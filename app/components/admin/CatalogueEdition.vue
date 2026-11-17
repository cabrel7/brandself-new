<script setup lang="ts">
import { CATALOGUE_MOTIF_MAX, PAYS_FUSEAUX_MAX, PAYS_INDICATIF_FORMAT, PAYS_LIBELLE_MAX, PAYS_LIBELLE_MIN } from '#shared/admin'
import { DEVISES } from '#shared/compte'
import type { DeviseDto, NomBloqueDto, PaysDto } from '#shared/schemas/admin-catalogues'
import {
  ACTIONS_CATALOGUE,
  cibleReauthCatalogue,
  erreurFuseaux,
  MESSAGE_INDICATIF,
  MESSAGE_LIBELLE_PAYS,
  MESSAGE_NOM_BLOQUE,
  modificationsPays,
  nomBloqueValide,
  normaliserNomBloque,
  noteCanal,
  NOTE_CANAL_EMAIL,
  saisieDepuisPays,
} from '~/utils/admin-catalogues'
import type { SaisiePays } from '~/utils/admin-catalogues'
import type { ResultatEcriture } from '~/composables/useAdminEcriture'
import { MESSAGE_REJOUE, motifValide, nouvelleCleIdempotence } from '~/utils/admin-paiements'

// Panneau latéral d'une écriture sur un catalogue : un seul panneau, jamais de fenêtre sur fenêtre. Les réglages
// oui/non sont des interrupteurs. L'écriture exige un motif et un code de réauthentification (A1) ; la clé
// d'idempotence suit l'intention (elle change dès que la saisie change).
export type CibleCatalogue =
  | { type: 'pays', pays: PaysDto }
  | { type: 'devise', devise: DeviseDto }
  | { type: 'nom-ajout' }
  | { type: 'nom-retrait', nom: NomBloqueDto }

const props = defineProps<{ cible: CibleCatalogue | null }>()
const emit = defineEmits<{ fermer: [], reussi: [] }>()

const UI_INTERRUPTEUR = { root: 'min-h-(--cible-tactile) items-center' }
const OPTIONS_DEVISE = DEVISES.map((code) => ({ label: code, value: code }))

const toast = useToast()
const ecritures = useAdminCatalogueEcritures()

const saisie = ref<SaisiePays | null>(null)
const actifDevise = ref(true)
const nomSaisi = ref('')
const suppression = ref(false)
const motif = ref('')
const code = ref('')
const enCours = ref(false)
const erreur = ref('')
const cle = ref(nouvelleCleIdempotence())

const ouvert = computed({
  get: () => props.cible !== null,
  set: (valeur: boolean) => {
    if (!valeur && !enCours.value) emit('fermer')
  },
})

watch(() => props.cible, (cible) => {
  motif.value = ''
  code.value = ''
  erreur.value = ''
  nomSaisi.value = ''
  suppression.value = false
  saisie.value = cible?.type === 'pays' ? saisieDepuisPays(cible.pays) : null
  actifDevise.value = cible?.type === 'devise' ? cible.devise.actif : true
  cle.value = nouvelleCleIdempotence()
}, { immediate: true })

// Une autre saisie est une autre demande : nouvelle clé (un rejeu de la même demande garde la sienne).
watch([saisie, actifDevise, nomSaisi, motif, suppression], () => {
  cle.value = nouvelleCleIdempotence()
}, { deep: true })

const mode = computed<'pays' | 'pays-retrait' | 'devise' | 'nom-ajout' | 'nom-retrait'>(() => {
  const cible = props.cible
  if (cible?.type === 'pays') return suppression.value ? 'pays-retrait' : 'pays'
  if (cible?.type === 'devise') return 'devise'
  return cible?.type ?? 'nom-ajout'
})

const titre = computed(() => {
  const cible = props.cible
  if (cible?.type === 'pays') return suppression.value ? `Supprimer ${cible.pays.libelle}` : `Modifier ${cible.pays.libelle}`
  if (cible?.type === 'devise') return `Modifier la devise ${cible.devise.code}`
  if (cible?.type === 'nom-retrait') return `Débloquer « ${cible.nom.valeur} »`
  return 'Bloquer un nom'
})

const description = computed(() => {
  switch (mode.value) {
    case 'pays': return 'Les vitrines déjà enregistrées pour ce pays restent valides.'
    case 'pays-retrait': return 'Le pays disparaît du catalogue. Il ne peut être supprimé que si aucune vitrine ne l’utilise.'
    case 'devise': return 'Une devise désactivée n’est plus proposée aux comptes. Les comptes existants gardent leur devise.'
    case 'nom-ajout': return 'Ce nom ne pourra plus être choisi comme adresse de vitrine. Les vitrines existantes ne changent pas.'
    default: return 'Ce nom pourra de nouveau être choisi comme adresse de vitrine.'
  }
})

