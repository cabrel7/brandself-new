// S12 (#166) : section « Promesse » de la page d'accueil marketing.
<script setup lang="ts">
defineProps<{ palette?: string }>()
</script>

<template>
  <section class="mx-auto flex w-full max-w-6xl flex-col items-center gap-6 px-6 py-12 md:py-20 text-center">
    <h1 class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold text-encre md:text-(length:--fs-48)">
      Votre vitrine en ligne
    </h1>
    <p class="m-0 max-w-2xl text-(length:--fs-20) text-texte-secondaire">
      Être trouvé sur Google, être compris, être contacté ou réservé.
    </p>
    <div class="mt-6 flex flex-col gap-4 sm:flex-row sm:justify-center">
      <NuxtLink to="/connexion" class="min-h-(--cible-tactile) inline-flex items-center justify-center gap-2 px-6 py-3 font-semibold text-sur-accent bg-accent rounded-(--rayon) no-underline transition-colors hover:bg-accent-hover">
        Créer ma vitrine
      </NuxtLink>
      <NuxtLink to="/dr-cabrel" class="min-h-(--cible-tactile) inline-flex items-center justify-center gap-2 px-6 py-3 font-semibold text-encre border border-bordure bg-surface rounded-(--rayon) no-underline transition-colors hover:bg-surface-hover">
        Voir un exemple
      </NuxtLink>
    </div>
  </section>
</template>
