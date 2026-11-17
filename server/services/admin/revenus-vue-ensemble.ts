// A3 (D-A3-12) : vue d'ensemble ENRICHIE de l'administration. Remplace `lireVueEnsemble` d'A1 (qui ne renvoyait aucun
// compteur). Compose les revenus du mois courant, les alertes et trois compteurs ; aucune donnée personnelle.
import { Temporal } from '@js-temporal/polyfill'
import { sql } from 'drizzle-orm'
import { SUPERADMIN } from '../../../shared/admin'
import { ADMIN_ACTIVITE_JOURS } from '../../../shared/admin-a2'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import { JOUR_MS } from '../../../shared/temps'
import { db } from '../../utils/db'
import { lireAlertes } from './alertes'
import type { AlertesAdmin } from './alertes'
import { lireRevenus, versEntierSur } from './revenus'

export interface VueEnsembleEnrichie {
  adminNom: string
  compteurs: { inscrits: number, vitrinesPubliees: number, abonnesPayants: number }
  /** Encaissé K-PAY du mois courant, par devise (brut présumé). */
  revenus: { devise: string, encaisseMoisCourant: number, nombre: number }[]
  indicateurReussite: { vitrinesActives: number, vitrinesPubliees: number }
  mention: string
  alertes: AlertesAdmin
  genereLe: Date
}

type LigneCompteurs = {
  inscrits: string | number
  vitrines_publiees: string | number
  abonnes_payants: string | number
  vitrines_actives: string | number
}

/**
 * Compteurs en UNE requête. « Vitrine active » = publiée avec au moins une vue (`vues.jour`) ou une réservation créée
 * sur `ADMIN_ACTIVITE_JOURS` jours. Les comptes d'administration ne sont pas des inscrits.
 */
async function lireCompteurs(now: Date): Promise<LigneCompteurs> {
  const jourDebut = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(ABONNEMENT_FUSEAU_REPLI)
    .toPlainDate()
    .subtract({ days: ADMIN_ACTIVITE_JOURS })
    .toString()
  const depuis = new Date(now.getTime() - ADMIN_ACTIVITE_JOURS * JOUR_MS).toISOString()
  const resultat = await db.execute<LigneCompteurs>(sql`
    SELECT
      (SELECT count(*) FROM users WHERE role <> ${SUPERADMIN}) AS inscrits,
      (SELECT count(*) FROM vitrines WHERE publiee_le IS NOT NULL) AS vitrines_publiees,
      (SELECT count(*) FROM abonnements WHERE origine = 'paiement' AND expire_le > ${now.toISOString()}::timestamptz) AS abonnes_payants,
      (SELECT count(*) FROM vitrines v
        WHERE v.publiee_le IS NOT NULL
          AND (EXISTS (SELECT 1 FROM vues x WHERE x.vitrine_id = v.id AND x.jour >= ${jourDebut}::date)
            OR EXISTS (SELECT 1 FROM reservations r WHERE r.vitrine_id = v.id AND r.created_at >= ${depuis}::timestamptz))
      ) AS vitrines_actives`)
  const ligne = resultat.rows[0]
  if (ligne === undefined) throw new Error('COMPTEURS_SANS_RESULTAT')
  return ligne
}

export async function lireVueEnsembleEnrichie(admin: { nom: string }, now: Date = new Date()): Promise<VueEnsembleEnrichie> {
  const [compteurs, revenus, alertes] = await Promise.all([lireCompteurs(now), lireRevenus(now), lireAlertes(now)])
  const vitrinesPubliees = versEntierSur(compteurs.vitrines_publiees)
  return {
    adminNom: admin.nom,
    compteurs: {
      inscrits: versEntierSur(compteurs.inscrits),
      vitrinesPubliees,
      abonnesPayants: versEntierSur(compteurs.abonnes_payants),
    },
    revenus: revenus.devises.map((carte) => ({
      devise: carte.devise,
      encaisseMoisCourant: carte.mois.courant.kpay.brut,
      nombre: carte.mois.courant.kpay.nombre,
    })),
    indicateurReussite: { vitrinesActives: versEntierSur(compteurs.vitrines_actives), vitrinesPubliees },
    mention: revenus.mention,
    alertes,
    genereLe: now,
  }
}
