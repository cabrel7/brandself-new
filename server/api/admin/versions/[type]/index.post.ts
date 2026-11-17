import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurSansReauth, lireParametres } from '#server/utils/admin-a5'
import { toVersionReponse } from '#server/resources/admin-a5'
import { creerBrouillon } from '#server/services/configuration/versions'
import { schemasCreationVersion, schemaVersionTypeParam } from '#shared/schemas/admin-versions'

// Brouillon : inerte (aucun effet tant qu'il n'est pas activé), donc sans réauthentification ; clé d'idempotence obligatoire.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { type } = lireParametres(event, schemaVersionTypeParam)
  const corps = await lireCorps(event, schemasCreationVersion[type])
  return toVersionReponse(await creerBrouillon(auteurSansReauth(event, admin), type, corps))
})
