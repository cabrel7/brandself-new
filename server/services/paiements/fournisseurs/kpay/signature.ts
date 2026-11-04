import { createHmac, timingSafeEqual } from 'node:crypto'
import { KPAY_ENTETE_SIGNATURE, KPAY_SIGNATURE_HEX_LONGUEUR } from './constantes'

// S10 (docs/specs/S10-abonnements.md §5.2) : signature des webhooks K-PAY = HMAC-SHA256 hexadécimal du CORPS
// BRUT (octets reçus, jamais un corps re-sérialisé), comparée en temps constant. Appelée AVANT tout parsing.

const FORMAT_SIGNATURE = new RegExp(`^[0-9a-fA-F]{${KPAY_SIGNATURE_HEX_LONGUEUR}}$`)

/** Valeur de l'en-tête de signature, quelle que soit la casse du nom ; `undefined` si absent ou répété. */
export function lireEnteteSignature(entetes: Readonly<Record<string, string | undefined>>): string | undefined {
  const valeurs = Object.entries(entetes)
    .filter(([nom, valeur]) => nom.toLowerCase() === KPAY_ENTETE_SIGNATURE && valeur !== undefined)
    .map(([, valeur]) => valeur)
  return valeurs.length === 1 ? valeurs[0] : undefined
}

/** Jamais d'exception : un secret ou une signature absents ou mal formés donnent simplement `false`. */
export function verifierSignatureHmac(corpsBrut: Buffer, signature: string | undefined, secret: string | undefined): boolean {
  if (!secret || signature === undefined || !FORMAT_SIGNATURE.test(signature)) return false
  const attendue = createHmac('sha256', secret).update(corpsBrut).digest()
  const recue = Buffer.from(signature, 'hex')
  return recue.length === attendue.length && timingSafeEqual(recue, attendue)
}