const erreurLibelle = computed(() => {
  const longueur = saisie.value?.libelle.trim().length ?? 0
  return longueur >= PAYS_LIBELLE_MIN && longueur <= PAYS_LIBELLE_MAX ? '' : MESSAGE_LIBELLE_PAYS
})
const erreurIndicatif = computed(() => (PAYS_INDICATIF_FORMAT.test(saisie.value?.indicatif ?? '') ? '' : MESSAGE_INDICATIF))
const erreurFuseauxSaisis = computed(() => erreurFuseaux(saisie.value?.fuseaux ?? []))
const erreurNom = computed(() => (nomSaisi.value === '' || nomBloqueValide(nomSaisi.value) ? '' : MESSAGE_NOM_BLOQUE))

const modifications = computed(() => (props.cible?.type === 'pays' && saisie.value ? modificationsPays(props.cible.pays, saisie.value) : {}))
const motifMax = computed(() => (mode.value === 'nom-ajout' ? CATALOGUE_MOTIF_MAX : undefined))

const saisieValide = computed(() => {
  switch (mode.value) {
    case 'pays':
      return Object.keys(modifications.value).length > 0 && !erreurLibelle.value && !erreurIndicatif.value && !erreurFuseauxSaisis.value
    case 'devise':
      return props.cible?.type === 'devise' && actifDevise.value !== props.cible.devise.actif
    case 'nom-ajout':
      return nomBloqueValide(nomSaisi.value)
    default:
      return true
  }
})
const motifPermis = computed(() => motifValide(motif.value) && motif.value.trim().length <= (motifMax.value ?? Number.POSITIVE_INFINITY))
const peutEnvoyer = computed(() => saisieValide.value && motifPermis.value && code.value !== '' && !enCours.value)

// Le serveur lie le code à `<catalogue>:<identifiant>` (routes /api/admin/catalogues/[nom]/** : `${nom}:${id}`) ; un code lié
// au seul identifiant est refusé (« Ce code de confirmation n’est pas valide »).
const reauth = computed(() => {
  const cible = props.cible
  if (cible?.type === 'pays') return cibleReauthCatalogue(suppression.value ? ACTIONS_CATALOGUE.supprimer : ACTIONS_CATALOGUE.modifier, `pays:${cible.pays.code}`)
  if (cible?.type === 'devise') return cibleReauthCatalogue(ACTIONS_CATALOGUE.modifier, `devises:${cible.devise.code}`)
  if (cible?.type === 'nom-retrait') return cibleReauthCatalogue(ACTIONS_CATALOGUE.supprimer, `noms-bloques:${cible.nom.valeur}`)
  return cibleReauthCatalogue(ACTIONS_CATALOGUE.creer, `noms-bloques:${normaliserNomBloque(nomSaisi.value) || 'nouveau'}`)
})

const libelleAction = computed(() => {
  switch (mode.value) {
    case 'pays-retrait': return 'Supprimer le pays'
    case 'nom-ajout': return 'Bloquer ce nom'
    case 'nom-retrait': return 'Débloquer ce nom'
    default: return 'Enregistrer'
  }
})

const succes = computed(() => {
  switch (mode.value) {
    case 'pays-retrait': return 'Le pays est supprimé.'
    case 'nom-ajout': return 'Le nom est bloqué.'
    case 'nom-retrait': return 'Le nom est débloqué.'
    default: return 'Vos modifications sont enregistrées.'
  }
})

async function envoyer(): Promise<void> {
  const cible = props.cible
  if (!cible || !peutEnvoyer.value) return
  enCours.value = true
  erreur.value = ''
  const confirmation = { motif: motif.value.trim(), code: code.value, cle: cle.value }
  let resultat: ResultatEcriture<{ rejoue: boolean }>
  if (cible.type === 'pays') {
    resultat = suppression.value
      ? await ecritures.retirer('pays', cible.pays.code, confirmation)
      : await ecritures.modifier('pays', cible.pays.code, modifications.value, confirmation)
  } else if (cible.type === 'devise') {
    resultat = await ecritures.modifier('devises', cible.devise.code, { actif: actifDevise.value }, confirmation)
  } else if (cible.type === 'nom-ajout') {
    resultat = await ecritures.ajouterNomBloque(normaliserNomBloque(nomSaisi.value), confirmation)
  } else {
    resultat = await ecritures.retirer('noms-bloques', cible.nom.valeur, confirmation)
  }
  enCours.value = false
  if (!resultat.ok) {
    erreur.value = resultat.message
    // Un code est à usage unique : après un échec, on en redemande un.
    code.value = ''
    return
  }
  toast.add({ title: resultat.donnees.rejoue ? MESSAGE_REJOUE : succes.value, color: 'success', icon: 'i-ph-check-circle' })
  emit('reussi')
}
</script>

