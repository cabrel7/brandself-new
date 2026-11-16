// A2 : comptes vus et administrés par le superadmin. Lectures : listes à tri et filtres en liste blanche, fiche
// (jamais de donnée de visiteur : des NOMBRES seulement). Écritures : UNE transaction chacune = verrou du compte,
// réauthentification (si exigée), changement d'état, entrée de journal, ligne d'outbox de l'e-mail au titulaire.
// Si l'une des étapes échoue, aucune n'existe (CA10).
import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_LISTE_LIMITE_DEFAUT } from '../../../shared/admin'
import {
  ADMIN_ACTIVITE_JOURS,
  ADMIN_FICHE_LIGNES_MAX,
  ADMIN_UTILISATEURS_TRI_DEFAUT,
} from '../../../shared/admin-a2'
import type { AbonnementOrigine } from '../../../shared/admin-a2'
import {
  abonnements,
  capacitesAccordees,
  demandes,
  liens,
  messages,
  realisations,
  reservations,
  services,
  sessions,
  temoignages,
  users,
  vitrines,
  vues,
} from '../../../shared/db/schema'
import type { CapacitePayante, PlanId } from '../../../shared/plans'
import type { ListeUtilisateursQuery, PaginationAdmin } from '../../../shared/schemas/admin-a2'
import { ConflictError, NotFoundError, UnprocessableError } from '../../exceptions/http'
import { planifierRafraichissementCacheMedias } from '../../jobs/rafraichir-cache-medias'
import { db } from '../../utils/db'
import { activerPayantParAdmin, offrirJours as offrirJoursAbonnement, supprimerAbonnement } from '../abonnements-offrir'
import { getIaQuota, lireGraceJours } from '../plans'
import { supprimerCompteDansTransaction, supprimerFichiersDuCompte } from '../utilisateurs'
import {
  FUSEAU_FILTRES,
  baseUtilisateurs,
  normaliserRecherche,
  planDuCompte,
  sqlDerniereConnexion,
  sqlEtatAbonnement,
  sqlPlanAbonnement,
  sqlRechercheUtilisateur,
  toutesLesConditions,
  versLigneUtilisateur,
} from './a2-lignes'
import type { PageAdmin, UtilisateurLigneVue } from './a2-lignes'
import {
  annulerEmailsEnAttenteDuCompte,
  emettreEmailAdmin,
  horloge,
  refuserCompteAdmin,
  rejouerSiDejaFait,
  revoquerAccesOauth,
} from './a2-support'
import type { DepsEcriture, DepsEcritureReauth } from './a2-support'
import { lireAssistants } from './assistants'
import type { AssistantVue } from './assistants'
import { enregistrer } from './audit'
import type { TransactionAdmin } from './audit'

export interface UtilisateurFicheVue extends UtilisateurLigneVue {
  /** Téléphone du PROFESSIONNEL titulaire (jamais d'un visiteur). */
  telephone: string | null
  pays: string | null
  devise: string
  fuseau: string
  motifSuspension: string | null
  abonnement: { origine: AbonnementOrigine, expireLe: Date, premiereActivationLe: Date } | null
  compteurs: { services: number, realisations: number, temoignages: number, liens: number }
  activite30j: { vues: number, reservations: number, demandes: number, messages: number }
  iaMois: number
  sessionsActives: { id: string, creeLe: Date, expireLe: Date }[]
  assistants: AssistantVue[]
  /** Capacités ACCORDÉES par l'administration (actives, non révoquées), hors plan. */
  capacites: CapacitePayante[]
}

export interface ResultatOffreJours {
  expireLe: Date
  rejoue: boolean
}

export interface ResultatChangementPlan {
  plan: PlanId
  /** Nouvelle échéance (passage au payant) ; `null` au retour au gratuit. */
  expireLe: Date | null
  rejoue: boolean
}

const MS_PAR_JOUR = 86_400_000
const CIBLE_UTILISATEUR = ADMIN_CIBLES.utilisateur

// ---------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------

