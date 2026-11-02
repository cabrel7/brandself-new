<script setup lang="ts">
import type { ContenusPublicsDTO } from '#shared/dto'
import { realisationsHref } from '#shared/realisations'

const props = defineProps<{ nomAffiche: string, username: string, contenus: ContenusPublicsDTO }>()

const route = useRoute()

const servicesHref = computed(() => `/${props.username}/services`)
const realisationsHrefComputed = computed(() => realisationsHref(props.username))
// S7-bis : « Réserver » mène à la page Agenda, seul endroit où choisir un créneau.
const reserverHref = computed(() => `/${props.username}/agenda`)
const reserverActif = computed(() => route.path === reserverHref.value)

const liens = computed(() => {
  const items: { libelle: string, to: string }[] = []
  if (props.contenus.services > 0) items.push({ libelle: 'Services', to: servicesHref.value })
  if (props.contenus.realisations > 0) items.push({ libelle: 'Réalisations', to: realisationsHrefComputed.value })
  if (props.contenus.agenda) items.push({ libelle: 'Agenda', to: `/${props.username}/agenda` })
  items.push({ libelle: 'Contact', to: `/${props.username}/contact` })
  return items.map(item => ({
    ...item,
    actif: route.path === item.to || route.path.startsWith(`${item.to}/`),
  }))
})
</script>

<template>
  <header class="border-b border-bordure bg-fond sticky top-0 z-10">
    <div class="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
      <NuxtLink
        :to="`/${username}`"
        class="inline-flex min-h-(--cible-tactile) min-w-0 items-center font-(family-name:--font-titre) text-(length:--fs-20) font-bold"
      >
        <span class="truncate">{{ nomAffiche }}</span>
      </NuxtLink>
      <nav aria-label="Vitrine" class="flex shrink-0 items-center gap-6">
        <NuxtLink
          v-for="lien in liens"
          :key="lien.to"
          :to="lien.to"
          :aria-current="lien.actif ? 'page' : undefined"
          class="hidden min-h-(--cible-tactile) items-center text-(length:--fs-14) font-medium transition-colors hover:text-accent-texte md:inline-flex"
          :class="lien.actif ? 'text-encre' : 'text-texte-secondaire'"
        >
          {{ lien.libelle }}
        </NuxtLink>
        <NuxtLink
          v-if="contenus.agenda"
          :to="reserverHref"
          :aria-current="reserverActif ? 'page' : undefined"
          class="inline-flex min-h-(--cible-tactile) items-center rounded-(--rayon) bg-accent px-4 py-2 text-(length:--fs-14) font-medium text-sur-accent no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Réserver
        </NuxtLink>
      </nav>
    </div>
  </header>
</template>
