<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME } from '#shared/medias'

const props = defineProps<{
  photo: MediaDTO | null
  /** Erreur de l'enregistrement liée à la photo (ex. photo introuvable). */
  erreurExterne?: string
}>()

const emit = defineEmits<{
  televersee: [media: MediaDTO]
  retiree: []
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
    <div class="flex items-center gap-4">
      <input
        ref="champ"
        type="file"
        :accept="ACCEPT"
        class="hidden"
        tabindex="-1"
        @change="surChoix"
      >
      <button
        type="button"
        class="relative flex size-24 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-(--rayon) border border-dashed border-accent bg-accent-doux transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait"
        :disabled="enCours"
        tabindex="-1"
        :aria-labelledby="idAction"
        :aria-describedby="messageErreur ? idErreur : undefined"
        @click="ouvrir"
      >
        <img
          v-if="photo"
          :src="photo.url"
          :srcset="photo.srcset"
          sizes="96px"
          :width="photo.largeur"
          :height="photo.hauteur"
          alt="Photo du service"
          class="size-full object-cover"
        >
        <UIcon v-else-if="enCours" name="i-ph-circle-notch" class="size-8 animate-spin text-accent" aria-hidden="true" />
        <UIcon v-else name="i-ph-image" class="size-8 text-accent" aria-hidden="true" />
        <span v-if="photo && enCours" class="absolute inset-0 flex items-center justify-center bg-fond/70" aria-hidden="true">
          <UIcon name="i-ph-circle-notch" class="size-8 animate-spin text-accent" />
        </span>
      </button>

      <div class="flex min-w-0 flex-1 flex-col items-start gap-1">
        <UButton
          :id="idAction"
          :aria-describedby="messageErreur ? idErreur : undefined"
          :label="photo ? 'Changer la photo' : 'Ajouter une photo'"
          variant="link"
          size="lg"
          class="px-0"
          :loading="enCours"
          @click="ouvrir"
        />
        <UButton
          v-if="photo"
          label="Retirer la photo"
          variant="link"
          color="neutral"
          size="lg"
          class="px-0"
          :disabled="enCours"
          @click="emit('retiree')"
        />
        <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
          Elle s’affiche sur la fiche du service.
        </p>
      </div>
    </div>

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
