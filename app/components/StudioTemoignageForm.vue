<script setup lang="ts">
import slugify from '@sindresorhus/slugify'
import type { LimiteAtteinte } from '~/composables/useLimitePlan'
import type { TemoignageStudioDTO, TemoignagesCompteursDTO } from '#shared/dto'
import { schemaTemoignageCreate, schemaTemoignageUpdate } from '#shared/schemas/temoignage'
import {
  TEMOINAGE_AUTEUR_MAX,
  TEMOINAGE_FONCTION_MAX,
  TEMOINAGE_SLUG_REPLI,
  TEMOINAGE_TEXTE_MAX,
  libelleVedetteTemoignages,
} from '#shared/temoignages'

const props = defineProps<{
  /** `null` : création. */
  temoignage: TemoignageStudioDTO | null
  /** Compteurs de la vitrine (plafond de vedettes), fournis par la liste du studio. */
  compteurs: TemoignagesCompteursDTO
}>()

const emit = defineEmits<{ enregistrement: [] }>()

const SWITCH_UI = { root: 'w-full flex-row-reverse items-center justify-between gap-4', wrapper: 'ms-0' }

const ERREUR_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Vos modifications sont gardées, réessayez dans un instant.'
const ERREUR_SUPPRESSION = 'Nous n’avons pas pu supprimer ce témoignage. Réessayez dans un instant.'
const AIDE_VEDETTE = 'Le témoignage en vedette est mis en avant sur votre accueil.'

type ChampTemoignage = 'auteur' | 'fonction' | 'texte' | 'enVedette' | 'actif'
type Erreurs = Partial<Record<ChampTemoignage, string>>

const CHAMPS: readonly ChampTemoignage[] = ['auteur', 'fonction', 'texte', 'enVedette', 'actif']

const enCreation = computed(() => props.temoignage === null)

// Création : la vedette est proposée s'il reste de la place (même mécanisme que le formulaire réalisation).
const placeEnVedette = props.compteurs.enVedette < props.compteurs.vedetteMax
const actifInitial = props.temoignage?.actif ?? true

const form = reactive({
  auteur: props.temoignage?.auteur ?? '',
  fonction: props.temoignage?.fonction ?? '',
  texte: props.temoignage?.texte ?? '',
  enVedette: props.temoignage ? props.temoignage.enVedette && actifInitial : placeEnVedette,
  actif: actifInitial,
})

const erreurs = ref<Erreurs>({})
const erreurGenerale = ref('')
/** Création refusée : limite du plan atteinte (un seul message, à la place de l'erreur générale). */
const limiteAtteinte = ref<LimiteAtteinte | null>(null)
const enregistrement = ref(false)
const introuvable = ref(false)

const suppressionOuverte = ref(false)
const suppressionEnCours = ref(false)
const erreurSuppression = ref('')

/** Corps tel que le serveur le connaît : référence de comparaison pour n'envoyer que les modifications. */
const reference = props.temoignage
  ? {
      auteur: props.temoignage.auteur,
      fonction: props.temoignage.fonction ?? '',
      texte: props.temoignage.texte,
      enVedette: props.temoignage.enVedette,
      actif: props.temoignage.actif,
    }
  : null

const aDesModifications = computed(() => {
  if (!reference) return true
  return form.auteur !== reference.auteur
    || form.fonction !== reference.fonction
    || form.texte !== reference.texte
    || form.enVedette !== reference.enVedette
    || form.actif !== reference.actif
})

// Le témoignage en cours ne compte pas dans le plafond.
const vedetteComplete = computed(
  () => props.compteurs.enVedette - (props.temoignage?.enVedette ? 1 : 0) >= props.compteurs.vedetteMax,
)
const vedetteBloquee = computed(() => !form.actif || vedetteComplete.value)
const aideVedette = computed(() => {
  if (!form.actif) return 'Un témoignage masqué ne peut pas être en vedette.'
  const etat = libelleVedetteTemoignages(props.compteurs.enVedette, props.compteurs.vedetteMax)
  return vedetteComplete.value ? `${etat} Retirez-en un pour en mettre un autre en avant.` : `${AIDE_VEDETTE} ${etat}`
})

function viderErreur(champ: ChampTemoignage): void {
  if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
}

// Cohérence immédiate (le serveur la revérifie) : masqué => pas en vedette.
watch(() => form.actif, (actif) => {
  if (!actif) form.enVedette = false
})

function corpsCreation(): Record<string, unknown> {
  const auteur = form.auteur.trim()
  const fonction = form.fonction.trim()
  const slug = slugify(auteur, { customReplacements: [['&', ' et ']], decamelize: false }) || TEMOINAGE_SLUG_REPLI
  return {
    slug,
    auteur,
    ...(fonction === '' ? {} : { fonction }),
    texte: form.texte.trim(),
    enVedette: form.actif && form.enVedette,
    actif: form.actif,
  }
}

