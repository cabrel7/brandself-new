// A3 (D-A3-01, D-A3-02) : revenus PAR DEVISE, jamais d'addition entre devises. « Encaissé » = somme de `montant` des
// paiements `reussi`, bornée par `applique_le` dans le mois (fuseau `Africa/Douala`). Montant brut présumé : aucun net
// inventé. Entiers seulement (les agrégats `sum(bigint)` arrivent en chaîne : `Number.isSafeInteger` ou erreur).
import { Temporal } from '@js-temporal/polyfill'
import { sql } from 'drizzle-orm'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import {
  PAIEMENT_SOURCE_KPAY,
  PAIEMENT_SOURCE_MANUEL,
  REVENUS_MENTION_INCERTITUDE,
} from '../../../shared/admin-paiements'
import { ADMIN_REVENUS_REPARTITION_MOIS } from '../../../shared/limites'
import { ABONNEMENT_FUSEAU_REPLI, PERIODES_MOIS } from '../../../shared/plans'
import type { PeriodeMois } from '../../../shared/plans'
import { db } from '../../utils/db'

export interface AgregatRevenu {
  brut: number
  nombre: number
  fraisReels: number
  nombreSansFrais: number
}

export interface PeriodeRevenu {
  debut: Date
  fin: Date
  kpay: AgregatRevenu
  manuel: AgregatRevenu
}

export interface RevenuDevise {
  devise: string
  mois: { courant: PeriodeRevenu, precedent: PeriodeRevenu }
  abonnesActifs: number
  repartition: { periodeMois: PeriodeMois, nombre: number, brut: number }[]
}

export interface RevenusAdmin {
  devises: RevenuDevise[]
  offerts: { jours: number, nombre: number }
  mention: string
  genereLe: Date
}

export interface BornesMois {
  courant: { debut: Date, fin: Date }
  precedent: { debut: Date, fin: Date }
  /** Début du plus ancien des `ADMIN_REVENUS_REPARTITION_MOIS` mois de la répartition (le mois courant compris). */
  debutRepartition: Date
}

/** Entier sûr depuis un agrégat PostgreSQL (`sum(bigint)` = chaîne). Toute autre valeur est une erreur, jamais un montant arrondi. */
export function versEntierSur(valeur: string | number | bigint | null | undefined): number {
  if (valeur === null || valeur === undefined) return 0
  const nombre = typeof valeur === 'number' ? valeur : Number(valeur)
  if (!Number.isSafeInteger(nombre) || nombre < 0) throw new RangeError('AGREGAT_NON_ENTIER')
  return nombre
}

/** Mois civils courant et précédent dans le fuseau de l'administration, bornes `[début, fin[` en instants. PURE. */
export function bornesMois(now: Date, fuseau: string = ABONNEMENT_FUSEAU_REPLI): BornesMois {
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(fuseau)
  const debutCourant = local.toPlainDate().with({ day: 1 }).toZonedDateTime(fuseau)
  const enDate = (zone: Temporal.ZonedDateTime): Date => new Date(zone.epochMilliseconds)
  const debutPrecedent = debutCourant.subtract({ months: 1 })
  return {
    courant: { debut: enDate(debutCourant), fin: enDate(debutCourant.add({ months: 1 })) },
    precedent: { debut: enDate(debutPrecedent), fin: enDate(debutCourant) },
    debutRepartition: enDate(debutCourant.subtract({ months: ADMIN_REVENUS_REPARTITION_MOIS - 1 })),
  }
}

const AGREGAT_VIDE: AgregatRevenu = { brut: 0, nombre: 0, fraisReels: 0, nombreSansFrais: 0 }

type LigneAgregat = {
  devise: string
  source: string
  nombre: string | number
  brut: string | number | null
  frais: string | number | null
  sans_frais: string | number
}

/** Une période : paiements `reussi` appliqués dans `[debut, fin[`, par devise et par source. */
async function agregerPeriode(debut: Date, fin: Date): Promise<Map<string, { kpay: AgregatRevenu, manuel: AgregatRevenu }>> {
  const resultat = await db.execute<LigneAgregat>(sql`
    SELECT devise, source, count(*) AS nombre, COALESCE(sum(montant), 0) AS brut,
           COALESCE(sum(frais_reels) FILTER (WHERE frais_reels IS NOT NULL), 0) AS frais,
           count(*) FILTER (WHERE frais_reels IS NULL) AS sans_frais
    FROM paiements
    WHERE statut = 'reussi' AND applique_le >= ${debut.toISOString()}::timestamptz AND applique_le < ${fin.toISOString()}::timestamptz
    GROUP BY devise, source`)
  const parDevise = new Map<string, { kpay: AgregatRevenu, manuel: AgregatRevenu }>()
  for (const ligne of resultat.rows) {
    const entree = parDevise.get(ligne.devise) ?? { kpay: AGREGAT_VIDE, manuel: AGREGAT_VIDE }
    const agregat: AgregatRevenu = {
      brut: versEntierSur(ligne.brut),
      nombre: versEntierSur(ligne.nombre),
      fraisReels: versEntierSur(ligne.frais),
      nombreSansFrais: versEntierSur(ligne.sans_frais),
    }
    if (ligne.source === PAIEMENT_SOURCE_KPAY) entree.kpay = agregat
    else if (ligne.source === PAIEMENT_SOURCE_MANUEL) entree.manuel = agregat
    parDevise.set(ligne.devise, entree)
  }
  return parDevise
}

