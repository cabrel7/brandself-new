<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Autoriser l’assistant' })

const nomAssistant = 'Mon assistant'
const porteeEcriture = false
const porteeReservations = false
const porteeMessages = false
</script>

<template>
  <div class="flex flex-col gap-6 max-w-2xl mx-auto">
    <StudioRetour to="/studio/assistants" label="Assistants" />

    <UCard class="border border-bordure rounded-(--rayon)">
      <div class="p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="size-10 rounded-full bg-accent-doux flex items-center justify-center">
            <UIcon name="i-ph-robot" size="32" class="text-accent-texte" aria-hidden="true" />
          </div>
          <div>
            <h1 class="m-0 text-(length:--fs-24) font-bold text-encre">
              {{ nomAssistant }} demande l’accès à votre vitrine
            </h1>
            <p class="m-0 mt-1 text-base text-texte-secondaire">
              Cet assistant souhaite se connecter à votre serveur MCP.
            </p>
          </div>
        </div>

        <h2 class="m-0 mb-4 text-(length:--fs-18) font-semibold text-encre">
          Portées demandées
        </h2>
        <ul class="m-0 list-none space-y-3">
          <li class="flex items-start gap-3">
            <UIcon name="i-ph-check-circle" size="18" class="shrink-0 text-accent" aria-hidden="true" />
            <span class="text-base text-encre">
              <span class="font-semibold">Lire votre vitrine</span> — consulter l’état, les services et les réalisations.
            </span>
          </li>
          <li class="flex items-start gap-3">
            <UIcon
              :name="porteeEcriture ? 'i-ph-check-circle' : 'i-ph-circle'"
              size="18"
              class="shrink-0"
              :class="porteeEcriture ? 'text-accent' : 'text-texte-secondaire'"
              aria-hidden="true"
            />
            <span class="text-base text-encre">
              <span class="font-semibold">Créer et modifier des contenus</span> — ajouter des services et réalisations (brouillons).
            </span>
          </li>
          <li class="flex items-start gap-3">
            <UIcon
              :name="porteeReservations ? 'i-ph-check-circle' : 'i-ph-circle'"
              size="18"
              class="shrink-0"
              :class="porteeReservations ? 'text-accent' : 'text-texte-secondaire'"
              aria-hidden="true"
            />
            <span class="text-base text-encre">
              <span class="font-semibold">Lire vos réservations</span> — consulter vos réservations (confidentialité par défaut).
            </span>
          </li>
          <li class="flex items-start gap-3">
            <UIcon
              :name="porteeMessages ? 'i-ph-check-circle' : 'i-ph-circle'"
              size="18"
              class="shrink-0"
              :class="porteeMessages ? 'text-accent' : 'text-texte-secondaire'"
              aria-hidden="true"
            />
            <span class="text-base text-encre">
              <span class="font-semibold">Lire vos messages</span> — consulter vos messages (confidentialité par défaut).
            </span>
          </li>
        </ul>

        <div class="mt-6 p-4 rounded-(--rayon) bg-alerte-doux border border-bordure-alerte">
          <div class="flex items-start gap-3">
            <UIcon name="i-ph-warning-circle" size="20" class="shrink-0 text-alerte-texte" aria-hidden="true" />
            <p class="m-0 text-(length:--fs-14) text-alerte-texte">
              Les contenus créés par cet assistant sont des brouillons : ils apparaissent masqués sur votre vitrine et doivent être activés dans le studio.
            </p>
          </div>
        </div>

        <div class="mt-8 flex flex-col sm:flex-row gap-3">
          <UButton
            label="Autoriser"
            variant="solid"
            class="flex-1 sm:flex-none"
            @click="() => {}"
          />
          <UButton
            label="Refuser"
            variant="outline"
            color="neutral"
            class="flex-1 sm:flex-none"
            @click="() => {}"
          />
        </div>
      </div>
    </UCard>
  </div>
</template>