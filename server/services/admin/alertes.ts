// A3 (D-A3-13) : alertes de l'administration. Lecture seule, identifiants bornés (jamais une liste sans fin), aucune
// donnée personnelle : des identifiants et des nombres.
import { sql } from 'drizzle-orm'
import { MOTIF_STATUT_FINAL } from '../paiements/transitions'
import {
  ADMIN_ALERTE_INCOHERENCES_MAX,
  ADMIN_ALERTE_PAIEMENT_OUVERT_MIN,
  ADMIN_ALERTE_TARDIFS_JOURS,
} from '../../../shared/limites'
import { MS_PAR_MINUTE, JOUR_MS } from '../../../shared/temps'
import { db } from '../../utils/db'
import { compterRefusDerniereHeure } from '../webhooks-refuses'
import { versEntierSur } from './revenus'

export interface AlertesAdmin {
  paiementsEnAttente: { nombre: number, ids: string[] }
  webhooksRefuses1h: number
  incoherences: { paiementsSansProlongation: string[], abonnementsSansPaiement: string[] }
  encaissementsTardifs: number
  genereLe: Date
}

type LigneId = { id: string }

/** Paiements `cree` / `en_attente` depuis PLUS de `ADMIN_ALERTE_PAIEMENT_OUVERT_MIN` minutes : nombre total et premiers identifiants. */
async function lirePaiementsOuverts(now: Date): Promise<{ nombre: number, ids: string[] }> {
  const limite = new Date(now.getTime() - ADMIN_ALERTE_PAIEMENT_OUVERT_MIN * MS_PAR_MINUTE).toISOString()
  const [total, ids] = await Promise.all([
    db.execute<{ nombre: string | number }>(sql`
      SELECT count(*) AS nombre FROM paiements
      WHERE statut IN ('cree', 'en_attente') AND created_at < ${limite}::timestamptz`),
    db.execute<LigneId>(sql`
      SELECT id FROM paiements
      WHERE statut IN ('cree', 'en_attente') AND created_at < ${limite}::timestamptz
      ORDER BY created_at ASC, id ASC LIMIT ${ADMIN_ALERTE_INCOHERENCES_MAX}`),
  ])
  return { nombre: versEntierSur(total.rows[0]?.nombre), ids: ids.rows.map((ligne) => ligne.id) }
}

/** Paiement `reussi` dont l'abonnement n'a pas été prolongé jusqu'à l'échéance enregistrée (ou n'existe pas). */
async function lirePaiementsSansProlongation(): Promise<string[]> {
  const resultat = await db.execute<LigneId>(sql`
    SELECT p.id FROM paiements p LEFT JOIN abonnements a ON a.user_id = p.user_id
    WHERE p.statut = 'reussi' AND p.user_id IS NOT NULL
      AND (a.id IS NULL OR a.expire_le < p.abonnement_expire_apres)
    ORDER BY p.created_at DESC, p.id LIMIT ${ADMIN_ALERTE_INCOHERENCES_MAX}`)
  return resultat.rows.map((ligne) => ligne.id)
}

/** Abonnement payant en cours sans aucun paiement `reussi` : un abonnement `offert` ou `admin` n'est JAMAIS signalé. */
async function lireAbonnementsSansPaiement(now: Date): Promise<string[]> {
  const resultat = await db.execute<LigneId>(sql`
    SELECT a.id FROM abonnements a
    WHERE a.origine = 'paiement' AND a.expire_le > ${now.toISOString()}::timestamptz
      AND NOT EXISTS (SELECT 1 FROM paiements p WHERE p.user_id = a.user_id AND p.statut = 'reussi')
    ORDER BY a.created_at DESC, a.id LIMIT ${ADMIN_ALERTE_INCOHERENCES_MAX}`)
  return resultat.rows.map((ligne) => ligne.id)
}

/** Événements du fournisseur ignorés parce que le paiement était déjà final (ex. encaissement tardif après un marquage manuel). */
async function compterEncaissementsTardifs(now: Date): Promise<number> {
  const depuis = new Date(now.getTime() - ADMIN_ALERTE_TARDIFS_JOURS * JOUR_MS).toISOString()
  const resultat = await db.execute<{ nombre: string | number }>(sql`
    SELECT count(*) AS nombre FROM evenements_paiement
    WHERE traitement = 'ignore' AND motif = ${MOTIF_STATUT_FINAL} AND recu_le >= ${depuis}::timestamptz`)
  return versEntierSur(resultat.rows[0]?.nombre)
}

export async function lireAlertes(now: Date = new Date()): Promise<AlertesAdmin> {
  const [paiementsEnAttente, webhooksRefuses1h, paiementsSansProlongation, abonnementsSansPaiement, encaissementsTardifs] =
    await Promise.all([
      lirePaiementsOuverts(now),
      compterRefusDerniereHeure(now),
      lirePaiementsSansProlongation(),
      lireAbonnementsSansPaiement(now),
      compterEncaissementsTardifs(now),
    ])
  return {
    paiementsEnAttente,
    webhooksRefuses1h,
    incoherences: { paiementsSansProlongation, abonnementsSansPaiement },
    encaissementsTardifs,
    genereLe: now,
  }
}