function conditionsFiltres(filtres: Partial<ListeUtilisateursQuery>, now: Date, graceJours: number): (SQL | undefined)[] {
  return [
    filtres.q === undefined ? undefined : sqlRechercheUtilisateur(normaliserRecherche(filtres.q)),
    filtres.plan === undefined ? undefined : sql`${sqlPlanAbonnement(now, graceJours)} = ${filtres.plan}`,
    filtres.etat === undefined ? undefined : sql`${sqlEtatAbonnement(now, graceJours)} = ${filtres.etat}`,
    filtres.suspendu === undefined ? undefined : eq(users.banned, filtres.suspendu),
    filtres.vitrine === 'publiee'
      ? sql`${vitrines.publieeLe} IS NOT NULL AND ${vitrines.blocageAdmin} = false`
      : undefined,
    filtres.vitrine === 'bloquee' ? eq(vitrines.blocageAdmin, true) : undefined,
    filtres.vitrine === 'aucune' ? sql`${vitrines.id} IS NULL` : undefined,
    filtres.du === undefined
      ? undefined
      : gte(users.createdAt, sql`((${filtres.du}::date)::timestamp AT TIME ZONE ${FUSEAU_FILTRES})`),
    filtres.au === undefined
      ? undefined
      : lt(users.createdAt, sql`(((${filtres.au}::date) + 1)::timestamp AT TIME ZONE ${FUSEAU_FILTRES})`),
  ]
}

function ordreUtilisateurs(filtres: Partial<ListeUtilisateursQuery>, now: Date, graceJours: number): SQL[] {
  const sens = filtres.ordre === 'asc' ? sql`ASC` : sql`DESC`
  const tri = filtres.tri ?? ADMIN_UTILISATEURS_TRI_DEFAUT
  const departage = asc(users.id)
  switch (tri) {
    case 'email':
      return [sql`lower(${users.email}) ${sens}`, departage]
    case 'derniere_connexion':
      return [sql`${sqlDerniereConnexion()} ${sens} NULLS LAST`, departage]
    case 'plan':
      return [sql`(CASE WHEN ${sqlPlanAbonnement(now, graceJours)} = 'gratuit' THEN 0 ELSE 1 END) ${sens}`, departage]
    case 'cree_le':
      return [sql`${users.createdAt} ${sens}`, departage]
  }
}

/** Liste paginée par page (D-A2-12). `pagination` complète ou remplace `page` et `limite` du filtre. */
export async function listerUtilisateurs(
  filtres: Partial<ListeUtilisateursQuery> = {},
  pagination: Partial<PaginationAdmin> = {},
  now: Date = new Date(),
): Promise<PageAdmin<UtilisateurLigneVue>> {
  const page = pagination.page ?? filtres.page ?? 1
  const limite = pagination.limite ?? filtres.limite ?? ADMIN_LISTE_LIMITE_DEFAUT
  const graceJours = await lireGraceJours()
  const condition = toutesLesConditions(conditionsFiltres(filtres, now, graceJours))
  const [lignes, [total]] = await Promise.all([
    baseUtilisateurs()
      .where(condition)
      .orderBy(...ordreUtilisateurs(filtres, now, graceJours))
      .limit(limite)
      .offset((page - 1) * limite),
    db
      .select({ total: count() })
      .from(users)
      .leftJoin(vitrines, eq(vitrines.userId, users.id))
      .leftJoin(abonnements, eq(abonnements.userId, users.id))
      .where(condition),
  ])
  return { elements: lignes.map((ligne) => versLigneUtilisateur(ligne, now, graceJours)), total: total?.total ?? 0, page, limite }
}

function versOrigine(valeur: string): AbonnementOrigine {
  return valeur === 'offert' || valeur === 'admin' ? valeur : 'paiement'
}

