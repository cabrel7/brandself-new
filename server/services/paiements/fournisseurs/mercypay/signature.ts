import { createHmac, timingSafeEqual } from 'node:crypto'
import {
  MERCY_ENTETE_SIGNATURE,
  MERCY_SIGNATURE_ENTETE_MAX,
  MERCY_SIGNATURE_HEX_LONGUEUR,
  MERCY_SIGNATURE_SCHEMA,
  MERCY_SIGNATURE_T_CHIFFRES_MAX,
  MERCY_SIGNATURE_V1_MAX,
  MERCY_TOLERANCE_SIGNATURE_S,
} from './constantes'

// P1 (docs/specs/P1-mercypay.md §2) : signature des webhooks Mercy Pay. En-tête
// `MercyPay-Signature: t=<secondes>,v1=<hex>[,v1=<hex>…]` ; v1 = HMAC-SHA256 hexadécimal de `"{t}.{corps brut}"` avec le
// secret `whsec_…` (plusieurs `v1` pendant 24 h lors d'une rotation). Le corps est celui des OCTETS reçus, jamais un
// corps re-sérialisé. Appelée AVANT tout parsing. Comparaison en temps constant ; jamais d'exception.

const FORMAT_HEX = new RegExp(`^[0-9a-fA-F]{${MERCY_SIGNATURE_HEX_LONGUEUR}}$`)
const FORMAT_T = new RegExp(`^\\d{1,${MERCY_SIGNATURE_T_CHIFFRES_MAX}}$`)

/** Valeur de l'en-tête de signature, quelle que soit la casse du nom ; `undefined` si absent ou répété. */
export function lireEnteteSignatureMercy(entetes: Readonly<Record<string, string | undefined>>): string | undefined {
  const valeurs = Object.entries(entetes)
    .filter(([nom, valeur]) => nom.toLowerCase() === MERCY_ENTETE_SIGNATURE && valeur !== undefined)
    .map(([, valeur]) => valeur)
  return valeurs.length === 1 ? valeurs[0] : undefined
}

interface EnteteAnalysee {
  t: number
  /** `t` tel que reçu : c'est CE texte qui est signé (un zéro en tête ne doit pas changer le message). */
  tBrut: string
  v1: string[]
}

function analyserEntete(valeur: string): EnteteAnalysee | null {
  if (valeur.length === 0 || valeur.length > MERCY_SIGNATURE_ENTETE_MAX) return null
  const horodatages: string[] = []
  const signatures: string[] = []
  for (const element of valeur.split(',')) {
    const egal = element.indexOf('=')
    if (egal <= 0) continue
    const cle = element.slice(0, egal).trim()
    const contenu = element.slice(egal + 1).trim()
    if (cle === 't') horodatages.push(contenu)
    else if (cle === MERCY_SIGNATURE_SCHEMA) signatures.push(contenu)
  }
  // Un `t` répété est ambigu : refusé. Sans `t` ou sans `v1`, rien à vérifier.
  const [brut] = horodatages
  if (horodatages.length !== 1 || brut === undefined || !FORMAT_T.test(brut) || signatures.length === 0) return null
  return { t: Number(brut), tBrut: brut, v1: signatures.slice(0, MERCY_SIGNATURE_V1_MAX) }
}

/**
 * Vrai si l'en-tête porte au moins un `v1` égal au HMAC calculé avec `secret`, avec `t` à moins de 300 s de `now`
 * (passé comme futur). Secret absent ou vide = faux, toujours.
 */
export function verifierSignatureMercy(
  corpsBrut: Buffer,
  entete: string | undefined,
  secret: string | undefined,
  now: Date,
): boolean {
  if (!secret || entete === undefined) return false
  const lue = analyserEntete(entete)
  if (!lue) return false
  const ecartS = Math.abs(now.getTime() / 1000 - lue.t)
  if (!Number.isFinite(ecartS) || ecartS > MERCY_TOLERANCE_SIGNATURE_S) return false
  const attendue = createHmac('sha256', secret).update(`${lue.tBrut}.`).update(corpsBrut).digest()
  // Tous les `v1` sont examinés, sans court-circuit : le temps ne révèle pas lequel (ni s'il y en a un) correspond.
  let valide = false
  for (const candidate of lue.v1) {
    if (!FORMAT_HEX.test(candidate)) continue
    const recue = Buffer.from(candidate, 'hex')
    if (recue.length === attendue.length && timingSafeEqual(recue, attendue)) valide = true
  }
  return valide
}
