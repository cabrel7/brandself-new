// S12 (#145) : section « Sur Google » du Profil studio. Champs SEO avec compteurs et aperçu.
<script setup lang="ts">
const props = defineProps<{
  vitrine: {
    seoTitre: string | null
    seoDescription: string | null
    nomAffiche: string
    metier: string
    ville: string | null
    pays: string | null
    accroche: string | null
    bio: string | null
  }
  enregistrer: () => Promise<void>
  aDesModifications: boolean
  erreurs: Record<string, string[] | undefined>
  viderErreur: (champ: string) => void
}>()

const SEO_TITRE_MIN = 30
const SEO_TITRE_MAX = 70
const SEO_DESCRIPTION_MIN = 50
const SEO_DESCRIPTION_MAX = 160

const seoTitre = defineModel<string>('seoTitre', {
  default: props.vitrine.seoTitre ?? '',
})
const seoDescription = defineModel<string>('seoDescription', {
  default: props.vitrine.seoDescription ?? '',
})

const apercuTitre = computed(() => seoTitre.value ?? `${props.vitrine.nomAffiche} — ${props.vitrine.metier} à ${props.vitrine.ville}`)
const apercuDescription = computed(() => seoDescription.value ?? `${props.vitrine.metier} à ${props.vitrine.ville}. ${props.vitrine.accroche ?? ''}`)

const titreValide = computed(() => {
  if (!seoTitre.value) return true
  const t = seoTitre.value.trim()
  return t.length >= SEO_TITRE_MIN && t.length <= SEO_TITRE_MAX
})
const descriptionValide = computed(() => {
  if (!seoDescription.value) return true
  const t = seoDescription.value.trim()
  return t.length >= SEO_DESCRIPTION_MIN && t.length <= SEO_DESCRIPTION_MAX
})
</script>

<template>
  <section class="mt-8 flex flex-col gap-4 px-4 md:px-8 lg:px-0">
    <h2 class="m-0 text-(length:--fs-20) font-semibold text-encre">
      Sur Google
    </h2>
    <p class="m-0 text-base text-texte-secondaire">
      Titre et description affichés dans les résultats de recherche. Laissez vide : nous les écrivons pour vous à partir de votre métier, de votre ville et de votre accroche.
    </p>

    <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
      <UFormField label="Titre sur Google" name="seoTitre" hint="30 à 70 caractères">
        <UInput v-model="seoTitre" :maxlength="SEO_TITRE_MAX" @update:model-value="viderErreur('seoTitre')" />
        <template #help>
          <span v-if="seoTitre">{{ seoTitre.length }} sur {{ SEO_TITRE_MAX }} caractères</span>
          <span v-else>Aperçu automatique</span>
        </template>
      </UFormField>
      <UFormField label="Description sur Google" name="seoDescription" hint="50 à 160 caractères">
        <UTextarea v-model="seoDescription" :rows="3" :maxlength="SEO_DESCRIPTION_MAX" class="w-full" @update:model-value="viderErreur('seoDescription')" />
        <template #help>
          <span v-if="seoDescription">{{ seoDescription.length }} sur {{ SEO_DESCRIPTION_MAX }} caractères</span>
          <span v-else>Aperçu automatique</span>
        </template>
      </UFormField>
    </div>

    <div class="mt-4 p-4 rounded-(--rayon) border border-bordure bg-surface">
      <p class="m-0 text-sm text-texte-secondaire">Aperçu :</p>
      <h3 class="m-0 mt-1 text-base font-semibold text-encre">{{ apercuTitre }}</h3>
      <p class="m-0 mt-1 text-sm text-texte-secondaire">{{ apercuDescription }}</p>
    </div>

    <p v-if="!titreValide || !descriptionValide" class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
      Respectez les longueurs indiquées pour que Google affiche votre titre et votre description en entier.
    </p>
  </section>
</template>
