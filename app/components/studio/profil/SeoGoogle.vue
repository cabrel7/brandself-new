<script setup lang="ts">
// Décision #24 : texte « Sur Google » de la vitrine. Champs vides = texte automatique.
// Le titre de la rubrique (h2) reste dans la page ; rien n'est enregistré ici.
import { SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_MIN, SEO_TITRE_MAX, SEO_TITRE_MIN } from '#shared/seo'

type ChampSeo = 'seoTitre' | 'seoDescription'

const props = defineProps<{
  seoAuto: { titre: string, description: string, origine: 'ia' | 'gabarit' }
  /** Métier, ville, pays ou accroche modifiés dans le formulaire (pas encore enregistrés). */
  identiteModifiee: boolean
  erreurs: Partial<Record<ChampSeo, string>>
  desactive?: boolean
}>()

const emit = defineEmits<{ viderErreur: [champ: ChampSeo] }>()

/** Chaîne vide = texte automatique. */
const seoTitre = defineModel<string>('seoTitre', { default: '' })
const seoDescription = defineModel<string>('seoDescription', { default: '' })

const racine = useTemplateRef<HTMLElement>('racine')
const annonce = ref('')

const personnalise = computed(() => seoTitre.value.trim() !== '' || seoDescription.value.trim() !== '')
const apercuTitre = computed(() => seoTitre.value.trim() || props.seoAuto.titre)
const apercuDescription = computed(() => seoDescription.value.trim() || props.seoAuto.description)
const noteMiseAJour = computed(() => props.identiteModifiee && !personnalise.value)

function aide(valeur: string, min: number, max: number): string {
  const longueur = valeur.trim().length
  if (longueur === 0) return `Texte automatique, ou ${min} à ${max} caractères.`
  if (longueur < min) return `${longueur} sur ${max} caractères : encore ${min - longueur} pour atteindre le minimum.`
  return `${longueur} sur ${max} caractères`
}

const aideTitre = computed(() => aide(seoTitre.value, SEO_TITRE_MIN, SEO_TITRE_MAX))
const aideDescription = computed(() => aide(seoDescription.value, SEO_DESCRIPTION_MIN, SEO_DESCRIPTION_MAX))

async function revenirAuto(): Promise<void> {
  seoTitre.value = ''
  seoDescription.value = ''
  emit('viderErreur', 'seoTitre')
  emit('viderErreur', 'seoDescription')
  annonce.value = 'Texte automatique rétabli. Pensez à enregistrer.'
  await nextTick()
  racine.value?.querySelector<HTMLInputElement>('input')?.focus()
}
</script>

<template>
  <div ref="racine" class="flex flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <UBadge
        :label="personnalise ? 'Personnalisé' : 'Automatique'"
        :color="personnalise ? 'primary' : 'neutral'"
        variant="subtle"
        size="lg"
      />
      <UButton
        v-if="personnalise"
        label="Revenir au texte automatique"
        icon="i-ph-arrow-counter-clockwise"
        variant="ghost"
        color="neutral"
        size="lg"
        class="min-h-11"
        :disabled="desactive"
        @click="revenirAuto"
      />
    </div>
    <p class="sr-only" aria-live="polite">
      {{ annonce }}
    </p>

    <p class="m-0 text-base text-texte-secondaire">
      Laissez vide pour un texte automatique.
    </p>

    <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <UFormField label="Titre sur Google" name="seoTitre" :error="erreurs.seoTitre" :help="aideTitre">
        <UInput
          v-model="seoTitre"
          class="w-full"
          :placeholder="seoAuto.titre"
          :maxlength="SEO_TITRE_MAX"
          :disabled="desactive"
          @update:model-value="emit('viderErreur', 'seoTitre')"
        />
      </UFormField>
      <UFormField label="Description sur Google" name="seoDescription" :error="erreurs.seoDescription" :help="aideDescription">
        <UTextarea
          v-model="seoDescription"
          class="w-full"
          :rows="3"
          :placeholder="seoAuto.description"
          :maxlength="SEO_DESCRIPTION_MAX"
          :disabled="desactive"
          @update:model-value="emit('viderErreur', 'seoDescription')"
        />
      </UFormField>
    </div>

    <p v-if="noteMiseAJour" class="m-0 flex items-start gap-2 text-(length:--fs-14) text-texte-secondaire">
      <UIcon name="i-ph-info" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <span>Le texte automatique sera mis à jour quelques minutes après l’enregistrement.</span>
    </p>

    <div class="rounded-(--rayon) border border-bordure bg-surface p-4">
      <p class="m-0 text-sm text-texte-secondaire">
        Aperçu dans Google
      </p>
      <p class="m-0 mt-1 text-base font-semibold text-encre">
        {{ apercuTitre }}
      </p>
      <p class="m-0 mt-1 text-sm text-texte-secondaire">
        {{ apercuDescription }}
      </p>
    </div>
  </div>
</template>
