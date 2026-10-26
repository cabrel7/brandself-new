<script setup lang="ts">
import type { MediaDTO } from '#shared/dto'
import { ACCROCHE_MAX, BIO_MAX, METIER_MAX, NOM_MAX, PAYS, PRENOM_MAX, TITRES, TITRE_LABELS, VILLE_MAX } from '#shared/vitrine'

definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Votre profil — Brandself' })

const TITRE_ITEMS = [
  { label: 'Sans titre', value: AUCUN_TITRE },
  ...TITRES.map((titre) => ({ label: TITRE_LABELS[titre], value: titre })),
]
const PAYS_ITEMS = PAYS.map((pays) => ({ label: pays.label, value: pays.code }))

const { vitrine, enChargement, enErreur, absente, refresh } = useStudioVitrine()
const {
  form, erreurs, erreurGenerale, enregistrement, enregistre, aDesModifications, nomAffiche, viderErreur, enregistrer,
} = useProfilForm(vitrine, async () => {
  await refresh()
})

// Photo téléversée mais pas encore enregistrée : on l'affiche déjà.
const televersee = ref<MediaDTO | null>(null)
const photoAffichee = computed(() =>
  televersee.value && televersee.value.id === form.photoMediaId ? televersee.value : (vitrine.value?.photo ?? null),
)

const initiales = computed(() => `${form.prenom.charAt(0)}${form.nom.charAt(0)}`.toUpperCase())

function surPhotoTelechargee(media: MediaDTO): void {
  televersee.value = media
  form.photoMediaId = media.id
  viderErreur('photoMediaId')
}

// Adresse
const { affichee, hote, complete } = useAdressePublique(() => vitrine.value?.username)
const { copy, copied, isSupported } = useClipboard({ source: complete, copiedDuring: 2000 })
const edition = ref(false)
const nouvelleAdresse = ref('')
const changement = useChangementAdresse(async () => {
  await refresh()
  await refreshNuxtData('studio-moi')
})

function ouvrirEdition(): void {
  nouvelleAdresse.value = vitrine.value?.username ?? ''
  changement.erreur.value = ''
  edition.value = true
}

async function validerAdresse(): Promise<void> {
  if (await changement.changer(nouvelleAdresse.value)) edition.value = false
}
</script>

