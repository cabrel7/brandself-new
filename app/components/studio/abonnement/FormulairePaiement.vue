<script setup lang="ts">
import type { DeviseOffreDTO, MoyenPaiementDTO, PrixPeriodeDTO } from '#shared/dto'
import type { PeriodeMois } from '#shared/plans'
import type { ErreursPaiement } from '~/composables/usePaiementAbonnement'

const props = defineProps<{
  /** Légende du choix de durée : « Renouveler pour » (abonné) ou « Choisir la durée » (plan gratuit). */
  legende: string
  /** « Payer 48 000 XAF » (plan gratuit) ou « Renouveler maintenant » (abonné). */
  action: string
  devises: DeviseOffreDTO[]
  /** Devise du compte : sert à signaler que le paiement se fait dans une autre. */
  deviseCompte: string
  prix: PrixPeriodeDTO[]
  exposant: number
  moyens: MoyenPaiementDTO[]
  moyenChoisi: MoyenPaiementDTO | null
  erreurs: ErreursPaiement
  envoi: boolean
}>()

const emit = defineEmits<{ payer: [], viderErreur: [champ: keyof ErreursPaiement] }>()

const periode = defineModel<PeriodeMois>('periode', { required: true })
const moyen = defineModel<string>('moyen', { required: true })
const telephone = defineModel<string>('telephone', { required: true })
/** Devise payable choisie (`null` : aucune devise proposée). */
const devise = defineModel<string | null>('devise', { required: true })

const UI_DEVISE = {
  legend: 'mb-2 text-base font-semibold text-encre',
  item: 'flex-1 has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent has-data-[state=checked]:**:text-sur-accent',
}

const itemsDevises = computed(() => props.devises.map((d) => ({ value: d.devise, label: d.devise })))
const deviseDifferente = computed(() => devise.value !== null && devise.value !== props.deviseCompte)
const aideTelephone = 'Vous recevrez une demande de confirmation sur votre téléphone.'
</script>

<template>
  <form class="flex flex-col gap-5" novalidate @submit.prevent="emit('payer')">
    <URadioGroup
      v-if="devises.length > 1"
      :model-value="devise ?? undefined"
      legend="Devise"
      :items="itemsDevises"
      variant="table"
      indicator="hidden"
      orientation="horizontal"
      size="lg"
      :disabled="envoi"
      :ui="UI_DEVISE"
      @update:model-value="devise = String($event)"
    />

    <StudioAbonnementChoixPeriode
      v-model="periode"
      :prix="prix"
      :devise="devise ?? ''"
      :exposant="exposant"
      :legende="legende"
      :disabled="envoi"
      :erreur="erreurs.periode"
      @choisir="emit('viderErreur', 'periode')"
    />

    <StudioAbonnementChoixMoyen
      v-model="moyen"
      :moyens="moyens"
      :disabled="envoi"
      :erreur="erreurs.moyen"
      @choisir="emit('viderErreur', 'moyen')"
    />

    <UFormField
      label="Numéro Mobile Money"
      name="telephone"
      :error="erreurs.telephone"
      :help="aideTelephone"
    >
      <UInput
        v-model="telephone"
        type="tel"
        inputmode="tel"
        autocomplete="tel-national"
        :placeholder="moyenChoisi?.exemple"
        :disabled="envoi"
        @update:model-value="emit('viderErreur', 'telephone')"
      >
        <template v-if="moyenChoisi" #leading>
          <span class="text-base font-semibold text-texte-secondaire">+{{ moyenChoisi.indicatif }}</span>
        </template>
      </UInput>
    </UFormField>

    <p v-if="deviseDifferente" class="m-0 text-(length:--fs-14) text-texte-secondaire">
      Le paiement se fait aujourd’hui par Mobile Money, en {{ nomDevise(devise ?? '') }}.
    </p>

    <div class="flex flex-col gap-3">
      <p v-if="erreurs.general" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurs.general }}</span>
      </p>
      <UButton type="submit" :label="action" block :loading="envoi" />
    </div>
  </form>
</template>
