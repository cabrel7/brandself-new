import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { lireCorps } from '#server/utils/admin-a2'
import { exporterJournalCsv } from '#server/services/admin/journal'
import { EXPORT_JOURNAL_CONTENT_TYPE, EXPORT_JOURNAL_NOM_FICHIER_PREFIXE } from '#shared/admin'
import { schemaExportJournal } from '#shared/schemas/admin-a4'

// Export en POST : le motif est dans le corps, jamais dans l'URL ; journalisé `journal.exporter`.
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const entree = await lireCorps(event, schemaExportJournal)
  const contenu = await exporterJournalCsv({ adminId: admin.adminId, ip: admin.ip }, entree)
  setResponseHeader(event, 'Content-Type', EXPORT_JOURNAL_CONTENT_TYPE)
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${EXPORT_JOURNAL_NOM_FICHIER_PREFIXE}${new Date().toISOString().slice(0, 10)}.csv"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return contenu
})
