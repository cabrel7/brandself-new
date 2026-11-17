// A2 : lecture des entrées des routes d'administration des utilisateurs, vitrines et assistants. Ces helpers ne
// portent aucune logique métier : ils lisent l'événement, valident (Zod) et construisent les crochets passés aux
// services (réauthentification, clé d'idempotence). Une entrée invalide donne 422 `VALIDATION` (spec A2 §7, CA09).
import { getRequestHeader } from 'h3'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { ADMIN_IDEMPOTENCE_ENTETE } from '../../shared/admin'
import type { AdminAction, AdminCible } from '../../shared/admin'
import { schemaCleIdempotence, schemaIdAdmin } from '../../shared/schemas/admin-a2'
import { UnprocessableError, ValidationError } from '../exceptions/http'
import type { ExigerReauth } from '../services/admin/a2-support'
import { exigerReauth } from './reauth'
import { readBodyWith, readParamsWith, readQueryWith } from './validation'

const schemaParamsId = z.strictObject({ id: schemaIdAdmin })

/** Convertit la 400 de validation en 422 : le contrat de l'administration distingue « entrée invalide » de « corps illisible ». */
function enUnprocessable<T>(lecture: () => T): T {
  try {
    return lecture()
  } catch (erreur) {
    if (erreur instanceof ValidationError) throw new UnprocessableError('VALIDATION', erreur.data)
    throw erreur
  }
}

async function enUnprocessableAsync<T>(lecture: () => Promise<T>): Promise<T> {
  try {
    return await lecture()
  } catch (erreur) {
    if (erreur instanceof ValidationError) throw new UnprocessableError('VALIDATION', erreur.data)
    throw erreur
  }
}

export function lireIdParam(event: H3Event): string {
  return enUnprocessable(() => readParamsWith(event, schemaParamsId).id)
}

export function lireRequete<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  return enUnprocessable(() => readQueryWith(event, schema))
}

export function lireCorps<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  return enUnprocessableAsync(() => readBodyWith(event, schema))
}

/** En-tête `Idempotency-Key` (8 à 128 caractères sûrs) : absent 422 `CLE_IDEMPOTENCE_REQUISE`, mal formé 422 `VALIDATION`. */
export function lireCleIdempotence(event: H3Event): string {
  const brute = getRequestHeader(event, ADMIN_IDEMPOTENCE_ENTETE)
  if (brute === undefined || brute.trim() === '') throw new UnprocessableError('CLE_IDEMPOTENCE_REQUISE')
  const cle = schemaCleIdempotence.safeParse(brute.trim())
  if (!cle.success) {
    throw new UnprocessableError('VALIDATION', { champs: { [ADMIN_IDEMPOTENCE_ENTETE]: ['Clé d’idempotence invalide.'] } })
  }
  return cle.data
}

/**
 * Crochet de réauthentification d'une action destructrice : le service l'appelle DANS sa transaction, de sorte qu'un
 * échec de l'action laisse le code utilisable. Lié à (action, type de cible, cible).
 */
export function reauthPour(
  event: H3Event,
  adminId: string,
  action: AdminAction,
  cibleType: AdminCible,
  cibleId: string,
): ExigerReauth {
  return (tx) => exigerReauth(event, tx, adminId, { action, cibleType, cibleId })
}
