<script setup lang="ts">
const { entrees, estActive } = useStudioNav()
</script>

<template>
  <nav
    aria-label="Navigation du studio"
    class="fixed inset-x-0 bottom-0 z-20 grid grid-cols-5 border-t border-bordure bg-fond pb-[env(safe-area-inset-bottom)] md:hidden"
  >
    <NuxtLink
      v-for="entree in entrees"
      :key="entree.to"
      :to="entree.to"
      :aria-current="estActive(entree.to) ? 'page' : undefined"
      class="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-1 text-(length:--fs-12) font-medium whitespace-nowrap transition-colors hover:text-accent"
      :class="estActive(entree.to) ? 'text-accent' : 'text-texte-secondaire'"
    >
      <UIcon :name="entree.icon" class="size-6" aria-hidden="true" />
      <span>{{ entree.label }}</span>
    </NuxtLink>
  </nav>
</template>
