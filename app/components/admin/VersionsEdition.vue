<script setup lang="ts">
import { DEVISES } from '#shared/compte'
import { VERSION_PLAN_LIMITE_MAX } from '#shared/admin'
import { ESSAI_DUREE_MAX_JOURS, ESSAI_DUREE_MIN_JOURS } from '#shared/essai'
import type { AdminVersionType } from '#shared/admin'
import { PERIODES_MOIS } from '#shared/plans'
import type { PlanId } from '#shared/plans'
import { STATISTIQUES_RETENTION_JOURS } from '#shared/statistiques'
import { VERSION_PLAN_LIMITES_CLES } from '#shared/schemas/admin-versions'
import type { ValeursEssai, ValeursFrais, ValeursMoyens, ValeursPlan, ValeursPrix, VersionDto } from '#shared/schemas/admin-versions'
import { FRAIS_TAUX_PB_MAX } from '#shared/paiements'
import { MESSAGE_REJOUE, motifValide, nouvelleCleIdempotence } from '~/utils/admin-paiements'
import {
  erreurTaux,
  erreursEssai,
  erreursPlan,
  erreursPrix,
  erreursPrompt,
  formEssaiDepuis,
  formFraisDepuis,
  formMoyensDepuis,
  formPlanDepuis,
  formPrixDepuis,
  formPromptDepuis,
  libelleCleVersion,
  LIBELLES_LIMITES_PLAN,
  OPTIONS_SUPPORTEUR,
  pourcentageDepuisPointsBase,
  valeursEssaiDepuis,
  valeursFraisDepuis,
  valeursMoyensDepuis,
  valeursPlanDepuis,
  valeursPrixDepuis,
  valeursPromptDepuis,
} from '~/utils/admin-versions'

// Création d'un brouillon à partir d'une version existante (jamais une modification : une version enregistrée est figée).
// Un seul panneau, motif obligatoire, aucun code : un brouillon ne change rien au produit tant qu'il n'est pas activé.
export interface CibleEdition {
  type: AdminVersionType
  cle: string
  /** Version de départ : ses valeurs préremplissent le formulaire. */
  base: VersionDto
  /** Identifiants de moyens vus dans l'historique (pour pouvoir rouvrir un moyen fermé). */
  moyensConnus: string[]
}

const props = defineProps<{ cible: CibleEdition | null }>()
const emit = defineEmits<{ fermer: [], reussi: [] }>()

const UI_INTERRUPTEUR = { root: 'min-h-(--cible-tactile) items-center' }

const toast = useToast()
const { creerBrouillon } = useAdminVersionsEcritures()

const formPlan = ref(formPlanDepuis(valeursPlanVide()))
const formPrix = ref(formPrixDepuis(valeursPrixVide()))
const formFrais = ref(formFraisDepuis({ tauxPointsBase: 0, supporteur: 'marchand' }))
const formMoyens = ref<Record<string, boolean>>({})
const formEssai = ref(formEssaiDepuis({ actif: true, dureeJours: 1, relanceServicesJour: 1, relanceStatistiquesJour: 2 }))
const formPrompt = ref(formPromptDepuis(null))
const motif = ref('')
const enCours = ref(false)
const erreur = ref('')
const cle = ref(nouvelleCleIdempotence())

function valeursPlanVide(): ValeursPlan {
  return {
    services: 0, realisations: 0, temoignages: 0, reservationsParMois: 0, generationsIaParMois: 0,
    badge: true, statistiquesJours: 1, statistiquesDetails: false, capacites: { mcp: false },
  }
}
function valeursPrixVide(): ValeursPrix {
  const grille = { 1: 1, 3: 1, 12: 1 }
  return { XAF: { ...grille }, EUR: { ...grille }, USD: { ...grille } }
}

const ouvert = computed({
  get: () => props.cible !== null,
  set: (valeur: boolean) => {
    if (!valeur && !enCours.value) emit('fermer')
  },
})

