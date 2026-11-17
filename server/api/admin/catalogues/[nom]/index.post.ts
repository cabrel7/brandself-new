import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurReauth, lireParametres } from '#server/utils/admin-a5'
import { introuvableAdmin } from '#server/utils/introuvable'
import { toNomBloqueReponse } from '#server/resources/admin-a5'
import { creerNomBloque } from '#server/services/configuration/catalogues'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaCatalogueNomParam, schemaCreerNomBloque } from '#shared/schemas/admin-catalogues'

// Réauthentification exigée. Seuls les noms bloqués se créent ici : pays et devises se créent par migration (D-A5-10).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { nom } = lireParametres(event, schemaCatalogueNomParam)
  if (nom !== 'noms-bloques') throw introuvableAdmin()
  const corps = await lireCorps(event, schemaCreerNomBloque)
  const auteur = auteurReauth(event, admin, ADMIN_ACTIONS.catalogueCreer, ADMIN_CIBLES.catalogue, `${nom}:${corps.valeur}`)
  return toNomBloqueReponse(await creerNomBloque(auteur, corps))
})
