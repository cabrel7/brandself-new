// S12 (#166) : résumé des tarifs de la page d'accueil marketing.
// Les limites viennent de l'API (lignesPlan) : aucune limite de plan écrite en dur ici.
<script setup lang="ts">
const { tarifs, erreur, gratuit, payant } = await useTarifs()
</script>

<template>
  <section v-if="!erreur && tarifs" class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 md:py-20">
    <h2 class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-semibold text-encre">
      Tarifs
    </h2>
    <div class="grid gap-6 sm:grid-cols-2">
      <div v-if="gratuit" class="p-6 rounded-(--rayon) border border-bordure bg-surface">
        <h3 class="m-0 text-base font-semibold text-encre">Gratuit</h3>
        <ul class="mt-4 list-disc list-inside text-sm text-texte-secondaire">
          <li v-for="ligne in lignesPlan(gratuit)" :key="ligne">{{ ligne }}</li>
        </ul>
      </div>
      <div v-if="payant" class="p-6 rounded-(--rayon) border border-bordure bg-surface ring-1 ring-accent">
        <h3 class="m-0 text-base font-semibold text-encre">Payant</h3>
        <p class="m-0 mt-1 text-sm text-texte-secondaire">Paiement par Mobile Money</p>
        <ul class="mt-4 list-disc list-inside text-sm text-texte-secondaire">
          <li v-for="ligne in lignesPlan(payant)" :key="ligne">{{ ligne }}</li>
        </ul>
      </div>
    </div>
  </section>
</template>
