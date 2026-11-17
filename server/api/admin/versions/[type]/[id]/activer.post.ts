import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurReauth, lireParametres } from '#server/utils/admin-a5'
import { toVersionReponse } from '#server/resources/admin-a5'
import { activerVersion, lireVersion } from '#server/services/configuration/versions'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaActiverVersion, schemaVersionEntreeParam } from '#shared/schemas/admin-versions'

// Réauthentification exigée (`version.activer`). `programmeePour` null = immédiat ; une date = programmation (le job
// l'applique à l'échéance). Une baisse de limite exige `impactAcquitte` : sinon 409 `IMPACT_CHANGE`.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { type, id } = lireParametres(event, schemaVersionEntreeParam)
  const corps = await lireCorps(event, schemaActiverVersion)
  await lireVersion(type, id)
  const auteur = auteurReauth(event, admin, ADMIN_ACTIONS.versionActiver, ADMIN_CIBLES.version, id)
  return toVersionReponse(await activerVersion(auteur, id, corps))
})
