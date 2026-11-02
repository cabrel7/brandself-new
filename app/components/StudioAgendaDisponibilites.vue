<script setup lang="ts">
import type {
  ChampPlageAgenda,
  ChampReglageAgenda,
  ErreursDisponibilitesAgenda,
  JourAgendaEdition,
  ReglagesAgendaEdition,
} from '~/composables/useStudioDisponibilites'

defineProps<{
  jours: JourAgendaEdition[]
  reglages: ReglagesAgendaEdition
  fuseauItems: Array<{ label: string, value: string }>
  pasItems: Array<{ label: string, value: number }>
  erreurs: ErreursDisponibilitesAgenda
}>()

const emit = defineEmits<{
  ajouter: [jourSemaine: number]
  supprimer: [cle: string]
  modifierPlage: [cle: string, champ: ChampPlageAgenda, valeur: string]
  modifierReglage: [champ: ChampReglageAgenda, valeur: string | number]
}>()
</script>

<template>
  <section aria-label="Disponibilités hebdomadaires" class="rounded-(--rayon) border border-bordure bg-surface p-4 md:p-6">
    <div>
      <div v-for="jour in jours" :key="jour.numero" class="border-b border-bordure py-4">
        <div class="flex min-h-(--cible-tactile) items-center justify-between gap-3">
          <h3 class="m-0 text-base font-semibold text-encre">
            {{ jour.libelle }}
          </h3>
        </div>

        <p v-if="jour.plages.length === 0" class="m-0 mt-1 text-(length:--fs-14) text-texte-secondaire">
          Fermé
        </p>

        <div v-else class="mt-2 flex flex-col gap-3">
          <div
            v-for="plage in jour.plages"
            :key="plage.cle"
            class="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_var(--cible-tactile)] items-start gap-2"
          >
            <UFormField
              label="Début"
              :name="`debut-${plage.cle}`"
              :error="erreurs.plages[plage.cle]?.debut"
            >
              <UInput
                :id="`debut-${plage.cle}`"
                type="time"
                :model-value="plage.debut"
                class="w-full"
                :aria-invalid="Boolean(erreurs.plages[plage.cle]?.debut)"
                @update:model-value="emit('modifierPlage', plage.cle, 'debut', String($event))"
              />
            </UFormField>
            <UFormField
              label="Fin"
              :name="`fin-${plage.cle}`"
              :error="erreurs.plages[plage.cle]?.fin"
            >
              <UInput
                :id="`fin-${plage.cle}`"
                type="time"
                :model-value="plage.fin"
                class="w-full"
                :aria-invalid="Boolean(erreurs.plages[plage.cle]?.fin)"
                @update:model-value="emit('modifierPlage', plage.cle, 'fin', String($event))"
              />
            </UFormField>
            <UButton
              icon="i-ph-x"
              variant="ghost"
              color="neutral"
              size="lg"
              class="mt-7 size-(--cible-tactile) justify-center p-0"
              :aria-label="`Supprimer la plage de ${plage.debut} à ${plage.fin}`"
              @click="emit('supprimer', plage.cle)"
            />
          </div>
        </div>

        <UButton
          label="Ajouter une plage"
          icon="i-ph-plus"
          variant="ghost"
          color="neutral"
          size="sm"
          class="mt-2 -ml-2 min-h-(--cible-tactile) text-accent-texte"
          :aria-label="`Ajouter une plage le ${jour.libelle.toLowerCase()}`"
          @click="emit('ajouter', jour.numero)"
        />
      </div>
    </div>

    <details class="group border-b border-bordure">
      <summary
        class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 py-2 font-semibold text-encre [&::-webkit-details-marker]:hidden"
      >
        Réglages avancés
        <UIcon
          name="i-ph-caret-down"
          class="size-5 shrink-0 transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>
      <div class="grid gap-4 pb-5 sm:grid-cols-2 xl:grid-cols-1">
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
          label="Préavis (heures)"
          name="preavisHeures"
          :error="erreurs.preavisHeures"
          help="Délai minimal avant une réservation."
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
          label="Horizon (jours)"
          name="horizonJours"
          :error="erreurs.horizonJours"
          help="Période ouverte à la réservation."
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
