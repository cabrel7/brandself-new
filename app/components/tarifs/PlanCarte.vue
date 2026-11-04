<script setup lang="ts">
defineProps<{
  titre: string
  /** Prix déjà formaté ; `null` quand aucun prix n'est publié. */
  prix: string | null
  /** Précision sous le prix (« pour toujours », « par mois, facturé… »). */
  precision?: string
  lignes: string[]
  /** Plan payant : contour et fond d'accent. */
  miseEnAvant?: boolean
  action?: { label: string, to: string }
  /** Texte à la place du bouton quand l'action n'est pas encore possible. */
  noteAction?: string
}>()

const idTitre = useId()
</script>

<template>
  <section
    :aria-labelledby="idTitre"
    class="flex flex-col gap-6 rounded-(--rayon-carte) border p-6 md:p-8"
    :class="miseEnAvant ? 'border-accent bg-surface' : 'border-bordure bg-fond'"
  >
    <div class="flex flex-col gap-2">
      <h2 :id="idTitre" class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre">
        {{ titre }}
      </h2>
      <p v-if="prix" class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold text-encre md:text-(length:--fs-48)">
        {{ prix }}
      </p>
      <p v-if="precision" class="m-0 text-base text-texte-secondaire">
        {{ precision }}
      </p>
    </div>

    <ul class="m-0 flex list-none flex-col gap-3 border-t border-bordure p-0 pt-6">
      <li v-for="ligne in lignes" :key="ligne" class="flex items-start gap-3 text-base text-encre">
        <UIcon name="i-ph-check" class="mt-0.5 size-5 shrink-0 text-accent-texte" aria-hidden="true" />
        <span>{{ ligne }}</span>
      </li>
    </ul>

    <div class="mt-auto">
      <UButton
        v-if="action"
        :label="action.label"
        :to="action.to"
        :variant="miseEnAvant ? 'solid' : 'outline'"
        block
      />
      <p v-else-if="noteAction" class="message-info">
        <UIcon name="i-ph-clock" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ noteAction }}</span>
      </p>
    </div>
  </section>
</template>
