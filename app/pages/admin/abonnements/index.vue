<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import { ABONNEMENT_ONGLETS, type AbonnementOnglet } from '#shared/admin-paiements'
import { UI_ONGLETS_TACTILES, UI_PAGINATION_TACTILE } from '~/utils/admin-ui'
import { LIBELLES_ONGLETS, LIBELLES_ONGLETS_COURTS, LIBELLES_VIDE_ONGLET } from '~/utils/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Abonnements · Administration' })

const {
  onglet, page, data, status, error, refresh, changerOnglet, changerPage,
  cible, rappelEnCours, erreurRappel, ouvrirRappel, fermerRappel, envoyerRappel,
} = useAdminAbonnements()

const { ready: squeletteVisible } = useTimeout(200, { controls: true })

const onglets: TabsItem[] = ABONNEMENT_ONGLETS.map((valeur) => ({ label: LIBELLES_ONGLETS_COURTS[valeur], value: valeur }))

// Le rappel est refusé par le serveur pour un abonnement échu (D-A3-07) : il n'est proposé que dans « À renouveler ».
const rappelPossible = computed(() => onglet.value === 'renouvellement')

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
  <div class="flex flex-col gap-4">
    <UTabs
      v-model="ongletActif"
      :items="onglets"
      :content="false"
      size="lg"
      :ui="UI_ONGLETS_TACTILES"
      aria-label="Échéances des abonnements"
    />
    <p class="m-0 text-base text-texte-secondaire" role="status">{{ LIBELLES_ONGLETS[onglet] }}</p>

    <div v-if="chargement" class="flex flex-col gap-3" aria-busy="true">
      <template v-if="squeletteVisible">
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-16 w-full" />
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
      <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" class="min-h-(--cible-tactile)" @click="() => refresh()">
        Réessayer
      </UButton>
    </div>

    <UEmpty
      v-else-if="data.elements.length === 0"
      icon="i-ph-credit-card"
      :title="LIBELLES_VIDE_ONGLET[onglet]"
    />

    <template v-else>
      <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
        <li v-for="abonnement in data.elements" :key="abonnement.id">
          <AdminAbonnementLigne :abonnement="abonnement" :rappel-possible="rappelPossible" @rappel="ouvrirRappel" />
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
        class="self-center"
      />
    </template>

    <AdminPaiementMotifDialog
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
