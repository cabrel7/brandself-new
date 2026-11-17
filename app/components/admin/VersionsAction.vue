<script setup lang="ts">
import type { ImpactPlan, VersionDto } from '#shared/schemas/admin-versions'
import { MESSAGE_REJOUE, motifValide, nouvelleCleIdempotence } from '~/utils/admin-paiements'
import {
  cibleReauthVersion,
  corpsRetourVersion,
  DEFINITIONS_ACTION_VERSION,
  impactNonNul,
  libelleCleVersion,
  lignesValeursVersion,
  programmationValide,
  instantDepuisSaisie,
} from '~/utils/admin-versions'
import type { ActionVersion } from '~/utils/admin-versions'

// Activer, programmer, revenir en arrière ou valider un prix : un seul panneau, motif et code de réauthentification.
// Pour un plan, l'aperçu d'impact s'affiche d'abord ; l'activation n'est possible qu'une fois l'aperçu chargé et, s'il
// touche des comptes, acquitté. Le serveur compare cet impact à son calcul du moment (409 `IMPACT_CHANGE` sinon).
export interface CibleAction {
  version: VersionDto
  action: ActionVersion
}

const props = defineProps<{ cible: CibleAction | null }>()
const emit = defineEmits<{ fermer: [], reussi: [] }>()

const toast = useToast()
const { agir } = useAdminVersionsEcritures()

const motif = ref('')
const code = ref('')
const dateSaisie = ref('')
const impact = ref<ImpactPlan | null>(null)
const acquitte = ref(false)
const enCours = ref(false)
const erreur = ref('')
const cle = ref(nouvelleCleIdempotence())

const ouvert = computed({
  get: () => props.cible !== null,
  set: (valeur: boolean) => {
    if (!valeur && !enCours.value) emit('fermer')
  },
})

watch(() => props.cible, () => {
  motif.value = ''
  code.value = ''
  dateSaisie.value = ''
  impact.value = null
  acquitte.value = false
  erreur.value = ''
  cle.value = nouvelleCleIdempotence()
}, { immediate: true })

watch([motif, dateSaisie, impact, acquitte], () => {
  cle.value = nouvelleCleIdempotence()
})

const definition = computed(() => (props.cible ? DEFINITIONS_ACTION_VERSION[props.cible.action] : DEFINITIONS_ACTION_VERSION.activer))
const version = computed(() => props.cible?.version ?? null)
const planActive = computed(() => version.value?.type === 'plans' && (props.cible?.action === 'activer' || props.cible?.action === 'programmer'))
const programmation = computed(() => props.cible?.action === 'programmer')
const lignes = computed(() => (version.value ? lignesValeursVersion(version.value) : []))
const reauth = computed(() => cibleReauthVersion(definition.value.action, version.value?.id ?? ''))
const dateValide = computed(() => !programmation.value || programmationValide(dateSaisie.value, new Date()))
const erreurDate = computed(() => (programmation.value && dateSaisie.value !== '' && !dateValide.value ? 'Choisissez une date au moins dix minutes plus tard.' : ''))
// Retour arrière : aucun aperçu au départ (la version rétablie est choisie par le serveur) ; si le serveur répond
// `IMPACT_CHANGE`, son impact est présenté et doit être acquitté avant de renvoyer.
const retourAvecImpact = computed(() => props.cible?.action === 'retour' && version.value?.type === 'plans' && impact.value !== null)
const impactVisible = computed(() => planActive.value || retourAvecImpact.value)
const impactPret = computed(() => (!planActive.value && !retourAvecImpact.value) || (impact.value !== null && (!impactNonNul(impact.value) || acquitte.value)))
const peutEnvoyer = computed(() => motifValide(motif.value) && code.value !== '' && dateValide.value && impactPret.value && !enCours.value)

