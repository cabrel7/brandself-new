<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()

const HTTP_NOT_FOUND = 404

const introuvable = computed(() => props.error.statusCode === HTTP_NOT_FOUND)
const titre = computed(() => (introuvable.value ? 'Cette vitrine est introuvable.' : 'Un incident est survenu.'))
const message = computed(() =>
  introuvable.value
    ? "L'adresse est peut-être mal écrite, ou la vitrine n'est pas encore en ligne."
    : 'Cela vient de nous, pas de vous. Réessayez dans un instant.',
)

useSeoMeta({ title: () => titre.value, robots: 'noindex' })

async function retourner(): Promise<void> {
  await clearError({ redirect: '/' })
}
</script>

<template>
  <main class="mx-auto flex min-h-screen w-full max-w-120 flex-col items-start justify-center gap-4 px-6">
    <span class="flex size-16 items-center justify-center rounded-full bg-accent-doux text-accent">
      <UIcon :name="introuvable ? 'i-ph-magnifying-glass' : 'i-ph-warning-circle'" class="size-8" />
    </span>
    <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">{{ titre }}</h1>
    <p class="text-texte-secondaire">{{ message }}</p>
    <UButton @click="retourner">Retourner à l'accueil</UButton>
  </main>
</template>
