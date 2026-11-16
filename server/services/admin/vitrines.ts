// A2 (D-A2-02) : vitrines vues et dépubliées par le superadmin. Dépublier = `blocage_admin` + motif ; `publiee_le`
// est CONSERVÉE : republier rétablit tout sans repasser par l'onboarding. Aucune édition du contenu par l'admin, aucune
// donnée de visiteur (des nombres seulement).
import { asc, count, eq, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_LISTE_LIMITE_DEFAUT } from '../../../shared/admin'
import { ADMIN_VITRINES_TRI_DEFAUT } from '../../../shared/admin-a2'
import { abonnements, liens, realisations, services, temoignages, users, vitrines } from '../../../shared/db/schema'
import type { ListeVitrinesQuery, PaginationAdmin } from '../../../shared/schemas/admin-a2'
import { ConflictError, NotFoundError } from '../../exceptions/http'
import { planifierRafraichissementCacheMedias } from '../../jobs/rafraichir-cache-medias'
import { db } from '../../utils/db'
import { lireGraceJours } from '../plans'
import {
  baseVitrines,
  normaliserRecherche,
  sqlPlanAbonnement,
  sqlRechercheVitrine,
  toutesLesConditions,
  versLigneVitrine,
} from './a2-lignes'
import type { PageAdmin, VitrineLigneVue } from './a2-lignes'
import { emettreEmailAdmin, horloge } from './a2-support'
import type { DepsEcritureReauth } from './a2-support'
import { enregistrer } from './audit'
import type { TransactionAdmin } from './audit'

export interface VitrineFicheVue extends VitrineLigneVue {
  publieeLe: Date | null
  compteurs: { services: number, realisations: number, temoignages: number, liens: number }
}

function conditionsFiltres(filtres: Partial<ListeVitrinesQuery>, now: Date, graceJours: number): (SQL | undefined)[] {
  return [
    filtres.q === undefined ? undefined : sqlRechercheVitrine(normaliserRecherche(filtres.q)),
    filtres.plan === undefined ? undefined : sql`${sqlPlanAbonnement(now, graceJours)} = ${filtres.plan}`,
    filtres.statut === 'publiee'
      ? sql`${vitrines.publieeLe} IS NOT NULL AND ${vitrines.blocageAdmin} = false`
      : undefined,
    filtres.statut === 'bloquee' ? eq(vitrines.blocageAdmin, true) : undefined,
    filtres.statut === 'non_publiee' ? sql`${vitrines.publieeLe} IS NULL` : undefined,
  ]
}

function ordreVitrines(filtres: Partial<ListeVitrinesQuery>): SQL[] {
  const sens = filtres.ordre === 'asc' ? sql`ASC` : sql`DESC`
  const departage = asc(vitrines.id)
  switch (filtres.tri ?? ADMIN_VITRINES_TRI_DEFAUT) {
    case 'username':
      return [sql`${vitrines.username} ${sens}`, departage]
    case 'nom':
      return [sql`lower(${vitrines.prenom} || ' ' || ${vitrines.nom}) ${sens}`, departage]
    case 'cree_le':
      return [sql`${vitrines.createdAt} ${sens}`, departage]
  }
}

/** Liste paginée par page (D-A2-12). */
export async function listerVitrines(
  filtres: Partial<ListeVitrinesQuery> = {},
  pagination: Partial<PaginationAdmin> = {},
  now: Date = new Date(),
): Promise<PageAdmin<VitrineLigneVue>> {
  const page = pagination.page ?? filtres.page ?? 1
  const limite = pagination.limite ?? filtres.limite ?? ADMIN_LISTE_LIMITE_DEFAUT
  const graceJours = await lireGraceJours()
  const condition = toutesLesConditions(conditionsFiltres(filtres, now, graceJours))
  const [lignes, [total]] = await Promise.all([
    baseVitrines()
      .where(condition)
      .orderBy(...ordreVitrines(filtres))
      .limit(limite)
      .offset((page - 1) * limite),
    db
      .select({ total: count() })
      .from(vitrines)
      .innerJoin(users, eq(users.id, vitrines.userId))
      .leftJoin(abonnements, eq(abonnements.userId, users.id))
      .where(condition),
  ])
  return { elements: lignes.map((ligne) => versLigneVitrine(ligne, now, graceJours)), total: total?.total ?? 0, page, limite }
}

