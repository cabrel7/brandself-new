import { z } from 'zod'
import {
  DESABONNEMENT_JETON_LONGUEUR_MAX,
  DESABONNEMENT_JETON_LONGUEUR_MIN,
  DESABONNEMENT_JETON_VERSION,
  LIST_UNSUBSCRIBE_ONE_CLICK,
} from '../notifications'
import { NEXT_STEPS } from '../vitrine'

// S9 (docs/specs/S9-notifications.md §3.6) : schémas stricts de la prochaine étape et du désabonnement.

const JETON_FORME = new RegExp(`^${DESABONNEMENT_JETON_VERSION}\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$`)

export const schemaEtapeIgnorer = z.strictObject({
  etape: z.enum(NEXT_STEPS, 'Étape inconnue.'),
})

/** Forme seulement (version, deux segments base64url) : la signature est vérifiée par le service. */
export const schemaJetonDesabonnement = z
  .string()
  .min(DESABONNEMENT_JETON_LONGUEUR_MIN)
  .max(DESABONNEMENT_JETON_LONGUEUR_MAX)
  .regex(JETON_FORME, 'Jeton invalide.')

export const schemaDesabonnementQuery = z.strictObject({ jeton: schemaJetonDesabonnement })

/**
 * Corps du POST : `List-Unsubscribe=One-Click` (RFC 8058, form-urlencoded, le jeton est alors dans la
 * query) ou JSON `{ jeton }`.
 */
export const schemaDesabonnementCorps = z.union([
  z.strictObject({ jeton: schemaJetonDesabonnement }),
  z.strictObject({ 'List-Unsubscribe': z.literal(LIST_UNSUBSCRIBE_ONE_CLICK) }),
])

export type EtapeIgnorerInput = z.infer<typeof schemaEtapeIgnorer>
export type DesabonnementQueryInput = z.infer<typeof schemaDesabonnementQuery>
export type DesabonnementCorpsInput = z.infer<typeof schemaDesabonnementCorps>
