<script setup lang="ts">
// Dernier appel : le même champ d'adresse que le hero (valeur partagée). C'est la cible de « Créer ma vitrine » (#adresse-fin).
const TEXTE_TITRE = 'Votre adresse vous attend.'
</script>

<template>
  <section id="adresse-fin" class="bg-accent-doux px-4 py-20 md:px-6 md:py-30" aria-labelledby="titre-cloture">
    <div class="mx-auto flex max-w-160 flex-col items-center gap-10 text-center">
      <h2 id="titre-cloture" class="m-0 text-balance font-(family-name:--font-titre) text-[clamp(2.125rem,4.8vw,3.625rem)] leading-[1.06] font-medium text-encre">
        {{ TEXTE_TITRE }}
      </h2>
      <MarketingAdresse />
    </div>
  </section>
</template>
