<script setup lang="ts">
import type { ServiceType } from '#shared/services'

const props = defineProps<{ type: ServiceType, inclus: string[] }>()

const PAD_NUMERO = 2
const programme = computed(() => props.type === 'accompagnement')
const titre = computed(() => (programme.value ? 'Le programme' : 'Ce que comprend ce service'))
const numero = (index: number): string => String(index + 1).padStart(PAD_NUMERO, '0')
</script>

<template>
  <section v-if="inclus.length > 0" aria-labelledby="service-inclus" class="flex flex-col gap-4">
    <h2 id="service-inclus" class="font-(family-name:--font-titre) text-(length:--fs-24) font-bold">{{ titre }}</h2>
    <ol v-if="programme" class="flex flex-col border-t border-bordure">
      <li v-for="(ligne, index) in inclus" :key="`${index}-${ligne}`" class="flex items-baseline gap-4 border-b border-bordure py-4">
        <span class="w-8 shrink-0 font-(family-name:--font-titre) text-(length:--fs-20) text-accent-texte">{{ numero(index) }}</span>
        <span>{{ ligne }}</span>
      </li>
    </ol>
    <ul v-else class="flex flex-col gap-3">
      <li v-for="(ligne, index) in inclus" :key="`${index}-${ligne}`" class="flex items-start gap-3">
        <UIcon name="i-ph-check" class="mt-1 size-5 shrink-0 text-accent" aria-hidden="true" />
        <span>{{ ligne }}</span>
      </li>
    </ul>
  </section>
</template>
