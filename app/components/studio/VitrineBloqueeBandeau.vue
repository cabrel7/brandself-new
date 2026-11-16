<script setup lang="ts">
// Vitrine bloquée par l'administration (D-A2-02) : remplace les boutons de publication, qui ne peuvent rien faire.
defineProps<{
  /** Motif communiqué par l'administration (D-A2-13). */
  motif: string | null
}>()

const idTitre = useId()
</script>

<template>
  <section :aria-labelledby="idTitre" class="flex flex-col items-start gap-2 rounded-(--rayon-carte) bg-accent-doux p-6 text-start md:col-span-2">
    <h2 :id="idTitre" class="m-0 text-(length:--fs-20) leading-snug font-bold text-encre">
      Votre vitrine est bloquée.
    </h2>
    <p class="m-0 text-base text-encre">
      Elle n’est plus visible et vous ne pouvez pas la publier pour le moment.
    </p>
    <p v-if="motif" class="m-0 text-base text-encre">
      Motif : {{ motif }}
    </p>
    <p class="m-0 text-base text-encre">
      Contactez-nous pour la rétablir.
    </p>
  </section>
</template>
