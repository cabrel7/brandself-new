<script setup lang="ts">
import { ADMIN_PREFIXE_API } from '#shared/admin'
import { ADMIN_STATUTS_VITRINE, ADMIN_VITRINES_TRI_DEFAUT, ADMIN_VITRINES_TRIS } from '#shared/admin-a2'
import type { ListeVitrinesDto } from '#shared/schemas/admin-a2'
import { PLAN_IDS } from '#shared/plans'
import { messageDepuisErreurApi, termeRecherche } from '~/utils/admin-a2'
import { UI_CHAMP_TACTILE, UI_PAGINATION_TACTILE, compterFiltresActifs } from '~/utils/admin-ui'
import { FILTRE_TOUS, formaterNombre, libellePlan } from '~/utils/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Vitrines · Administration' })

const dans = (liste: readonly string[]) => (valeur: string) => liste.includes(valeur)
const ORDRES = ['asc', 'desc']

const {
  data, error, enChargement, actualisation, filtres, filtresActifs, page, saisie, tropCourte, maj, changerPage, reinitialiser, refresh,
} = useAdminListe<ListeVitrinesDto>({
  chemin: `${ADMIN_PREFIXE_API}/vitrines`,
  cle: 'admin-vitrines',
  filtres: {
    q: (valeur) => termeRecherche(valeur) !== null,
    plan: dans(PLAN_IDS),
    statut: dans(ADMIN_STATUTS_VITRINE),
    tri: dans(ADMIN_VITRINES_TRIS),
    ordre: dans(ORDRES),
  },
})

const LIBELLES_TRI: Record<(typeof ADMIN_VITRINES_TRIS)[number], string> = {
  cree_le: 'Date de création',
  username: 'Adresse',
  nom: 'Nom',
}

const optionsPlan = [{ label: 'Tous les plans', value: FILTRE_TOUS }, ...PLAN_IDS.map((p) => ({ label: libellePlan(p), value: p }))]
const optionsStatut = [
  { label: 'Tous les statuts', value: FILTRE_TOUS },
  { label: 'Publiée', value: 'publiee' },
  { label: 'Bloquée', value: 'bloquee' },
  { label: 'Non publiée', value: 'non_publiee' },
]
const optionsTri = ADMIN_VITRINES_TRIS.map((valeur) => ({ label: LIBELLES_TRI[valeur], value: valeur }))

const nombreFiltres = computed(() => compterFiltresActifs(filtres.value, ['q', 'tri', 'ordre']))
const ordre = computed(() => filtres.value.ordre ?? 'desc')
// Valeur de l'URL validée contre la liste blanche, repli sur le tri par défaut.
const tri = computed(() => ADMIN_VITRINES_TRIS.find((valeur) => valeur === filtres.value.tri) ?? ADMIN_VITRINES_TRI_DEFAUT)
const pageCourante = computed({
  get: () => page.value,
  set: (valeur: number) => { void changerPage(valeur) },
})
const filtreOuTous = (nom: string): string => filtres.value[nom] ?? FILTRE_TOUS
const changerFiltre = (nom: string, valeur: string): Promise<void> => maj({ [nom]: valeur === FILTRE_TOUS ? undefined : valeur })

const total = computed(() => data.value?.total ?? 0)
const limite = computed(() => data.value?.limite ?? 25)
const messageErreur = computed(() => (error.value ? messageDepuisErreurApi(error.value) : ''))
</script>

<template>
  <div class="flex flex-col gap-6">
    <form class="flex flex-col gap-4" novalidate role="search" aria-label="Rechercher des vitrines" @submit.prevent>
      <AdminRechercheChamp
        v-model="saisie"
        label="Rechercher"
        placeholder="Adresse ou nom"
        :trop-courte="tropCourte"
      />

      <AdminFiltresRepliables :actifs="nombreFiltres">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <UFormField label="Plan">
            <USelect :model-value="filtreOuTous('plan')" :items="optionsPlan" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="changerFiltre('plan', $event)" />
          </UFormField>
          <UFormField label="Statut">
            <USelect :model-value="filtreOuTous('statut')" :items="optionsStatut" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="changerFiltre('statut', $event)" />
          </UFormField>
        </div>
      </AdminFiltresRepliables>

      <div class="flex flex-wrap items-end gap-3">
        <UFormField label="Trier par" class="min-w-0 flex-1">
          <USelect :model-value="tri" :items="optionsTri" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="maj({ tri: $event })" />
        </UFormField>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          :icon="ordre === 'asc' ? 'i-ph-sort-ascending' : 'i-ph-sort-descending'"
          class="min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center"
          :aria-label="ordre === 'asc' ? 'Ordre croissant, passer en décroissant' : 'Ordre décroissant, passer en croissant'"
          @click="maj({ ordre: ordre === 'asc' ? 'desc' : 'asc' })"
        />
        <UButton v-if="filtresActifs" color="neutral" variant="link" size="lg" class="min-h-(--cible-tactile)" @click="reinitialiser">
          Réinitialiser
        </UButton>
      </div>
    </form>

    <AdminRechercheEtats
      :chargement="enChargement"
      :erreur="!!error"
      :vide="data !== undefined && data !== null && data.elements.length === 0"
      :message-erreur="messageErreur"
      icone="i-ph-storefront"
      titre-vide="Aucune vitrine"
      :description-vide="filtresActifs ? 'Aucune vitrine ne correspond à ces critères.' : 'Aucune vitrine n’a encore été créée.'"
      @reessayer="() => refresh()"
    >
      <template #vide-actions>
        <UButton v-if="filtresActifs" color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile)" @click="reinitialiser">
          Réinitialiser les critères
        </UButton>
      </template>

      <div v-if="data" class="flex flex-col gap-4" :aria-busy="actualisation">
        <p class="m-0 text-base text-texte-secondaire" role="status">
          {{ formaterNombre(total) }} {{ total > 1 ? 'vitrines' : 'vitrine' }}
        </p>
        <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0" :class="{ 'opacity-60': actualisation }">
          <li v-for="vitrine in data.elements" :key="vitrine.id">
            <AdminVitrineLigne :vitrine="vitrine" />
          </li>
        </ul>
        <UPagination
          v-if="total > limite"
          v-model:page="pageCourante"
          :items-per-page="limite"
          :total="total"
          :sibling-count="1"
          size="xl"
          :ui="UI_PAGINATION_TACTILE"
          class="self-center"
        />
      </div>
    </AdminRechercheEtats>
  </div>
</template>
