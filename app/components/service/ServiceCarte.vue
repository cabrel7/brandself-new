<script setup lang="ts">
import type { ServicePublicCarteDTO } from '#shared/dto'
import { libellePrix, SERVICE_TYPE_PASTILLES, serviceDetailHref } from '#shared/services'

const props = defineProps<{ service: ServicePublicCarteDTO, username: string }>()

const duree = computed(() => resumeDuree(props.service, 'court'))
const prix = computed(() => libellePrix(props.service))
const action = computed(() => actionCarte(props.service, props.username))
</script>

<template>
  <article class="relative flex h-full flex-col overflow-hidden rounded-(--rayon-carte) border border-bordure bg-surface transition-[border-color,box-shadow] hover:border-texte-secondaire hover:shadow-sm has-[h3_a:focus-visible]:outline-2 has-[h3_a:focus-visible]:outline-offset-2 has-[h3_a:focus-visible]:outline-accent">
    <div class="relative">
      <ServiceVisuel :image="service.image" :titre="service.titre" hauteur="carte" />
      <span class="absolute top-4 left-4 rounded-full bg-champ px-3 py-1 text-(length:--fs-14) font-medium text-encre">
        {{ SERVICE_TYPE_PASTILLES[service.type] }}
      </span>
    </div>
    <div class="flex flex-1 flex-col gap-3 p-6">
      <h3 class="font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold">
        <NuxtLink
          :to="serviceDetailHref(username, service.slug)"
          class="after:absolute after:inset-0 after:content-['']"
        >
          {{ service.titre }}
        </NuxtLink>
      </h3>
      <p v-if="service.description" class="line-clamp-2 text-texte-secondaire">{{ service.description }}</p>
      <p v-if="duree" class="flex items-center gap-2 text-(length:--fs-14) text-texte-secondaire">
        <UIcon name="i-ph-clock" class="size-4 shrink-0" aria-hidden="true" />
        {{ duree }}
      </p>
      <div class="mt-auto flex items-center justify-between gap-4 border-t border-bordure pt-4">
        <p class="font-semibold">{{ prix }}</p>
        <UButton :to="action.to" size="lg" class="relative shrink-0">{{ action.libelle }}</UButton>
      </div>
    </div>
  </article>
</template>
