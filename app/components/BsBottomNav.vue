<script setup lang="ts">
const { entrees, estActive, estEcranEnfant } = useStudioNav()
const { nombre, affichage, libelleAccessible } = useStudioAgendaATraiter()

/** Variante pleine Phosphor de l'icône de l'entrée (`i-ph-house` → `i-ph-house-fill`). */
function iconePleine(icon: string): string {
  return `${icon}-fill`
}
</script>

<template>
  <!-- Barre flottante : détachée des bords, même famille que les feuilles du bas (z-20 < z-40 des feuilles et modales). -->
  <nav
    v-if="!estEcranEnfant"
    aria-label="Navigation du studio"
    class="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 grid grid-cols-5 gap-1 rounded-(--rayon-carte) border border-bordure bg-fond/85 p-1.5 shadow-2xl backdrop-blur-md md:hidden"
  >
    <NuxtLink
      v-for="entree in entrees"
      :key="entree.to"
      :to="entree.to"
      :aria-current="estActive(entree.to) ? 'page' : undefined"
      class="flex min-h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-(--rayon) px-1 text-(length:--fs-12) whitespace-nowrap transition-[transform,background-color,box-shadow,color] duration-150 ease-out hover:bg-surface hover:text-encre motion-reduce:transition-none"
      :class="
        estActive(entree.to)
          ? '-translate-y-0.5 bg-accent-doux font-bold text-accent-texte shadow-md hover:bg-accent-doux hover:text-accent-texte motion-reduce:translate-y-0'
          : 'font-medium text-texte-secondaire'
      "
    >
      <span class="relative inline-flex">
        <UIcon :name="estActive(entree.to) ? iconePleine(entree.icon) : entree.icon" class="size-6" aria-hidden="true" />
        <span
          v-if="entree.to === CHEMIN_AGENDA && nombre > 0"
          class="absolute -top-1.5 -right-2.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-(length:--fs-12) leading-4 font-semibold text-sur-accent ring-2 ring-fond"
          aria-hidden="true"
        >{{ affichage }}</span>
      </span>
      <span>{{ entree.label }}</span>
      <span v-if="entree.to === CHEMIN_AGENDA && nombre > 0" class="sr-only">, {{ libelleAccessible }}</span>
    </NuxtLink>
  </nav>
</template>