function corpsModification(): Record<string, unknown> {
  if (!reference) return {}
  const corps: Record<string, unknown> = {}
  const auteur = form.auteur.trim()
  if (auteur !== reference.auteur) corps.auteur = auteur
  const fonction = form.fonction.trim()
  if (fonction !== reference.fonction) corps.fonction = fonction
  const texte = form.texte.trim()
  if (texte !== reference.texte) corps.texte = texte
  const enVedette = form.actif && form.enVedette
  if (form.actif !== reference.actif) corps.actif = form.actif
  if (!form.actif && reference.actif) corps.enVedette = false
  else if (enVedette !== reference.enVedette) corps.enVedette = enVedette
  return corps
}

/** Contrôle client des champs (le serveur fait foi) : mêmes schémas que l'API. */
function validerChamps(corps: Record<string, unknown>): boolean {
  const schema = enCreation.value ? schemaTemoignageCreate : schemaTemoignageUpdate
  const resultat = schema.safeParse(corps)
  if (resultat.success) return true
  const parChamp: Erreurs = {}
  for (const issue of resultat.error.issues) {
    const cible = champRacine(String(issue.path[0] ?? ''))
    if (cible && !parChamp[cible]) parChamp[cible] = issue.message
  }
  erreurs.value = parChamp
  if (Object.keys(parChamp).length === 0) erreurGenerale.value = 'Vérifiez les champs signalés.'
  return false
}

/** Un slug invalide vient de l'auteur (le slug en est généré). */
function champRacine(nom: string): ChampTemoignage | undefined {
  const racine = nom.split('.')[0]
  if (racine === 'slug') return 'auteur'
  return CHAMPS.find((champ) => champ === racine)
}

/** `data.enVedette` de VEDETTE_COMPLETE (non exposé par `lireErreurApi`) : auteurs déjà en vedette. */
function lireAuteursEnVedette(erreur: unknown): string[] {
  if (typeof erreur !== 'object' || erreur === null) return []
  const corps = (erreur as { data?: { data?: { enVedette?: unknown } } }).data
  const liste = corps?.data?.enVedette
  if (!Array.isArray(liste)) return []
  return liste.flatMap((entree: unknown) => {
    const auteur = (entree as { auteur?: unknown } | null)?.auteur
    return typeof auteur === 'string' ? [auteur] : []
  })
}

function messageVedetteComplete(max: number, auteurs: string[]): string {
  const detail = auteurs.length > 0 ? ` : ${auteurs.join(', ')}` : ''
  return `Vous avez déjà ${max} témoignages en vedette${detail}. Retirez-en un pour mettre celui-ci en avant.`
}

function rangerErreur(e: unknown): void {
  const erreur = lireErreurApi(e)
  const limite = lireLimitePlan(e, 'temoignages')
  if (limite) {
    limiteAtteinte.value = limite
  }
  else if (erreur.code === 'VALIDATION') {
    const parChamp: Erreurs = {}
    for (const [nom, messages] of Object.entries(erreur.champs)) {
      const cible = champRacine(nom)
      const message = messages?.[0]
      if (cible && message && !parChamp[cible]) parChamp[cible] = message
    }
    erreurs.value = parChamp
    if (Object.keys(parChamp).length === 0) erreurGenerale.value = ERREUR_ENREGISTREMENT
  }
  else if (erreur.code === 'VEDETTE_COMPLETE') {
    erreurs.value = { enVedette: messageVedetteComplete(props.compteurs.vedetteMax, lireAuteursEnVedette(e)) }
  }
  else if (erreur.statut === 404 || erreur.code === 'TEMOINAGE_INTROUVABLE') {
    introuvable.value = true
  }
  else {
    erreurGenerale.value = ERREUR_ENREGISTREMENT
  }
}

async function enregistrer(): Promise<void> {
  if (enregistrement.value || !aDesModifications.value) return
  erreurs.value = {}
  erreurGenerale.value = ''
  limiteAtteinte.value = null
  const corps = enCreation.value ? corpsCreation() : corpsModification()
  if (!validerChamps(corps)) return

  enregistrement.value = true
  try {
    if (enCreation.value) {
      await $fetch('/api/studio/temoignages', { method: 'POST', body: corps })
    }
    else if (props.temoignage) {
      await $fetch(`/api/studio/temoignages/${props.temoignage.slug}`, { method: 'PUT', body: corps })
    }
    emit('enregistrement')
  }
  catch (e) {
    rangerErreur(e)
    enregistrement.value = false
  }
}

