<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME } from '#shared/medias'

const props = defineProps<{
  photo: MediaDTO | null
  televersement: boolean
  /** Message sous l'arche (photo manquante, refus du serveur, échec d'envoi). */
  erreur?: string
}>()

const emit = defineEmits<{ choisir: [fichier: File] }>()

const ACCEPT = MEDIA_ACCEPTED_MIME.join(',')
const champ = useTemplateRef<HTMLInputElement>('champ')
const arche = useTemplateRef<HTMLButtonElement>('arche')
const changer = useTemplateRef<{ $el: HTMLElement }>('changer')
const idErreur = useId()

// Une photo vient d'arriver (ou d'être remplacée) : l'arche cliquable a disparu, le focus passe à
// « Changer la photo ». On suit la photo et non `televersement`, qui repasse à faux avant qu'elle soit posée.
watch(() => props.photo?.id, async (nouvelle, ancienne) => {
  if (!nouvelle || nouvelle === ancienne) return
  await nextTick()
  changer.value?.$el.focus()
})

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
        class="fondu-bas h-72 w-56 overflow-hidden bg-accent-doux md:h-80 md:w-64"
      >
        <img
          :src="photo.url"
          :srcset="photo.srcset"
          sizes="(min-width: 768px) 256px, 224px"
          :width="photo.largeur"
          :height="photo.hauteur"
          alt="Aperçu de votre photo"
          class="size-full object-cover object-top"
        >
      </div>
      <button
        v-else
        ref="arche"
        type="button"
        class="flex h-72 w-56 cursor-pointer flex-col md:h-80 md:w-64 items-center justify-center gap-3 border-2 border-dashed border-accent bg-accent-doux font-semibold text-accent-texte transition-colors hover:bg-surface disabled:cursor-wait disabled:opacity-70"
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
        ref="changer"
        label="Changer la photo"
        variant="outline"
        color="neutral"
        :loading="televersement"
        @click="ouvrir"
      />

      <!-- Seule annonce de l'envoi : le texte du bouton « Ajouter une photo » n'est pas une zone vivante. -->
      <p class="sr-only" role="status">{{ televersement ? 'Envoi de votre photo…' : '' }}</p>

      <p v-if="erreur" :id="idErreur" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreur }}</span>
      </p>
    </div>
  </div>
</template>
