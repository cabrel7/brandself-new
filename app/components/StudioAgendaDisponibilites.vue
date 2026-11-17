<script setup lang="ts">
import type { AppliquerJour } from '~/composables/useFeuilleJourDisponibilites'
import type {
  ChampReglageAgenda,
  ErreursDisponibilitesAgenda,
  JourAgendaEdition,
  ReglagesAgendaEdition,
} from '~/composables/useStudioDisponibilites'
import { nomLigneJour, plagesRestantesPourJour, resumeJour } from '~/composables/useStudioDisponibilites'

const props = defineProps<{
  jours: JourAgendaEdition[]
  reglages: ReglagesAgendaEdition
  fuseauItems: Array<{ label: string, value: string }>
  pasItems: Array<{ label: string, value: number }>
  erreurs: ErreursDisponibilitesAgenda
  /** Aucune plage dans la semaine : propose la semaine type. */
  aucunePlage: boolean
  appliquer: AppliquerJour
}>()

const emit = defineEmits<{
  semaineType: []
  modifierReglage: [champ: ChampReglageAgenda, valeur: string | number]
}>()

const numeroEdite = ref<number | null>(null)
const feuilleOuverte = ref(false)
const liste = useTemplateRef<HTMLElement>('liste')
let declencheur: HTMLElement | null = null

const lignes = computed(() => props.jours.map((jour) => {
  const resume = resumeJour(jour.plages)
  const enErreur = jour.plages.some((plage) => Boolean(props.erreurs.plages[plage.cle]))
  return {
    numero: jour.numero,
    libelle: jour.libelle,
    resume,
    ferme: jour.plages.length === 0,
    enErreur,
    nom: nomLigneJour(jour.libelle, jour.plages),
  }
}))

const jourEdite = computed(() => props.jours.find((jour) => jour.numero === numeroEdite.value) ?? null)
const autresJours = computed(() => props.jours
  .filter((jour) => jour.numero !== numeroEdite.value)
  .map(({ numero, libelle }) => ({ numero, libelle })))
const limiteJourEdite = computed(() => (numeroEdite.value === null ? 0 : plagesRestantesPourJour(props.jours, numeroEdite.value)))

function ouvrirFeuille(numero: number, evenement: Event): void {
  declencheur = evenement.currentTarget instanceof HTMLElement ? evenement.currentTarget : null
  numeroEdite.value = numero
  feuilleOuverte.value = true
}

/** La « Semaine type » disparaît une fois appliquée : le focus passe à la première ligne. */
async function choisirSemaineType(): Promise<void> {
  emit('semaineType')
  await nextTick()
  liste.value?.querySelector<HTMLElement>('button')?.focus()
}

/** La feuille rend le focus à la ligne d'origine une fois refermée. */
function rendreLeFocus(): void {
  declencheur?.focus()
}
</script>

<template>
  <section aria-label="Disponibilités hebdomadaires" class="overflow-hidden rounded-(--rayon) border border-bordure bg-surface">
    <div v-if="aucunePlage" class="border-b border-bordure px-4 py-3 md:px-6">
      <UButton
        label="Semaine type : lundi à vendredi, 9h–17h"
        icon="i-ph-calendar-check"
        variant="soft"
        size="lg"
        block
        class="min-h-(--cible-tactile)"
        @click="choisirSemaineType"
      />
    </div>

    <ul ref="liste" class="m-0 list-none p-0">
      <li v-for="ligne in lignes" :key="ligne.numero" class="border-b border-bordure">
        <button
          type="button"
          class="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent-doux active:bg-accent-doux focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent md:px-6"
          :aria-label="ligne.nom"
          :aria-describedby="ligne.enErreur ? `erreur-jour-${ligne.numero}` : undefined"
          @click="ouvrirFeuille(ligne.numero, $event)"
        >
          <span class="w-24 shrink-0 text-base font-semibold text-encre sm:w-32">{{ ligne.libelle }}</span>
          <span
            class="min-w-0 flex-1 text-base"
            :class="ligne.ferme ? 'text-texte-secondaire' : 'text-encre'"
          >{{ ligne.resume }}</span>
          <span
            v-if="ligne.enErreur"
            :id="`erreur-jour-${ligne.numero}`"
            class="flex shrink-0 items-center gap-1 text-(length:--fs-14) font-medium text-erreur"
          >
            <UIcon name="i-ph-warning-circle" class="size-4" aria-hidden="true" />
            À corriger
          </span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0 text-texte-secondaire" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <StudioAgendaFeuilleJour
      v-if="jourEdite"
      v-model:open="feuilleOuverte"
      :jour="jourEdite"
      :autres-jours="autresJours"
      :limite="limiteJourEdite"
      :appliquer="appliquer"
      @fermee="rendreLeFocus"
    />

    <details class="group">
      <summary
        class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-semibold text-encre transition-colors hover:bg-accent-doux active:bg-accent-doux focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent md:px-6 [&::-webkit-details-marker]:hidden"
      >
        Réglages avancés
        <UIcon
          name="i-ph-caret-down"
          class="size-5 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div class="grid gap-4 px-4 pb-5 md:px-6 sm:grid-cols-2 xl:grid-cols-1">
        <UFormField label="Fuseau horaire" name="fuseau">
          <USelect
            :model-value="reglages.fuseau"
            :items="fuseauItems"
            class="w-full"
            @update:model-value="emit('modifierReglage', 'fuseau', String($event))"
          />
        </UFormField>
        <UFormField label="Pas des créneaux" name="pasCreneauMin">
          <USelect
            :model-value="reglages.pasCreneauMin"
            :items="pasItems"
            class="w-full"
            @update:model-value="emit('modifierReglage', 'pasCreneauMin', Number($event))"
          />
        </UFormField>
        <UFormField
          label="Délai minimal avant réservation (heures)"
          name="preavisHeures"
          :error="erreurs.preavisHeures"
        >
          <UInput
            type="number"
            inputmode="numeric"
            min="0"
            :model-value="reglages.preavisHeures"
            class="w-full"
            :aria-invalid="Boolean(erreurs.preavisHeures)"
            @update:model-value="emit('modifierReglage', 'preavisHeures', String($event))"
          />
        </UFormField>
        <UFormField
          label="Réservation possible jusqu’à (jours)"
          name="horizonJours"
          :error="erreurs.horizonJours"
        >
          <UInput
            type="number"
            inputmode="numeric"
            min="1"
            :model-value="reglages.horizonJours"
            class="w-full"
            :aria-invalid="Boolean(erreurs.horizonJours)"
            @update:model-value="emit('modifierReglage', 'horizonJours', String($event))"
          />
        </UFormField>
      </div>
    </details>
  </section>
</template>
