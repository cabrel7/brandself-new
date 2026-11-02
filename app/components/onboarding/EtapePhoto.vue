<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME } from '#shared/medias'

defineProps<{
  photo: MediaDTO | null
  televersement: boolean
  /** Message sous l'arche (photo manquante, refus du serveur, échec d'envoi). */
  erreur?: string
}>()

const emit = defineEmits<{ choisir: [fichier: File] }>()

const CONSEILS = [
  'Photo de face, visage bien visible',
  'Lumière naturelle, fond simple',
  'Une tenue que vous portez avec vos clients',
] as const

const ACCEPT = MEDIA_ACCEPTED_MIME.join(',')
const champ = useTemplateRef<HTMLInputElement>('champ')
const arche = useTemplateRef<HTMLButtonElement>('arche')
const idErreur = useId()

function ouvrir(): void {
  champ.value?.click()
}

function surChoix(event: Event): void {
  const cible = event.target as HTMLInputElement
  const fichier = cible.files?.[0]
  // Permet de rechoisir le même fichier après une erreur.
  cible.value = ''
  if (fichier) emit('choisir', fichier)
}

function focusErreur(): void {
  arche.value?.focus()
}

defineExpose({ focusErreur })
</script>

<template>
  <div class="flex flex-col gap-6">
    <input ref="champ" type="file" :accept="ACCEPT" class="hidden" tabindex="-1" @change="surChoix">

    <div class="flex flex-col items-center gap-3">
      <div
        v-if="photo"
        class="h-60 w-50 overflow-hidden rounded-t-full rounded-b-(--rayon-carte) bg-accent-doux"
      >
        <img
          :src="photo.url"
          :srcset="photo.srcset"
          sizes="200px"
          :width="photo.largeur"
          :height="photo.hauteur"
          alt="Votre photo"
          class="size-full object-cover object-top"
        >
      </div>
      <button
        v-else
        ref="arche"
        type="button"
        class="flex h-60 w-50 cursor-pointer flex-col items-center justify-center gap-3 rounded-t-full rounded-b-(--rayon-carte) border-2 border-dashed border-accent bg-accent-doux font-semibold text-accent-texte transition-colors hover:bg-surface disabled:cursor-wait disabled:opacity-70"
        :disabled="televersement"
        :aria-busy="televersement"
        :aria-describedby="erreur ? idErreur : undefined"
        @click="ouvrir"
      >
        <UIcon
          :name="televersement ? 'i-ph-spinner' : 'i-ph-image'"
          class="size-10"
          :class="{ 'animate-spin motion-reduce:animate-none': televersement }"
          aria-hidden="true"
        />
        <span>{{ televersement ? 'Envoi de votre photo…' : 'Ajouter une photo' }}</span>
      </button>

      <UButton
        v-if="photo"
        label="Changer la photo"
        variant="outline"
        color="neutral"
        :loading="televersement"
        @click="ouvrir"
      />

      <p class="sr-only" role="status">{{ televersement ? 'Envoi de votre photo…' : '' }}</p>

      <p v-if="erreur" :id="idErreur" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreur }}</span>
      </p>
    </div>

    <ul class="m-0 flex list-none flex-col gap-3 p-0">
      <li v-for="conseil in CONSEILS" :key="conseil" class="flex items-center gap-3 text-texte-secondaire">
        <UIcon name="i-ph-check" class="size-5 shrink-0 text-accent" aria-hidden="true" />
        {{ conseil }}
      </li>
    </ul>
  </div>
</template>
