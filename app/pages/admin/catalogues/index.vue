<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { DeviseDto, NomBloqueDto, PaysDto } from '#shared/schemas/admin-catalogues'
import type { CibleCatalogue } from '~/components/admin/CatalogueEdition.vue'
import { ONGLETS_CATALOGUE } from '~/utils/admin-catalogues'
import { UI_ONGLETS_TACTILES, UI_PAGINATION_TACTILE } from '~/utils/admin-ui'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Catalogues · Administration' })

const { onglet, page, liste, error, enChargement, refresh, changerOnglet, changerPage } = useAdminCatalogues()
const { ready: squeletteVisible } = useTimeout(200, { controls: true })

const items: TabsItem[] = ONGLETS_CATALOGUE.map((o) => ({ label: o.libelle, value: o.valeur }))
const ongletActif = computed({
  get: () => onglet.value,
  set: (valeur) => void changerOnglet(valeur),
})
const definition = computed(() => ONGLETS_CATALOGUE.find((o) => o.valeur === onglet.value) ?? ONGLETS_CATALOGUE[0])
const pagination = computed({
  get: () => page.value,
  set: (valeur: number) => void changerPage(valeur),
})

const cible = ref<CibleCatalogue | null>(null)
const modifierPays = (pays: PaysDto): void => { cible.value = { type: 'pays', pays } }
const modifierDevise = (devise: DeviseDto): void => { cible.value = { type: 'devise', devise } }
const retirerNom = (nom: NomBloqueDto): void => { cible.value = { type: 'nom-retrait', nom } }
const ajouterNom = (): void => { cible.value = { type: 'nom-ajout' } }

async function apresEcriture(): Promise<void> {
  cible.value = null
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UTabs
      v-model="ongletActif"
      :items="items"
      :content="false"
      size="lg"
      :ui="UI_ONGLETS_TACTILES"
      aria-label="Catalogues"
    />

    <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <p class="m-0 text-base text-texte-secondaire" role="status">{{ definition?.aide }}</p>
      <UButton
        v-if="onglet === 'noms-bloques'"
        size="lg"
        icon="i-ph-plus"
        class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
        @click="ajouterNom"
      >
        Bloquer un nom
      </UButton>
    </div>

    <div v-if="enChargement" class="flex flex-col gap-3" aria-busy="true">
      <template v-if="squeletteVisible">
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-16 w-full" />
        <USkeleton class="h-16 w-full" />
      </template>
    </div>

    <div v-else-if="error || !liste" class="flex flex-col items-start gap-4">
      <UAlert
        role="alert"
        color="error"
        variant="soft"
        icon="i-ph-warning-circle"
        description="Nous n’avons pas pu charger ce catalogue."
        class="w-full"
      />
      <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" class="min-h-(--cible-tactile)" @click="() => refresh()">
        Réessayer
      </UButton>
    </div>

    <UEmpty v-else-if="liste.elements.length === 0" icon="i-ph-globe-hemisphere-west" :title="definition?.vide" />

    <template v-else>
      <AdminCatalogueTableau
        :liste="liste"
        @modifier-pays="modifierPays"
        @modifier-devise="modifierDevise"
        @retirer-nom="retirerNom"
      />
      <UPagination
        v-if="liste.total > liste.limite"
        v-model:page="pagination"
        :total="liste.total"
        :items-per-page="liste.limite"
        :sibling-count="1"
        size="xl"
        :ui="UI_PAGINATION_TACTILE"
        class="self-center"
      />
    </template>

    <AdminCatalogueEdition :cible="cible" @fermer="cible = null" @reussi="apresEcriture" />
  </div>
</template>
