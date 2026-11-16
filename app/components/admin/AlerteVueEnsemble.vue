<script setup lang="ts">
import type { AlertesDto } from '#shared/schemas/admin-paiements'
import { listerAlertes } from '~/utils/admin-alertes'

// Un seul message d'alerte à l'écran : un résumé et la liste des points à examiner, chacun relié à sa page.
const props = defineProps<{ alertes: AlertesDto }>()

const lignes = computed(() => listerAlertes(props.alertes))
const titre = computed(() =>
  lignes.value.length === 1 ? 'Un point à examiner' : `${lignes.value.length} points à examiner`,
)
</script>

<template>
  <UAlert
    v-if="lignes.length > 0"
    role="status"
    color="neutral"
    variant="outline"
    icon="i-ph-warning"
    :title="titre"
  >
    <template #description>
      <ul class="mt-2 flex flex-col">
        <li v-for="ligne in lignes" :key="ligne.id">
          <NuxtLink
            v-if="ligne.to"
            :to="ligne.to"
            class="flex min-h-(--cible-tactile) items-center gap-2 font-medium underline underline-offset-4"
          >
            {{ ligne.libelle }}
          </NuxtLink>
          <span v-else class="flex min-h-(--cible-tactile) items-center">{{ ligne.libelle }}</span>
        </li>
      </ul>
    </template>
  </UAlert>
</template>
