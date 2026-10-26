<script setup lang="ts">
defineProps<{ nomAffiche: string, username: string, servicesTotal: number }>()
</script>

<template>
  <header class="border-b border-bordure bg-fond">
    <div class="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
      <NuxtLink
        :to="`/${username}`"
        class="inline-flex min-h-(--cible-tactile) items-center font-(family-name:--font-titre) text-(length:--fs-20) font-bold"
      >
        {{ nomAffiche }}
      </NuxtLink>
      <nav aria-label="Vitrine" class="flex items-center gap-6">
        <NuxtLink
          v-if="servicesTotal > 0"
          :to="`/${username}/services`"
          class="hidden min-h-(--cible-tactile) items-center text-(length:--fs-14) font-medium text-texte-secondaire transition-colors hover:text-accent md:inline-flex"
        >
          Services
        </NuxtLink>
        <a
          href="#contact"
          class="hidden min-h-(--cible-tactile) items-center text-(length:--fs-14) font-medium text-texte-secondaire transition-colors hover:text-accent md:inline-flex"
        >
          Contact
        </a>
        <UButton to="#contact" size="lg">Me contacter</UButton>
      </nav>
    </div>
  </header>
</template>
