<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { LienStudioDTO } from '#shared/dto'
import type { LienType } from '#shared/liens'
import type { LienCreateInput, LienUpdateInput } from '#shared/schemas/lien'
import {
  adresseDepuisMailtoUrl,
  LIEN_RESEAUX,
  LIEN_TYPE_LIBELLES,
  LIEN_TYPES,
  LIEN_VITRINE_PAGES,
  numeroDepuisTelUrl,
  numeroDepuisWhatsappUrl,
  pageDepuisVitrineUrl,
  plateformeDepuisUrl,
} from '#shared/liens'
import { schemaLienCreate } from '#shared/schemas/lien'

const props = defineProps<{
  /** `null` : création. */
  lien: LienStudioDTO | null
}>()

const enCreation = computed(() => props.lien === null)
const typeOptions = LIEN_TYPES.map((type) => ({ label: LIEN_TYPE_LIBELLES[type], value: type }))
const pageOptions = LIEN_VITRINE_PAGES.map((page) => ({ label: page.libelle, value: page.id }))
const reseauOptions = LIEN_RESEAUX.map((reseau) => ({ label: reseau.libelle, value: reseau.id }))

type ValeursFormulaire = {
  type: LienType
  libelle: string
  url: string
  numero: string
  plateforme: string
  adresse: string
  page: string
  actif: boolean
}

function valeursInitiales(): ValeursFormulaire {
  return {
    type: 'libre',
    libelle: '',
    url: '',
    numero: '',
    plateforme: '',
    adresse: '',
    page: '',
    actif: true,
  }
}

const form = ref<ValeursFormulaire>(valeursInitiales())

const erreurs = ref<Record<string, string[] | undefined>>({})
const erreurGenerale = ref('')
const enregistrement = ref(false)
const attenteActualisationParent = ref(false)

/** Champ spécifique du formulaire, selon le type choisi. */
const CHAMP_PAR_TYPE: Record<LienType, { champ: Exclude<keyof ValeursFormulaire, 'actif'>; label: string; placeholder: string; inputmode: 'text' | 'tel' | 'email' }> = {
  libre: { champ: 'url', label: 'Lien vers un site', placeholder: 'https://mon-site.test', inputmode: 'text' },
  whatsapp: { champ: 'numero', label: 'Numéro WhatsApp', placeholder: '[numéro]', inputmode: 'tel' },
  telephone: { champ: 'numero', label: 'Numéro de téléphone', placeholder: '+237 6 99 00 00 01', inputmode: 'tel' },
  reseau: { champ: 'url', label: 'Lien du profil', placeholder: 'https://www.linkedin.com/in/…', inputmode: 'text' },
  email: { champ: 'adresse', label: 'Adresse e-mail', placeholder: 'prenom.nom@exemple.com', inputmode: 'email' },
  vitrine: { champ: 'page', label: 'Page de votre vitrine', placeholder: '', inputmode: 'text' },
}

const champSpecifique = computed(() => CHAMP_PAR_TYPE[form.value.type])

function viderErreur(champ: string): void {
  erreurs.value = Object.fromEntries(Object.entries(erreurs.value).filter(([c]) => c !== champ))
  erreurGenerale.value = ''
}

watch(() => props.lien, (lien) => {
  if (!lien) {
    form.value = valeursInitiales()
    return
  }

  const valeurs = valeursInitiales()
  valeurs.type = lien.type
  valeurs.libelle = lien.libelle
  valeurs.actif = lien.actif

  if (lien.type === 'whatsapp') valeurs.numero = numeroDepuisWhatsappUrl(lien.url)
  else if (lien.type === 'telephone') valeurs.numero = numeroDepuisTelUrl(lien.url)
  else if (lien.type === 'email') valeurs.adresse = adresseDepuisMailtoUrl(lien.url)
  else if (lien.type === 'vitrine') valeurs.page = pageDepuisVitrineUrl('', lien.url) ?? ''
  else {
    valeurs.url = lien.url
    if (lien.type === 'reseau') valeurs.plateforme = lien.plateforme ?? plateformeDepuisUrl(lien.url) ?? ''
  }

  form.value = valeurs
  if (attenteActualisationParent.value) {
    attenteActualisationParent.value = false
    enregistrement.value = false
  }
}, { immediate: true })

/** Corps de la requête : uniquement les champs du type choisi (schéma strict). */
function corpsCreation(): LienCreateInput {
  const commun = { libelle: form.value.libelle, actif: form.value.actif }
  switch (form.value.type) {
    case 'libre':
      return { type: 'libre', ...commun, url: form.value.url }
    case 'whatsapp':
      return { type: 'whatsapp', ...commun, numero: form.value.numero }
    case 'reseau':
      return { type: 'reseau', ...commun, plateforme: form.value.plateforme, url: form.value.url }
    case 'email':
      return { type: 'email', ...commun, adresse: form.value.adresse }
    case 'telephone':
      return { type: 'telephone', ...commun, numero: form.value.numero }
    case 'vitrine':
      return { type: 'vitrine', ...commun, page: form.value.page }
  }
}

/** Mise à jour cohérente avec le type immuable : aucun champ construit ne reçoit d'URL. */
function corpsModification(corps: LienCreateInput): LienUpdateInput {
  const commun = { libelle: corps.libelle, actif: corps.actif }
  switch (corps.type) {
    case 'libre':
      return { ...commun, url: corps.url }
    case 'whatsapp':
      return { ...commun, numero: corps.numero }
    case 'reseau':
      return { ...commun, plateforme: corps.plateforme, url: corps.url }
    case 'email':
      return { ...commun, adresse: corps.adresse }
    case 'telephone':
      return { ...commun, numero: corps.numero }
    case 'vitrine':
      return { ...commun, page: corps.page }
  }
}

