import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireRequete } from '#server/utils/admin-a2'
import { toListeJournal } from '#server/resources/admin-a4'
import { listerJournal } from '#server/services/admin/journal'
import { schemaListeJournalQuery } from '#shared/schemas/admin-a4'

// Lecture seule : non journalisée (D-A4-18).
export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  return toListeJournal(await listerJournal(lireRequete(event, schemaListeJournalQuery)))
})