async function supprimer(): Promise<void> {
  if (!props.temoignage || suppressionEnCours.value) return
  erreurSuppression.value = ''
  suppressionEnCours.value = true
  try {
    await $fetch(`/api/studio/temoignages/${props.temoignage.slug}`, { method: 'DELETE' })
    suppressionOuverte.value = false
    emit('enregistrement')
  }
  catch (e) {
    // Déjà supprimé ailleurs : le résultat voulu est atteint.
    if (lireErreurApi(e).statut === 404) {
      suppressionOuverte.value = false
      emit('enregistrement')
    }
    else {
      erreurSuppression.value = ERREUR_SUPPRESSION
      suppressionEnCours.value = false
    }
  }
}
</script>

<template>
  <UEmpty
    v-if="introuvable"
    icon="i-ph-chat-centered-text"
    title="Ce témoignage n’existe plus"
    description="Il a peut-être été supprimé depuis un autre appareil."
    :actions="[{ label: 'Retour aux témoignages', to: '/studio/temoignages', size: 'xl' }]"
  />

  <form v-else class="flex flex-col gap-6" novalidate @submit.prevent="enregistrer">
    <UFormField label="Auteur" name="auteur" required :error="erreurs.auteur">
      <UInput
        v-model="form.auteur"
        :maxlength="TEMOINAGE_AUTEUR_MAX"
        placeholder="Le nom de la personne"
        @update:model-value="viderErreur('auteur')"
      />
    </UFormField>

    <UFormField name="fonction" :error="erreurs.fonction">
      <template #label>
        Fonction <StudioMentionFacultative feminin />
      </template>
      <UInput
        v-model="form.fonction"
        :maxlength="TEMOINAGE_FONCTION_MAX"
        placeholder="Directeur, Cliente, etc."
        @update:model-value="viderErreur('fonction')"
      />
    </UFormField>

    <UFormField label="Texte du témoignage" name="texte" required :error="erreurs.texte">
      <UTextarea
        v-model="form.texte"
        :rows="5"
        :maxlength="TEMOINAGE_TEXTE_MAX"
        class="w-full"
        placeholder="Ex. : « Un accompagnement à l’écoute, des résultats concrets. »"
        @update:model-value="viderErreur('texte')"
      />
      <p class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
        Affiché tel quel sur votre vitrine.
        {{ form.texte.length }} sur {{ TEMOINAGE_TEXTE_MAX }} caractères.
      </p>
    </UFormField>

    <div class="flex flex-col border-y border-bordure">
      <div class="border-b border-bordure py-4">
        <USwitch
          v-model="form.actif"
          label="Visible sur la vitrine"
          description="Désactivez pour masquer ce témoignage sans le supprimer."
          :ui="SWITCH_UI"
        />
      </div>
      <div class="py-4">
        <USwitch
          v-model="form.enVedette"
          label="En vedette sur l’accueil"
          :description="aideVedette"
          :disabled="vedetteBloquee"
          :ui="SWITCH_UI"
          @update:model-value="viderErreur('enVedette')"
        />
        <p v-if="erreurs.enVedette" role="alert" class="message-erreur mt-2">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ erreurs.enVedette }}</span>
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <StudioLimitePlanMessage
        v-if="limiteAtteinte"
        alerte
        :ressource="limiteAtteinte.ressource"
        :limite="limiteAtteinte.limite"
      />
      <p v-else-if="erreurGenerale" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurGenerale }}</span>
      </p>
      <UButton
        type="submit"
        label="Enregistrer"
        :loading="enregistrement"
        :disabled="!aDesModifications"
        block
      />
      <UButton
        type="button"
        label="Annuler"
        variant="outline"
        color="neutral"
        to="/studio/temoignages"
        :disabled="enregistrement"
        block
      />
      <UButton
        v-if="temoignage"
        type="button"
        label="Supprimer ce témoignage"
        variant="link"
        color="neutral"
        size="lg"
        :disabled="enregistrement || suppressionEnCours"
        block
        @click="suppressionOuverte = true"
      />
    </div>

    <UModal
      v-if="temoignage"
      v-model:open="suppressionOuverte"
      :title="`Supprimer le témoignage de ${temoignage.auteur} ?`"
      description="Il disparaîtra de votre vitrine. Cette action est définitive."
      :dismissible="!suppressionEnCours"
    >
      <template #footer="{ close }">
        <div class="flex w-full flex-col gap-3">
          <p v-if="erreurSuppression" role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ erreurSuppression }}</span>
          </p>
          <div class="flex flex-col gap-2 sm:flex-row-reverse">
            <UButton label="Supprimer" color="error" :loading="suppressionEnCours" @click="supprimer" />
            <UButton label="Annuler" variant="outline" color="neutral" :disabled="suppressionEnCours" @click="close" />
          </div>
        </div>
      </template>
    </UModal>
  </form>
</template>
