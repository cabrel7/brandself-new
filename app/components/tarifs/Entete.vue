<script setup lang="ts">
import { MARQUE } from '#shared/brand'
</script>

<template>
  <header class="border-b border-bordure">
    <div class="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-4 px-6">
      <NuxtLink
        to="/"
        :aria-label="`${MARQUE.nom}, accueil`"
        class="inline-flex min-h-(--cible-tactile) items-center"
      >
        <BsLogo variante="wordmark" class="h-8 md:hidden" />
        <BsLogo variante="horizontal" class="hidden h-10 md:block" />
      </NuxtLink>
      <nav aria-label="Accès au compte" class="flex items-center gap-3">
        <UButton label="Se connecter" to="/connexion" variant="outline" size="lg" class="hidden sm:inline-flex" />
        <UButton label="Commencer" to="/connexion" size="lg" />
      </nav>
    </div>
  </header>
</template>
