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
/**
 * Code NEUTRE des 503 renvoyés à un appelant non authentifié : il ne distingue ni « secret absent », ni « clés
 * absentes », ni « corps non interprétable ». Le détail va dans les journaux, sans donnée personnelle.
 */
const CODE_NON_DISPONIBLE = 'PAIEMENT_INDISPONIBLE'

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
    // Erreur de flux ou délai dépassé : 503, RÉESSAYABLE. K-PAY ne réessaie jamais un 4xx, et rien n'a été signé
    // ni lu à ce stade : un 400 ferait perdre définitivement l'événement.
    const surErreur = (): void => {
      nettoyer()
      reject(new ServiceUnavailableError(CODE_NON_DISPONIBLE))
    }
    const minuteur = setTimeout(() => {
      nettoyer()
      reject(new ServiceUnavailableError(CODE_NON_DISPONIBLE))
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
  if (!provider || provider.webhookConfigure === false) {
    console.error({ webhook: 'non_configure', fournisseur, cles: Boolean(provider) })
    throw new ServiceUnavailableError(CODE_NON_DISPONIBLE)
  }
  if (corpsBrut.length > (deps.maxOctets ?? WEBHOOK_CORPS_MAX_OCTETS)) throw new ContentTooLargeError('CORPS_TROP_GROS')

  // Signature AVANT tout parsing, sur les octets reçus. Aucun détail sur la cause du refus.
  if (!provider.verifierSignature(corpsBrut, entetes)) throw new UnauthorizedError('SIGNATURE_INVALIDE')

  // Corps SIGNÉ (donc authentique) mais illisible : c'est un défaut d'intégration de notre côté ou du fournisseur,
  // jamais une erreur de l'appelant. Un 4xx ne serait pas réessayé et l'événement serait perdu : 503 réessayable,
  // avec une alerte (fournisseur seulement, jamais le corps). Le rapprochement par interrogation rattrape
  // l'activation si le corps ne devient jamais lisible.
  // Corps vide : aucun événement n'a été envoyé, ce n'est pas un événement perdu (400, rien à réessayer).
  if (corpsBrut.length === 0) throw new BadRequestError('CORPS_ILLISIBLE')
  let json: unknown
  try {
    json = JSON.parse(corpsBrut.toString('utf8')) as unknown
  } catch {
    console.error({ webhook: 'signe_non_interpretable', fournisseur, cause: 'json' })
    throw new ServiceUnavailableError(CODE_NON_DISPONIBLE)
  }
  const evenement = provider.interpreterWebhook(json)
  if (evenement === null) {
    console.error({ webhook: 'signe_non_interpretable', fournisseur, cause: 'schema' })
    throw new ServiceUnavailableError(CODE_NON_DISPONIBLE)
  }

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
