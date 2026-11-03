import { createHash, createHmac, hkdfSync, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '../../shared/env'
import type { DesabonnementApercuDTO, DesabonnementDTO } from '../../shared/dto/notifications'
import { users } from '../../shared/db/schema'
import { DESABONNEMENT_CLE_PREFIXE } from '../../shared/limites'
import type { DesabonnementOperation } from '../../shared/limites'
import {
  DESABONNEMENT_HKDF_INFO,
  DESABONNEMENT_JETON_VALIDITE_JOURS,
  DESABONNEMENT_JETON_VERSION,
  PREFERENCES_EMAIL,
} from '../../shared/notifications'
import type { PreferenceEmail } from '../../shared/notifications'
import { schemaDesabonnementCorps, schemaJetonDesabonnement } from '../../shared/schemas/notifications'
import { MS_PAR_SECONDE, SECONDES_PAR_JOUR } from '../../shared/temps'
import { GoneError, NotFoundError } from '../exceptions/http'
import { db } from '../utils/db'

// S9 §1 #89 : désabonnement par jeton signé sans état `v1.<charge base64url>.<HMAC-SHA256 base64url>`.
// Le jeton n'est jamais journalisé ni recopié dans une erreur ; tout jeton inutilisable (mal formé, version
// inconnue, signature fausse) donne la MÊME réponse (404 JETON_INVALIDE) : aucun oracle. Le 410 JETON_EXPIRE
// n'est possible qu'après vérification de la signature (un jeton falsifié n'apprend rien à son auteur).

const ALGORITHME_HMAC = 'sha256'
const LONGUEUR_CLE_OCTETS = 32
const SEPARATEUR = '.'

/** En-têtes de toute réponse de désabonnement : le jeton est dans l'URL, rien ne doit être mis en cache, relayé ni indexé. */
export const DESABONNEMENT_ENTETES = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex',
} as const

/** Octets : au-delà, le corps n'est pas lu (un corps légitime tient en quelques dizaines d'octets). */
export const DESABONNEMENT_CORPS_MAX_OCTETS = 1_024

const schemaCharge = z.strictObject({
  u: z.string().min(1),
  p: z.enum(PREFERENCES_EMAIL),
  e: z.number().int(),
})

export interface VerifiedUnsubscribeToken {
  userId: string
  preference: PreferenceEmail
}

const COLONNES: Record<PreferenceEmail, typeof users.email_hebdo | typeof users.email_rappel_jour> = {
  email_hebdo: users.email_hebdo,
  email_rappel_jour: users.email_rappel_jour,
}

const DESACTIVATION: Record<PreferenceEmail, Pick<typeof users.$inferInsert, PreferenceEmail>> = {
  email_hebdo: { email_hebdo: false },
  email_rappel_jour: { email_rappel_jour: false },
}

let cleSignature: Buffer | undefined

/** HKDF-SHA256 (sel vide) du secret d'authentification : la clé brute du secret ne signe jamais directement. */
function getCleSignature(): Buffer {
  cleSignature ??= Buffer.from(
    hkdfSync('sha256', env.NUXT_BETTER_AUTH_SECRET, Buffer.alloc(0), DESABONNEMENT_HKDF_INFO, LONGUEUR_CLE_OCTETS),
  )
  return cleSignature
}

function signer(entree: string): Buffer {
  return createHmac(ALGORITHME_HMAC, getCleSignature()).update(entree).digest()
}

export function signUnsubscribeToken(userId: string, preference: PreferenceEmail, now: Date): string {
  const expiration = Math.floor(now.getTime() / MS_PAR_SECONDE) + DESABONNEMENT_JETON_VALIDITE_JOURS * SECONDES_PAR_JOUR
  const charge = Buffer.from(JSON.stringify({ u: userId, p: preference, e: expiration }), 'utf8').toString('base64url')
  const entree = `${DESABONNEMENT_JETON_VERSION}${SEPARATEUR}${charge}`
  return `${entree}${SEPARATEUR}${signer(entree).toString('base64url')}`
}

