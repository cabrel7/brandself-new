<script setup lang="ts">
import type { PropositionOnboardingDTO } from '#shared/dto'
import { ACCROCHES_PROPOSEES, SERVICES_PROPOSES } from '#shared/ia'
import { BIO_MAX } from '#shared/vitrine'
import type { EtatProposition } from '~/composables/useOnboarding'

defineProps<{
  etat: EtatProposition
  proposition: PropositionOnboardingDTO | null
  /** Plus de 10 secondes d'attente : le message change. */
  attenteLongue: boolean
  /** Message de l'état `erreur` (suivi en échec, limite de demandes, réseau). */
  messageErreur: string
  erreurPresentation?: string
  desactive: boolean
}>()

const emit = defineEmits<{ reessayer: [] }>()

const accrocheIndex = defineModel<number>('accrocheIndex', { required: true })
const presentation = defineModel<string>('presentation', { required: true })
const servicesActifs = defineModel<boolean[]>('servicesActifs', { required: true })

const nomGroupe = useId()
const racine = useTemplateRef<HTMLElement>('racine')

function basculerService(index: number, actif: boolean): void {
  servicesActifs.value = servicesActifs.value.map((valeur, i) => (i === index ? actif : valeur))
}

function focusErreur(): void {
  racine.value?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
}

defineExpose({ focusErreur })
</script>

<template>
  <div ref="racine">
    <div v-if="etat === 'attente'" class="flex flex-col gap-6" aria-busy="true">
      <p role="status" aria-live="polite" class="m-0 font-semibold text-encre">
        {{ attenteLongue ? 'Encore un instant, nous relisons chaque phrase.' : 'Nous rédigeons votre proposition. Cela prend quelques secondes.' }}
      </p>
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton v-for="n in ACCROCHES_PROPOSEES" :key="n" class="h-20 w-full" />
      </div>
      <USkeleton class="h-36 w-full" aria-hidden="true" />
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton v-for="n in SERVICES_PROPOSES" :key="n" class="h-12 w-full" />
      </div>
    </div>

    <div v-else-if="etat === 'erreur'" class="flex flex-col items-start gap-4">
      <p role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ messageErreur }}</span>
      </p>
      <UButton label="Réessayer" variant="outline" color="neutral" size="lg" @click="emit('reessayer')" />
    </div>

    <div v-else-if="proposition" class="flex flex-col gap-8">
      <fieldset class="m-0 flex min-w-0 flex-col gap-3 border-0 p-0">
        <legend class="mb-3 p-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold text-encre">
          Votre accroche
        </legend>
        <label
          v-for="(accroche, index) in proposition.accroches"
          :key="accroche"
          class="flex min-h-(--cible-tactile) cursor-pointer items-start gap-3 rounded-(--rayon) border border-bordure bg-champ p-4 transition-colors hover:border-texte-secondaire has-checked:border-accent has-checked:bg-accent-doux has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent has-disabled:cursor-not-allowed has-disabled:opacity-70"
        >
          <input
            v-model="accrocheIndex"
            type="radio"
            :name="nomGroupe"
            :value="index"
            :disabled="desactive"
            class="mt-1 size-5 shrink-0 cursor-pointer accent-accent"
          >
          <span class="font-(family-name:--font-titre) text-(length:--fs-20) leading-snug font-bold text-encre">{{ accroche }}</span>
        </label>
      </fieldset>

      <UFormField label="Votre présentation" name="presentation" :error="erreurPresentation">
        <UTextarea
          v-model="presentation"
          :rows="8"
          :maxlength="BIO_MAX"
          :disabled="desactive"
          class="w-full"
        />
        <template #help>
          Modifiable à tout moment. Rien n’est publié sans votre accord.
        </template>
      </UFormField>

      <section aria-labelledby="titre-services" class="flex flex-col gap-3">
        <h2 id="titre-services" class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold text-encre">
          Services proposés
        </h2>
        <ul class="m-0 flex list-none flex-col border-t border-bordure p-0">
          <li
            v-for="(service, index) in proposition.services"
            :key="service.titre"
            class="flex min-h-(--cible-tactile) items-center justify-between gap-4 border-b border-bordure py-3"
          >
            <span class="flex min-w-0 flex-col gap-1">
              <span class="font-semibold wrap-break-word text-encre">{{ service.titre }}</span>
              <span class="text-(length:--fs-14) text-texte-secondaire">{{ metaServicePropose(service) }}</span>
            </span>
            <USwitch
              :model-value="servicesActifs[index] ?? false"
              :disabled="desactive"
              :aria-label="`Proposer « ${service.titre} » sur votre vitrine`"
              class="min-w-(--cible-tactile) shrink-0 justify-center"
              @update:model-value="basculerService(index, $event)"
            />
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
