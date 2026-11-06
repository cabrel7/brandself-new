// S12 (#166) : résumé des tarifs de la page d'accueil marketing.
<script setup lang="ts">
const { tarifs, erreur } = await useTarifs()
</script>

<template>
  <section v-if="!erreur && tarifs" class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 md:py-20">
    <h2 class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-semibold text-encre">
      Tarifs
    </h2>
    <p class="m-0 text-base text-texte-secondaire">
      Un plan gratuit pour commencer, un plan payant quand votre vitrine reçoit des rendez-vous.
    </p>
    <div class="grid gap-6 sm:grid-cols-2">
      <div class="p-6 rounded-(--rayon) border border-bordure bg-surface">
        <h3 class="m-0 text-base font-semibold text-encre">Gratuit</h3>
        <p class="m-0 mt-1 text-sm text-texte-secondaire">Pour toujours</p>
        <ul class="mt-4 list-disc list-inside text-sm text-texte-secondaire">
          <li>Jusqu’à 3 services, 3 réalisations, 3 témoignages</li>
          <li>Jusqu’à 10 réservations par mois</li>
          <li>3 générations IA par mois</li>
          <li>Badge « Créé avec Brandself »</li>
        </ul>
      </div>
      <div class="p-6 rounded-(--rayon) border border-bordure bg-surface ring-1 ring-accent">
        <h3 class="m-0 text-base font-semibold text-encre">Payant</h3>
        <p class="m-0 mt-1 text-sm text-texte-secondaire">Paiement par Mobile Money</p>
        <ul class="mt-4 list-disc list-inside text-sm text-texte-secondaire">
          <li>Services, réalisations et témoignages illimités</li>
          <li>Réservations illimitées par mois</li>
          <li>Générations IA illimitées</li>
          <li>Statistiques sur 90 jours avec pages et sources</li>
        </ul>
      </div>
    </div>
  </section>
</template>
