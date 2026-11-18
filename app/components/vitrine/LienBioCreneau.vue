<script setup lang="ts">
import type { RouteLocationRaw } from '#vue-router'
import type { ProchainCreneauPublic } from '~/composables/usePublicAgenda'
import { ajouterJoursAgenda, dateLocaleAgenda, formaterHeureAgenda } from '~/composables/usePublicAgenda'

const JOURS_SEMAINE = 6
const NBSP = ' '

const props = defineProps<{
  creneau: ProchainCreneauPublic
  /** Titre du service dont le créneau est proposé. */
  serviceTitre: string | null
  to: RouteLocationRaw
}>()

// Jour et heure au fuseau de la vitrine, jamais à celui du navigateur.
const libelle = computed(() => {
  const { debut, fuseau } = props.creneau
  const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, weekday: 'long' }).format(new Date(debut))
  const aujourdHui = dateLocaleAgenda(new Date(), fuseau)
  const cetteSemaine = dateLocaleAgenda(debut, fuseau) <= ajouterJoursAgenda(aujourdHui, JOURS_SEMAINE)
  // Au-delà de la semaine, le jour seul serait ambigu : on ajoute la date.
  const date = cetteSemaine
    ? ''
    : ` ${new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, day: 'numeric', month: 'short' }).format(new Date(debut))}`
  const jourCapitalise = jour.charAt(0).toLocaleUpperCase('fr-FR') + jour.slice(1)
  // Espace insécable dans l'heure (« 9 h ») : elle ne doit jamais se couper entre le chiffre et « h ».
  const heure = formaterHeureAgenda(debut, fuseau).replace(/\s/g, NBSP)
  return `${jourCapitalise}${date} ${heure}`
})
</script>

<template>
  <section aria-label="Prochain créneau" class="flex items-center gap-4 rounded-(--rayon-carte) border border-bordure bg-surface p-4">
    <span class="hidden size-12 shrink-0 items-center justify-center sm:flex rounded-(--rayon-interne) bg-accent-doux text-accent-texte" aria-hidden="true">
      <UIcon name="i-ph-calendar-dots" class="size-6" />
    </span>
    <div class="min-w-0 flex-1">
      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">Prochain créneau</p>
      <p class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) leading-tight font-bold text-encre">{{ libelle }}</p>
      <p v-if="serviceTitre" :title="serviceTitre" class="m-0 truncate text-(length:--fs-14) text-texte-secondaire">{{ serviceTitre }}</p>
    </div>
    <NuxtLink
      :to="to"
      class="inline-flex min-h-(--cible-tactile) shrink-0 items-center rounded-full border border-accent px-5 text-(length:--fs-16) font-semibold text-accent-texte no-underline transition-colors hover:bg-accent-doux focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      Réserver
    </NuxtLink>
  </section>
</template>
