// A5 : lecture des entrées des routes d'administration des catalogues et des versions. Ces helpers ne portent aucune
// logique métier : ils lisent l'événement, valident (Zod) et construisent l'auteur d'écriture (administrateur,
// adresse, clé d'idempotence en en-tête, crochet de réauthentification). Entrée invalide : 422 `VALIDATION`.
import type { H3Event } from 'h3'
import type { z } from 'zod'
import type { AdminAction, AdminCible } from '../../shared/admin'
import { UnprocessableError, ValidationError } from '../exceptions/http'
import type { AuteurEcriture, AuteurEcritureReauth } from '../services/configuration/ecriture'
import type { ContexteAdmin } from './admin'
import { lireCleIdempotence, reauthPour } from './admin-a2'
import { readParamsWith } from './validation'

export function lireParametres<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  try {
    return readParamsWith(event, schema)
  } catch (erreur) {
    if (erreur instanceof ValidationError) throw new UnprocessableError('VALIDATION', erreur.data)
    throw erreur
  }
}

/** Écriture inerte (brouillon) : clé d'idempotence obligatoire, aucune réauthentification. */
export function auteurSansReauth(event: H3Event, admin: ContexteAdmin): AuteurEcriture {
  return { adminId: admin.adminId, ip: admin.ip, cleIdempotence: lireCleIdempotence(event) }
}

/** Écriture réauthentifiée : le code est lié à (action, type de cible, cible) et consommé DANS la transaction. */
export function auteurReauth(
  event: H3Event,
  admin: ContexteAdmin,
  action: AdminAction,
  cibleType: AdminCible,
  cibleId: string,
): AuteurEcritureReauth {
  return {
    adminId: admin.adminId,
    ip: admin.ip,
    cleIdempotence: lireCleIdempotence(event),
    reauth: reauthPour(event, admin.adminId, action, cibleType, cibleId),
  }
}