watch(() => props.cible, (cible) => {
  motif.value = ''
  erreur.value = ''
  cle.value = nouvelleCleIdempotence()
  if (!cible) return
  const base = cible.base
  if (base.type === 'plans') formPlan.value = formPlanDepuis(base.valeurs)
  else if (base.type === 'prix') formPrix.value = formPrixDepuis(base.valeurs)
  else if (base.type === 'frais') formFrais.value = formFraisDepuis(base.valeurs)
  else if (base.type === 'moyens') formMoyens.value = formMoyensDepuis(base.valeurs, cible.moyensConnus)
  else if (base.type === 'essai') formEssai.value = formEssaiDepuis(base.valeurs)
  else formPrompt.value = formPromptDepuis(base)
}, { immediate: true })

watch([formPlan, formPrix, formFrais, formMoyens, formEssai, formPrompt, motif], () => {
  cle.value = nouvelleCleIdempotence()
}, { deep: true })

const type = computed(() => props.cible?.type ?? 'plans')
const planCle = computed(() => (props.cible?.cle === 'gratuit' ? 'gratuit' : 'payant') satisfies PlanId)
const erreurs = computed<Record<string, string>>(() => {
  switch (type.value) {
    case 'plans': return erreursPlan(planCle.value, formPlan.value)
    case 'prix': return erreursPrix(formPrix.value)
    case 'frais': return erreurTaux(formFrais.value.taux) ? { taux: erreurTaux(formFrais.value.taux) } : {}
    case 'essai': return erreursEssai(formEssai.value)
    case 'prompts': return erreursPrompt(formPrompt.value)
    default: return {}
  }
})
const aucunMoyen = computed(() => type.value === 'moyens' && Object.keys(formMoyens.value).length === 0)

const titre = computed(() => `Nouvelle version · ${props.cible ? libelleCleVersion(props.cible.cle) : ''}`)
const peutEnvoyer = computed(() => Object.keys(erreurs.value).length === 0 && !aucunMoyen.value && motifValide(motif.value) && !enCours.value)

function valeursEnvoyees(): ValeursPlan | ValeursPrix | ValeursFrais | ValeursMoyens | ValeursEssai | ReturnType<typeof valeursPromptDepuis> | null {
  switch (type.value) {
    case 'plans': return valeursPlanDepuis(formPlan.value)
    case 'prix': return valeursPrixDepuis(formPrix.value)
    case 'frais': return valeursFraisDepuis(formFrais.value)
    case 'moyens': return valeursMoyensDepuis(formMoyens.value)
    case 'essai': return valeursEssaiDepuis(formEssai.value)
    default: return valeursPromptDepuis(formPrompt.value)
  }
}

async function envoyer(): Promise<void> {
  const cibleCourante = props.cible
  const valeurs = valeursEnvoyees()
  if (!cibleCourante || valeurs === null || !peutEnvoyer.value) return
  enCours.value = true
  erreur.value = ''
  const resultat = await creerBrouillon(cibleCourante.type, { cle: cibleCourante.cle, valeurs, motif: motif.value.trim() }, cle.value)
  enCours.value = false
  if (!resultat.ok) {
    erreur.value = resultat.message
    return
  }
  toast.add({
    title: resultat.donnees.rejoue ? MESSAGE_REJOUE : 'La nouvelle version est enregistrée. Vous pouvez maintenant l’activer.',
    color: 'success',
    icon: 'i-ph-check-circle',
  })
  emit('reussi')
}

const AIDE_RELANCE_SERVICES = 'Invite à ajouter des services à la vitrine. 1 = le lendemain de la création.'
const AIDE_RELANCE_STATISTIQUES = 'Après le premier e-mail et avant la fin de l’essai.'
// Bornes dynamiques : 1 <= services < statistiques < durée (même règle que le serveur).
const maxRelanceStatistiques = computed(() => Math.max(2, formEssai.value.dureeJours - 1))
const maxRelanceServices = computed(() => Math.max(1, formEssai.value.relanceStatistiquesJour - 1))