/** Abonnés PAYANTS (origine `paiement`, jamais `offert`/`admin`) en cours (`expire_le > now`, la grâce n'est pas active) par devise du DERNIER paiement (repli : devise du compte) : l'abonnement n'a pas de devise propre. */
export async function compterAbonnesActifsParDevise(now: Date): Promise<Map<string, number>> {
  const resultat = await db.execute<{ devise: string, nombre: string | number }>(sql`
    SELECT COALESCE(p.devise, u.devise) AS devise, count(*) AS nombre
    FROM abonnements a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN paiements p ON p.id = a.dernier_paiement_id
    WHERE a.origine = 'paiement' AND a.expire_le > ${now.toISOString()}::timestamptz
    GROUP BY COALESCE(p.devise, u.devise)`)
  return new Map(resultat.rows.map((ligne) => [ligne.devise, versEntierSur(ligne.nombre)]))
}

/** Jours offerts : lus dans `journal_admin` (`utilisateur.offrir_jours`, `apres.jours`), tous temps confondus. */
async function lireOfferts(): Promise<{ jours: number, nombre: number }> {
  const resultat = await db.execute<{ jours: string | number, nombre: string | number }>(sql`
    SELECT COALESCE(sum((apres ->> 'jours')::bigint), 0) AS jours, count(*) AS nombre
    FROM journal_admin
    WHERE action = ${ADMIN_ACTIONS.utilisateurOffrirJours} AND apres ->> 'jours' ~ '^[0-9]{1,6}$'`)
  const ligne = resultat.rows[0]
  return { jours: versEntierSur(ligne?.jours), nombre: versEntierSur(ligne?.nombre) }
}

/** Répartition des encaissements K-PAY par durée d'abonnement sur les `ADMIN_REVENUS_REPARTITION_MOIS` derniers mois. */
async function lireRepartition(debut: Date, fin: Date): Promise<Map<string, Map<number, { nombre: number, brut: number }>>> {
  const resultat = await db.execute<{ devise: string, periode_mois: number, nombre: string | number, brut: string | number | null }>(sql`
    SELECT devise, periode_mois, count(*) AS nombre, COALESCE(sum(montant), 0) AS brut
    FROM paiements
    WHERE statut = 'reussi' AND source = ${PAIEMENT_SOURCE_KPAY}
      AND applique_le >= ${debut.toISOString()}::timestamptz AND applique_le < ${fin.toISOString()}::timestamptz
    GROUP BY devise, periode_mois`)
  const parDevise = new Map<string, Map<number, { nombre: number, brut: number }>>()
  for (const ligne of resultat.rows) {
    const periodes = parDevise.get(ligne.devise) ?? new Map<number, { nombre: number, brut: number }>()
    periodes.set(Number(ligne.periode_mois), { nombre: versEntierSur(ligne.nombre), brut: versEntierSur(ligne.brut) })
    parDevise.set(ligne.devise, periodes)
  }
  return parDevise
}

/** Cartes de revenus : une par devise rencontrée (paiements des deux mois, répartition ou abonnés actifs), triées par code. */
export async function lireRevenus(now: Date = new Date()): Promise<RevenusAdmin> {
  const bornes = bornesMois(now)
  const [courant, precedent, repartition, abonnes, offerts] = await Promise.all([
    agregerPeriode(bornes.courant.debut, bornes.courant.fin),
    agregerPeriode(bornes.precedent.debut, bornes.precedent.fin),
    lireRepartition(bornes.debutRepartition, bornes.courant.fin),
    compterAbonnesActifsParDevise(now),
    lireOfferts(),
  ])
  const codes = new Set([...courant.keys(), ...precedent.keys(), ...repartition.keys(), ...abonnes.keys()])
  const periode = (bornesPeriode: { debut: Date, fin: Date }, agregats: Map<string, { kpay: AgregatRevenu, manuel: AgregatRevenu }>, devise: string): PeriodeRevenu => ({
    ...bornesPeriode,
    kpay: agregats.get(devise)?.kpay ?? AGREGAT_VIDE,
    manuel: agregats.get(devise)?.manuel ?? AGREGAT_VIDE,
  })
  const devises = [...codes].sort().map((devise): RevenuDevise => ({
    devise,
    mois: { courant: periode(bornes.courant, courant, devise), precedent: periode(bornes.precedent, precedent, devise) },
    abonnesActifs: abonnes.get(devise) ?? 0,
    repartition: PERIODES_MOIS.map((periodeMois) => ({
      periodeMois,
      nombre: repartition.get(devise)?.get(periodeMois)?.nombre ?? 0,
      brut: repartition.get(devise)?.get(periodeMois)?.brut ?? 0,
    })),
  }))
  return { devises, offerts, mention: REVENUS_MENTION_INCERTITUDE, genereLe: now }
}
