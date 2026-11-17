import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurReauth, lireParametres } from '#server/utils/admin-a5'
import { toVersionReponse } from '#server/resources/admin-a5'
import { lireVersion, retourVersion } from '#server/services/configuration/versions'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaRetourVersion, schemaVersionEntreeParam } from '#shared/schemas/admin-versions'

// Réauthentification exigée (`version.retour`). `id` = la version active (on rétablit la précédente) ou une version remplacée.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { type, id } = lireParametres(event, schemaVersionEntreeParam)
  const corps = await lireCorps(event, schemaRetourVersion)
  await lireVersion(type, id)
  const auteur = auteurReauth(event, admin, ADMIN_ACTIONS.versionRetour, ADMIN_CIBLES.version, id)
  return toVersionReponse(await retourVersion(auteur, id, corps))
})
