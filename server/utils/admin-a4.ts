// A4 : lecture des paramètres de route des routes de supervision et de capacités. Aucune logique métier : valide (Zod)
// et convertit la 400 de validation en 422 `VALIDATION`, comme les routes A2.
import { getRouterParam, getRouterParams } from 'h3'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { MAINTENANCE_MESSAGE_LONGUEUR_MAX } from '../../shared/reglages'
import { schemaModifierReglage } from '../../shared/schemas/admin-a4'
import { UnprocessableError } from '../exceptions/http'

// Nom propre à A4 : `lireParametres` existe aussi dans admin-a5.ts, et deux exports de même nom dans server/utils se masquent
// en silence (auto-import Nitro).
export function lireParametresA4<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  const lu = schema.safeParse(getRouterParams(event))
  if (!lu.success) throw new UnprocessableError('VALIDATION')
  return lu.data
}

/**
 * Corps de `PUT /api/admin/reglages/[cle]` : même forme que `schemaModifierReglage`, mais la VALEUR n'est pas bornée à un
 * entier (un décimal ou un type inattendu doit répondre 422 `REGLAGE_INVALIDE` par le registre, pas un 422 générique).
 * Les bornes de la clé sont appliquées ensuite par `Reglages.ecrire` (registre).
 */
export const schemaCorpsModifierReglage = schemaModifierReglage.extend({
  valeur: z.union([z.number(), z.boolean(), z.string().max(MAINTENANCE_MESSAGE_LONGUEUR_MAX)]).nullable(),
})

/** `[cle]` brute d'une route de réglage (le registre décide ensuite : hors registre = 404). */
export function lireCleBrute(event: H3Event): string {
  return getRouterParam(event, 'cle') ?? ''
}
