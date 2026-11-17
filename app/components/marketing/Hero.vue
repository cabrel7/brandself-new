<script setup lang="ts">
// Accroche : le seul `h1` de la page, rien d'invisible avant l'hydratation (le titre est le LCP, aucune image ici).
const TEXTES = {
  surtitre: 'Pour les professionnels',
  titre: 'Votre vitrine en ligne, à votre nom.',
  accroche: 'On vous trouve, on vous comprend, on vous réserve.',
  mention: 'Gratuit pour commencer.',
} as const
</script>

<template>
  <section class="px-4 pt-14 pb-20 md:px-6 md:pt-24 md:pb-30" aria-labelledby="titre-accueil">
    <div class="mx-auto flex max-w-230 flex-col items-center text-center">
      <p class="m-0 text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">
        {{ TEXTES.surtitre }}
      </p>
      <h1
        id="titre-accueil"
        class="mt-4 mb-6 text-balance font-(family-name:--font-titre) text-[clamp(2.625rem,7.4vw,5.25rem)] leading-[1.03] font-medium tracking-tight text-encre"
      >
        {{ TEXTES.titre }}
      </h1>
      <p class="m-0 mb-10 text-[clamp(1.1875rem,2.4vw,1.5rem)] text-texte-secondaire">
        {{ TEXTES.accroche }}
      </p>
      <div class="w-full max-w-145">
        <MarketingAdresse />
      </div>
      <p class="m-0 mt-2 text-base text-texte-secondaire">
        {{ TEXTES.mention }}
      </p>
    </div>
  </section>
</template>
