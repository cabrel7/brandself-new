import { setResponseHeader } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { readBodyWith } from '#server/utils/validation'
import { toFichierExport } from '#server/resources/admin-paiements'
import { exporterPaiements } from '#server/services/admin/export'
import { EXPORT_PAIEMENTS_CONTENT_TYPE } from '#shared/admin-paiements'
import { schemaExportPaiements } from '#shared/schemas/admin-paiements'

// Export en POST : le motif est dans le corps, jamais dans l'URL (journaux d'accès). Pas de réauthentification (⚠️ D-A3-09).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  const entree = await readBodyWith(event, schemaExportPaiements)
  const fichier = toFichierExport(await exporterPaiements({ adminId: admin.adminId, ip: admin.ip }, entree))
  setResponseHeader(event, 'Content-Type', EXPORT_PAIEMENTS_CONTENT_TYPE)
  setResponseHeader(event, 'Content-Disposition', `attachment; filename="${fichier.nomFichier}"`)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return fichier.contenu
})
