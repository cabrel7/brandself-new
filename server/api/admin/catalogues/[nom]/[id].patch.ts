import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurReauth, lireParametres } from '#server/utils/admin-a5'
import { introuvableAdmin } from '#server/utils/introuvable'
import { toDeviseReponse, toPaysReponse } from '#server/resources/admin-a5'
import { modifierDevise, modifierPays } from '#server/services/configuration/catalogues'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaCatalogueEntreeParam, schemaModifierDevise, schemaModifierPays } from '#shared/schemas/admin-catalogues'

// Réauthentification exigée. Les noms bloqués ne se modifient pas : on les retire.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { nom, id } = lireParametres(event, schemaCatalogueEntreeParam)
  if (nom === 'noms-bloques') throw introuvableAdmin()
  const code = id.toUpperCase()
  const cible = `${nom}:${code}`
  if (nom === 'pays') {
    const corps = await lireCorps(event, schemaModifierPays)
    return toPaysReponse(await modifierPays(auteurReauth(event, admin, ADMIN_ACTIONS.catalogueModifier, ADMIN_CIBLES.catalogue, cible), code, corps))
  }
  const corps = await lireCorps(event, schemaModifierDevise)
  return toDeviseReponse(await modifierDevise(auteurReauth(event, admin, ADMIN_ACTIONS.catalogueModifier, ADMIN_CIBLES.catalogue, cible), code, corps))
})
