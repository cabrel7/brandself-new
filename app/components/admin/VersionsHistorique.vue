<script setup lang="ts">
import type { VersionDto } from '#shared/schemas/admin-versions'
import { formaterDateHeureAdmin } from '~/utils/admin-paiements'
import {
  actionsVersion,
  couleurStatutVersion,
  DEFINITIONS_ACTION_VERSION,
  libelleCleVersion,
  libelleStatutVersion,
  lignesValeursVersion,
} from '~/utils/admin-versions'
import type { ActionVersion } from '~/utils/admin-versions'

// Historique d'un type de version, du plus récent au plus ancien, en lignes empilées (lisible à 390 px). Les boutons
// sont toujours visibles et font 44 px de haut ; aucune écriture ici : le parent ouvre le panneau demandé.
defineProps<{
  versions: VersionDto[]
  /** Vrai quand l'historique mêle plusieurs clés (frais, moyens) : chaque ligne nomme la sienne. */
  afficherCle: boolean
}>()
const emit = defineEmits<{
  agir: [version: VersionDto, action: ActionVersion]
  nouvelle: [version: VersionDto]
}>()

function dateEffet(version: VersionDto): string | null {
  if (version.type === 'prompts' || version.effectiveA === null) return null
  const date = formaterDateHeureAdmin(version.effectiveA)
  return version.statut === 'programmee' ? `Prend effet le ${date}` : `Effet : ${date}`
}
</script>

<template>
  <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
    <li v-for="version in versions" :key="version.id" class="flex flex-col gap-3 px-1 py-4">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span class="font-semibold text-encre">
          Version {{ version.numero }}<template v-if="afficherCle"> · {{ libelleCleVersion(version.cle) }}</template>
        </span>
        <UBadge :color="couleurStatutVersion(version.statut)" variant="subtle" size="lg">{{ libelleStatutVersion(version.statut) }}</UBadge>
        <UBadge v-if="version.type === 'prix' && version.statut === 'active'" color="neutral" variant="outline" size="lg">
          {{ version.valideeLe ? 'Prix validés' : 'Prix non validés' }}
        </UBadge>
      </div>

      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
        <template v-if="dateEffet(version)">{{ dateEffet(version) }} · </template>Créée le {{ formaterDateHeureAdmin(version.creeLe) }}
      </p>
      <p v-if="version.motif" class="m-0 text-base text-encre">{{ version.motif }}</p>

      <details class="text-base">
        <summary class="min-h-(--cible-tactile) cursor-pointer py-2 text-texte-secondaire">Voir les valeurs</summary>
        <dl class="m-0 flex flex-col divide-y divide-bordure">
          <div v-for="ligne in lignesValeursVersion(version)" :key="ligne.libelle" class="flex items-baseline justify-between gap-4 py-2">
            <dt class="text-texte-secondaire">{{ ligne.libelle }}</dt>
            <dd class="m-0 text-right text-encre">{{ ligne.valeur }}</dd>
          </div>
        </dl>
      </details>

      <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <UButton
          v-for="action in actionsVersion(version)"
          :key="action"
          :color="action === 'retour' ? 'neutral' : 'primary'"
          :variant="action === 'retour' ? 'outline' : 'solid'"
          size="lg"
          :icon="DEFINITIONS_ACTION_VERSION[action].icone"
          class="min-h-(--cible-tactile) justify-center"
          :aria-label="`${DEFINITIONS_ACTION_VERSION[action].libelle}, version ${version.numero}`"
          @click="emit('agir', version, action)"
        >
          {{ DEFINITIONS_ACTION_VERSION[action].libelle }}
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-ph-copy"
          class="min-h-(--cible-tactile) justify-center"
          :aria-label="`Créer une version à partir de la version ${version.numero}`"
          @click="emit('nouvelle', version)"
        >
          Nouvelle version à partir de celle-ci
        </UButton>
      </div>
    </li>
  </ul>
</template>
