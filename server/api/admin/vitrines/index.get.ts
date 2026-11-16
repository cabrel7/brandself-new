import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toListeVitrines } from '#server/resources/admin-a2'
import { listerVitrines } from '#server/services/admin/vitrines'
import { schemaListeVitrinesQuery } from '#shared/schemas/admin-a2'

export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  const filtres = lireRequete(event, schemaListeVitrinesQuery)
  return toListeVitrines(await listerVitrines(filtres))
})
