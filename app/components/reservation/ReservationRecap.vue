<script setup lang="ts">
import { formatDureeLongue } from '#shared/services'
import { formaterDateLongueAgenda, formaterHeureAgenda } from '~/composables/usePublicAgenda'

const props = defineProps<{
  titre: string
  debut: string
  dureeMin: number | null
  paiement: string
  professionnel: string
  lieu: string
  fuseau: string
  modifierHref?: string
}>()

const dateHeure = computed(() =>
  `${formaterDateLongueAgenda(props.debut, props.fuseau)}, ${formaterHeureAgenda(props.debut, props.fuseau)}`,
)
</script>

<template>
  <aside aria-labelledby="recap-reservation-titre" class="rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8">
    <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">Votre rendez-vous</p>
    <h2 id="recap-reservation-titre" class="mt-3 text-(length:--fs-24) leading-tight font-bold md:text-(length:--fs-32)">
      {{ titre }}
    </h2>

    <ul class="mt-5 flex flex-col gap-4">
      <li class="flex items-start gap-3">
        <UIcon name="i-ph-calendar-blank" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <span>{{ dateHeure }}</span>
      </li>
      <li v-if="dureeMin !== null" class="flex items-start gap-3">
        <UIcon name="i-ph-clock" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <span>{{ formatDureeLongue(dureeMin) }}</span>
      </li>
      <li class="flex items-start gap-3">
        <UIcon name="i-ph-credit-card" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <span>{{ paiement }}</span>
      </li>
      <li class="flex items-start gap-3">
        <UIcon name="i-ph-map-pin" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
        <span>{{ professionnel }} · {{ lieu }}</span>
      </li>
    </ul>

    <NuxtLink
      v-if="modifierHref"
      :to="modifierHref"
      class="mt-5 inline-flex min-h-(--cible-tactile) items-center font-semibold text-accent-texte hover:text-encre"
    >
      Modifier le créneau
    </NuxtLink>
  </aside>
</template>
