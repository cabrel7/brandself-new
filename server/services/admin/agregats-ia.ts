// A4 (D-A4-17) : agrégats IA sur 30 jours au plus. SQL à colonnes explicites : `entree` et `sortie` ne sont JAMAIS lus
// (la table est purgée à 30 jours). Le top des consommateurs est un identifiant de compte (jamais d'e-mail ni de nom).
import { sql } from 'drizzle-orm'
import { ADMIN_SUPERVISION_TOP_MAX } from '../../../shared/admin'
import type { GenerationStatut, IaType, MotifRepli } from '../../../shared/ia'
import { JOUR_MS } from '../../../shared/temps'
import { db } from '../../utils/db'
import { limiteDe } from '../plans'
import { PLAN_GRATUIT_ID } from '../../config/plans'

export interface AgregatsIaVue {
  jours: number
  total: number
  parStatut: { statut: GenerationStatut, nombre: number }[]
  parMotifRepli: { motif: MotifRepli, nombre: number }[]
  parType: { type: IaType, nombre: number }[]
  parFournisseur: { fournisseur: string | null, nombre: number }[]
  tokensEntree: number
  tokensSortie: number
  dureeMoyenneMs: number | null
  injectionsSuspectees: number
  quotaGratuitMois: number | null
  consommateurs: { utilisateurId: string, nombre: number }[]
  genereLe: Date
}

const entier = (valeur: string | number | null | undefined): number => Number(valeur ?? 0)

export async function lireAgregatsIa(jours: number, maintenant: Date = new Date()): Promise<AgregatsIaVue> {
  const depuis = new Date(maintenant.getTime() - jours * JOUR_MS).toISOString()
  const fenetre = sql`created_at >= ${depuis}::timestamptz`
  const [statuts, motifs, types, fournisseurs, totaux, consommateurs] = await Promise.all([
    db.execute<{ statut: GenerationStatut, nombre: string }>(sql`
      SELECT statut, count(*) AS nombre FROM generations_ia WHERE ${fenetre} GROUP BY statut ORDER BY statut`),
    db.execute<{ motif: MotifRepli, nombre: string }>(sql`
      SELECT motif_repli AS motif, count(*) AS nombre FROM generations_ia
      WHERE ${fenetre} AND motif_repli IS NOT NULL GROUP BY motif_repli ORDER BY motif_repli`),
    db.execute<{ type: IaType, nombre: string }>(sql`
      SELECT type, count(*) AS nombre FROM generations_ia WHERE ${fenetre} GROUP BY type ORDER BY type`),
    db.execute<{ fournisseur: string | null, nombre: string }>(sql`
      SELECT fournisseur, count(*) AS nombre FROM generations_ia WHERE ${fenetre} GROUP BY fournisseur ORDER BY fournisseur NULLS FIRST`),
    db.execute<{ total: string, tokens_entree: string | null, tokens_sortie: string | null, duree: string | null, injections: string }>(sql`
      SELECT count(*) AS total, sum(tokens_entree) AS tokens_entree, sum(tokens_sortie) AS tokens_sortie,
             round(avg(duree_ms)) AS duree, count(*) FILTER (WHERE injection_suspectee) AS injections
      FROM generations_ia WHERE ${fenetre}`),
    db.execute<{ utilisateur_id: string, nombre: string }>(sql`
      SELECT user_id AS utilisateur_id, count(*) AS nombre FROM generations_ia WHERE ${fenetre}
      GROUP BY user_id ORDER BY count(*) DESC, user_id LIMIT ${ADMIN_SUPERVISION_TOP_MAX}`),
  ])
  const ligne = totaux.rows[0]
  return {
    jours,
    total: entier(ligne?.total),
    parStatut: statuts.rows.map((r) => ({ statut: r.statut, nombre: entier(r.nombre) })),
    parMotifRepli: motifs.rows.map((r) => ({ motif: r.motif, nombre: entier(r.nombre) })),
    parType: types.rows.map((r) => ({ type: r.type, nombre: entier(r.nombre) })),
    parFournisseur: fournisseurs.rows.map((r) => ({ fournisseur: r.fournisseur, nombre: entier(r.nombre) })),
    tokensEntree: entier(ligne?.tokens_entree),
    tokensSortie: entier(ligne?.tokens_sortie),
    dureeMoyenneMs: ligne?.duree === null || ligne?.duree === undefined ? null : entier(ligne.duree),
    injectionsSuspectees: entier(ligne?.injections),
    // Affiché seulement : la valeur se modifie dans les versions de plan (A5, D-A4-12).
    quotaGratuitMois: limiteDe(PLAN_GRATUIT_ID, 'generations_ia_mois'),
    consommateurs: consommateurs.rows.map((r) => ({ utilisateurId: r.utilisateur_id, nombre: entier(r.nombre) })),
    genereLe: maintenant,
  }
}
