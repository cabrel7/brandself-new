<script setup lang="ts">
import type { PaiementDTO } from '#shared/dto'
import { DEVISES_EXPOSANT } from '#shared/paiements'
import type { EtapePaiement } from '~/composables/usePaiementAbonnement'
import { MESSAGE_DELAI_ATTENTE, MESSAGE_SUIVI_COUPE, messageFinPaiement } from '~/composables/usePaiementAbonnement'

const props = defineProps<{
  etape: Extract<EtapePaiement, 'attente' | 'delai' | 'reseau' | 'reussi' | 'echec'>
  paiement: PaiementDTO
  /** Dernier jour payé, déjà formaté (« 22 novembre 2026 »), pour l'écran de réussite. */
  jourFin: string
}>()

const emit = defineEmits<{ reessayer: [], verifier: [], terminer: [] }>()

const titre = useTemplateRef<HTMLElement>('titre')
const montant = computed(() => formaterMontant(props.paiement.montant, props.paiement.devise, DEVISES_EXPOSANT[props.paiement.devise] ?? 0))
const enAttente = computed(() => props.etape === 'attente')
const echec = computed(() => props.etape === 'echec' || props.etape === 'reseau')

const ICONES: Record<typeof props.etape, string> = {
  attente: 'i-ph-device-mobile',
  delai: 'i-ph-hourglass',
  reseau: 'i-ph-warning-circle',
  reussi: 'i-ph-check-circle',
  echec: 'i-ph-warning-circle',
}
// Une anomalie ne se « réessaie » pas : un montant a peut-être été prélevé, un second paiement doublerait la dépense.
const peutReessayer = computed(() => props.etape === 'echec' && props.paiement.statut !== 'anomalie')

const titreAffiche = computed(() => {
  switch (props.etape) {
    case 'attente': return 'Validez le paiement sur votre téléphone'
    case 'delai': return 'Nous attendons encore l’opérateur'
    case 'reseau': return 'Le suivi du paiement est interrompu'
    case 'reussi': return props.jourFin ? `Votre plan payant est actif jusqu’au ${props.jourFin}` : 'Votre plan payant est actif'
    default: return 'Le paiement n’a pas abouti'
  }
})

const detail = computed(() => {
  switch (props.etape) {
    case 'attente': {
      const destinataire = props.paiement.telephoneMasque ? ` au ${props.paiement.telephoneMasque}` : ''
      return `Une demande de ${props.paiement.moyenLibelle} de ${montant.value} a été envoyée${destinataire}.`
    }
    case 'delai': return MESSAGE_DELAI_ATTENTE
    case 'reseau': return MESSAGE_SUIVI_COUPE
    case 'reussi': return 'Merci. Un récapitulatif vous est envoyé par e-mail.'
    default: return messageFinPaiement(props.paiement)
  }
})

// Le formulaire disparaît : le focus passe au résultat pour qu'il soit annoncé et atteint au clavier.
watch(() => props.etape, async (courante) => {
  if (courante === 'attente') return
  await nextTick()
  titre.value?.focus()
})
</script>

<template>
  <div
    class="flex flex-col items-start gap-3 rounded-(--rayon) bg-champ p-4"
    :role="echec ? 'alert' : 'status'"
    :aria-busy="enAttente"
  >
    <UIcon
      :name="ICONES[etape]"
      class="size-8"
      :class="echec ? 'text-erreur' : 'text-accent-texte'"
      aria-hidden="true"
    />
    <p ref="titre" tabindex="-1" class="m-0 text-(length:--fs-20) leading-snug font-semibold text-encre outline-none">
      {{ titreAffiche }}
    </p>
    <p class="m-0 text-base text-texte-secondaire">
      {{ detail }}
    </p>

    <p v-if="enAttente" class="m-0 flex items-center gap-2 text-(length:--fs-14) text-texte-secondaire">
      <UIcon name="i-ph-circle-notch" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
      <span>Vous pouvez quitter cette page : votre abonnement s’active dès que vous validez.</span>
    </p>

    <UButton
      v-if="peutReessayer"
      label="Réessayer"
      size="lg"
      block
      class="min-h-(--cible-tactile)"
      @click="emit('reessayer')"
    />
    <UButton
      v-else-if="etape === 'delai' || etape === 'reseau'"
      label="Vérifier à nouveau"
      size="lg"
      block
      class="min-h-(--cible-tactile)"
      @click="emit('verifier')"
    />
    <UButton
      v-else
      :label="etape === 'reussi' ? 'Terminé' : 'Fermer'"
      size="lg"
      variant="outline"
      block
      class="min-h-(--cible-tactile)"
      @click="emit('terminer')"
    />
  </div>
</template>