const periodeLibelle = (mois: number): string => `${mois} mois`
</script>

<template>
  <USlideover
    v-model:open="ouvert"
    :title="titre"
    description="La nouvelle version reste en brouillon : elle ne change rien tant que vous ne l’avez pas activée."
    :dismissible="!enCours"
    :close="!enCours"
  >
    <template #body>
      <form class="flex flex-col gap-6" novalidate @submit.prevent="envoyer">
        <template v-if="cible?.type === 'plans'">
          <fieldset class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" :disabled="enCours">
            <legend class="mb-2 p-0 text-base font-semibold text-encre">Limites</legend>
            <div v-for="nom in VERSION_PLAN_LIMITES_CLES" :key="nom" class="flex flex-col gap-1">
              <UFormField :label="LIBELLES_LIMITES_PLAN[nom]" :name="`limites.${nom}`" :error="erreurs[`limites.${nom}`]">
                <UInputNumber
                  v-model="formPlan.limites[nom].valeur"
                  :min="0"
                  :max="VERSION_PLAN_LIMITE_MAX"
                  size="lg"
                  class="w-full"
                  :disabled="enCours || formPlan.limites[nom].illimite"
                />
              </UFormField>
              <USwitch v-model="formPlan.limites[nom].illimite" label="Illimité" :disabled="enCours || cible.cle === 'gratuit'" :ui="UI_INTERRUPTEUR" />
            </div>
          </fieldset>
          <fieldset class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" :disabled="enCours">
            <legend class="mb-2 p-0 text-base font-semibold text-encre">Droits</legend>
            <USwitch v-model="formPlan.badge" label="Badge de la marque sur la vitrine" :ui="UI_INTERRUPTEUR" />
            <USwitch v-model="formPlan.statistiquesDetails" label="Statistiques détaillées" :ui="UI_INTERRUPTEUR" />
            <USwitch v-model="formPlan.mcp" label="Connexion d’un assistant" :ui="UI_INTERRUPTEUR" />
          </fieldset>
          <UFormField label="Durée des statistiques (jours)" name="statistiquesJours" :error="erreurs.statistiquesJours" :help="`De 1 à ${STATISTIQUES_RETENTION_JOURS} jours.`">
            <UInputNumber v-model="formPlan.statistiquesJours" :min="1" :max="STATISTIQUES_RETENTION_JOURS" size="lg" class="w-full" :disabled="enCours" />
          </UFormField>
        </template>

        <template v-else-if="cible?.type === 'prix'">
          <p class="m-0 text-base text-texte-secondaire">
            Montants TTC affichés au client, dans l’unité habituelle de la devise (15 000 pour XAF, 12,50 pour EUR et USD).
          </p>
          <fieldset v-for="devise in DEVISES" :key="devise" class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0" :disabled="enCours">
            <legend class="mb-2 p-0 text-base font-semibold text-encre">{{ devise }}</legend>
            <UFormField v-for="mois in PERIODES_MOIS" :key="mois" :label="periodeLibelle(mois)" :name="`${devise}.${mois}`" :error="erreurs[`${devise}.${mois}`]">
              <UInput v-model="formPrix[devise][String(mois)]" size="lg" inputmode="decimal" class="w-full" :disabled="enCours" />
            </UFormField>
          </fieldset>
        </template>

        <template v-else-if="cible?.type === 'frais'">
          <UFormField label="Taux (points de base)" name="taux" required :error="erreurs.taux" :help="`${pourcentageDepuisPointsBase(formFrais.taux)} · 100 points = 1 %, au plus ${FRAIS_TAUX_PB_MAX} points.`">
            <UInputNumber v-model="formFrais.taux" :min="0" :max="FRAIS_TAUX_PB_MAX" :step="25" size="lg" class="w-full" :disabled="enCours" />
          </UFormField>
          <UFormField label="Frais supportés par" name="supporteur" required>
            <USelect v-model="formFrais.supporteur" :items="OPTIONS_SUPPORTEUR" size="lg" class="w-full" :disabled="enCours" />
          </UFormField>
        </template>

        <template v-else-if="cible?.type === 'moyens'">
          <fieldset class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" :disabled="enCours">
            <legend class="mb-2 p-0 text-base font-semibold text-encre">Moyens ouverts aux clients</legend>
            <USwitch v-for="(_, id) in formMoyens" :key="id" v-model="formMoyens[id]" :label="id" :ui="UI_INTERRUPTEUR" />
            <p v-if="aucunMoyen" class="m-0 text-base text-texte-secondaire">Aucun moyen connu pour ce fournisseur.</p>
          </fieldset>
          <p class="m-0 text-(length:--fs-14) text-texte-secondaire">Un nouveau moyen ne se crée pas ici : il dépend du code de l’opérateur.</p>
        </template>

        <template v-else-if="cible?.type === 'essai'">
          <fieldset class="m-0 flex min-w-0 flex-col gap-4 border-0 p-0" :disabled="enCours">
            <legend class="mb-2 p-0 text-base font-semibold text-encre">Essai gratuit</legend>
            <div class="flex flex-col gap-1">
              <USwitch v-model="formEssai.actif" label="Essai actif" :ui="UI_INTERRUPTEUR" />
              <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
                Désactivé, aucune nouvelle vitrine ne reçoit d’essai. Les essais déjà accordés vont à leur terme.
              </p>
            </div>
            <UFormField label="Durée (jours)" name="dureeJours" required :error="erreurs.dureeJours" :help="`De ${ESSAI_DUREE_MIN_JOURS} à ${ESSAI_DUREE_MAX_JOURS} jours.`">
              <UInputNumber v-model="formEssai.dureeJours" :min="ESSAI_DUREE_MIN_JOURS" :max="ESSAI_DUREE_MAX_JOURS" size="lg" class="w-full" :disabled="enCours" />
            </UFormField>
            <UFormField label="Jour de l’e-mail « services »" name="relanceServicesJour" required :error="erreurs.relanceServicesJour" :help="AIDE_RELANCE_SERVICES">
              <UInputNumber v-model="formEssai.relanceServicesJour" :min="1" :max="maxRelanceServices" size="lg" class="w-full" :disabled="enCours" />
            </UFormField>
            <UFormField label="Jour de l’e-mail « statistiques »" name="relanceStatistiquesJour" required :error="erreurs.relanceStatistiquesJour" :help="AIDE_RELANCE_STATISTIQUES">
              <UInputNumber v-model="formEssai.relanceStatistiquesJour" :min="1" :max="maxRelanceStatistiques" size="lg" class="w-full" :disabled="enCours" />
            </UFormField>
          </fieldset>
        </template>

        <AdminEditeurPrompt
          v-else-if="cible?.type === 'prompts' && cible.base.type === 'prompts'"
          v-model:form="formPrompt"
          :cle="cible.cle"
          :schema-sortie="cible.base.valeurs.schemaSortie"
          :erreurs="erreurs"
          :desactive="enCours"
        />

        <AdminVersionsConfirmation
          v-if="cible"
          v-model:motif="motif"
          action="version.creer"
          cible-type="version"
          :cible-id="cible.base.id"
          :en-cours="enCours"
          sans-code
        />

        <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile) justify-center" :disabled="enCours" @click="emit('fermer')">
          Annuler
        </UButton>
        <UButton size="lg" class="min-h-(--cible-tactile) justify-center" :loading="enCours" :disabled="!peutEnvoyer" @click="envoyer">
          Enregistrer le brouillon
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
