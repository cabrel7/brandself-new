<script setup lang="ts">
import type { ProchaineEtape } from '~/utils/prochaine-etape'

defineProps<{
  etape: ProchaineEtape
  /** Affiche « Ne plus proposer cette étape » (accueil du studio ; absent de l'écran « C'est en ligne »). */
  ignorable?: boolean
  ignorerEnCours?: boolean
  /** Échec de « ignorer » : un seul message, dans la carte. */
  erreur?: string
}>()

const emit = defineEmits<{ action: [], ignorer: [] }>()

const idTitre = useId()
const titre = useTemplateRef<HTMLHeadingElement>('titre')

/** Appelé après « ignorer » : le bouton ne bouge pas, le focus passe au titre de la nouvelle étape. */
defineExpose({ focusTitre: () => titre.value?.focus() })
</script>

<template>
  <section :aria-labelledby="idTitre" class="flex flex-col items-start gap-3 rounded-(--rayon-carte) bg-accent-doux p-6 text-start">
    <p class="m-0 text-(length:--fs-14) font-bold tracking-widest text-accent-texte uppercase">
      Prochaine étape
    </p>
    <h2
      :id="idTitre"
      ref="titre"
      tabindex="-1"
      class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) leading-snug font-bold text-encre outline-none"
    >
      {{ etape.titre }}
    </h2>
    <p class="m-0 text-base text-encre">
      {{ etape.texte }}
    </p>

    <p v-if="erreur" role="alert" class="message-erreur">
      <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
      <span>{{ erreur }}</span>
    </p>

    <UButton
      :label="etape.action"
      :to="etape.to"
      block
      size="lg"
      :disabled="ignorerEnCours"
      class="min-h-(--cible-tactile) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-encre"
      @click="emit('action')"
    />
    <UButton
      v-if="ignorable"
      label="Ne plus proposer cette étape"
      variant="link"
      color="neutral"
      block
      size="lg"
      :loading="ignorerEnCours"
      class="min-h-(--cible-tactile) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-encre"
      @click="emit('ignorer')"
    />
  </section>
</template>
