<script setup lang="ts">
import type { CartePlan } from '~/composables/useTarifsAffichage'

// Carte d'un plan : claire (gratuit) ou sombre (payant). Partagée par la page d'accueil (titre de niveau 3, sous
// le titre de la rubrique) et par /tarifs (titre de niveau 2, sous le titre de la page).
const props = withDefaults(defineProps<{
  carte: CartePlan
  niveau?: 2 | 3
}>(), { niveau: 3 })

const idTitre = useId()
const balise = computed(() => `h${props.niveau}`)
// `opacity-80` et non `text-fond/80` : le modificateur d'opacité de Tailwind produit une couleur composée que l'audit d'accessibilité de Lighthouse ne sait pas lire.
const classeSecondaire = computed(() => (props.carte.sombre ? 'text-fond opacity-80' : 'text-texte-secondaire'))
</script>

<template>
  <section
    :aria-labelledby="idTitre"
    class="flex flex-col gap-6 rounded-(--rayon-carte) border p-7 md:p-10"
    :class="carte.sombre ? 'border-encre bg-encre text-fond' : 'border-bordure bg-fond text-encre'"
  >
    <component :is="balise" :id="idTitre" class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-medium">
      {{ carte.titre }}
    </component>
    <div class="flex flex-col gap-1">
      <p class="m-0 min-h-6 text-(length:--fs-14)" :class="classeSecondaire">
        {{ carte.accroche }}
      </p>
      <p v-if="carte.prix" class="m-0 font-(family-name:--font-titre) text-(length:--fs-48) leading-tight font-medium">
        {{ carte.prix }}
      </p>
      <p v-if="carte.precision" class="m-0 text-(length:--fs-14)" :class="classeSecondaire">
        {{ carte.precision }}
      </p>
    </div>
    <ul class="m-0 flex flex-1 list-none flex-col gap-3 p-0">
      <li v-for="ligne in carte.lignes" :key="ligne" class="flex items-start gap-2.5">
        <UIcon name="i-ph-check" class="mt-1 size-5 shrink-0" :class="carte.sombre ? 'text-accent-doux' : 'text-accent-texte'" aria-hidden="true" />
        <span>{{ ligne }}</span>
      </li>
    </ul>
    <BsButton v-if="carte.action" :to="carte.action.to" :variant="carte.sombre ? 'principal' : 'contour'" block>
      {{ carte.action.label }}
    </BsButton>
    <p v-else-if="carte.note" class="m-0 flex items-start gap-2" :class="classeSecondaire">
      <UIcon name="i-ph-clock" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <span>{{ carte.note }}</span>
    </p>
  </section>
</template>
