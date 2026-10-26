<script setup lang="ts">
import { fr } from '@nuxt/ui/locale'
</script>

<template>
  <UApp :locale="fr">
    <NuxtRouteAnnouncer />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
