<script setup lang="ts">
import type { AppliquerJour } from '~/composables/useFeuilleJourDisponibilites'
import type { JourAgendaEdition } from '~/composables/useStudioDisponibilites'

const props = defineProps<{
  jour: JourAgendaEdition
  /** Les six autres jours, cibles possibles de « Appliquer aussi à ». */
  autresJours: Array<{ numero: number, libelle: string }>
  /** Nombre de plages encore ajoutables à ce jour (limite globale de la semaine). */
  limite: number
  appliquer: AppliquerJour
}>()

const emit = defineEmits<{ fermee: [] }>()

const ouverte = defineModel<boolean>('open', { default: false })

const {
  saisies, cibles, erreurs, erreurGlobale, confirmationAbandon, annonce, ouvert, peutAjouter, limiteMax,
  ajouter, supprimer, modifier, basculerCible, terminer, demanderFermeture,
} = useFeuilleJour({
  jour: () => props.jour,
  ouverte: () => ouverte.value,
  limite: () => props.limite,
  appliquer: (numero, plages, ciblesChoisies) => props.appliquer(numero, plages, ciblesChoisies),
})

const corps = useTemplateRef<HTMLElement>('corps')
const boutonAppliquer = useTemplateRef<{ $el: HTMLElement }>('boutonAppliquer')

const jourMinuscule = computed(() => props.jour.libelle.toLowerCase())
const noteCibles = computed(() => (ouvert.value
  ? 'Les heures de ces jours seront remplacées.'
  : 'Ces jours seront fermés.'))

function champ(cle: string): HTMLElement | null {
  return corps.value?.querySelector<HTMLElement>(`[id="debut-${cle}"]`) ?? null
}

