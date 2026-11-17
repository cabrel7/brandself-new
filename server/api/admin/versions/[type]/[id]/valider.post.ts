import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurReauth, lireParametres } from '#server/utils/admin-a5'
import { introuvableAdmin } from '#server/utils/introuvable'
import { toVersionReponse } from '#server/resources/admin-a5'
import { lireVersion, validerPrixVersion } from '#server/services/configuration/versions'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaValiderPrix, schemaVersionEntreeParam } from '#shared/schemas/admin-versions'

// `POST /api/admin/versions/prix/[id]/valider` : valide la grille ACTIVE sans changer de grille. Réauthentification
// exigée (`version.valider_prix`). Seul le type `prix` se valide.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { type, id } = lireParametres(event, schemaVersionEntreeParam)
  if (type !== 'prix') throw introuvableAdmin()
  const corps = await lireCorps(event, schemaValiderPrix)
  await lireVersion(type, id)
  const auteur = auteurReauth(event, admin, ADMIN_ACTIONS.versionValiderPrix, ADMIN_CIBLES.version, id)
  return toVersionReponse(await validerPrixVersion(auteur, id, corps))
})