/** Fiche d'un compte : 404 `UTILISATEUR_INTROUVABLE`. Des nombres seulement pour l'activité (aucun contenu de visiteur). */
export async function getFicheUtilisateur(id: string, now: Date = new Date()): Promise<UtilisateurFicheVue> {
  const [brute] = await baseUtilisateurs().where(eq(users.id, id)).limit(1)
  if (!brute) throw new NotFoundError('UTILISATEUR_INTROUVABLE')
  const ligne = versLigneUtilisateur(brute, now, await lireGraceJours())

  const [detail] = await db
    .select({
      telephone: users.phoneNumber,
      devise: users.devise,
      fuseau: users.fuseau,
      motifSuspension: users.banReason,
      pays: vitrines.pays,
    })
    .from(users)
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .where(eq(users.id, id))
    .limit(1)
  if (!detail) throw new NotFoundError('UTILISATEUR_INTROUVABLE')

  const [abonnement] = await db.select().from(abonnements).where(eq(abonnements.userId, id)).limit(1)
  const depuis = new Date(now.getTime() - ADMIN_ACTIVITE_JOURS * MS_PAR_JOUR)
  const vitrineId = brute.vitrineId
  const [compteurs, activite, iaMois, sessionsActives, assistants, capacites] = await Promise.all([
    compterContenus(vitrineId),
    compterActivite(vitrineId, depuis),
    getIaQuota(id, now).then((quota) => quota.utilisees),
    db
      .select({ id: sessions.id, creeLe: sessions.createdAt, expireLe: sessions.expiresAt })
      .from(sessions)
      .where(and(eq(sessions.userId, id), sql`${sessions.expiresAt} > ${now.toISOString()}::timestamptz`))
      .orderBy(desc(sessions.createdAt))
      .limit(ADMIN_FICHE_LIGNES_MAX),
    lireAssistants(db, id),
    db
      .select({ capacite: capacitesAccordees.capacite })
      .from(capacitesAccordees)
      .where(and(eq(capacitesAccordees.userId, id), isNull(capacitesAccordees.revoqueLe)))
      .orderBy(capacitesAccordees.capacite),
  ])

  return {
    ...ligne,
    capacites: capacites.map((c) => c.capacite as CapacitePayante),
    telephone: detail.telephone,
    pays: detail.pays,
    devise: detail.devise,
    fuseau: detail.fuseau,
    motifSuspension: detail.motifSuspension,
    abonnement: abonnement
      ? {
          origine: versOrigine(abonnement.origine),
          expireLe: abonnement.expireLe,
          premiereActivationLe: abonnement.premiereActivationLe,
        }
      : null,
    compteurs,
    activite30j: activite,
    iaMois,
    sessionsActives,
    assistants,
  }
}

async function compterContenus(vitrineId: string | null): Promise<UtilisateurFicheVue['compteurs']> {
  if (vitrineId === null) return { services: 0, realisations: 0, temoignages: 0, liens: 0 }
  const [nbServices, nbRealisations, nbTemoignages, nbLiens] = await Promise.all([
    db.$count(services, eq(services.vitrineId, vitrineId)),
    db.$count(realisations, eq(realisations.vitrineId, vitrineId)),
    db.$count(temoignages, eq(temoignages.vitrineId, vitrineId)),
    db.$count(liens, eq(liens.vitrineId, vitrineId)),
  ])
  return { services: nbServices, realisations: nbRealisations, temoignages: nbTemoignages, liens: nbLiens }
}

/** Nombres seulement : jamais le nom, l'e-mail, le téléphone ni le contenu d'un visiteur. */
async function compterActivite(vitrineId: string | null, depuis: Date): Promise<UtilisateurFicheVue['activite30j']> {
  if (vitrineId === null) return { vues: 0, reservations: 0, demandes: 0, messages: 0 }
  const [nbVues, nbReservations, nbDemandes, nbMessages] = await Promise.all([
    db.$count(vues, and(eq(vues.vitrineId, vitrineId), gte(vues.createdAt, depuis))),
    db.$count(reservations, and(eq(reservations.vitrineId, vitrineId), gte(reservations.createdAt, depuis))),
    db.$count(demandes, and(eq(demandes.vitrineId, vitrineId), gte(demandes.createdAt, depuis))),
    db.$count(messages, and(eq(messages.vitrineId, vitrineId), gte(messages.createdAt, depuis))),
  ])
  return { vues: nbVues, reservations: nbReservations, demandes: nbDemandes, messages: nbMessages }
}

// ---------------------------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------------------------

interface CompteVerrouille {
  id: string
  role: string
  email: string
  fuseau: string
  suspendu: boolean
}

/** Verrouille la ligne du compte (FOR UPDATE) : deux actions concurrentes sur un même compte se sérialisent. */
async function verrouillerCompte(tx: TransactionAdmin, id: string): Promise<CompteVerrouille> {
  const [compte] = await tx
    .select({ id: users.id, role: users.role, email: users.email, fuseau: users.fuseau, suspendu: users.banned })
    .from(users)
    .where(eq(users.id, id))
    .for('update')
    .limit(1)
  if (!compte) throw new NotFoundError('UTILISATEUR_INTROUVABLE')
  return compte
}