async function validerFeuille(): Promise<void> {
  if (terminer()) {
    ouverte.value = false
    return
  }
  await nextTick()
  corps.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

/** Échap, clic hors de la feuille, « Annuler » : ferme seulement si rien n'a changé. */
async function fermer(): Promise<void> {
  if (demanderFermeture()) {
    ouverte.value = false
    return
  }
  await nextTick()
  boutonAppliquer.value?.$el.focus()
}

function abandonner(): void {
  ouverte.value = false
}

/** Après une suppression, le focus ne reste jamais dans le vide : plage voisine, sinon l'interrupteur. */
async function retirer(cle: string): Promise<void> {
  const voisine = supprimer(cle)
  await nextTick()
  const cible = voisine === null
    ? corps.value?.querySelector<HTMLElement>('[role="switch"]')
    : champ(voisine)
  cible?.focus()
}
</script>

<template>
  <UModal
    v-model:open="ouverte"
    :title="jour.libelle"
    :close="false"
    :dismissible="false"
    @close:prevent="fermer"
    @after:leave="emit('fermee')"
  >
    <template #body>
      <div ref="corps" class="flex flex-col gap-5">
        <p class="sr-only" role="status" aria-live="polite">{{ annonce }}</p>

        <USwitch v-model="ouvert" label="Jour ouvert" />

        <div v-if="ouvert" class="flex flex-col gap-3">
          <ul class="m-0 flex list-none flex-col gap-4 p-0">
            <li v-for="(plage, index) in saisies" :key="plage.cle">
              <div class="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 min-[400px]:items-center">
                <div class="grid grid-cols-1 gap-2 min-[400px]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] min-[400px]:items-center">
                  <div class="flex min-w-0 flex-col gap-1">
                    <label
                      :for="`debut-${plage.cle}`"
                      class="text-(length:--fs-14) font-medium text-texte-secondaire min-[400px]:sr-only"
                    >Début<span class="sr-only">, plage {{ index + 1 }} ({{ jourMinuscule }})</span></label>
                    <UInput
                      :id="`debut-${plage.cle}`"
                      type="time"
                      :model-value="plage.debut"
                      :color="erreurs[plage.cle]?.debut ? 'error' : undefined"
                      :ui="{ base: 'min-h-(--cible-tactile) px-3' }"
                      :aria-invalid="Boolean(erreurs[plage.cle]?.debut)"
                      :aria-describedby="erreurs[plage.cle]?.debut ? `erreur-debut-${plage.cle}` : undefined"
                      @update:model-value="modifier(plage.cle, 'debut', String($event))"
                    />
                  </div>
                  <span aria-hidden="true" class="hidden text-texte-secondaire min-[400px]:inline">à</span>
                  <div class="flex min-w-0 flex-col gap-1">
                    <label
                      :for="`fin-${plage.cle}`"
                      class="text-(length:--fs-14) font-medium text-texte-secondaire min-[400px]:sr-only"
                    >Fin<span class="sr-only">, plage {{ index + 1 }} ({{ jourMinuscule }})</span></label>
                    <UInput
                      :id="`fin-${plage.cle}`"
                      type="time"
                      :model-value="plage.fin"
                      :color="erreurs[plage.cle]?.fin ? 'error' : undefined"
                      :ui="{ base: 'min-h-(--cible-tactile) px-3' }"
                      :aria-invalid="Boolean(erreurs[plage.cle]?.fin)"
                      :aria-describedby="erreurs[plage.cle]?.fin ? `erreur-fin-${plage.cle}` : undefined"
                      @update:model-value="modifier(plage.cle, 'fin', String($event))"
                    />
                  </div>
                </div>
                <UButton
                  icon="i-ph-x"
                  variant="ghost"
                  color="neutral"
                  size="lg"
                  class="size-(--cible-tactile) shrink-0 justify-center p-0"
                  :aria-label="`Supprimer la plage ${index + 1} (${jourMinuscule}) : de ${plage.debut} à ${plage.fin}`"
                  @click="retirer(plage.cle)"
                />
              </div>
              <div v-if="erreurs[plage.cle]?.debut || erreurs[plage.cle]?.fin" class="mt-1 flex flex-col gap-1">
                <p
                  v-for="champErreur in (['debut', 'fin'] as const)"
                  v-show="erreurs[plage.cle]?.[champErreur]"
                  :id="`erreur-${champErreur}-${plage.cle}`"
                  :key="champErreur"
                  class="m-0 flex items-start gap-2 text-(length:--fs-14) text-erreur"
                >
                  <UIcon name="i-ph-warning-circle" class="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>{{ erreurs[plage.cle]?.[champErreur] }}</span>
                </p>
              </div>
            </li>
          </ul>

          <UButton
            label="Ajouter une plage"
            icon="i-ph-plus"
            variant="soft"
            color="neutral"
            size="lg"
            class="w-full justify-center sm:w-auto sm:self-start"
            :disabled="!peutAjouter"
            :aria-describedby="peutAjouter ? undefined : 'limite-plages'"
            @click="ajouter"
          />
          <p v-if="!peutAjouter" id="limite-plages" class="m-0 text-(length:--fs-14) text-texte-secondaire">
            Limite atteinte : {{ limiteMax }} plages par semaine.
          </p>
        </div>
        <p v-else class="m-0 text-base text-texte-secondaire">
          Ce jour est fermé.
        </p>

        <div class="border-t border-bordure pt-4">
          <fieldset class="m-0 min-w-0 border-0 p-0" :aria-describedby="cibles.length > 0 ? 'note-cibles' : undefined">
            <legend class="mb-2 p-0 text-(length:--fs-14) font-medium text-encre">
              Appliquer aussi à :
            </legend>
            <div class="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <button
                v-for="autre in autresJours"
                :key="autre.numero"
                type="button"
                class="inline-flex min-h-(--cible-tactile) min-w-(--cible-tactile) items-center justify-center gap-1 rounded-full border px-2 text-(length:--fs-14) font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                :class="cibles.includes(autre.numero)
                  ? 'border-accent bg-accent text-sur-accent'
                  : 'border-bordure bg-champ text-encre hover:border-accent'"
                :aria-pressed="cibles.includes(autre.numero)"
                :aria-label="autre.libelle"
                @click="basculerCible(autre.numero)"
              >
                <UIcon v-if="cibles.includes(autre.numero)" name="i-ph-check" class="size-4 shrink-0" aria-hidden="true" />
                {{ autre.libelle.slice(0, 3) }}
              </button>
            </div>
            <p v-if="cibles.length > 0" id="note-cibles" class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
              {{ noteCibles }}
            </p>
          </fieldset>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full flex-col gap-3">
        <div aria-live="polite" role="status">
          <p v-if="erreurGlobale" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ erreurGlobale }}</span>
          </p>
          <p v-else-if="confirmationAbandon" class="m-0 flex items-start gap-2 text-base font-semibold text-encre">
            <UIcon name="i-ph-warning-circle" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>Vous avez des modifications non appliquées.</span>
          </p>
        </div>
        <div class="flex flex-col gap-2 sm:flex-row-reverse">
          <UButton
            ref="boutonAppliquer"
            label="Appliquer"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            @click="validerFeuille"
          />
          <UButton
            v-if="confirmationAbandon"
            label="Abandonner"
            variant="outline"
            color="neutral"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            @click="abandonner"
          />
          <UButton
            v-else
            label="Annuler"
            variant="outline"
            color="neutral"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            @click="fermer"
          />
        </div>
      </div>
    </template>
  </UModal>
</template>
