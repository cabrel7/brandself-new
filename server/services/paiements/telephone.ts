import { createHmac, hkdfSync } from 'node:crypto'
import { env } from '../../../shared/env'
import {
  TELEPHONE_EMPREINTE_HKDF_INFO,
  TELEPHONE_MASQUE_CARACTERE,
  TELEPHONE_MASQUE_CHIFFRES_VISIBLES,
} from '../../../shared/paiements'
import { UnprocessableError } from '../../exceptions/http'
import type { MoyenPaiementConfig } from '../../config/paiements'

// S10 (docs/specs/S10-abonnements.md §1 #116) : le numéro du payeur n'est JAMAIS stocké en clair. Il est
// normalisé pour l'envoi au fournisseur, puis on ne garde qu'un masque d'affichage et une empreinte HMAC (limite
// par numéro). Ce module ne journalise rien.

/** Chiffres de tête laissés visibles (le premier chiffre national identifie l'opérateur). */
const CHIFFRES_TETE_VISIBLES = 1
/** Les chiffres masqués sont regroupés par blocs de cette taille, séparés par une espace. */
const TAILLE_GROUPE_MASQUE = 3
/** Octets de la clé dérivée (HMAC-SHA256). */
const LONGUEUR_CLE_EMPREINTE = 32
/** Sel vide : la dérivation s'appuie sur le secret de l'application, déjà de forte entropie. */
const SEL_HKDF = Buffer.alloc(0)

type MoyenNumero = Pick<MoyenPaiementConfig, 'indicatif' | 'numeroNational'>

/**
 * Numéro saisi (national, ou international avec ou sans `+`) -> chiffres internationaux sans `+`
 * (ex. `653 456 789` -> `237653456789`). Lève 422 `TELEPHONE_INVALIDE` si le numéro ne correspond pas au pays du moyen.
 */
export function normaliserNumero(saisie: string, moyen: MoyenNumero): string {
  const compact = saisie.replace(/\s+/g, '')
  const international = compact.startsWith('+')
  const chiffres = international ? compact.slice(1) : compact
  if (!/^\d+$/.test(chiffres)) throw new UnprocessableError('TELEPHONE_INVALIDE')
  if (!international && moyen.numeroNational.test(chiffres)) return `${moyen.indicatif}${chiffres}`
  if (chiffres.startsWith(moyen.indicatif)) {
    const national = chiffres.slice(moyen.indicatif.length)
    if (moyen.numeroNational.test(national)) return `${moyen.indicatif}${national}`
  }
  throw new UnprocessableError('TELEPHONE_INVALIDE')
}

/** Indicatifs connus, du plus long au plus court, pour retrouver où finit l'indicatif d'un numéro international. */
function indicatifDe(international: string, indicatifs: readonly string[]): string {
  const trie = [...indicatifs].sort((a, b) => b.length - a.length)
  return trie.find((indicatif) => international.startsWith(indicatif)) ?? international.slice(0, 3)
}

/**
 * `237653456789` -> `+237 6•• ••• •89` : l'indicatif, le premier chiffre et les deux derniers. Le masque contient
 * toujours au moins un `•` (contrainte de la base `paiements_telephone_masque_check`).
 */
export function masquer(international: string, indicatifs: readonly string[] = ['237']): string {
  const indicatif = indicatifDe(international, indicatifs)
  const national = international.slice(indicatif.length)
  const visiblesFin = TELEPHONE_MASQUE_CHIFFRES_VISIBLES
  const masques = Math.max(1, national.length - CHIFFRES_TETE_VISIBLES - visiblesFin)
  const brut = `${national.slice(0, CHIFFRES_TETE_VISIBLES)}${TELEPHONE_MASQUE_CARACTERE.repeat(masques)}${national.slice(national.length - visiblesFin)}`
  const groupes = brut.match(new RegExp(`.{1,${TAILLE_GROUPE_MASQUE}}`, 'gu')) ?? [brut]
  return `+${indicatif} ${groupes.join(' ')}`
}

/** Clé de l'empreinte : HKDF-SHA256 du secret de l'application, avec un paramètre `info` propre à cet usage. */
function cleEmpreinte(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, SEL_HKDF, TELEPHONE_EMPREINTE_HKDF_INFO, LONGUEUR_CLE_EMPREINTE))
}

/** HMAC-SHA256 hexadécimal (64 caractères) du numéro international : sert à limiter les demandes par numéro. */
export function empreinte(international: string, secret: string = env.NUXT_BETTER_AUTH_SECRET): string {
  return createHmac('sha256', cleEmpreinte(secret)).update(international).digest('hex')
}
