<script setup lang="ts">
import type { NextStep } from '#shared/vitrine'

const props = defineProps<{ username: string, prochaineEtape: NextStep | null }>()

const adresse = computed(() => `${HOTE_VITRINES}/${props.username}`)
// Le partage est déjà sur cet écran : la carte « Partagez votre vitrine » ferait doublon.
const etape = computed(() => (props.prochaineEtape === 'partager' ? null : prochaineEtape(props.prochaineEtape)))

const { copy, copied } = useClipboard({ copiedDuring: 2000 })
const { pret, lienWhatsapp, partagerWhatsapp } = usePartageVitrine()
const panneauOuvert = ref(false)

// Le bouton « Publier » vient de disparaître : le focus passe au titre de l'écran final.
const titre = useTemplateRef<HTMLHeadingElement>('titre')
onMounted(() => titre.value?.focus())
</script>

<template>
  <main class="mx-auto flex w-full max-w-120 flex-col items-center gap-4 px-6 pt-16 pb-12 text-center">
    <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
      <UIcon name="i-ph-check" class="size-10" aria-hidden="true" />
    </span>
    <h1
      ref="titre"
      tabindex="-1"
      class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold outline-none"
    >
      C’est en ligne.
    </h1>
    <p class="text-texte-secondaire">Votre vitrine est publiée. Voici votre adresse, prête à être partagée.</p>

    <div class="flex w-full items-center justify-between gap-2 rounded-(--rayon) border border-bordure bg-surface py-1 ps-4 pe-1">
      <span class="truncate font-semibold">{{ adresse }}</span>
      <UButton
        color="neutral"
        variant="ghost"
        size="lg"
        square
        :icon="copied ? 'i-ph-check' : 'i-ph-copy'"
        aria-label="Copier l’adresse"
        @click="copy(`https://${adresse}`)"
      />
    </div>
    <p class="sr-only" aria-live="polite">{{ copied ? 'Adresse copiée.' : '' }}</p>

    <UButton :to="`/${username}`" block>Voir ma vitrine</UButton>
    <UButton
      :to="lienWhatsapp"
      :disabled="!pret"
      target="_blank"
      rel="noopener"
      variant="outline"
      block
      icon="i-ph-whatsapp-logo"
      @click="partagerWhatsapp"
    >
      Partager sur WhatsApp
    </UButton>
    <UButton
      label="Autres façons de partager"
      variant="link"
      size="lg"
      class="min-h-(--cible-tactile)"
      aria-haspopup="dialog"
      @click="panneauOuvert = true"
    />
    <StudioPartageVitrine v-model:open="panneauOuvert" />

    <StudioProchaineEtape v-if="etape" :etape="etape" class="mt-4 w-full" />
  </main>
</template>