/** Fiche d'une vitrine : 404 `VITRINE_INTROUVABLE`. Jamais de réservation, demande, message ni témoignage en contenu. */
export async function getFicheVitrine(id: string, now: Date = new Date()): Promise<VitrineFicheVue> {
  const [brute] = await baseVitrines().where(eq(vitrines.id, id)).limit(1)
  if (!brute) throw new NotFoundError('VITRINE_INTROUVABLE')
  const graceJours = await lireGraceJours()
  const [nbServices, nbRealisations, nbTemoignages, nbLiens] = await Promise.all([
    db.$count(services, eq(services.vitrineId, id)),
    db.$count(realisations, eq(realisations.vitrineId, id)),
    db.$count(temoignages, eq(temoignages.vitrineId, id)),
    db.$count(liens, eq(liens.vitrineId, id)),
  ])
  return {
    ...versLigneVitrine(brute, now, graceJours),
    publieeLe: brute.publieeLe,
    compteurs: { services: nbServices, realisations: nbRealisations, temoignages: nbTemoignages, liens: nbLiens },
  }
}

interface VitrineVerrouillee {
  id: string
  userId: string
  blocageAdmin: boolean
}

async function verrouillerVitrine(tx: TransactionAdmin, id: string): Promise<VitrineVerrouillee> {
  const [vitrine] = await tx
    .select({ id: vitrines.id, userId: vitrines.userId, blocageAdmin: vitrines.blocageAdmin })
    .from(vitrines)
    .where(eq(vitrines.id, id))
    .for('update')
    .limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')
  return vitrine
}

/**
 * Dépublie (`blocage_admin = true` + motif ; `publiee_le` conservée). Réauthentification exigée (`deps.reauth`).
 * L'e-mail au titulaire (avec le motif) est posé dans l'outbox DANS la transaction. Masquage public ≤ 10 s (cache nginx).
 */
export async function depublier(
  adminId: string,
  vitrineId: string,
  motif: string,
  ip: string,
  deps: DepsEcritureReauth,
): Promise<void> {
  const maintenant = horloge(deps)
  const userId = await db.transaction(async (tx) => {
    const vitrine = await verrouillerVitrine(tx, vitrineId)
    await deps.reauth(tx)
    if (vitrine.blocageAdmin) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    await tx.update(vitrines).set({ blocageAdmin: true, blocageMotif: motif }).where(eq(vitrines.id, vitrineId))
    const journal = await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.vitrineDepublier,
      cibleType: ADMIN_CIBLES.vitrine,
      cibleId: vitrineId,
      avant: { blocage_admin: false },
      apres: { blocage_admin: true },
      motif,
      ip,
    })
    await emettreEmailAdmin(tx, { userId: vitrine.userId, type: 'utilisateur_depubliee', numeroJournal: journal.numero, maintenant })
    return vitrine.userId
  })
  // Après le COMMIT (jamais dans la transaction) : vide le cache nginx des images du titulaire. Ne lève jamais.
  await planifierRafraichissementCacheMedias(userId)
}

/** Motif seul. Lève le blocage : si la vitrine était publiée par le professionnel, elle redevient visible. */
export async function republier(
  adminId: string,
  vitrineId: string,
  motif: string,
  ip: string,
): Promise<void> {
  const userId = await db.transaction(async (tx) => {
    const vitrine = await verrouillerVitrine(tx, vitrineId)
    if (!vitrine.blocageAdmin) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    await tx.update(vitrines).set({ blocageAdmin: false, blocageMotif: null }).where(eq(vitrines.id, vitrineId))
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.vitrineRepublier,
      cibleType: ADMIN_CIBLES.vitrine,
      cibleId: vitrineId,
      avant: { blocage_admin: true },
      apres: { blocage_admin: false },
      motif,
      ip,
    })
    return vitrine.userId
  })
  // Après le COMMIT : les images du titulaire (404 en cache) sont redemandées et reviennent en 200.
  await planifierRafraichissementCacheMedias(userId)
}
