<script setup lang="ts">
import type { CreneauxPublicsReponse } from '#shared/dto'
import type { AgendaPublicStatut } from '~/composables/usePublicAgenda'
import { formaterJourCreneauAgenda } from '~/composables/usePublicAgenda'

const props = defineProps<{
  username: string
  serviceSlug: string
  fuseau: string
  reponse: CreneauxPublicsReponse | null
  statut: AgendaPublicStatut
  erreur: boolean
}>()

const emit = defineEmits<{ reessayer: [] }>()

const NOMBRE_CRENEAUX = 4
const prochains = computed(() => props.reponse?.creneaux.slice(0, NOMBRE_CRENEAUX) ?? [])

function lienReservation(debut: string) {
  return {
    path: `/${props.username}/reserver`,
    query: { service: props.serviceSlug, debut },
  }
}
</script>

<template>
  <section id="prochains-creneaux" class="scroll-mt-24 rounded-(--rayon-carte) border border-bordure bg-surface p-6" aria-labelledby="prochains-creneaux-titre">
    <h2 id="prochains-creneaux-titre" class="text-(length:--fs-24) font-bold">Prochains créneaux</h2>

    <div v-if="statut === 'pending'" class="mt-4 grid grid-cols-2 gap-2" aria-live="polite" aria-busy="true">
      <USkeleton v-for="numero in NOMBRE_CRENEAUX" :key="numero" class="h-(--hauteur-controle) rounded-(--rayon-interne)" />
      <span class="sr-only">Chargement des prochains créneaux</span>
    </div>

    <div v-else-if="statut === 'error' || erreur" class="mt-4 flex flex-col items-start gap-3" role="alert">
      <p class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>Les prochains créneaux ne sont pas disponibles.</span>
      </p>
      <UButton size="lg" variant="outline" icon="i-ph-arrow-counter-clockwise" @click="emit('reessayer')">
        Réessayer
      </UButton>
    </div>

    <AgendaSuspendue v-else-if="reponse?.suspendues" :username="username" />

    <div v-else-if="prochains.length" class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
      <UButton
        v-for="creneau in prochains"
        :key="creneau.debut"
        :to="lienReservation(creneau.debut)"
        variant="outline"
        color="primary"
        size="lg"
        class="justify-center"
      >
        {{ formaterJourCreneauAgenda(creneau.debut, reponse?.fuseau ?? fuseau) }}
      </UButton>
    </div>

    <p v-else class="mt-4 flex items-start gap-3 text-texte-secondaire" role="status">
      <UIcon name="i-ph-calendar-x" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <span>Aucun créneau n’est disponible actuellement.</span>
    </p>

    <NuxtLink
      :to="{ path: `/${username}/agenda`, query: { service: serviceSlug } }"
      class="mt-4 inline-flex min-h-(--cible-tactile) items-center gap-2 font-semibold text-accent-texte hover:text-encre"
    >
      Voir tout l’agenda
      <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
    </NuxtLink>
  </section>
</template>
