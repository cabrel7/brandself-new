<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'
import type { VersionDto } from '#shared/schemas/admin-versions'
import type { CibleEdition } from '~/components/admin/VersionsEdition.vue'
import type { CibleAction } from '~/components/admin/VersionsAction.vue'
import { UI_ONGLETS_TACTILES, UI_PAGINATION_TACTILE } from '~/utils/admin-ui'
import { libelleCleVersion, TYPES_VERSION } from '~/utils/admin-versions'
import type { ActionVersion } from '~/utils/admin-versions'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Versions · Administration' })

const { type, cles, cle, page, liste, error, enChargement, refresh, changerType, changerCle, changerPage } = useAdminVersions()
const { ready: squeletteVisible } = useTimeout(200, { controls: true })

const items: TabsItem[] = TYPES_VERSION.map((t) => ({ label: t.libelle, value: t.valeur }))
const typeActif = computed({
  get: () => type.value,
  set: (valeur) => void changerType(valeur),
})
const definition = computed(() => TYPES_VERSION.find((t) => t.valeur === type.value) ?? TYPES_VERSION[0])
const itemsCles = computed(() => cles.value.map((valeur) => ({ value: valeur, label: libelleCleVersion(valeur) })))
const cleChoisie = computed({
  get: () => cle.value,
  set: (valeur) => {
    if (valeur) void changerCle(valeur)
  },
})
const pagination = computed({
  get: () => page.value,
  set: (valeur: number) => void changerPage(valeur),
})

// Version de départ d'une nouvelle version : l'active de la clé affichée (sinon la plus récente).
const versionDeDepart = computed<VersionDto | null>(() => {
  const versions = liste.value?.elements ?? []
  return versions.find((v) => v.statut === 'active') ?? versions[0] ?? null
})
// Moyens vus dans l'historique : permet de rouvrir un moyen fermé sans le saisir à la main.
const moyensConnus = computed(() => [...new Set((liste.value?.elements ?? []).flatMap((v) => (v.type === 'moyens' ? v.valeurs.actifs : [])))])

const edition = ref<CibleEdition | null>(null)
const action = ref<CibleAction | null>(null)

function nouvelle(base: VersionDto): void {
  edition.value = { type: base.type, cle: base.cle, base, moyensConnus: moyensConnus.value }
}
function agir(version: VersionDto, quoi: ActionVersion): void {
  action.value = { version, action: quoi }
}
async function apresEcriture(): Promise<void> {
  edition.value = null
  action.value = null
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <UTabs
      v-model="typeActif"
      :items="items"
      :content="false"
      size="lg"
      :ui="UI_ONGLETS_TACTILES"
      aria-label="Types de versions"
    />

    <p class="m-0 text-base text-texte-secondaire" role="status">{{ definition?.aide }}</p>

    <div v-if="itemsCles.length > 1" class="flex flex-col gap-3 md:flex-row md:items-end">
      <UFormField :label="type === 'plans' ? 'Plan' : 'Prompt'" name="cle" class="md:w-80">
        <USelect v-model="cleChoisie" :items="itemsCles" size="lg" class="w-full" />
      </UFormField>
    </div>

    <UButton
      v-if="versionDeDepart && cle"
      size="lg"
      icon="i-ph-plus"
      class="min-h-(--cible-tactile) justify-center max-md:w-full md:self-start"
      @click="nouvelle(versionDeDepart)"
    >
      Nouvelle version
    </UButton>

    <div v-if="enChargement" class="flex flex-col gap-3" aria-busy="true">
      <template v-if="squeletteVisible">
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-24 w-full" />
        <USkeleton class="h-24 w-full" />
      </template>
    </div>

    <div v-else-if="error || !liste" class="flex flex-col items-start gap-4">
      <UAlert
        role="alert"
        color="error"
        variant="soft"
        icon="i-ph-warning-circle"
        description="Nous n’avons pas pu charger l’historique."
        class="w-full"
      />
      <UButton color="neutral" variant="outline" size="lg" icon="i-ph-arrow-counter-clockwise" class="min-h-(--cible-tactile)" @click="() => refresh()">
        Réessayer
      </UButton>
    </div>

    <UEmpty v-else-if="liste.elements.length === 0" icon="i-ph-clock-counter-clockwise" title="Aucune version pour le moment." />

    <template v-else>
      <AdminVersionsHistorique :versions="liste.elements" :afficher-cle="cles.length === 0" @agir="agir" @nouvelle="nouvelle" />
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

    <AdminVersionsEdition :cible="edition" @fermer="edition = null" @reussi="apresEcriture" />
    <AdminVersionsAction :cible="action" @fermer="action = null" @reussi="apresEcriture" />
  </div>
</template>
