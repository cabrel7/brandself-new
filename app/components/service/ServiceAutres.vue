<script setup lang="ts">
import type { ServicePublicCarteDTO } from '#shared/dto'
import { SERVICE_TYPE_PASTILLES, serviceDetailHref } from '#shared/services'

defineProps<{ autres: ServicePublicCarteDTO[], total: number, username: string }>()

function meta(s: ServicePublicCarteDTO): string {
  const duree = resumeDuree(s, 'court')
  return duree === null ? SERVICE_TYPE_PASTILLES[s.type] : `${SERVICE_TYPE_PASTILLES[s.type]} · ${duree}`
}
</script>

<template>
  <section v-if="autres.length > 0" aria-labelledby="service-autres" class="flex flex-col gap-4">
    <h2 id="service-autres" class="font-(family-name:--font-titre) text-(length:--fs-24) font-bold">Autres services</h2>
    <ul class="flex flex-col border-t border-bordure">
      <li v-for="autre in autres" :key="autre.slug" class="border-b border-bordure">
        <NuxtLink
          :to="serviceDetailHref(username, autre.slug)"
          class="flex min-h-(--cible-tactile) items-center justify-between gap-4 py-4 transition-colors hover:text-accent"
        >
          <span class="flex flex-col">
            <span class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">{{ autre.titre }}</span>
            <span class="text-(length:--fs-14) text-texte-secondaire">{{ meta(autre) }}</span>
          </span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0 text-accent" aria-hidden="true" />
        </NuxtLink>
      </li>
    </ul>
    <NuxtLink
      :to="`/${username}/services`"
      class="inline-flex min-h-(--cible-tactile) items-center gap-1 font-semibold text-accent-texte hover:underline"
    >
      Voir tous les services ({{ total }})
      <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
    </NuxtLink>
  </section>
</template>
