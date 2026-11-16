import { ADMIN_PREFIXE_API, EXPORT_JOURNAL_NOM_FICHIER_PREFIXE } from '#shared/admin'
import type { ExportJournal, JournalVerificationDto, ListeJournalDto } from '#shared/schemas/admin-a4'
import { messageDepuisErreurApi } from '~/utils/admin-a2'
import { VALIDATEURS_FILTRES_JOURNAL, filtresJournalDepuis } from '~/utils/admin-journal'
import { nomFichierExport } from '~/utils/admin-paiements'

/**
 * Journal d'administration (A4) : liste filtrée et paginée (filtres et page dans l'URL), vérification de la chaîne
 * d'empreintes, export CSV sous motif. Aucune règle métier : le serveur filtre, vérifie et journalise l'export.
 */
export function useAdminJournal() {
  const liste = useAdminListe<ListeJournalDto>({
    chemin: `${ADMIN_PREFIXE_API}/journal`,
    cle: 'admin-journal',
    filtres: VALIDATEURS_FILTRES_JOURNAL,
  })
  const { expirer } = useAdminSession()

  // --- Vérification de la chaîne ---

  const verification = ref<JournalVerificationDto | null>(null)
  const verificationEnCours = ref(false)
  const erreurVerification = ref('')

  async function verifier(): Promise<void> {
    if (verificationEnCours.value) return
    verificationEnCours.value = true
    verification.value = null
    erreurVerification.value = ''
    try {
      verification.value = await $fetch<JournalVerificationDto>(`${ADMIN_PREFIXE_API}/journal/verifier`)
    } catch (e) {
      const lue = lireErreurApi(e)
      if (lue.statut === 404 && lue.code === null) void expirer()
      erreurVerification.value = messageDepuisErreurApi(e)
    } finally {
      verificationEnCours.value = false
    }
  }

  // --- Export CSV (mêmes filtres que la liste) ---

  const exportEnCours = ref(false)
  const erreurExport = ref('')

  async function exporter(motif: string): Promise<boolean> {
    if (exportEnCours.value) return false
    exportEnCours.value = true
    erreurExport.value = ''
    const corps: ExportJournal = { motif: motif.trim(), filtres: filtresJournalDepuis(liste.filtres.value) }
    try {
      const csv = await $fetch<string>(`${ADMIN_PREFIXE_API}/journal/export`, { method: 'POST', body: corps })
      deposerFichierCsv(csv, nomFichierExport(EXPORT_JOURNAL_NOM_FICHIER_PREFIXE, new Date()))
      return true
    } catch (e) {
      const lue = lireErreurApi(e)
      if (lue.statut === 404 && lue.code === null) void expirer()
      erreurExport.value = messageDepuisErreurApi(e)
      return false
    } finally {
      exportEnCours.value = false
    }
  }

  return { ...liste, verification, verificationEnCours, erreurVerification, verifier, exportEnCours, erreurExport, exporter }
}

function deposerFichierCsv(contenu: string, nom: string): void {
  const url = URL.createObjectURL(new Blob([contenu], { type: 'text/csv;charset=utf-8' }))
  const lien = document.createElement('a')
  lien.href = url
  lien.download = nom
  lien.click()
  URL.revokeObjectURL(url)
}
