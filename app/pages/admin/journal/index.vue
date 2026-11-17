<script setup lang="ts">
import { messageDepuisErreurApi } from '~/utils/admin-a2'
import { UI_PAGINATION_TACTILE } from '~/utils/admin-ui'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Journal · Administration' })

const toast = useToast()
const {
  data, error, refresh, enChargement, actualisation, filtres, filtresActifs,
  maj, changerPage, reinitialiser,
  verification, verificationEnCours, erreurVerification, verifier,
  exportEnCours, erreurExport, exporter,
} = useAdminJournal()

const messageErreur = computed(() => (error.value ? messageDepuisErreurApi(error.value) : ''))

const pagination = computed({
  get: () => data.value?.page ?? 1,
  set: (valeur: number) => void changerPage(valeur),
})

const exportOuvert = ref(false)

function ouvrirExport(): void {
  erreurExport.value = ''
  exportOuvert.value = true
}

async function confirmerExport(motif: string): Promise<void> {
  if (await exporter(motif)) {
    exportOuvert.value = false
    toast.add({ title: 'Le fichier est téléchargé.', color: 'success', icon: 'i-ph-check-circle' })
  }
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:justify-end">
      <UButton
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-ph-seal-check"
        class="min-h-(--cible-tactile) justify-center"
        :loading="verificationEnCours"
        @click="verifier"
      >
        Vérifier la chaîne
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-ph-download-simple"
        class="min-h-(--cible-tactile) justify-center"
        @click="ouvrirExport"
      >
        Exporter en CSV
      </UButton>
    </div>

    <!-- Résultat de la vérification : un seul message, à cet endroit. -->
    <UAlert
      v-if="verification && verification.intacte"
      role="status"
      color="neutral"
      variant="outline"
      icon="i-ph-check-circle"
      title="La chaîne du journal est intacte."
      description="Aucune entrée n’a été modifiée ni retirée."
    />
    <UAlert
      v-else-if="verification"
      role="alert"
      color="error"
      variant="soft"
      icon="i-ph-warning-circle"
      :title="`La chaîne est rompue à l’entrée n° ${verification.premiereRupture}.`"
      description="Une entrée a été modifiée ou retirée après son écriture. Conservez ce constat et examinez cette entrée."
    />
    <UAlert v-else-if="erreurVerification" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreurVerification" />

    <AdminFiltresRepliables :actifs="Object.keys(filtres).length">
      <AdminJournalFiltres :filtres="filtres" :desactive="enChargement" @modifier="maj" @reinitialiser="reinitialiser" />
    </AdminFiltresRepliables>

    <AdminRechercheEtats
      :chargement="enChargement"
      :erreur="!!error"
      :vide="!!data && data.elements.length === 0"
      :message-erreur="messageErreur"
      icone="i-ph-scroll"
      :titre-vide="filtresActifs ? 'Aucune entrée ne correspond à ces filtres.' : 'Le journal est vide pour le moment.'"
      @reessayer="() => refresh()"
    >
      <template #vide-actions>
        <UButton v-if="filtresActifs" color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile)" @click="reinitialiser">
          Réinitialiser les filtres
        </UButton>
      </template>

      <template v-if="data">
        <ul
          class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0 transition-opacity"
          :class="{ 'opacity-60': actualisation }"
          :aria-busy="actualisation"
        >
          <li v-for="entree in data.elements" :key="entree.id">
            <AdminJournalLigne :entree="entree" />
          </li>
        </ul>

        <UPagination
          v-if="data.total > data.limite"
          v-model:page="pagination"
          :total="data.total"
          :items-per-page="data.limite"
          :sibling-count="1"
          size="xl"
          :ui="UI_PAGINATION_TACTILE"
          class="mt-4 self-center"
        />
      </template>
    </AdminRechercheEtats>

    <AdminPaiementMotifDialog
      v-model:open="exportOuvert"
      titre="Exporter le journal"
      description="Le fichier reprend les filtres affichés. Le motif est conservé dans le journal."
      libelle-action="Télécharger le fichier"
      :en-cours="exportEnCours"
      :erreur="erreurExport"
      @confirmer="confirmerExport"
    />
  </div>
</template>
