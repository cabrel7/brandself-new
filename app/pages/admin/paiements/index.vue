<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import { REVENUS_MENTION_INCERTITUDE } from '#shared/admin-paiements'
import type { PaiementDto } from '#shared/schemas/admin-paiements'
import {
  formaterDateHeureAdmin,
  formaterMontantAdmin,
  formaterNombre,
  LIBELLES_SOURCE,
} from '~/utils/admin-paiements'
import { accorder } from '~/utils/pluriel'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Paiements · Administration' })

const toast = useToast()
const {
  filtres, page, idDetail, filtresActifs, data, status, error, refresh,
  appliquerFiltres, changerPage, ouvrirDetail, fermerDetail,
  exportEnCours, erreurExport, exporter,
} = useAdminPaiements()
const revenus = useAdminRevenus()

const { ready: squeletteVisible } = useTimeout(200, { controls: true })

const colonnes: TableColumn<PaiementDto>[] = [
  { id: 'creeLe', header: 'Date' },
  { id: 'utilisateur', header: 'Utilisateur' },
  { id: 'montant', header: 'Montant' },
  { id: 'statut', header: 'Statut' },
  { id: 'source', header: 'Source' },
  { id: 'actions', header: '' },
]

const chargement = computed(() => status.value === 'pending' || status.value === 'idle')
const revenusEnChargement = computed(() => revenus.status.value === 'pending' || revenus.status.value === 'idle')

const pagination = computed({
  get: () => page.value,
  set: (valeur: number) => void changerPage(valeur),
})

const filtresModele = computed({
  get: () => filtres.value,
  set: (valeur) => void appliquerFiltres(valeur),
})

const exportOuvert = ref(false)

async function confirmerExport(motif: string): Promise<void> {
  if (await exporter(motif)) {
    exportOuvert.value = false
    toast.add({ title: 'Le fichier est téléchargé.', color: 'success', icon: 'i-ph-check-circle' })
  }
}

function ouvrirExport(): void {
  erreurExport.value = ''
  exportOuvert.value = true
}

// Une action réussie dans le tiroir change le statut : la liste et les revenus doivent le refléter.
async function actualiser(): Promise<void> {
  await Promise.all([refresh(), revenus.refresh()])
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="font-(family-name:--font-titre) text-(length:--fs-24) leading-[1.15] font-bold">Paiements</h1>
      <UButton color="neutral" variant="outline" size="lg" icon="i-ph-download-simple" @click="ouvrirExport">
        Exporter en CSV
      </UButton>
    </div>

    <section aria-labelledby="titre-revenus" class="flex flex-col gap-4">
      <h2 id="titre-revenus" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">Revenus du mois</h2>

      <div v-if="revenusEnChargement" class="flex flex-col gap-3" aria-busy="true">
        <USkeleton v-if="squeletteVisible" class="h-32 w-full" />
      </div>
      <div v-else-if="revenus.error.value || !revenus.data.value" class="flex flex-col items-start gap-4">
        <UAlert
          role="alert"
          color="error"
          variant="soft"
          icon="i-ph-warning-circle"
          description="Nous n’avons pas pu charger les revenus."
          class="w-full"
        />
        <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" @click="() => revenus.refresh()">
          Réessayer
        </UButton>
      </div>
      <p v-else-if="revenus.data.value.devises.length === 0" class="text-muted">
        Aucun revenu à afficher pour le moment.
      </p>
      <template v-else>
        <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <RevenusCarte v-for="revenu in revenus.data.value.devises" :key="revenu.devise" :revenu="revenu" />
        </div>
        <p class="text-muted">
          Jours offerts : {{ formaterNombre(revenus.data.value.offerts.jours) }}
          ({{ formaterNombre(revenus.data.value.offerts.nombre) }}
          {{ accorder(revenus.data.value.offerts.nombre, 'offre', 'offres') }}).
          {{ REVENUS_MENTION_INCERTITUDE }}.
        </p>
      </template>
    </section>

    <section aria-labelledby="titre-liste" class="flex flex-col gap-4">
      <h2 id="titre-liste" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">Liste des paiements</h2>

      <PaiementFiltres v-model="filtresModele" :desactive="chargement" />

      <div v-if="chargement" class="flex flex-col gap-3" aria-busy="true">
        <template v-if="squeletteVisible">
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-10 w-full" />
        </template>
      </div>

      <div v-else-if="error || !data" class="flex flex-col items-start gap-4">
        <UAlert
          role="alert"
          color="error"
          variant="soft"
          icon="i-ph-warning-circle"
          description="Nous n’avons pas pu charger les paiements."
          class="w-full"
        />
        <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" @click="() => refresh()">
          Réessayer
        </UButton>
      </div>

      <UEmpty
        v-else-if="data.elements.length === 0"
        icon="i-ph-receipt"
        :title="filtresActifs ? 'Aucun paiement ne correspond à ces filtres.' : 'Aucun paiement pour le moment.'"
        :actions="filtresActifs ? [{ label: 'Réinitialiser les filtres', color: 'neutral', variant: 'outline', size: 'lg', onClick: () => appliquerFiltres({}) }] : undefined"
      />

      <template v-else>
        <UTable :data="data.elements" :columns="colonnes" aria-label="Paiements">
          <template #creeLe-cell="{ row }">{{ formaterDateHeureAdmin(row.original.creeLe) }}</template>
          <template #utilisateur-cell="{ row }">
            <span class="break-all">{{ row.original.utilisateur?.email ?? 'Compte supprimé' }}</span>
          </template>
          <template #montant-cell="{ row }">{{ formaterMontantAdmin(row.original.montant, row.original.devise) }}</template>
          <template #statut-cell="{ row }"><PaiementStatutBadge :statut="row.original.statut" /></template>
          <template #source-cell="{ row }">{{ LIBELLES_SOURCE[row.original.source] }}</template>
          <template #actions-cell="{ row }">
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              icon="i-ph-arrow-square-out"
              :aria-label="`Voir le paiement de ${row.original.utilisateur?.email ?? 'un compte supprimé'}`"
              @click="ouvrirDetail(row.original.id)"
            >
              Détail
            </UButton>
          </template>
        </UTable>

        <UPagination
          v-if="data.total > data.limite"
          v-model:page="pagination"
          :total="data.total"
          :items-per-page="data.limite"
          size="lg"
          class="self-center"
        />
      </template>
    </section>

    <PaiementDetail :id="idDetail" @fermer="fermerDetail" @modifie="actualiser" />

    <PaiementMotifDialog
      v-model:open="exportOuvert"
      titre="Exporter les paiements"
      description="Le fichier reprend les filtres affichés. Le motif est conservé dans le journal."
      libelle-action="Télécharger le fichier"
      :en-cours="exportEnCours"
      :erreur="erreurExport"
      @confirmer="confirmerExport"
    />
  </div>
</template>
