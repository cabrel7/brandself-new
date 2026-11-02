<script setup lang="ts">
import type { ErreursIndisponibiliteAgenda, IndisponibiliteAgendaVue } from '~/composables/useStudioDisponibilites'

const props = defineProps<{
  items: IndisponibiliteAgendaVue[]
  date: string
  raison: string
  raisonMax: number
  erreurs: ErreursIndisponibiliteAgenda
  ajoutEnCours: boolean
  suppressionEnCours: string | null
  suppressionAConfirmer: string | null
}>()

const emit = defineEmits<{
  modifier: [champ: 'date' | 'raison', valeur: string]
  ajouter: []
  demanderSuppression: [id: string]
  annulerSuppression: []
  supprimer: [id: string]
}>()

const racine = useTemplateRef<HTMLElement>('racine')

watch(() => props.suppressionAConfirmer, async (id) => {
  if (!id) return
  await nextTick()
  racine.value?.querySelector<HTMLElement>('[data-confirmer-suppression]')?.focus()
})
</script>

<template>
  <section ref="racine" aria-label="Indisponibilités" class="rounded-(--rayon) border border-bordure bg-surface p-4 md:p-6">
    <form class="flex flex-col gap-4" novalidate @submit.prevent="emit('ajouter')">
      <UFormField label="Date" name="dateIndisponibilite" required :error="erreurs.date">
        <UInput
          type="date"
          :model-value="date"
          class="w-full"
          :aria-invalid="Boolean(erreurs.date)"
          @update:model-value="emit('modifier', 'date', String($event))"
        />
      </UFormField>
      <UFormField label="Raison (facultative)" name="raisonIndisponibilite" :error="erreurs.raison">
        <UInput
          :model-value="raison"
          :maxlength="raisonMax"
          placeholder="Congé, déplacement…"
          class="w-full"
          :aria-invalid="Boolean(erreurs.raison)"
          @update:model-value="emit('modifier', 'raison', String($event))"
        />
      </UFormField>
      <UButton
        type="submit"
        label="Ajouter une indisponibilité"
        icon="i-ph-plus"
        variant="outline"
        size="lg"
        block
        class="min-h-(--cible-tactile)"
        :loading="ajoutEnCours"
        :disabled="ajoutEnCours || !date"
      />
    </form>

    <UEmpty
      v-if="items.length === 0"
      class="mt-5"
      icon="i-ph-calendar-x"
      title="Aucune date fermée"
      description="Les disponibilités hebdomadaires s’appliquent sans exception."
      :ui="{ root: 'py-6', title: 'text-base' }"
    />

    <ul v-else class="m-0 mt-5 list-none border-t border-bordure p-0">
      <li v-for="item in items" :key="item.id" class="border-b border-bordure py-3">
        <div
          v-if="suppressionAConfirmer === item.id"
          role="group"
          aria-live="polite"
          :aria-labelledby="`confirmer-indisponibilite-${item.id}`"
        >
          <p :id="`confirmer-indisponibilite-${item.id}`" class="m-0 text-base font-semibold text-encre">
            Supprimer cette indisponibilité ?
          </p>
          <p class="m-0 mt-1 text-(length:--fs-14) text-texte-secondaire">
            Les créneaux habituels seront de nouveau proposés ce jour-là.
          </p>
          <div class="mt-3 grid grid-cols-2 gap-2">
            <UButton
              label="Supprimer"
              data-confirmer-suppression
              color="error"
              size="lg"
              class="min-h-(--cible-tactile) justify-center"
              @click="emit('supprimer', item.id)"
            />
            <UButton
              label="Garder"
              color="neutral"
              variant="outline"
              size="lg"
              class="min-h-(--cible-tactile) justify-center"
              @click="emit('annulerSuppression')"
            />
          </div>
        </div>

        <div v-else class="flex min-h-(--cible-tactile) items-center justify-between gap-3">
          <div class="min-w-0">
            <p class="m-0 text-base font-semibold text-encre first-letter:uppercase">
              {{ item.dateLibelle }}
            </p>
            <p v-if="item.raison" class="m-0 text-(length:--fs-14) text-texte-secondaire">
              {{ item.raison }}
            </p>
          </div>
          <UButton
            icon="i-ph-x"
            color="neutral"
            variant="ghost"
            size="lg"
            class="size-(--cible-tactile) shrink-0 justify-center p-0"
            :loading="suppressionEnCours === item.id"
            :disabled="Boolean(suppressionEnCours)"
            :aria-label="`Supprimer l’indisponibilité du ${item.dateLibelle}`"
            @click="emit('demanderSuppression', item.id)"
          />
        </div>
      </li>
    </ul>
  </section>
</template>