/**
 * Vérifie forme, signature (temps constant) puis expiration. `jeton` est volontairement `unknown` : la
 * valeur vient telle quelle de la requête (chaîne, tableau, absente) et toute forme inutilisable est un
 * JETON_INVALIDE, jamais une erreur de validation 400/422.
 */
export function verifyUnsubscribeToken(jeton: unknown, now: Date): VerifiedUnsubscribeToken {
  const forme = schemaJetonDesabonnement.safeParse(jeton)
  if (!forme.success) throw new NotFoundError('JETON_INVALIDE')
  const [version, charge, signature] = forme.data.split(SEPARATEUR)
  if (version === undefined || charge === undefined || signature === undefined) throw new NotFoundError('JETON_INVALIDE')

  const attendue = signer(`${version}${SEPARATEUR}${charge}`)
  const recue = Buffer.from(signature, 'base64url')
  // La longueur est publique : on la contrôle avant, timingSafeEqual lève une RangeError sinon.
  const memeSignature = recue.byteLength === attendue.byteLength && timingSafeEqual(recue, attendue)
  // base64url non canonique (bits de bourrage non nuls) : décodé à l'identique par Node, refusé ici.
  const canonique = recue.toString('base64url') === signature
  if (!memeSignature || !canonique) throw new NotFoundError('JETON_INVALIDE')

  let brut: unknown
  try {
    brut = JSON.parse(Buffer.from(charge, 'base64url').toString('utf8'))
  } catch {
    throw new NotFoundError('JETON_INVALIDE')
  }
  const lu = schemaCharge.safeParse(brut)
  if (!lu.success) throw new NotFoundError('JETON_INVALIDE')
  const contenu = lu.data

  if (Math.floor(now.getTime() / MS_PAR_SECONDE) > contenu.e) throw new GoneError('JETON_EXPIRE')
  return { userId: contenu.u, preference: contenu.p }
}

/**
 * Choisit le jeton d'un POST : JSON `{ jeton }` d'abord ; sinon (RFC 8058 `List-Unsubscribe=One-Click`, corps
 * absent, trop gros, en morceaux ou illisible) le jeton de la query. Le jeton signé est l'autorisation : un
 * corps inutilisable ne le remplace pas, et sans jeton valide le service répond 404 JETON_INVALIDE.
 */
export function pickUnsubscribeToken(corps: unknown, jetonQuery: unknown): unknown {
  const lu = schemaDesabonnementCorps.safeParse(corps)
  if (lu.success && 'jeton' in lu.data) return lu.data.jeton
  return jetonQuery
}

/**
 * Clé du limiteur par IP et par opération (aperçu GET / action POST : budgets distincts) : l'adresse
 * n'apparaît pas en clair dans Redis.
 */
export function unsubscribeLimitKey(ip: string, operation: DesabonnementOperation): string {
  return `${DESABONNEMENT_CLE_PREFIXE}${operation}:${createHash('sha256').update(ip).digest('hex')}`
}

/** GET : aucun effet, ne révèle ni adresse e-mail ni nom (ni même l'existence du compte). */
export function previewUnsubscribe(jeton: unknown, now: Date): DesabonnementApercuDTO {
  return { preference: verifyUnsubscribeToken(jeton, now).preference }
}

/**
 * POST : met la préférence à false. Idempotent (déjà désabonné ou compte supprimé : même succès, aucun
 * oracle d'existence). Ne réactive jamais ; seule la préférence nommée par le jeton signé est touchée.
 */
export async function unsubscribe(jeton: unknown, now: Date): Promise<DesabonnementDTO> {
  const { userId, preference } = verifyUnsubscribeToken(jeton, now)
  await db
    .update(users)
    .set({ ...DESACTIVATION[preference], updatedAt: now })
    .where(and(eq(users.id, userId), eq(COLONNES[preference], true)))
  return { preference, desabonne: true }
}
