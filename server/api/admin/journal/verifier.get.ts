import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { toVerificationJournal } from '#server/resources/admin-a4'
import { verifierChaineAdmin } from '#server/services/admin/journal'

// Limité à 5 par minute et par administrateur (le recalcul parcourt toute la chaîne).
export default defineApiHandler(async (event) => {
  const admin = await requireSuperadmin(event)
  return toVerificationJournal(await verifierChaineAdmin(admin.adminId))
})
