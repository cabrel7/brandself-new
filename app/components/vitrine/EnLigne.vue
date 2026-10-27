<script setup lang="ts">
import type { NextStep } from '#shared/vitrine'

const props = defineProps<{ username: string, prochaineEtape: NextStep | null }>()

const ETAPES: Record<NextStep, { titre: string, texte: string }> = {
  photo: { titre: 'Ajoutez votre photo', texte: 'Un visage rassure vos visiteurs dès les premières secondes.' },
  service: { titre: 'Ajoutez votre premier service', texte: 'Vos visiteurs sauront tout de suite ce que vous proposez.' },
  realisation: { titre: 'Présentez une réalisation', texte: 'Montrez un travail dont vous êtes fier.' },
}

const adresse = computed(() => `${HOTE_VITRINES}/${props.username}`)
const lienPartage = computed(
  () => `https://wa.me/?text=${encodeURIComponent(`Découvrez ma vitrine : https://${adresse.value}`)}`,
)
const etape = computed(() => (props.prochaineEtape ? ETAPES[props.prochaineEtape] : null))

const { copy, copied } = useClipboard({ copiedDuring: 2000 })
</script>

<template>
  <main class="mx-auto flex w-full max-w-120 flex-col items-center gap-4 px-6 pt-16 pb-12 text-center">
    <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
      <UIcon name="i-ph-check" class="size-10" />
    </span>
    <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">C'est en ligne.</h1>
    <p class="text-texte-secondaire">Votre vitrine est publiée. Voici votre adresse, prête à être partagée.</p>

    <div class="flex w-full items-center justify-between gap-2 rounded-(--rayon) border border-bordure bg-surface py-1 ps-4 pe-1">
      <span class="truncate font-semibold">{{ adresse }}</span>
      <UButton
        color="neutral"
        variant="ghost"
        size="lg"
        square
        :icon="copied ? 'i-ph-check' : 'i-ph-copy'"
        :aria-label="copied ? 'Adresse copiée' : 'Copier l\'adresse'"
        @click="copy(`https://${adresse}`)"
      />
    </div>

    <UButton :to="`/${username}`" block>Voir ma vitrine</UButton>
    <UButton :to="lienPartage" target="_blank" rel="noopener" variant="outline" block icon="i-ph-whatsapp-logo">
      Partager sur WhatsApp
    </UButton>

    <NuxtLink
      v-if="etape"
      to="/studio"
      class="mt-4 flex w-full flex-col gap-1 rounded-3xl bg-accent-doux p-6 text-start transition-colors hover:bg-surface"
    >
      <span class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">Prochaine étape</span>
      <span class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">{{ etape.titre }}</span>
      <span class="text-texte-secondaire">{{ etape.texte }}</span>
    </NuxtLink>
  </main>
</template>
