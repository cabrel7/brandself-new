import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { auteurReauth, lireParametres } from '#server/utils/admin-a5'
import { toActionEffectuee } from '#server/resources/admin-a2'
import { supprimerEntree } from '#server/services/configuration/catalogues'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import { schemaActionMotif } from '#shared/schemas/admin-a2'
import { schemaCatalogueEntreeParam } from '#shared/schemas/admin-catalogues'

// Réauthentification exigée. Un pays utilisé par une vitrine : 409 `CATALOGUE_ENTREE_UTILISEE` (on le désactive).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const { nom, id } = lireParametres(event, schemaCatalogueEntreeParam)
  const { motif } = await lireCorps(event, schemaActionMotif)
  const identifiant = nom === 'pays' ? id.toUpperCase() : id
  const auteur = auteurReauth(event, admin, ADMIN_ACTIONS.catalogueSupprimer, ADMIN_CIBLES.catalogue, `${nom}:${identifiant}`)
  const { rejoue } = await supprimerEntree(auteur, nom, identifiant, motif)
  return toActionEffectuee(rejoue)
})
