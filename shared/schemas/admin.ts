// A1 : contrats Zod STRICTS de l'API d'administration. Les réponses sont construites champ par champ (jamais de
// spread d'une ligne de base) puis validées par ces schémas : une clé en trop fait échouer la réponse.
import { z } from 'zod'
import {
  ADMIN_ACTION_FORMAT,
  ADMIN_CIBLE_ID_MAX,
  ADMIN_CIBLE_TYPE_FORMAT,
  ADMIN_MOTIF_MAX,
  ADMIN_MOTIF_MIN,
} from '../admin'

/** Session courante de l'administrateur (son propre e-mail : ce n'est pas une donnée de visiteur). */
export const schemaAdminSessionDto = z.strictObject({
  id: z.string().min(1),
  nom: z.string(),
  email: z.string(),
  expireLe: z.iso.datetime(),
})
export type AdminSessionDto = z.infer<typeof schemaAdminSessionDto>

/** Vue d'ensemble de A1 : aucun compteur (ils arrivent en A2). */
export const schemaVueEnsembleDto = z.strictObject({
  admin: z.strictObject({ nom: z.string() }),
  genereLe: z.iso.datetime(),
})
export type VueEnsembleDto = z.infer<typeof schemaVueEnsembleDto>

/** Demande d'un code de réauthentification : lié à l'action et à sa cible (D-A1-08). */
export const schemaDemandeReauth = z.strictObject({
  action: z.string().regex(ADMIN_ACTION_FORMAT),
  cibleType: z.string().regex(ADMIN_CIBLE_TYPE_FORMAT),
  cibleId: z.string().min(1).max(ADMIN_CIBLE_ID_MAX).optional(),
})
export type DemandeReauth = z.infer<typeof schemaDemandeReauth>

export const schemaReauthReponse = z.strictObject({ expireLe: z.iso.datetime() })
export type ReauthReponse = z.infer<typeof schemaReauthReponse>

/** Motif obligatoire d'une écriture d'administration. */
export const schemaMotifAdmin = z.string().trim().min(ADMIN_MOTIF_MIN).max(ADMIN_MOTIF_MAX)