/** D-A2-01. Réauthentification exigée (`deps.reauth`). */
export async function suspendre(
  adminId: string,
  utilisateurId: string,
  motif: string,
  ip: string,
  deps: DepsEcritureReauth,
): Promise<void> {
  const maintenant = horloge(deps)
  await db.transaction(async (tx) => {
    const compte = await verrouillerCompte(tx, utilisateurId)
    refuserCompteAdmin(compte.role)
    await deps.reauth(tx)
    if (compte.suspendu) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    await tx
      .update(users)
      .set({ banned: true, banReason: motif, banExpires: null, updatedAt: maintenant })
      .where(eq(users.id, utilisateurId))
    // Sessions et accès OAuth supprimés : la session ouverte répond 401 dès la requête suivante (CA01).
    await tx.delete(sessions).where(eq(sessions.userId, utilisateurId))
    await revoquerAccesOauth(tx, utilisateurId)
    const journal = await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurSuspendre,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      avant: { suspendu: false },
      apres: { suspendu: true },
      motif,
      ip,
    })
    await emettreEmailAdmin(tx, { userId: utilisateurId, type: 'utilisateur_suspendu', numeroJournal: journal.numero, maintenant })
  })
  // Après le COMMIT (jamais dans la transaction) : vide le cache nginx des images du compte. Ne lève jamais.
  await planifierRafraichissementCacheMedias(utilisateurId)
}

/** Motif seul. La vitrine et les écritures visiteur reviennent sans autre action (CA04). */
export async function reactiver(
  adminId: string,
  utilisateurId: string,
  motif: string,
  ip: string,
  deps: DepsEcriture = {},
): Promise<void> {
  const maintenant = horloge(deps)
  await db.transaction(async (tx) => {
    const compte = await verrouillerCompte(tx, utilisateurId)
    if (!compte.suspendu) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    await tx
      .update(users)
      .set({ banned: false, banReason: null, banExpires: null, updatedAt: maintenant })
      .where(eq(users.id, utilisateurId))
    const journal = await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurReactiver,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      avant: { suspendu: true },
      apres: { suspendu: false },
      motif,
      ip,
    })
    await emettreEmailAdmin(tx, { userId: utilisateurId, type: 'utilisateur_reactive', numeroJournal: journal.numero, maintenant })
  })
  // Après le COMMIT : les images du compte (404 en cache) sont redemandées et reviennent en 200.
  await planifierRafraichissementCacheMedias(utilisateurId)
}

function dateJournal(valeur: unknown): Date {
  if (typeof valeur !== 'string') throw new Error('JOURNAL_ECHEANCE_ILLISIBLE')
  return new Date(valeur)
}

/** D-A2-04, D-A2-06. Motif seul ; `cle` = en-tête `Idempotency-Key`. Un rejeu identique ne change rien. */
export async function offrirJours(
  adminId: string,
  utilisateurId: string,
  jours: number,
  cle: string,
  motif: string,
  ip: string,
  deps: DepsEcriture = {},
): Promise<ResultatOffreJours> {
  const maintenant = horloge(deps)
  return db.transaction(async (tx) => {
    const rejeu = await rejouerSiDejaFait(tx, adminId, cle, {
      action: ADMIN_ACTIONS.utilisateurOffrirJours,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      motif,
      parametres: { jours },
    })
    if (rejeu) return { expireLe: dateJournal(rejeu.apres.expire_le), rejoue: true }

    await verrouillerCompte(tx, utilisateurId)
    const offre = await offrirJoursAbonnement(tx, utilisateurId, jours, maintenant)
    const journal = await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurOffrirJours,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      avant: { expire_le: offre.avant?.expireLe.toISOString() ?? null, origine: offre.avant?.origine ?? null },
      // A3 lit `jours` dans `apres` : ne pas le retirer.
      apres: { expire_le: offre.apres.expireLe.toISOString(), origine: offre.apres.origine, jours },
      motif,
      ip,
      cleIdempotence: cle,
    })
    await emettreEmailAdmin(tx, { userId: utilisateurId, type: 'utilisateur_jours_offerts', numeroJournal: journal.numero, maintenant })
    return { expireLe: offre.apres.expireLe, rejoue: false }
  })
}

/**
 * D-A2-05. `payant` exige `jours` (1 à 365) et crée la ligne `origine='admin'` ; `gratuit` supprime la ligne
 * d'abonnement (sans grâce, paiements conservés). Réauthentification exigée (`deps.reauth`), après la vérification du
 * rejeu : un rejeu n'a pas à consommer un nouveau code.
 */
