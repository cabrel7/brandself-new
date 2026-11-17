<script setup lang="ts">
const { estEcranEnfant } = useStudioNav()
</script>

<template>
  <div class="min-h-dvh bg-fond">
    <BsTopNav />
    <!-- Mobile : la barre flottante (≈ 5 rem + marge basse + zone sûre) ne recouvre jamais le contenu. -->
    <main
      class="studio-conteneur pt-6 md:pt-10"
      :class="estEcranEnfant ? 'pb-8' : 'pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-12'"
    >
      <slot />
    </main>
    <BsBottomNav v-if="!estEcranEnfant" />
  </div>
</template>
