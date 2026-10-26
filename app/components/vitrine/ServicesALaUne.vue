<script setup lang="ts">
import type { ServicePublicCarteDTO } from '#shared/dto'

defineProps<{ username: string, services: ServicePublicCarteDTO[], total: number }>()
</script>

<template>
  <section aria-labelledby="services-a-la-une" class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12">
    <div class="flex items-end justify-between gap-4">
      <div class="flex flex-col gap-2">
        <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent uppercase">Services · à la une</p>
        <h2 id="services-a-la-une" class="font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold">
          Ce que je propose
        </h2>
      </div>
      <NuxtLink
        :to="`/${username}/services`"
        class="hidden min-h-(--cible-tactile) items-center gap-1 font-semibold text-accent hover:underline md:inline-flex"
      >
        Voir tous les services ({{ total }})
        <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
      </NuxtLink>
    </div>

    <!-- Défilement horizontal natif (scroll-snap) sur mobile et tablette, grille à partir de 1024 px. -->
    <div
      role="region"
      aria-label="Services à la une"
      tabindex="0"
      class="-mx-6 snap-x snap-mandatory scroll-px-6 overflow-x-auto px-6 pb-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent lg:mx-0 lg:overflow-visible lg:px-0"
    >
      <ul class="flex gap-4 lg:grid lg:grid-cols-3 lg:gap-6">
        <li
          v-for="service in services"
          :key="service.slug"
          class="w-[85%] shrink-0 snap-start md:w-[45%] lg:w-auto"
        >
          <ServiceCarte :service="service" :username="username" />
        </li>
      </ul>
    </div>

    <UButton :to="`/${username}/services`" variant="outline" block class="md:hidden">
      Voir tous les services ({{ total }})
    </UButton>
  </section>
</template>