<template>
  <div>
    <StudioRetour to="/studio" label="Ma vitrine" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6" aria-busy="true" aria-label="Chargement de votre profil">
      <USkeleton class="h-10 w-48" />
      <USkeleton class="h-36 w-full" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Votre profil apparaît ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !vitrine"
      icon="i-ph-warning-circle"
      title="Votre profil ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos informations sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <form v-else class="flex flex-col gap-6 pb-32" novalidate @submit.prevent="enregistrer">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-semibold text-encre">
        Votre profil
      </h1>

      <UFormField label="Votre photo" name="photo">
        <PhotoUpload
          :photo="photoAffichee"
          :initiales="initiales"
          :erreur-externe="erreurs.photoMediaId"
          @televersee="surPhotoTelechargee"
        />
      </UFormField>

      <div class="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4">
        <UFormField label="Titre" name="titre" :error="erreurs.titre">
          <USelect v-model="form.titre" :items="TITRE_ITEMS" @update:model-value="viderErreur('titre')" />
        </UFormField>
        <UFormField label="Prénom" name="prenom" required :error="erreurs.prenom">
          <UInput v-model="form.prenom" autocomplete="given-name" :maxlength="PRENOM_MAX" @update:model-value="viderErreur('prenom')" />
        </UFormField>
      </div>

      <UFormField label="Nom" name="nom" required :error="erreurs.nom">
        <UInput v-model="form.nom" autocomplete="family-name" :maxlength="NOM_MAX" @update:model-value="viderErreur('nom')" />
        <template #help>
          Affiché sur la vitrine : {{ nomAffiche }}
        </template>
      </UFormField>

      <UFormField label="Métier" name="metier" required :error="erreurs.metier">
        <UInput v-model="form.metier" autocomplete="organization-title" :maxlength="METIER_MAX" @update:model-value="viderErreur('metier')" />
      </UFormField>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Ville" name="ville" :error="erreurs.ville">
          <UInput v-model="form.ville" autocomplete="address-level2" :maxlength="VILLE_MAX" @update:model-value="viderErreur('ville')" />
        </UFormField>
        <UFormField label="Pays" name="pays" :error="erreurs.pays">
          <USelect
            v-model="form.pays"
            :items="PAYS_ITEMS"
            placeholder="Choisir un pays"
            @update:model-value="viderErreur('pays')"
          />
        </UFormField>
      </div>

      <UFormField label="Accroche" name="accroche" :error="erreurs.accroche">
        <UInput v-model="form.accroche" :maxlength="ACCROCHE_MAX" @update:model-value="viderErreur('accroche')" />
        <p class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
          {{ form.accroche.length }} sur {{ ACCROCHE_MAX }} caractères
        </p>
      </UFormField>

      <UFormField label="Présentation" name="bio" :error="erreurs.bio">
        <UTextarea v-model="form.bio" :rows="6" :maxlength="BIO_MAX" class="w-full" @update:model-value="viderErreur('bio')" />
        <p class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
          {{ form.bio.length }} sur {{ BIO_MAX }} caractères
        </p>
      </UFormField>

      <USeparator />

      <fieldset class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <legend class="mb-4 p-0 font-(family-name:--font-titre) text-(length:--fs-20) font-semibold text-encre">
          Contact
        </legend>
        <UFormField label="Email" name="emailContact" :error="erreurs.emailContact">
          <UInput
            v-model="form.emailContact"
            type="email"
            autocomplete="email"
            placeholder="adresse@exemple.com"
            @update:model-value="viderErreur('emailContact')"
          />
        </UFormField>
        <UFormField label="Téléphone" name="telephone" :error="erreurs.telephone" help="Format international, par exemple +237600000000.">
          <UInput
            v-model="form.telephone"
            type="tel"
            autocomplete="tel"
            placeholder="+237600000000"
            @update:model-value="viderErreur('telephone')"
          />
        </UFormField>
        <UFormField label="WhatsApp" name="whatsapp" :error="erreurs.whatsapp">
          <UInput
            v-model="form.whatsapp"
            type="tel"
            autocomplete="tel"
            placeholder="+237600000000"
            @update:model-value="viderErreur('whatsapp')"
          />
        </UFormField>
      </fieldset>

      <USeparator />

      <section aria-labelledby="titre-palette" class="flex flex-col gap-3">
        <h2 id="titre-palette" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Couleurs de la vitrine
        </h2>
        <PaletteChoice v-model="form.palette" labelledby="titre-palette" />
        <p v-if="erreurs.palette" role="alert" class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ erreurs.palette }}</span>
        </p>
      </section>

      <USeparator />

      <section aria-labelledby="titre-adresse" class="flex flex-col gap-3">
        <h2 id="titre-adresse" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Adresse
        </h2>

        <div v-if="!edition" class="flex items-center justify-between gap-2 rounded-(--rayon) bg-surface py-1 pr-1 pl-4">
          <span class="min-w-0 break-all text-base text-encre">{{ affichee }}</span>
          <UButton
            v-if="isSupported"
            :icon="copied ? 'i-ph-check' : 'i-ph-copy'"
            variant="ghost"
            color="neutral"
            size="lg"
            class="shrink-0"
            aria-label="Copier l’adresse de votre vitrine"
            @click="copy(complete)"
          />
        </div>
        <p class="sr-only" aria-live="polite">
          {{ copied ? 'Adresse copiée.' : '' }}
        </p>

        <template v-if="!edition">
          <UButton label="Modifier l’adresse" variant="link" size="lg" class="self-start" @click="ouvrirEdition" />
        </template>

        <template v-else>
          <UFormField label="Nouvelle adresse" name="username" :error="changement.erreur.value || undefined">
            <UInput v-model="nouvelleAdresse" autocomplete="off" autocapitalize="none" spellcheck="false" :maxlength="30">
              <template #leading>
                <span class="text-base text-texte-secondaire">{{ hote }}/</span>
              </template>
            </UInput>
            <template #help>
              Le lien actuel cessera de fonctionner : pensez à prévenir les personnes qui l’ont reçu.
            </template>
          </UFormField>
          <div class="flex flex-col gap-2 sm:flex-row">
            <UButton
              label="Changer l’adresse"
              :loading="changement.enCours.value"
              :disabled="nouvelleAdresse.trim() === '' || nouvelleAdresse.trim().toLowerCase() === vitrine.username"
              @click="validerAdresse"
            />
            <UButton label="Annuler" variant="outline" color="neutral" :disabled="changement.enCours.value" @click="edition = false" />
          </div>
        </template>
      </section>

      <div
        class="fixed inset-x-0 bottom-0 z-20 border-t border-bordure bg-fond pb-[env(safe-area-inset-bottom)]"
      >
        <div class="mx-auto flex w-full max-w-2xl flex-col gap-2 px-4 py-3 md:px-6">
          <p v-if="erreurGenerale" role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ erreurGenerale }}</span>
          </p>
          <UButton
            type="submit"
            :label="enregistre ? 'Enregistré' : 'Enregistrer'"
            :icon="enregistre ? 'i-ph-check' : undefined"
            :loading="enregistrement"
            :disabled="!aDesModifications"
            block
          />
          <p class="sr-only" aria-live="polite">
            {{ enregistre ? 'Votre profil est enregistré.' : '' }}
          </p>
        </div>
      </div>
    </form>
  </div>
</template>
