// A4 (D-A4-15) : journal d'envoi des codes de connexion (`envois_codes`) : canal, pays, statut, tentative, code
// d'erreur court. JAMAIS de numéro, d'adresse, de code ni de message d'erreur brut. `enregistrerEnvoi` ne LÈVE
// JAMAIS : une panne du journal ne doit avoir aucun effet sur la connexion (le job OTP ne rejoue pas, un seul
// e-mail part). Le pays d'un numéro est déduit de son indicatif (`libphonenumber-js`), puis le numéro est oublié.
import { count, sql } from 'drizzle-orm'
import { parsePhoneNumberFromString } from 'libphonenumber-js/min'
import { envoisCodes } from '../../shared/db/schema'
import {
  ENVOIS_CODES_CODE_ERREUR_MAX,
  ENVOIS_CODES_PAYS_FORMAT,
  ENVOIS_CODES_PURGE_LOT,
  ENVOIS_CODES_RETENTION_JOURS,
  ENVOIS_CODES_TENTATIVE_MAX,
} from '../../shared/jobs'
import type { EnvoiCodeCanal, EnvoiCodeStatut } from '../../shared/jobs'
import { JOUR_MS } from '../../shared/temps'
import { db } from '../utils/db'

/** Code d'erreur sans donnée : le `code` de l'erreur ou son message s'ils ont la forme d'un code (`OTP_SMS_NON_CONFIGURE`). */
const FORME_CODE_ERREUR = /^[A-Z][A-Z0-9_]{1,39}$/
export const CODE_ERREUR_ENVOI_INCONNU = 'ERREUR_ENVOI'

export function codeErreurDe(erreur: unknown): string {
  if (erreur instanceof Error) {
    const code = (erreur as { code?: unknown }).code
    if (typeof code === 'string' && FORME_CODE_ERREUR.test(code)) return code
    if (FORME_CODE_ERREUR.test(erreur.message)) return erreur.message
  }
  return CODE_ERREUR_ENVOI_INCONNU
}

/** Code pays ISO alpha-2 d'un numéro international (`+237…`), `null` si l'indicatif est inconnu ou ambigu. */
export function paysDuNumero(numero: string): string | null {
  const pays = parsePhoneNumberFromString(numero)?.country
  return pays !== undefined && ENVOIS_CODES_PAYS_FORMAT.test(pays) ? pays : null
}

export interface EnvoiCode {
  canal: EnvoiCodeCanal
  /** Numéro de téléphone (canaux `sms` et `whatsapp`) : sert uniquement à déduire le pays, jamais conservé. */
  numero?: string | undefined
  statut: EnvoiCodeStatut
  tentative: number
  /** Erreur de l'envoi (statut `echec`) : réduite à un code. */
  erreur?: unknown
}

/** Écrit une ligne ; avale toute erreur (la connexion n'en dépend jamais) et ne journalise aucune donnée. */
export async function enregistrerEnvoi(envoi: EnvoiCode): Promise<void> {
  try {
    const pays = envoi.canal === 'email' || envoi.numero === undefined ? null : paysDuNumero(envoi.numero)
    const tentative = Math.min(Math.max(Math.trunc(envoi.tentative), 1), ENVOIS_CODES_TENTATIVE_MAX)
    const codeErreur = envoi.statut === 'echec' ? codeErreurDe(envoi.erreur).slice(0, ENVOIS_CODES_CODE_ERREUR_MAX) : null
    await db.insert(envoisCodes).values({ canal: envoi.canal, pays, statut: envoi.statut, tentative, codeErreur })
  } catch {
    console.error('[otp] journal d\'envoi indisponible (ENVOIS_CODES_ECRITURE_ECHEC)')
  }
}

export interface AgregatEnvois {
  lignes: { canal: EnvoiCodeCanal, pays: string | null, envoyes: number, echecs: number }[]
  erreurs: { codeErreur: string, nombre: number }[]
  total: { envoyes: number, echecs: number }
}

/** Agrégat des envois des `jours` derniers jours : par canal et pays, et les codes d'erreur les plus fréquents. */
export async function agregerEnvois(jours: number, maintenant: Date = new Date(), topErreurs = 10): Promise<AgregatEnvois> {
  const depuis = new Date(maintenant.getTime() - jours * JOUR_MS)
  const lignes = await db
    .select({
      canal: envoisCodes.canal,
      pays: envoisCodes.pays,
      envoyes: sql<number>`count(*) filter (where ${envoisCodes.statut} = 'envoye')::int`,
      echecs: sql<number>`count(*) filter (where ${envoisCodes.statut} = 'echec')::int`,
    })
    .from(envoisCodes)
    .where(sql`${envoisCodes.creeLe} >= ${depuis.toISOString()}::timestamptz`)
    .groupBy(envoisCodes.canal, envoisCodes.pays)
    .orderBy(sql`count(*) desc`, envoisCodes.canal, envoisCodes.pays)
  const erreurs = await db
    .select({ codeErreur: envoisCodes.codeErreur, nombre: count() })
    .from(envoisCodes)
    .where(sql`${envoisCodes.creeLe} >= ${depuis.toISOString()}::timestamptz AND ${envoisCodes.codeErreur} IS NOT NULL`)
    .groupBy(envoisCodes.codeErreur)
    .orderBy(sql`count(*) desc`)
    .limit(topErreurs)
  return {
    lignes: lignes.map((ligne) => ({
      canal: ligne.canal as EnvoiCodeCanal,
      pays: ligne.pays,
      envoyes: ligne.envoyes,
      echecs: ligne.echecs,
    })),
    erreurs: erreurs.flatMap((ligne) => (ligne.codeErreur === null ? [] : [{ codeErreur: ligne.codeErreur, nombre: ligne.nombre }])),
    total: {
      envoyes: lignes.reduce((somme, ligne) => somme + ligne.envoyes, 0),
      echecs: lignes.reduce((somme, ligne) => somme + ligne.echecs, 0),
    },
  }
}

/** Purge quotidienne : supprime par lots les envois plus anciens que la rétention. Renvoie le nombre de lignes supprimées. */
export async function purgerEnvois(maintenant: Date = new Date()): Promise<number> {
  const limite = new Date(maintenant.getTime() - ENVOIS_CODES_RETENTION_JOURS * JOUR_MS)
  let total = 0
  for (;;) {
    const supprimees = await db.execute(sql`
      DELETE FROM envois_codes
      WHERE id IN (SELECT id FROM envois_codes WHERE cree_le < ${limite.toISOString()}::timestamptz LIMIT ${ENVOIS_CODES_PURGE_LOT})`)
    const nombre = supprimees.rowCount ?? 0
    total += nombre
    if (nombre < ENVOIS_CODES_PURGE_LOT) return total
  }
}
