<script setup lang="ts">
import type { ReglageValeur } from '#shared/reglages'
import type { ReglageDto } from '#shared/schemas/admin-a4'
import {
  erreurSaisieReglage,
  estModifieReglage,
  libelleValeurReglage,
  peutRetablirReglage,
  valeurRepliReglage,
} from '~/utils/admin-reglages'

// Un réglage : libellé, aide, champ adapté au type (interrupteur, nombre, texte), valeur par défaut et de repli. Le
// brouillon est local ; « Enregistrer » ne fait que demander la confirmation à la page (motif, code, clé d'idempotence).
const props = defineProps<{
  reglage: ReglageDto
  /** Tous les réglages : la validation croisée du registre lit les valeurs des autres. */
  tous: readonly ReglageDto[]
  /** Une confirmation est en cours : aucune autre modification en parallèle. */
  occupe: boolean
}>()
const emit = defineEmits<{ enregistrer: [valeur: ReglageValeur], retablir: [] }>()

const brouillon = ref<ReglageValeur | null>(props.reglage.valeur)
// Après enregistrement, la page recharge le registre : le brouillon repart de la valeur en vigueur.
watch(() => props.reglage.valeur, (valeur) => { brouillon.value = valeur })

const idChamp = useId()
const idAide = useId()

const modifie = computed(() => estModifieReglage(props.reglage, brouillon.value))
const erreur = computed(() => (modifie.value ? erreurSaisieReglage(props.reglage, brouillon.value, props.tous) : ''))
const peutEnregistrer = computed(() => props.reglage.modifiable && modifie.value && erreur.value === '' && !props.occupe)
const peutRetablir = computed(() => peutRetablirReglage(props.reglage) && !props.occupe)
const repli = computed(() => libelleValeurReglage(valeurRepliReglage(props.reglage)))
const restants = computed(() =>
  props.reglage.longueurMax !== null && typeof brouillon.value === 'string' ? props.reglage.longueurMax - brouillon.value.length : 0,
)

const bornes = computed(() => (props.reglage.type === 'entier' ? `De ${props.reglage.min} à ${props.reglage.max}.` : ''))

function enregistrer(): void {
  if (peutEnregistrer.value && brouillon.value !== null) emit('enregistrer', brouillon.value)
}
</script>

<template>
  <form class="flex flex-col gap-4 py-5" novalidate @submit.prevent="enregistrer">
    <div class="flex flex-wrap items-center gap-2">
      <UBadge v-if="!reglage.modifiable" color="neutral" variant="outline" icon="i-ph-lock-simple" size="lg">
        Lecture seule
      </UBadge>
      <UBadge v-if="reglage.securite" color="neutral" variant="outline" icon="i-ph-shield-check" size="lg">
        Sécurité
      </UBadge>
      <UBadge v-if="reglage.surcharge" color="primary" variant="subtle" icon="i-ph-pencil-simple" size="lg" class="text-accent-texte">
        Valeur personnalisée
      </UBadge>
    </div>

    <USwitch
      v-if="reglage.type === 'booleen'"
      :model-value="brouillon === true"
      :label="reglage.libelle"
      :description="reglage.aide"
      :disabled="!reglage.modifiable || occupe"
      :ui="{
        root: 'w-full min-h-(--cible-tactile) flex-row-reverse justify-between gap-4',
        wrapper: 'ms-0',
        label: 'text-base font-semibold text-encre',
        description: 'text-base text-texte-secondaire',
      }"
      @update:model-value="brouillon = $event"
    />

    <UFormField
      v-else
      :label="reglage.libelle"
      :name="idChamp"
      :description="reglage.aide"
      :help="bornes || undefined"
      :error="erreur || undefined"
      :ui="{ label: 'text-base font-semibold text-encre' }"
    >
      <UInputNumber
        v-if="reglage.type === 'entier'"
        :model-value="typeof brouillon === 'number' ? brouillon : undefined"
        :min="reglage.min ?? undefined"
        :max="reglage.max ?? undefined"
        :step="1"
        size="lg"
        class="w-full sm:w-56"
        :disabled="!reglage.modifiable || occupe"
        :aria-describedby="idAide"
        @update:model-value="brouillon = $event ?? null"
      />
      <UTextarea
        v-else
        :model-value="typeof brouillon === 'string' ? brouillon : ''"
        :rows="3"
        :maxlength="reglage.longueurMax ?? undefined"
        class="w-full"
        :disabled="!reglage.modifiable || occupe"
        :aria-describedby="idAide"
        @update:model-value="brouillon = String($event)"
      />
      <template v-if="reglage.type === 'texte'" #hint>
        <span class="text-(length:--fs-14) text-texte-secondaire" aria-live="polite">{{ restants }} caractères restants</span>
      </template>
    </UFormField>

    <p v-if="reglage.type === 'booleen' && erreur" role="alert" class="message-erreur">
      <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
      <span>{{ erreur }}</span>
    </p>

    <p :id="idAide" class="m-0 text-(length:--fs-14) text-texte-secondaire">
      Valeur par défaut : {{ libelleValeurReglage(reglage.defaut) }}.
      <template v-if="reglage.securite">En cas d’incident de lecture, ce réglage se replie sur « {{ repli }} ».</template>
      <template v-else>En cas d’incident de lecture, la valeur par défaut s’applique.</template>
    </p>

    <div v-if="reglage.modifiable" class="flex flex-col gap-2 sm:flex-row">
      <UButton type="submit" size="lg" class="min-h-(--cible-tactile) justify-center" :disabled="!peutEnregistrer">
        Enregistrer
      </UButton>
      <UButton
        v-if="reglage.surcharge"
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-(--cible-tactile) justify-center"
        :disabled="!peutRetablir"
        @click="emit('retablir')"
      >
        Rétablir la valeur par défaut
      </UButton>
    </div>
  </form>
</template>
