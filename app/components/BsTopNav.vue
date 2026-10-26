<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'

const { entrees, estActive } = useStudioNav()
const { vitrine } = useStudioVitrine()

const items = computed<NavigationMenuItem[]>(() =>
  entrees.map((entree) => ({
    label: entree.label,
    to: entree.to,
    active: estActive(entree.to),
  })),
)

const initiales = computed(() => {
  if (!vitrine.value) return ''
  return `${vitrine.value.prenom.charAt(0)}${vitrine.value.nom.charAt(0)}`.toUpperCase()
})
</script>

<template>
  <header class="sticky top-0 z-10 hidden border-b border-bordure bg-fond md:block">
    <div class="mx-auto flex h-16 max-w-5xl items-center justify-between gap-6 px-6">
      <NuxtLink
        to="/studio"
        class="font-(family-name:--font-titre) text-(length:--fs-24) font-semibold text-encre no-underline"
      >
        Brandself
      </NuxtLink>
      <UNavigationMenu
        :items="items"
        orientation="horizontal"
        aria-label="Navigation du studio"
        :ui="{ link: 'min-h-(--cible-tactile) items-center text-base' }"
      />
      <NuxtLink
        to="/studio/compte"
        aria-label="Votre compte"
        class="inline-flex size-11 items-center justify-center rounded-full"
      >
        <UAvatar :text="initiales || undefined" icon="i-ph-user" size="lg" aria-hidden="true" />
      </NuxtLink>
    </div>
  </header>
</template>