export async function changerPlan(
  adminId: string,
  utilisateurId: string,
  plan: PlanId,
  jours: number | null,
  cle: string,
  motif: string,
  ip: string,
  deps: DepsEcritureReauth,
): Promise<ResultatChangementPlan> {
  const maintenant = horloge(deps)
  const graceJours = await lireGraceJours()
  if (plan === 'payant' && jours === null) {
    throw new UnprocessableError('VALIDATION', { champs: { jours: ['Indiquez le nombre de jours.'] } })
  }
  const joursDemandes = plan === 'payant' ? jours : null
  return db.transaction(async (tx) => {
    const rejeu = await rejouerSiDejaFait(tx, adminId, cle, {
      action: ADMIN_ACTIONS.utilisateurChangerPlan,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      motif,
      parametres: { plan, jours: joursDemandes },
    })
    if (rejeu) {
      const echeance = rejeu.apres.expire_le
      return { plan, expireLe: typeof echeance === 'string' ? new Date(echeance) : null, rejoue: true }
    }

    const compte = await verrouillerCompte(tx, utilisateurId)
    await deps.reauth(tx)
    const [abonnement] = await tx.select().from(abonnements).where(eq(abonnements.userId, utilisateurId)).limit(1)
    const avant = planDuCompte(
      { plan: abonnement?.plan ?? null, expireLe: abonnement?.expireLe ?? null },
      compte.fuseau,
      maintenant,
      graceJours,
    )

    let expireLe: Date | null = null
    if (plan === 'payant') {
      if (avant.plan === 'payant') throw new ConflictError('ETAT_DEJA_APPLIQUE')
      expireLe = (await activerPayantParAdmin(tx, utilisateurId, joursDemandes ?? 0, maintenant)).apres.expireLe
    } else {
      if (avant.plan === 'gratuit') throw new ConflictError('ETAT_DEJA_APPLIQUE')
      await supprimerAbonnement(tx, utilisateurId)
    }

    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurChangerPlan,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      avant: { plan: avant.plan },
      apres: { plan, expire_le: expireLe?.toISOString() ?? null, jours: joursDemandes },
      motif,
      ip,
      cleIdempotence: cle,
    })
    return { plan, expireLe, rejoue: false }
  })
}

/** Motif seul. Supprime TOUTES les sessions du compte. Renvoie le nombre de sessions supprimées. */
export async function revoquerSessions(
  adminId: string,
  utilisateurId: string,
  motif: string,
  ip: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const compte = await verrouillerCompte(tx, utilisateurId)
    refuserCompteAdmin(compte.role)
    const supprimees = await tx.delete(sessions).where(eq(sessions.userId, utilisateurId)).returning({ id: sessions.id })
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurRevoquerSessions,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      apres: { sessions: supprimees.length },
      motif,
      ip,
    })
    return supprimees.length
  })
}

/** Motif seul. Retire TOUS les assistants du compte (consentements et jetons). Renvoie le nombre d'assistants retirés. */
export async function retirerAssistants(
  adminId: string,
  utilisateurId: string,
  motif: string,
  ip: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    await verrouillerCompte(tx, utilisateurId)
    const retires = await revoquerAccesOauth(tx, utilisateurId)
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurRetirerAssistants,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      apres: { assistants: retires },
      motif,
      ip,
    })
    return retires
  })
}

/**
 * D-A2-08. Confirmation par l'adresse e-mail EXACTE du compte (casse ignorée) + réauthentification (`deps.reauth`).
 * Une transaction : e-mails en attente du compte annulés, journal (identifiants seulement), suppression du compte
 * (cascade ; `paiements.user_id` passe à NULL). Les fichiers d'images sont effacés après le commit. Aucun e-mail
 * n'est envoyé au compte supprimé.
 */
export async function supprimer(
  adminId: string,
  utilisateurId: string,
  emailSaisi: string,
  motif: string,
  ip: string,
  deps: DepsEcritureReauth,
): Promise<void> {
  const maintenant = horloge(deps)
  await db.transaction(async (tx) => {
    const compte = await verrouillerCompte(tx, utilisateurId)
    refuserCompteAdmin(compte.role)
    if (emailSaisi.trim().toLowerCase() !== compte.email.toLowerCase()) throw new UnprocessableError('CONFIRMATION_EMAIL_INVALIDE')
    await deps.reauth(tx)
    await annulerEmailsEnAttenteDuCompte(tx, utilisateurId, maintenant)
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.utilisateurSupprimer,
      cibleType: CIBLE_UTILISATEUR,
      cibleId: utilisateurId,
      avant: { suspendu: compte.suspendu },
      apres: { supprime: true },
      motif,
      ip,
    })
    await supprimerCompteDansTransaction(tx, utilisateurId)
  })
  await supprimerFichiersDuCompte(utilisateurId)
}

