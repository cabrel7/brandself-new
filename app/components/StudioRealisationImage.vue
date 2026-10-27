<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME } from '#shared/medias'

const props = defineProps<{
  image: MediaDTO | null
  /** Erreur de l'enregistrement liée à l'image (absente, introuvable…). */
  erreurExterne?: string
}>()

const emit = defineEmits<{
  televersee: [media: MediaDTO]
}>()

const ACCEPT = MEDIA_ACCEPTED_MIME.join(',')
const champ = useTemplateRef<HTMLInputElement>('champ')
const { enCours, erreur, televerser } = useMediaUpload()
const messageErreur = computed(() => erreur.value || props.erreurExterne || '')
const idErreur = useId()
const idAction = useId()

function ouvrir(): void {
  champ.value?.click()
}

async function surChoix(event: Event): Promise<void> {
  const cible = event.target as HTMLInputElement
  const fichier = cible.files?.[0]
  // Permet de rechoisir le même fichier après une erreur.
  cible.value = ''
  if (!fichier) return
  const media = await televerser(fichier)
  if (media) emit('televersee', media)
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <input
      ref="champ"
      type="file"
      :accept="ACCEPT"
      class="hidden"
      tabindex="-1"
      @change="surChoix"
    >

    <button
      :id="idAction"
      type="button"
      class="relative flex aspect-[2/1] w-full cursor-pointer items-center justify-center overflow-hidden rounded-(--rayon) border border-dashed bg-accent-doux transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait"
      :class="messageErreur ? 'border-erreur' : 'border-accent'"
      :disabled="enCours"
      :aria-label="image ? 'Changer l’image principale' : 'Ajouter une image principale'"
      :aria-describedby="messageErreur ? idErreur : undefined"
      :aria-invalid="messageErreur ? true : undefined"
      @click="ouvrir"
    >
      <img
        v-if="image"
        :src="image.url"
        :srcset="image.srcset"
        sizes="(min-width: 768px) 640px, 100vw"
        :width="image.largeur"
        :height="image.hauteur"
        alt="Image principale de la réalisation"
        class="size-full object-cover"
      >
      <span v-else class="flex flex-col items-center gap-2 text-base font-semibold text-accent-texte">
        <UIcon :name="enCours ? 'i-ph-circle-notch' : 'i-ph-image'" class="size-10" :class="{ 'animate-spin': enCours }" aria-hidden="true" />
        Ajouter une image
      </span>
      <span v-if="image" class="absolute right-3 bottom-3 inline-flex min-h-(--cible-tactile) items-center gap-2 rounded-(--rayon-interne) bg-fond px-4 text-base font-semibold text-encre">
        <UIcon :name="enCours ? 'i-ph-circle-notch' : 'i-ph-camera'" class="size-5" :class="{ 'animate-spin': enCours }" aria-hidden="true" />
        Changer l’image
      </span>
    </button>

    <span v-if="enCours" role="status" class="sr-only">Envoi de l’image en cours</span>

    <p
      v-if="messageErreur"
      :id="idErreur"
      role="alert"
      class="message-erreur"
    >
      <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
      <span>{{ messageErreur }}</span>
    </p>
  </div>
</template>
