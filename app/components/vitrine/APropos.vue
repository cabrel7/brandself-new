<script setup lang="ts">
// Le long texte de présentation, hors du héros : le héros reste court (accroche, réservation), le détail vient ici.
defineProps<{ bio: string }>()
</script>

<template>
  <section id="a-propos" aria-labelledby="a-propos-titre" class="mx-auto grid w-full max-w-6xl gap-4 px-6 py-12 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-12">
    <div class="flex flex-col gap-2">
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">Présentation</p>
      <h2 id="a-propos-titre" class="font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold">
        À propos
      </h2>
    </div>
    <p class="max-w-prose text-(length:--fs-16) leading-relaxed whitespace-pre-line text-texte-secondaire md:text-(length:--fs-20)">
      {{ bio }}
    </p>
  </section>
</template>
