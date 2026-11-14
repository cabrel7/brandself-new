// S12 (#166) : section « 3 fonctions » de la page d'accueil marketing.
<script setup lang="ts"></script>

<template>
  <section class="mx-auto flex w-full max-w-6xl flex-col gap-12 px-6 py-12 md:py-20">
    <div class="grid gap-6 sm:grid-cols-3">
      <div class="flex flex-col gap-3 p-6 rounded-(--rayon) border border-bordure bg-surface">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent-doux text-sur-accent">
          <UIcon name="i-ph-magnifying-glass" class="size-5" aria-hidden="true" />
        </div>
        <h2 class="m-0 text-base font-semibold text-encre">Être trouvé</h2>
        <p class="m-0 text-sm text-texte-secondaire">
          Votre vitrine apparaît sur Google quand on cherche votre métier près de chez vous.
        </p>
      </div>
      <div class="flex flex-col gap-3 p-6 rounded-(--rayon) border border-bordure bg-surface">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent-doux text-sur-accent">
          <UIcon name="i-ph-user" class="size-5" aria-hidden="true" />
        </div>
        <h2 class="m-0 text-base font-semibold text-encre">Être compris</h2>
        <p class="m-0 text-sm text-texte-secondaire">
          Votre présentation, vos services et vos réalisations parlent pour vous.
        </p>
      </div>
      <div class="flex flex-col gap-3 p-6 rounded-(--rayon) border border-bordure bg-surface">
        <div class="flex h-10 w-10 items-center justify-center rounded-full bg-accent-doux text-sur-accent">
          <UIcon name="i-ph-calendar" class="size-5" aria-hidden="true" />
        </div>
        <h2 class="m-0 text-base font-semibold text-encre">Être contacté ou réservé</h2>
        <p class="m-0 text-sm text-texte-secondaire">
          Vos visiteurs vous écrivent ou prennent rendez-vous directement depuis votre vitrine.
        </p>
      </div>
    </div>
  </section>
</template>
