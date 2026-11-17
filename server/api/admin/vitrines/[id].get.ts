import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireIdParam } from '#server/utils/admin-a2'
import { toVitrineFiche } from '#server/resources/admin-a2'
import { getFicheVitrine } from '#server/services/admin/vitrines'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toVitrineFiche(await getFicheVitrine(lireIdParam(event)))
})