const consigne = computed(() => {
  const courante = version.value
  if (!courante) return ''
  switch (props.cible?.action) {
    case 'retour': return retourAvecImpact.value
      ? 'Ce retour arrière baisse des limites de plan. Relisez l’impact ci-dessous, puis confirmez.'
      : 'La version précédente redevient active. Celle-ci passe en « Remplacée ». Rien n’est supprimé.'
    case 'valider': return 'Valider cette grille ouvre les paiements en ligne à ces prix. Vérifiez chaque montant avant de continuer.'
    case 'programmer': return 'La version devient active à la date choisie, avec un retard d’une minute au plus.'
    default: return courante.type === 'prix'
      ? 'Activer une grille de prix la valide : les paiements en ligne s’ouvrent à ces prix.'
      : 'La version devient active tout de suite.'
  }
})

async function envoyer(): Promise<void> {
  const cibleCourante = props.cible
  if (!cibleCourante || !peutEnvoyer.value) return
  enCours.value = true
  erreur.value = ''
  const action = cibleCourante.action
  const corps = action === 'retour'
    ? corpsRetourVersion(motif.value.trim(), retourAvecImpact.value ? impact.value : null)
    : action === 'valider'
    ? { motif: motif.value.trim() }
    : {
        programmeePour: programmation.value ? instantDepuisSaisie(dateSaisie.value) : null,
        ...(planActive.value && impact.value ? { impactAcquitte: impact.value } : {}),
        motif: motif.value.trim(),
      }
  const resultat = await agir(cibleCourante.version.type, cibleCourante.version.id, action, corps, { code: code.value, cle: cle.value })
  enCours.value = false
  if (!resultat.ok) {
    // Retour arrière : l'impact présenté est l'unique message (pas d'alerte en plus), le serveur ne bloque que sur lui.
    erreur.value = cibleCourante.action === 'retour' && resultat.impact ? '' : resultat.message
    // Un code est à usage unique ; un impact recalculé par le serveur doit être relu avant de confirmer à nouveau.
    code.value = ''
    if (resultat.impact) impact.value = resultat.impact
    return
  }
  toast.add({ title: resultat.donnees.rejoue ? MESSAGE_REJOUE : 'C’est enregistré.', color: 'success', icon: 'i-ph-check-circle' })
  emit('reussi')
}
</script>

<template>
  <USlideover v-model:open="ouvert" :title="definition.titre" :description="version ? `${libelleCleVersion(version.cle)} · version ${version.numero}` : undefined" :dismissible="!enCours" :close="!enCours">
    <template #body>
      <form v-if="version" class="flex flex-col gap-6" novalidate @submit.prevent="envoyer">
        <dl class="m-0 flex flex-col divide-y divide-bordure border-y border-bordure">
          <div v-for="ligne in lignes" :key="ligne.libelle" class="flex items-baseline justify-between gap-4 px-1 py-2">
            <dt class="text-texte-secondaire">{{ ligne.libelle }}</dt>
            <dd class="m-0 text-right text-encre">{{ ligne.valeur }}</dd>
          </div>
        </dl>

        <AdminApercuImpactPlan
          v-if="impactVisible && version.type === 'plans'"
          v-model:impact="impact"
          v-model:acquitte="acquitte"
          :cle="version.cle"
          :valeurs="version.valeurs"
          :desactive="enCours"
          :charger="planActive"
        />

        <UFormField v-if="programmation" label="Date et heure d’effet" name="programmeePour" required :error="erreurDate" help="Heure de votre appareil.">
          <UInput v-model="dateSaisie" type="datetime-local" size="lg" class="w-full" :disabled="enCours" />
        </UFormField>

        <AdminVersionsConfirmation
          v-model:motif="motif"
          v-model:code="code"
          :action="reauth.action"
          :cible-type="reauth.cibleType"
          :cible-id="reauth.cibleId"
          :en-cours="enCours"
          :consigne="consigne"
        />

        <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile) justify-center" :disabled="enCours" @click="emit('fermer')">
          Annuler
        </UButton>
        <UButton
          :color="definition.destructive ? 'error' : 'primary'"
          size="lg"
          class="min-h-(--cible-tactile) justify-center"
          :loading="enCours"
          :disabled="!peutEnvoyer"
          @click="envoyer"
        >
          {{ definition.libelle }}
        </UButton>
      </div>
    </template>
  </USlideover>
</template>
