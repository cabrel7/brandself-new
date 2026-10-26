<script setup lang="ts">
const { estEcranEnfant } = useStudioNav()
</script>

<template>
  <div class="min-h-dvh bg-fond">
    <BsTopNav />
    <main
      class="mx-auto w-full max-w-2xl px-4 pt-6 md:px-6 md:pt-10"
      :class="estEcranEnfant ? 'pb-8' : 'pb-24 md:pb-12'"
    >
      <slot />
    </main>
    <BsBottomNav v-if="!estEcranEnfant" />
  </div>
</template>
