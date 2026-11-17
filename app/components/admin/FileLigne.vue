<script setup lang="ts">
import { SUPERVISION_ECHECS_LISTES_MAX } from '#shared/jobs'
import type { EtatFileDto, JobEchecDto } from '#shared/schemas/admin-a4'
import { formaterDateHeureAdmin, formaterNombre } from '~/utils/admin-paiements'
import { LIBELLES_FILES_SUPERVISION, MESSAGE_FILE_NON_RELANCABLE, fileEnAlerte } from '~/utils/admin-supervision'
import { accorder } from '~/utils/pluriel'

// Une file de tâches : compteurs, alerte si le seuil d'échecs est atteint, liste des échecs récents (code réduit,
// jamais le contenu de la tâche) avec « Relancer », et « Purger » pour la file entière. La file des codes de connexion
// n'est jamais relançable : le bouton est désactivé ET l'explication est écrite à l'écran (pas seulement en infobulle).
const props = defineProps<{ file: EtatFileDto, seuil: number }>()
const emit = defineEmits<{ relancer: [job: JobEchecDto], purger: [] }>()

const nom = computed(() => LIBELLES_FILES_SUPERVISION[props.file.file])
const enAlerte = computed(() => fileEnAlerte(props.file.echecs15Min, props.seuil))

const compteurs = computed(() => [
  { libelle: 'En attente', valeur: props.file.compteurs.attente },
  { libelle: 'En cours', valeur: props.file.compteurs.actifs },
  { libelle: 'Différées', valeur: props.file.compteurs.differes },
  { libelle: 'En échec', valeur: props.file.compteurs.echoues },
  { libelle: 'Terminées', valeur: props.file.compteurs.termines },
])

const resteNonAffiche = computed(() => props.file.compteurs.echoues > props.file.echecs.length)
const resume = computed(() => {
  const nombre = props.file.compteurs.echoues
  return nombre === 0 ? 'Aucun échec' : `${formaterNombre(nombre)} ${accorder(nombre, 'échec', 'échecs')}`
})
</script>

<template>
  <div class="flex flex-col gap-3 py-4">
    <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <h3 class="m-0 text-base font-semibold text-encre">
        {{ nom }}
      </h3>
      <UBadge v-if="enAlerte" color="error" variant="subtle" icon="i-ph-warning-circle" size="lg">
        {{ file.echecs15Min }} {{ accorder(file.echecs15Min, 'échec', 'échecs') }} en 15 min
      </UBadge>
    </div>

    <dl class="m-0 grid grid-cols-3 gap-3 sm:grid-cols-5">
      <div v-for="compteur in compteurs" :key="compteur.libelle" class="flex flex-col">
        <dt class="text-(length:--fs-14) text-texte-secondaire">{{ compteur.libelle }}</dt>
        <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(compteur.valeur) }}</dd>
      </div>
    </dl>

    <details v-if="file.compteurs.echoues > 0" class="group">
      <summary class="flex min-h-(--cible-tactile) cursor-pointer items-center gap-2 font-medium text-encre">
        <UIcon name="i-ph-caret-right" class="size-5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
        {{ resume }}
      </summary>

      <div class="flex flex-col gap-3 pt-2">
        <p v-if="!file.relancable" class="m-0 flex items-start gap-2 text-base text-texte-secondaire">
          <UIcon name="i-ph-info" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>{{ MESSAGE_FILE_NON_RELANCABLE }}</span>
        </p>

        <ul v-if="file.echecs.length > 0" class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
          <li v-for="job in file.echecs" :key="job.id" class="flex flex-col gap-2 py-3 md:flex-row md:items-center md:gap-6">
            <div class="flex min-w-0 flex-1 flex-col gap-0.5">
              <span class="truncate font-medium text-encre" :title="job.nom">{{ job.nom }}</span>
              <span class="text-(length:--fs-14) text-texte-secondaire">
                {{ job.echecLe ? formaterDateHeureAdmin(job.echecLe) : 'Date inconnue' }}
                · {{ job.tentatives }} {{ accorder(job.tentatives, 'tentative', 'tentatives') }}
                <template v-if="job.motif"> · <code>{{ job.motif }}</code></template>
              </span>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              size="lg"
              icon="i-ph-arrow-counter-clockwise"
              class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
              :disabled="!file.relancable"
              :aria-label="`Relancer la tâche ${job.nom}`"
              @click="emit('relancer', job)"
            >
              Relancer
            </UButton>
          </li>
        </ul>

        <p v-if="resteNonAffiche" class="m-0 text-(length:--fs-14) text-texte-secondaire">
          Les {{ SUPERVISION_ECHECS_LISTES_MAX }} échecs les plus récents sont affichés.
        </p>

        <UButton
          color="error"
          variant="outline"
          size="lg"
          icon="i-ph-trash"
          class="min-h-(--cible-tactile) justify-center self-start max-sm:w-full"
          @click="emit('purger')"
        >
          Purger les échecs de cette file
        </UButton>
      </div>
    </details>
    <p v-else class="m-0 text-base text-texte-secondaire">
      Aucun échec.
    </p>
  </div>
</template>
