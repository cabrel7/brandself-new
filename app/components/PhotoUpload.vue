<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME } from '#shared/medias'

const props = defineProps<{
  photo: MediaDTO | null
  initiales: string
  /** Erreur de l'enregistrement du profil liée à la photo (ex. photo introuvable). */
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
    <div class="flex items-start gap-4">
      <div
        class="flex h-36 w-28 shrink-0 items-center justify-center overflow-hidden rounded-t-full rounded-b-(--rayon-interne) bg-accent-doux"
      >
        <img
          v-if="photo"
          :src="photo.url"
          :srcset="photo.srcset"
          sizes="112px"
          :width="photo.largeur"
          :height="photo.hauteur"
          alt="Votre photo de profil"
          class="size-full object-cover object-top"
        >
        <span
          v-else
          class="font-(family-name:--font-titre) text-(length:--fs-32) font-semibold text-accent"
          aria-hidden="true"
        >
          {{ initiales }}
        </span>
      </div>
      <div class="flex min-w-0 flex-1 flex-col gap-2">
        <input
          ref="champ"
          type="file"
          :accept="ACCEPT"
          class="hidden"
          tabindex="-1"
          @change="surChoix"
        >
        <UButton
          :label="photo ? 'Changer la photo' : 'Ajouter une photo'"
          variant="outline"
          :loading="enCours"
          :aria-describedby="messageErreur ? idErreur : undefined"
          block
          @click="ouvrir"
        />
        <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
          Une photo de face, bien éclairée, rend votre vitrine plus chaleureuse.
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
