<script setup lang="ts">
import { ADMIN_PREFIXE_API } from '#shared/admin'
import { ADMIN_FILTRES_VITRINE_UTILISATEUR, ADMIN_UTILISATEURS_TRI_DEFAUT, ADMIN_UTILISATEURS_TRIS } from '#shared/admin-a2'
import type { ListeUtilisateursDto } from '#shared/schemas/admin-a2'
import { PLAN_IDS } from '#shared/plans'
import { messageDepuisErreurApi, termeRecherche } from '~/utils/admin-a2'
import { UI_CHAMP_TACTILE, UI_PAGINATION_TACTILE, compterFiltresActifs } from '~/utils/admin-ui'
import { FILTRE_TOUS, formaterNombre, libellePlan } from '~/utils/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Utilisateurs · Administration' })

const dans = (liste: readonly string[]) => (valeur: string) => liste.includes(valeur)
const ORDRES = ['asc', 'desc']
const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/

const {
  data, error, enChargement, actualisation, filtres, filtresActifs, page, saisie, tropCourte, maj, changerPage, reinitialiser, refresh,
} = useAdminListe<ListeUtilisateursDto>({
  chemin: `${ADMIN_PREFIXE_API}/utilisateurs`,
  cle: 'admin-utilisateurs',
  filtres: {
    q: (valeur) => termeRecherche(valeur) !== null,
    plan: dans(PLAN_IDS),
    suspendu: dans(['true', 'false']),
    vitrine: dans(ADMIN_FILTRES_VITRINE_UTILISATEUR),
    du: (valeur) => FORMAT_JOUR.test(valeur),
    au: (valeur) => FORMAT_JOUR.test(valeur),
    tri: dans(ADMIN_UTILISATEURS_TRIS),
    ordre: dans(ORDRES),
  },
})

const LIBELLES_TRI: Record<(typeof ADMIN_UTILISATEURS_TRIS)[number], string> = {
  cree_le: 'Date d’inscription',
  email: 'Adresse e-mail',
  derniere_connexion: 'Dernière connexion',
  plan: 'Plan',
}

const optionsPlan = [{ label: 'Tous les plans', value: FILTRE_TOUS }, ...PLAN_IDS.map((p) => ({ label: libellePlan(p), value: p }))]
const optionsCompte = [
  { label: 'Tous les comptes', value: FILTRE_TOUS },
  { label: 'Suspendus', value: 'true' },
  { label: 'Non suspendus', value: 'false' },
]
const optionsVitrine = [
  { label: 'Toutes les vitrines', value: FILTRE_TOUS },
  { label: 'Publiée', value: 'publiee' },
  { label: 'Bloquée', value: 'bloquee' },
  { label: 'Aucune vitrine', value: 'aucune' },
]
const optionsTri = ADMIN_UTILISATEURS_TRIS.map((valeur) => ({ label: LIBELLES_TRI[valeur], value: valeur }))

const periodeInvalide = computed(() => filtres.value.du !== undefined && filtres.value.au !== undefined && filtres.value.du > filtres.value.au)
// Compteur du bloc « Filtres » : ni la recherche ni le tri (restent visibles) ne comptent.
const nombreFiltres = computed(() => compterFiltresActifs(filtres.value, ['q', 'tri', 'ordre']))
const ordre = computed(() => filtres.value.ordre ?? 'desc')
// Valeur de l'URL validée contre la liste blanche, repli sur le tri par défaut.
const tri = computed(() => ADMIN_UTILISATEURS_TRIS.find((valeur) => valeur === filtres.value.tri) ?? ADMIN_UTILISATEURS_TRI_DEFAUT)

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
    <form class="flex flex-col gap-4" novalidate role="search" aria-label="Rechercher des utilisateurs" @submit.prevent>
      <AdminRechercheChamp
        v-model="saisie"
        label="Rechercher"
        placeholder="E-mail, téléphone, adresse ou nom"
        :trop-courte="tropCourte"
      />

      <AdminFiltresRepliables :actifs="nombreFiltres">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <UFormField label="Plan">
            <USelect :model-value="filtreOuTous('plan')" :items="optionsPlan" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="changerFiltre('plan', $event)" />
          </UFormField>
          <UFormField label="Compte">
            <USelect :model-value="filtreOuTous('suspendu')" :items="optionsCompte" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="changerFiltre('suspendu', $event)" />
          </UFormField>
          <UFormField label="Vitrine">
            <USelect :model-value="filtreOuTous('vitrine')" :items="optionsVitrine" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="changerFiltre('vitrine', $event)" />
          </UFormField>
        </div>

        <div class="grid grid-cols-2 gap-3">
          <UFormField label="Inscrits à partir du" :error="periodeInvalide ? 'La date de début doit précéder la date de fin.' : undefined">
            <UInput :model-value="filtres.du ?? ''" type="date" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="maj({ du: String($event) })" />
          </UFormField>
          <UFormField label="Inscrits jusqu’au">
            <UInput :model-value="filtres.au ?? ''" type="date" size="lg" :ui="UI_CHAMP_TACTILE" class="w-full" @update:model-value="maj({ au: String($event) })" />
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
        <UButton
          v-if="filtresActifs"
          color="neutral"
          variant="link"
          size="lg"
          class="min-h-(--cible-tactile)"
          @click="reinitialiser"
        >
          Réinitialiser
        </UButton>
      </div>
    </form>

    <AdminRechercheEtats
      :chargement="enChargement"
      :erreur="!!error"
      :vide="data !== undefined && data !== null && data.elements.length === 0"
      :message-erreur="messageErreur"
      icone="i-ph-users"
      titre-vide="Aucun utilisateur"
      :description-vide="filtresActifs ? 'Aucun compte ne correspond à ces critères.' : 'Aucun compte n’est encore inscrit.'"
      @reessayer="() => refresh()"
    >
      <template #vide-actions>
        <UButton v-if="filtresActifs" color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile)" @click="reinitialiser">
          Réinitialiser les critères
        </UButton>
      </template>

      <div v-if="data" class="flex flex-col gap-4" :aria-busy="actualisation">
        <p class="m-0 text-base text-texte-secondaire" role="status">
          {{ formaterNombre(total) }} {{ total > 1 ? 'utilisateurs' : 'utilisateur' }}
        </p>
        <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0" :class="{ 'opacity-60': actualisation }">
          <li v-for="utilisateur in data.elements" :key="utilisateur.id">
            <AdminUtilisateurLigne :utilisateur="utilisateur" />
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
