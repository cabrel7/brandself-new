// A1 : sortie de l'API d'administration. Chaque réponse est construite CHAMP PAR CHAMP (jamais de spread d'une
// ligne de base ou d'un objet ORM) puis validée par un schéma strict : une clé en trop fait échouer la réponse
// au lieu de fuiter. Les clés autorisées sont celles de shared/schemas/admin.ts.
import {
  schemaAdminSessionDto,
  schemaReauthReponse,
  schemaVueEnsembleDto,
} from '../../shared/schemas/admin'
import type { AdminSessionDto, ReauthReponse, VueEnsembleDto } from '../../shared/schemas/admin'
import type { VueEnsemble } from '../services/admin/vue-ensemble'
import type { ContexteAdmin } from '../utils/admin'

export function toAdminSession(admin: Pick<ContexteAdmin, 'adminId' | 'nom' | 'email' | 'expireLe'>): AdminSessionDto {
  return schemaAdminSessionDto.parse({
    id: admin.adminId,
    nom: admin.nom,
    email: admin.email,
    expireLe: admin.expireLe.toISOString(),
  })
}

export function toVueEnsemble(vue: VueEnsemble): VueEnsembleDto {
  return schemaVueEnsembleDto.parse({
    admin: { nom: vue.adminNom },
    genereLe: vue.genereLe.toISOString(),
  })
}

export function toReauthReponse(demande: { expireLe: Date }): ReauthReponse {
  return schemaReauthReponse.parse({ expireLe: demande.expireLe.toISOString() })
}
