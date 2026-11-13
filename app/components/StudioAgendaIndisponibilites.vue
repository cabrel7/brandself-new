<script setup lang="ts">
import type {
  ChampIndisponibilite,
  ErreursIndisponibiliteAgenda,
  IndisponibiliteAgendaVue,
  MessageIndisponibilite,
  ModeIndisponibilite,
} from '~/composables/useStudioDisponibilites'

const MODES: ReadonlyArray<{ valeur: ModeIndisponibilite, libelle: string }> = [
  { valeur: 'date', libelle: 'Une date' },
  { valeur: 'plage', libelle: 'Plusieurs jours' },
]
const LIEN_AGENDA = '/studio/agenda'

const props = defineProps<{
  aVenir: IndisponibiliteAgendaVue[]
  passees: IndisponibiliteAgendaVue[]
  mode: ModeIndisponibilite
  date: string
  debut: string
  fin: string
  dateMin: string
  /** « 5 jours » en direct ; vide tant que la plage est illisible. */
  libelleJours: string
  /** Limite de jours dépassée : affichée en direct sous « Au » (sans voler le focus). */
  erreurLongueur?: string
  ajoutPossible: boolean
  raison: string
  raisonMax: number
  erreurs: ErreursIndisponibiliteAgenda
  /** Retour des indisponibilités uniquement (jamais celui des heures de la semaine). */
  message: MessageIndisponibilite | null
  ajoutEnCours: boolean
  suppressionEnCours: string | null
  suppressionAConfirmer: string | null
}>()

const emit = defineEmits<{
  modifier: [champ: ChampIndisponibilite, valeur: string]
  changerMode: [mode: ModeIndisponibilite]
  ajouter: []
  demanderSuppression: [id: string]
  annulerSuppression: []
  supprimer: [id: string]
}>()

const racine = useTemplateRef<HTMLElement>('racine')
const titre = useTemplateRef<HTMLElement>('titre')

const retour = computed(() => (props.message && props.message.type !== 'erreur' ? props.message : null))
const echec = computed(() => (props.message?.type === 'erreur' ? props.message.texte : ''))
const erreurFin = computed(() => props.erreurs.fin ?? props.erreurLongueur)
const total = computed(() => props.aVenir.length + props.passees.length)

watch(() => props.suppressionAConfirmer, async (id) => {
  if (!id) return
  await nextTick()
  racine.value?.querySelector<HTMLElement>('[data-confirmer-suppression]')?.focus()
})

/** Une ligne disparaît : le bouton qui avait le focus n'existe plus, on le ramène au titre de la zone. */
watch(total, (nouveau, ancien) => {
  if (nouveau < ancien && racine.value?.contains(document.activeElement) !== true) titre.value?.focus()
})

/** Erreur de saisie après un envoi : le focus va sur le champ fautif (le premier dans l'ordre de lecture). */
watch(() => [props.erreurs.date, props.erreurs.debut, props.erreurs.fin, props.erreurs.raison], async (erreurs) => {
  if (!erreurs.some(Boolean)) return
  await nextTick()
  racine.value?.querySelector<HTMLElement>('form input[aria-invalid="true"]')?.focus()
})

/** Ajout réussi : le formulaire est vidé, le focus revient à son premier champ pour en saisir un autre ; le retour est lu par la région live. */
watch(() => props.ajoutEnCours, async (encours, avant) => {
  if (!avant || encours || props.message?.type === 'erreur' || Object.values(props.erreurs).some(Boolean)) return
  await nextTick()
  racine.value?.querySelector<HTMLElement>('form input')?.focus()
})
</script>