function valider(): LienCreateInput | null {
  erreurs.value = {}
  erreurGenerale.value = ''
  const resultat = schemaLienCreate.safeParse(corpsCreation())
  if (resultat.success) return resultat.data

  erreurs.value = resultat.error.flatten().fieldErrors
  if (Object.values(erreurs.value).every((messages) => !messages?.length)) {
    erreurGenerale.value = 'Nous n’avons pas pu valider ce lien. Vérifiez les champs signalés.'
  }
  return null
}

function rangerErreurApi(e: unknown): void {
  const api = lireErreurApi(e)
  if (Object.values(api.champs).some((messages) => messages?.length)) {
    erreurs.value = api.champs
    return
  }
  erreurGenerale.value = 'Nous n’avons pas pu enregistrer ce lien. Réessayez.'
}

const emit = defineEmits<{ enregistrement: []; suppression: [] }>()

async function enregistrer(): Promise<void> {
  if (enregistrement.value) return
  const corps = valider()
  if (!corps) return
  const lien = props.lien
  if (!enCreation.value && !lien) return

  enregistrement.value = true
  try {
    if (enCreation.value) {
      await $fetch('/api/studio/liens', { method: 'POST', body: corps })
    }
    else if (lien) {
      await $fetch(`/api/studio/liens/${lien.id}`, { method: 'PUT', body: corpsModification(corps) })
      attenteActualisationParent.value = true
    }
    emit('enregistrement')
  }
  catch (e) {
    attenteActualisationParent.value = false
    enregistrement.value = false
    rangerErreurApi(e)
  }
}
</script>

<template>
  <form class="flex flex-col gap-5" novalidate @submit.prevent="enregistrer">

    <UFormField
      label="Type de lien"
      name="type"
      required
      :error="erreurs.type?.[0]"
      :help="enCreation ? undefined : 'Le type ne peut pas être modifié après la création du lien.'"
    >
      <USelect
        v-model="form.type"
        :items="typeOptions"
        :disabled="!enCreation || enregistrement"
        @update:model-value="viderErreur('type')"
      />
    </UFormField>

    <UFormField label="Libellé" name="libelle" required :error="erreurs.libelle?.[0]" help="Le texte du bouton.">
      <UInput v-model="form.libelle" :maxlength="100" :disabled="enregistrement" @update:model-value="viderErreur('libelle')" />
    </UFormField>

    <template v-if="form.type === 'reseau'">
      <UFormField label="Réseau social" name="plateforme" required :error="erreurs.plateforme?.[0]">
        <USelect
          v-model="form.plateforme"
          :items="reseauOptions"
          :disabled="enregistrement"
          placeholder="Choisir un réseau social"
          @update:model-value="viderErreur('plateforme')"
        />
      </UFormField>
      <UFormField label="Lien du profil" name="url" required :error="erreurs.url?.[0]">
        <UInput
          v-model="form.url"
          inputmode="url"
          autocomplete="url"
          :disabled="enregistrement"
          placeholder="https://www.linkedin.com/in/…"
          @update:model-value="viderErreur('url')"
        />
      </UFormField>
    </template>

    <UFormField
      v-else
      :label="champSpecifique.label"
      :name="champSpecifique.champ"
      required
      :error="erreurs[champSpecifique.champ]?.[0]"
      :help="form.type === 'libre' ? undefined : 'Le lien est créé pour vous.'"
    >
      <USelect
        v-if="form.type === 'vitrine'"
        v-model="form.page"
        :items="pageOptions"
        :disabled="enregistrement"
        placeholder="Choisir une page"
        @update:model-value="viderErreur('page')"
      />
      <UInput
        v-else
        v-model="form[champSpecifique.champ]"
        :inputmode="champSpecifique.inputmode"
        :placeholder="champSpecifique.placeholder"
        :disabled="enregistrement"
        @update:model-value="viderErreur(champSpecifique.champ)"
      />
    </UFormField>

    <section class="flex flex-col gap-3 rounded-(--rayon) bg-surface p-4">
      <h2 class="m-0 font-(family-name:--font-texte) text-(length:--fs-14) font-semibold tracking-wider text-texte-secondaire uppercase">
        Aperçu sur votre page de liens
      </h2>
      <div class="flex items-center gap-3 rounded-(--rayon-interne) bg-champ p-3">
        <span class="min-w-0 truncate font-semibold text-encre">{{ form.libelle || 'Mon lien' }}</span>
        <UIcon name="i-ph-caret-right" class="ms-auto size-5 shrink-0 text-texte-secondaire" aria-hidden="true" />
      </div>
    </section>

    <div class="border-t border-bordure pt-4">
      <USwitch
        v-model="form.actif"
        label="Visible sur la page de liens"
        description="Désactivez pour masquer ce lien sans le supprimer."
        :disabled="enregistrement"
        :ui="{ root: 'w-full flex-row-reverse items-center justify-between gap-4', wrapper: 'ms-0' }"
        @update:model-value="viderErreur('actif')"
      />
    </div>

    <div class="pt-2">
      <p v-if="erreurGenerale" role="alert" class="message-erreur mb-3">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurGenerale }}</span>
      </p>
      <UButton
        type="submit"
        :label="enCreation ? 'Enregistrer' : 'Enregistrer le lien'"
        :loading="enregistrement"
        block
      />
      <UButton
        v-if="!enCreation"
        type="button"
        label="Supprimer ce lien"
        variant="link"
        color="neutral"
        size="lg"
        block
        :disabled="enregistrement"
        class="mt-3"
        @click="emit('suppression')"
      />
    </div>
  </form>
</template>
