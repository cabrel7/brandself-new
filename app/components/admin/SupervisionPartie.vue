<script setup lang="ts">
// Une partie de la page de supervision : titre, chargement, erreur avec « Réessayer », puis le contenu. Chaque partie
// échoue seule : une lecture en panne ne masque pas les autres. Le titre est un h2 (le h1 est celui de la barre du haut).
defineProps<{
  id: string
  titre: string
  chargement: boolean
  erreur: boolean
  messageErreur: string
}>()
defineEmits<{ reessayer: [] }>()
</script>

<template>
  <section :id="id" :aria-labelledby="`${id}-titre`" class="flex scroll-mt-4 flex-col gap-4">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <h2 :id="`${id}-titre`" class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold text-encre">
        {{ titre }}
      </h2>
      <slot name="actions" />
    </div>
    <AdminRechercheEtats
      :chargement="chargement"
      :erreur="erreur"
      :vide="false"
      titre-vide=""
      :message-erreur="messageErreur"
      @reessayer="$emit('reessayer')"
    >
      <slot />
    </AdminRechercheEtats>
  </section>
</template>
