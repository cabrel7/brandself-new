<script setup lang="ts">
import type { ContenusPublicsDTO } from '#shared/dto'
import { realisationsHref } from '#shared/realisations'

const props = defineProps<{ nomAffiche: string, username: string, contenus: ContenusPublicsDTO }>()

const route = useRoute()

const liens = computed(() => {
  const servicesHref = `/${props.username}/services`
  const realisationsLien = realisationsHref(props.username)
  const items: { libelle: string, to: string }[] = []
  if (props.contenus.services > 0) items.push({ libelle: 'Services', to: servicesHref })
  if (props.contenus.realisations > 0) items.push({ libelle: 'Réalisations', to: realisationsLien })
  return items.map(item => ({
    ...item,
    actif: route.path === item.to || route.path.startsWith(`${item.to}/`),
  }))
})
</script>

<template>
  <header class="border-b border-bordure bg-fond">
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
        <a
          href="#contact"
          class="hidden min-h-(--cible-tactile) items-center text-(length:--fs-14) font-medium text-texte-secondaire transition-colors hover:text-accent-texte md:inline-flex"
        >
          Contact
        </a>
        <UButton to="#contact" size="lg">Me contacter</UButton>
      </nav>
    </div>
  </header>
</template>
