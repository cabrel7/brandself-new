<script setup lang="ts">
defineProps<{ username: string }>()
</script>

<template>
  <section aria-labelledby="realisation-appel" class="flex flex-col gap-3 rounded-(--rayon-carte) bg-accent-doux p-6 md:p-8">
    <h2 id="realisation-appel" class="font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold">
      Un projet en tête ? Parlons-en.
    </h2>
    <p class="text-texte-secondaire">Prenez rendez-vous pour en discuter.</p>
    <UButton :to="`/${username}/agenda`" size="lg" block class="mt-2 md:w-auto md:self-start">
      Prendre rendez-vous
    </UButton>
  </section>
</template>