<template>
  <USlideover v-model:open="ouvert" :title="titre" :description="description" :dismissible="!enCours" :close="!enCours">
    <template #body>
      <form class="flex flex-col gap-6" novalidate @submit.prevent="envoyer">
        <template v-if="mode === 'pays' && saisie">
          <UFormField label="Nom du pays" name="libelle" required :error="erreurLibelle">
            <UInput v-model="saisie.libelle" size="lg" class="w-full" :maxlength="PAYS_LIBELLE_MAX" :disabled="enCours" />
          </UFormField>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="Indicatif téléphonique" name="indicatif" required :error="erreurIndicatif">
              <UInput v-model="saisie.indicatif" size="lg" inputmode="numeric" class="w-full" :disabled="enCours">
                <template #leading>
                  <span class="text-base font-semibold text-texte-secondaire">+</span>
                </template>
              </UInput>
            </UFormField>
            <UFormField label="Devise par défaut" name="deviseDefaut" required>
              <USelect v-model="saisie.deviseDefaut" :items="OPTIONS_DEVISE" size="lg" class="w-full" :disabled="enCours" />
            </UFormField>
          </div>

          <UFormField
            label="Fuseaux horaires"
            name="fuseaux"
            required
            :error="erreurFuseauxSaisis"
            :help="`Jusqu’à ${PAYS_FUSEAUX_MAX} fuseaux, par exemple Africa/Douala. Validez chacun avec Entrée.`"
          >
            <UInputTags v-model="saisie.fuseaux" size="lg" class="w-full" add-on-blur :max="PAYS_FUSEAUX_MAX" :disabled="enCours" />
          </UFormField>

          <fieldset class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0" :disabled="enCours">
            <legend class="mb-2 p-0 text-base font-semibold text-encre">Réglages du pays</legend>
            <USwitch v-model="saisie.actif" label="Pays actif" description="Proposé à l’inscription et à la connexion." :ui="UI_INTERRUPTEUR" />
            <USwitch v-model="saisie.canalSms" label="Code par SMS" :description="noteCanal('sms', saisie.canalSms, props.cible?.type === 'pays' && props.cible.pays.smsEffectif) || undefined" :ui="UI_INTERRUPTEUR" />
            <USwitch v-model="saisie.canalWhatsapp" label="Code par WhatsApp" :description="noteCanal('whatsapp', saisie.canalWhatsapp, props.cible?.type === 'pays' && props.cible.pays.whatsappEffectif) || undefined" :ui="UI_INTERRUPTEUR" />
            <USwitch v-model="saisie.canalEmail" label="Connexion par email" :description="NOTE_CANAL_EMAIL" :ui="UI_INTERRUPTEUR" />
          </fieldset>
        </template>

        <template v-else-if="mode === 'devise'">
          <USwitch v-model="actifDevise" label="Devise active" description="Les comptes peuvent la choisir." :ui="UI_INTERRUPTEUR" :disabled="enCours" />
        </template>

        <template v-else-if="mode === 'nom-ajout'">
          <UFormField label="Nom à bloquer" name="valeur" required :error="erreurNom" help="Minuscules, chiffres, tiret et tiret bas.">
            <UInput v-model="nomSaisi" size="lg" class="w-full" autocapitalize="none" autocomplete="off" spellcheck="false" :disabled="enCours" />
          </UFormField>
        </template>

        <AdminVersionsConfirmation
          v-model:motif="motif"
          v-model:code="code"
          :action="reauth.action"
          :cible-type="reauth.cibleType"
          :cible-id="reauth.cibleId"
          :en-cours="enCours"
          :motif-max="motifMax"
        />

        <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
      </form>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-2">
        <UButton
          v-if="props.cible?.type === 'pays' && !props.cible.pays.utilise && !suppression"
          color="error"
          variant="link"
          size="lg"
          icon="i-ph-trash"
          class="min-h-(--cible-tactile) self-start"
          :disabled="enCours"
          @click="suppression = true"
        >
          Supprimer ce pays
        </UButton>
        <p v-else-if="props.cible?.type === 'pays' && props.cible.pays.utilise" class="m-0 text-(length:--fs-14) text-texte-secondaire">
          Ce pays est utilisé par des vitrines : vous pouvez le désactiver, pas le supprimer.
        </p>
        <div class="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile) justify-center" :disabled="enCours" @click="suppression ? (suppression = false) : emit('fermer')">
            {{ suppression ? 'Retour' : 'Annuler' }}
          </UButton>
          <UButton
            :color="mode === 'pays-retrait' ? 'error' : 'primary'"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            :loading="enCours"
            :disabled="!peutEnvoyer"
            @click="envoyer"
          >
            {{ libelleAction }}
          </UButton>
        </div>
      </div>
    </template>
  </USlideover>
</template>