<template>
  <section ref="racine" aria-labelledby="titre-indisponibilites" class="flex flex-col gap-4">
    <div class="flex flex-col gap-1">
      <h2
        id="titre-indisponibilites"
        ref="titre"
        tabindex="-1"
        class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre outline-none"
      >
        Indisponibilités
      </h2>
      <p class="m-0 text-base text-texte-secondaire">
        Les dates où vous êtes absent (congés, déplacements) : personne ne peut réserver ces jours-là.
      </p>
    </div>

    <div class="overflow-hidden rounded-(--rayon) border border-bordure bg-surface">
      <form class="flex flex-col gap-4 p-4 md:p-6" novalidate @submit.prevent="emit('ajouter')">
        <div role="group" aria-label="Type d’indisponibilité" class="grid grid-cols-2 gap-2">
          <button
            v-for="option in MODES"
            :key="option.valeur"
            type="button"
            class="inline-flex min-h-(--cible-tactile) items-center justify-center gap-1 rounded-(--rayon) border px-3 text-base font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            :class="mode === option.valeur
              ? 'border-accent bg-accent text-sur-accent'
              : 'border-bordure bg-champ text-encre hover:border-accent'"
            :aria-pressed="mode === option.valeur"
            @click="emit('changerMode', option.valeur)"
          >
            <UIcon v-if="mode === option.valeur" name="i-ph-check" class="size-4 shrink-0" aria-hidden="true" />
            {{ option.libelle }}
          </button>
        </div>

        <UFormField v-if="mode === 'date'" label="Date" name="dateIndisponibilite" required :error="erreurs.date">
          <UInput
            type="date"
            :model-value="date"
            :min="dateMin"
            class="w-full"
            :aria-invalid="Boolean(erreurs.date)"
            @update:model-value="emit('modifier', 'date', String($event))"
          />
        </UFormField>
        <template v-else>
          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField label="Du" name="debutIndisponibilite" required :error="erreurs.debut">
              <UInput
                type="date"
                :model-value="debut"
                :min="dateMin"
                class="w-full"
                :aria-invalid="Boolean(erreurs.debut)"
                @update:model-value="emit('modifier', 'debut', String($event))"
              />
            </UFormField>
            <UFormField label="Au" name="finIndisponibilite" required :error="erreurFin">
              <UInput
                type="date"
                :model-value="fin"
                :min="debut || dateMin"
                class="w-full"
                :aria-invalid="Boolean(erreurFin)"
                @update:model-value="emit('modifier', 'fin', String($event))"
              />
            </UFormField>
          </div>
          <p v-if="libelleJours" class="m-0 text-base font-semibold text-encre">
            {{ libelleJours }}
          </p>
        </template>
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
        <StudioBoutonAjouter
          type="submit"
          label="Ajouter"
          aria-label="Ajouter une indisponibilité"
          class="w-full md:w-auto md:self-end"
          :loading="ajoutEnCours"
          :disabled="ajoutEnCours || !ajoutPossible"
        />

        <!-- Retour propre à cette zone : conteneurs toujours dans le DOM, contenu changeant. -->
        <div role="status" aria-live="polite" class="empty:hidden">
          <div
            v-if="retour?.type === 'avertissement'"
            class="flex flex-col gap-2 rounded-(--rayon) border border-accent bg-accent-doux p-3"
          >
            <p class="m-0 flex items-start gap-2 text-base font-semibold text-encre">
              <UIcon name="i-ph-warning" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{{ retour.texte }}</span>
            </p>
            <NuxtLink
              :to="LIEN_AGENDA"
              class="inline-flex min-h-(--cible-tactile) items-center self-start text-base font-semibold text-accent-texte underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Voir l’agenda
            </NuxtLink>
          </div>
          <p v-else-if="retour" class="m-0 flex items-start gap-2 text-base font-semibold text-encre">
            <UIcon
              :name="retour.type === 'info' ? 'i-ph-info' : 'i-ph-check-circle'"
              class="mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
            <span>{{ retour.texte }}</span>
          </p>
        </div>
        <div role="alert" class="empty:hidden">
          <p v-if="echec" class="m-0 flex items-start gap-2 text-base font-semibold text-erreur">
            <UIcon name="i-ph-warning-circle" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>{{ echec }}</span>
          </p>
        </div>
      </form>

      <UEmpty
        v-if="aVenir.length === 0"
        class="border-t border-bordure"
        icon="i-ph-calendar-x"
        title="Aucune date fermée"
        description="Indiquez ci-dessus vos congés ou déplacements. Sinon, vos heures de la semaine s’appliquent sans exception."
        :ui="{ root: 'py-6', title: 'text-base' }"
      />

      <ul v-else class="m-0 list-none border-t border-bordure p-0">
        <li v-for="item in aVenir" :key="item.id" class="border-b border-bordure px-4 py-3 last:border-b-0 md:px-6">
          <div
            v-if="suppressionAConfirmer === item.id"
            role="group"
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
              <p v-if="item.raison" class="m-0 text-(length:--fs-14) break-words text-texte-secondaire">
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

      <details v-if="passees.length > 0" class="group border-t border-bordure">
        <summary
          class="flex min-h-(--cible-tactile) cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-base font-semibold text-texte-secondaire transition-colors hover:bg-accent-doux active:bg-accent-doux focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent md:px-6 [&::-webkit-details-marker]:hidden"
        >
          <span>Dates passées ({{ passees.length }})</span>
          <UIcon
            name="i-ph-caret-down"
            class="size-5 shrink-0 transition-transform group-open:rotate-180"
            aria-hidden="true"
          />
        </summary>
        <ul class="m-0 list-none border-t border-bordure p-0">
          <li v-for="item in passees" :key="item.id" class="border-b border-bordure px-4 py-3 last:border-b-0 md:px-6">
            <div
              v-if="suppressionAConfirmer === item.id"
              role="group"
              :aria-labelledby="`confirmer-indisponibilite-${item.id}`"
            >
              <p :id="`confirmer-indisponibilite-${item.id}`" class="m-0 text-base font-semibold text-encre">
                Supprimer cette indisponibilité ?
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
              <div class="min-w-0 text-texte-secondaire">
                <p class="m-0 text-base first-letter:uppercase">
                  {{ item.dateLibelle }}
                </p>
                <p v-if="item.raison" class="m-0 text-(length:--fs-14) break-words">
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
      </details>
    </div>
  </section>
</template>
