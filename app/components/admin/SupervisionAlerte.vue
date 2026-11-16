<script setup lang="ts">
import type { PointSupervision } from '~/utils/admin-supervision'

// Un seul message d'alerte à l'écran : un résumé et les points à examiner, chacun relié à sa partie de la page.
const props = defineProps<{ points: PointSupervision[] }>()

const titre = computed(() =>
  props.points.length === 1 ? 'Un point à examiner' : `${props.points.length} points à examiner`,
)
</script>

<template>
  <UAlert v-if="points.length > 0" role="status" color="neutral" variant="outline" icon="i-ph-warning" :title="titre">
    <template #description>
      <ul class="mt-2 flex list-none flex-col p-0">
        <li v-for="point in points" :key="point.id">
          <a
            :href="`#${point.ancre}`"
            class="flex min-h-(--cible-tactile) items-center gap-2 font-medium underline underline-offset-4"
          >
            {{ point.libelle }}
          </a>
        </li>
      </ul>
    </template>
  </UAlert>
</template>
