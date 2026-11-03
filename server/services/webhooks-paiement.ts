import type { IncomingHttpHeaders } from 'node:http'
import type { Readable } from 'node:stream'
import { WEBHOOK_CORPS_MAX_OCTETS } from '../../shared/limites'
import {
  BadRequestError,
  ContentTooLargeError,
  NotFoundError,
  ServiceUnavailableError,
  UnauthorizedError,
} from '../exceptions/http'
import { appliquerEvenement } from './paiements/application'
import { estFournisseurConnu, getPaiementProvider } from './paiements/fournisseurs'
import type { PaiementProvider } from './paiements/types'

// S10 (docs/specs/S10-abonnements.md §1 #112) : réception d'un webhook de paiement. Aucune session, aucun CSRF :
// la SIGNATURE (HMAC du corps brut, temps constant) est l'autorisation et elle est vérifiée AVANT tout parsing.
// Réponse identique (`{ recu: true }`) pour appliqué, doublon, ignoré ou anomalie : aucun oracle. Une panne de
// base se propage (500) : le fournisseur réessaie. Aucun journal ne contient le corps ni de numéro.

/** Millisecondes : délai maximal pour recevoir le corps complet (le fournisseur attend une réponse en moins de 3 s). */
const WEBHOOK_LECTURE_DELAI_MS = 5_000

export interface WebhookDeps {
  provider?: PaiementProvider | null
  maxOctets?: number
}

type EntetesPlats = Readonly<Record<string, string | undefined>>

/** En-têtes Node -> `Record<string, string>` ; un en-tête répété est considéré absent (signature ambiguë). */
export function aplatirEntetes(entetes: IncomingHttpHeaders): EntetesPlats {
  const plats: Record<string, string | undefined> = {}
  for (const [nom, valeur] of Object.entries(entetes)) {
    plats[nom.toLowerCase()] = Array.isArray(valeur) ? (valeur.length === 1 ? valeur[0] : undefined) : valeur
  }
  return plats
}

/**
 * Lit le corps brut avec un plafond : s'arrête dès que `max` octets sont dépassés (aussi sans `Content-Length`,
 * corps en morceaux) et dans un délai borné. 413 `CORPS_TROP_GROS` au-delà.
 */
export function lireCorpsBorne(flux: Readable, max: number = WEBHOOK_CORPS_MAX_OCTETS, delaiMs: number = WEBHOOK_LECTURE_DELAI_MS): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    if (flux.readableEnded) {
      resolve(Buffer.alloc(0))
      return
    }
    const morceaux: Buffer[] = []
    let total = 0
    const nettoyer = (): void => {
      clearTimeout(minuteur)
      flux.off('data', surDonnees)
      flux.off('end', surFin)
      flux.off('error', surErreur)
      flux.pause()
    }
    const surDonnees = (morceau: Buffer | string): void => {
      const octets = typeof morceau === 'string' ? Buffer.from(morceau, 'utf8') : morceau
      total += octets.length
      if (total > max) {
        nettoyer()
        reject(new ContentTooLargeError('CORPS_TROP_GROS'))
        return
      }
      morceaux.push(octets)
    }
    const surFin = (): void => {
      nettoyer()
      resolve(Buffer.concat(morceaux, total))
    }
    const surErreur = (): void => {
      nettoyer()
      reject(new BadRequestError('CORPS_ILLISIBLE'))
    }
    const minuteur = setTimeout(() => {
      nettoyer()
      reject(new BadRequestError('CORPS_ILLISIBLE'))
    }, delaiMs)
    flux.on('data', surDonnees)
    flux.once('end', surFin)
    flux.once('error', surErreur)
  })
}

/** Vérifie signature -> interprète -> applique. `corpsBrut` est le Buffer exact reçu (jamais re-sérialisé). */
export async function recevoirWebhook(
  fournisseur: string,
  corpsBrut: Buffer,
  entetes: EntetesPlats,
  now: Date,
  deps: WebhookDeps = {},
): Promise<{ recu: true }> {
  if (!estFournisseurConnu(fournisseur)) throw new NotFoundError('FOURNISSEUR_INCONNU')
  const provider = deps.provider !== undefined ? deps.provider : getPaiementProvider(fournisseur)
  if (!provider || provider.webhookConfigure === false) throw new ServiceUnavailableError('WEBHOOK_NON_CONFIGURE')
  if (corpsBrut.length > (deps.maxOctets ?? WEBHOOK_CORPS_MAX_OCTETS)) throw new ContentTooLargeError('CORPS_TROP_GROS')

  // Signature AVANT tout parsing, sur les octets reçus. Aucun détail sur la cause du refus.
  if (!provider.verifierSignature(corpsBrut, entetes)) throw new UnauthorizedError('SIGNATURE_INVALIDE')

  let json: unknown
  try {
    json = JSON.parse(corpsBrut.toString('utf8')) as unknown
  } catch {
    throw new BadRequestError('CORPS_ILLISIBLE')
  }
  const evenement = provider.interpreterWebhook(json)
  if (evenement === null) throw new BadRequestError('CORPS_ILLISIBLE')

  await appliquerEvenement(fournisseur, evenement, 'webhook', now, { environnement: provider.environnement })
  return { recu: true }
}

/** Point d'entrée de la route : fournisseur inconnu et corps annoncé trop gros sont refusés SANS lire le corps. */
export async function traiterWebhook(
  fournisseur: string,
  flux: Readable,
  entetes: IncomingHttpHeaders,
  now: Date,
  deps: WebhookDeps = {},
): Promise<{ recu: true }> {
  if (!estFournisseurConnu(fournisseur)) throw new NotFoundError('FOURNISSEUR_INCONNU')
  const plafond = deps.maxOctets ?? WEBHOOK_CORPS_MAX_OCTETS
  const annonce = Number.parseInt(entetes['content-length'] ?? '', 10)
  if (Number.isInteger(annonce) && annonce > plafond) throw new ContentTooLargeError('CORPS_TROP_GROS')
  const corps = await lireCorpsBorne(flux, plafond)
  return recevoirWebhook(fournisseur, corps, aplatirEntetes(entetes), now, deps)
}
