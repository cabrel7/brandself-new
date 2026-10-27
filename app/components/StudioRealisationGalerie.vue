<script setup lang="ts">
import { useSortable } from '@vueuse/integrations/useSortable'
import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME } from '#shared/medias'
import { GALERIE_MAX } from '#shared/realisations'

const props = defineProps<{
  images: MediaDTO[]
  /** Erreur de l'enregistrement liée à la galerie. */
  erreurExterne?: string
}>()

const emit = defineEmits<{
  'update:images': [images: MediaDTO[]]
}>()

const ACCEPT = MEDIA_ACCEPTED_MIME.join(',')
const ANIMATION_MS = 150
const DELAI_TACTILE_MS = 150
const MESSAGE_MAX = `La galerie compte ${GALERIE_MAX} images au maximum.`

const liste = useTemplateRef<HTMLElement>('liste')
const champ = useTemplateRef<HTMLInputElement>('champ')
const { enCours, erreur, televerser } = useMediaUpload()

// Copie locale : c'est elle que useSortable réordonne ; le parent reçoit chaque changement.
const items = ref<MediaDTO[]>([...props.images])
watch(() => props.images, (images) => {
  items.value = [...images]
})

const messageMax = ref('')
const annonce = ref('')
const pleine = computed(() => items.value.length >= GALERIE_MAX)
const messageErreur = computed(() => erreur.value || messageMax.value || props.erreurExterne || '')
const idErreur = useId()
const idAide = useId()

function publier(): void {
  emit('update:images', [...items.value])
}

function annoncerPosition(index: number): void {
  annonce.value = `Image ${index + 1} sur ${items.value.length}.`
}

function ouvrir(): void {
  champ.value?.click()
}

async function surChoix(event: Event): Promise<void> {
  const cible = event.target as HTMLInputElement
  const fichiers = Array.from(cible.files ?? [])
  // Permet de rechoisir les mêmes fichiers après une erreur.
  cible.value = ''
  if (fichiers.length === 0) return
  messageMax.value = fichiers.length > GALERIE_MAX - items.value.length ? MESSAGE_MAX : ''
  // Envoi séquentiel, jusqu'à atteindre le plafond ; la première erreur interrompt la série.
  for (const fichier of fichiers) {
    if (items.value.length >= GALERIE_MAX) break
    const media = await televerser(fichier)
    if (!media) break
    items.value = [...items.value, media]
    publier()
  }
}

async function retirer(index: number): Promise<void> {
  const retiree = items.value[index]
  if (!retiree) return
  messageMax.value = ''
  items.value = items.value.filter((_, i) => i !== index)
  annonce.value = `Image ${index + 1} retirée de la galerie.`
  publier()
  // Le bouton cliqué disparaît : le focus passe à la vignette voisine, sinon à la tuile « + ».
  await nextTick()
  const voisine = items.value[Math.min(index, items.value.length - 1)]
  const cible = voisine
    ? liste.value?.querySelector<HTMLElement>(`[data-vignette="${voisine.id}"]`)
    : liste.value?.querySelector<HTMLElement>('[data-ajout]')
  cible?.focus()
}

async function deplacer(id: string, sens: -1 | 1): Promise<void> {
  const index = items.value.findIndex((m) => m.id === id)
  const cible = index + sens
  const courant = items.value[index]
  const voisin = items.value[cible]
  if (!courant || !voisin) return
  const copie = [...items.value]
  copie[index] = voisin
  copie[cible] = courant
  items.value = copie
  annoncerPosition(cible)
  publier()
  // Le déplacement du nœud fait perdre le focus à la vignette : on le lui rend.
  await nextTick()
  liste.value?.querySelector<HTMLElement>(`[data-vignette="${id}"]`)?.focus()
}

function surTouche(event: KeyboardEvent, id: string): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
  event.preventDefault()
  void deplacer(id, event.key === 'ArrowLeft' ? -1 : 1)
}

const animationReduite = useMediaQuery('(prefers-reduced-motion: reduce)')
useSortable(liste, items, {
  handle: '[data-vignette]',
  draggable: '[data-element]',
  filter: '[data-retrait]',
  preventOnFilter: false,
  animation: animationReduite.value ? 0 : ANIMATION_MS,
  delay: DELAI_TACTILE_MS,
  delayOnTouchOnly: true,
  watchElement: true,
  onEnd: (evenement) => {
    const { oldIndex, newIndex } = evenement
    if (newIndex === undefined || oldIndex === newIndex) return
    annoncerPosition(newIndex)
    publier()
  },
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <input
      ref="champ"
      type="file"
      :accept="ACCEPT"
      multiple
      class="hidden"
      tabindex="-1"
      @change="surChoix"
    >

    <ul ref="liste" class="m-0 flex list-none flex-wrap gap-3 p-0">
      <li v-for="(media, index) in items" :key="media.id" data-element class="relative size-24">
        <button
          type="button"
          :data-vignette="media.id"
          class="size-full cursor-grab overflow-hidden rounded-(--rayon-interne) bg-accent-doux focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:cursor-grabbing"
          :aria-label="`Image ${index + 1} sur ${items.length}`"
          :aria-describedby="idAide"
          @keydown="(event) => surTouche(event, media.id)"
        >
          <img
            :src="media.url"
            :srcset="media.srcset"
            sizes="96px"
            :width="media.largeur"
            :height="media.hauteur"
            alt=""
            class="pointer-events-none size-full object-cover"
          >
        </button>
        <button
          type="button"
          data-retrait
          class="absolute -top-2 -right-2 flex size-(--cible-tactile) cursor-pointer items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-accent"
          :aria-label="`Retirer l’image ${index + 1} de la galerie`"
          @click="retirer(index)"
        >
          <span class="flex size-7 items-center justify-center rounded-full bg-encre text-fond">
            <UIcon name="i-ph-x" class="size-4" aria-hidden="true" />
          </span>
        </button>
      </li>

      <li v-if="!pleine" class="size-24">
        <button
          type="button"
          data-ajout
          class="flex size-full cursor-pointer items-center justify-center rounded-(--rayon-interne) border border-dashed border-accent text-accent-texte transition-colors hover:bg-accent-doux focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait"
          :disabled="enCours"
          aria-label="Ajouter des images à la galerie"
          @click="ouvrir"
        >
          <UIcon :name="enCours ? 'i-ph-circle-notch' : 'i-ph-plus'" class="size-6" :class="{ 'animate-spin': enCours }" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
      {{ items.length }} sur {{ GALERIE_MAX }}
    </p>
    <p :id="idAide" class="sr-only">
      Utilisez les flèches gauche et droite pour changer l’ordre
    </p>
    <p class="sr-only" aria-live="polite">
      {{ annonce }}
    </p>
    <span v-if="enCours" role="status" class="sr-only">Envoi des images en cours</span>

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
