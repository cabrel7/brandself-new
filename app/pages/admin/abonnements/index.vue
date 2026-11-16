<script setup lang="ts">
import type { TableColumn, TabsItem } from '@nuxt/ui'
import { ABONNEMENT_ONGLETS, type AbonnementOnglet } from '#shared/admin-paiements'
import type { AbonnementAdminDto } from '#shared/schemas/admin-paiements'
import {
  formaterDate,
  formaterMontantAdmin,
  LIBELLES_ETAT_ABONNEMENT,
  LIBELLES_ONGLETS,
  LIBELLES_ORIGINE,
  LIBELLES_STATUT,
  LIBELLES_VIDE_ONGLET,
  libellePlan,
} from '~/utils/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Abonnements · Administration' })

const {
  onglet, page, data, status, error, refresh, changerOnglet, changerPage,
  cible, rappelEnCours, erreurRappel, ouvrirRappel, fermerRappel, envoyerRappel,
} = useAdminAbonnements()

const { ready: squeletteVisible } = useTimeout(200, { controls: true })

const onglets: TabsItem[] = ABONNEMENT_ONGLETS.map((valeur) => ({ label: LIBELLES_ONGLETS[valeur], value: valeur }))

// Le rappel est refusé par le serveur pour un abonnement échu (D-A3-07) : la colonne n'existe que dans « À renouveler ».
const colonnesBase: TableColumn<AbonnementAdminDto>[] = [
  { id: 'utilisateur', header: 'Utilisateur' },
  { id: 'plan', header: 'Plan' },
  { accessorKey: 'devise', header: 'Devise' },
  { id: 'expireLe', header: 'Échéance' },
  { id: 'etat', header: 'État' },
  { id: 'origine', header: 'Origine' },
  { id: 'dernierPaiement', header: 'Dernier paiement' },
]
const colonneActions: TableColumn<AbonnementAdminDto> = { id: 'actions', header: '' }
const colonnes = computed(() => (onglet.value === 'renouvellement' ? [...colonnesBase, colonneActions] : colonnesBase))

const rappelOuvert = computed({
  get: () => cible.value !== null,
  set: (valeur: boolean) => {
    if (!valeur) fermerRappel()
  },
})

const chargement = computed(() => status.value === 'pending' || status.value === 'idle')
const pagination = computed({
  get: () => page.value,
  set: (valeur: number) => void changerPage(valeur),
})
const ongletActif = computed({
  get: () => onglet.value,
  set: (valeur: AbonnementOnglet) => void changerOnglet(valeur),
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <h1 class="font-(family-name:--font-titre) text-(length:--fs-24) leading-[1.15] font-bold">Abonnements</h1>

    <UTabs v-model="ongletActif" :items="onglets" :content="false" size="lg" aria-label="Échéances des abonnements" />

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
        description="Nous n’avons pas pu charger les abonnements."
        class="w-full"
      />
      <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" @click="() => refresh()">
        Réessayer
      </UButton>
    </div>

    <UEmpty
      v-else-if="data.elements.length === 0"
      icon="i-ph-credit-card"
      :title="LIBELLES_VIDE_ONGLET[onglet]"
    />

    <template v-else>
      <UTable :data="data.elements" :columns="colonnes" :aria-label="LIBELLES_ONGLETS[onglet]">
        <template #utilisateur-cell="{ row }">
          <span class="break-all">{{ row.original.utilisateur.email }}</span>
        </template>
        <template #plan-cell="{ row }">{{ libellePlan(row.original.plan) }}</template>
        <template #expireLe-cell="{ row }">{{ formaterDate(row.original.expireLe) }}</template>
        <template #etat-cell="{ row }">
          <UBadge color="neutral" variant="subtle" size="lg">{{ LIBELLES_ETAT_ABONNEMENT[row.original.etat] }}</UBadge>
        </template>
        <template #origine-cell="{ row }">{{ LIBELLES_ORIGINE[row.original.origine] }}</template>
        <template #dernierPaiement-cell="{ row }">
          <span v-if="row.original.dernierPaiement">
            {{ formaterMontantAdmin(row.original.dernierPaiement.montant, row.original.dernierPaiement.devise) }},
            {{ LIBELLES_STATUT[row.original.dernierPaiement.statut].toLowerCase() }}
            le {{ formaterDate(row.original.dernierPaiement.creeLe) }}
          </span>
          <span v-else class="text-muted">Aucun</span>
        </template>
        <template #actions-cell="{ row }">
          <UButton
            color="neutral"
            variant="outline"
            size="lg"
            icon="i-ph-paper-plane-tilt"
            :aria-label="`Envoyer un rappel à ${row.original.utilisateur.email}`"
            @click="ouvrirRappel(row.original)"
          >
            Envoyer un rappel
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

    <PaiementMotifDialog
      v-model:open="rappelOuvert"
      titre="Envoyer un rappel"
      :description="cible ? `Un e-mail de rappel d’échéance sera envoyé à ${cible.utilisateur.email}. Un seul rappel par 24 heures.` : undefined"
      libelle-action="Envoyer le rappel"
      :en-cours="rappelEnCours"
      :erreur="erreurRappel"
      @confirmer="envoyerRappel"
    />
  </div>
</template>
