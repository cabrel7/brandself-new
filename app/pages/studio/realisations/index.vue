<script setup lang="ts">
import { resumeListeRealisations } from '#shared/realisations'

definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Vos réalisations — Brandself' })

const liste = useTemplateRef<HTMLElement>('liste')
const {
  realisations, resume, enChargement, enErreur, absente, vide, refresh,
  message, annonce, occupes, basculerVisibilite, deplacer,
} = useStudioRealisations(liste)

const resumeTexte = computed(() => resumeListeRealisations(resume.value.visibles, resume.value.enVedette, resume.value.vedetteMax))
</script>

<template>
  <div>
    <UEmpty
      v-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos réalisations apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Vos réalisations ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Vos réalisations sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <StudioVide
      v-else-if="vide"
      icon="i-ph-squares-four"
      title="Montrez votre travail"
      description="Ajoutez une première réalisation : vos visiteurs verront concrètement ce que vous faites."
      action-label="Ajouter une réalisation"
      action-to="/studio/realisations/nouveau"
    />

    <template v-else>
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
            Réalisations
          </h1>
          <p v-if="!enChargement" class="m-0 mt-1 text-base text-texte-secondaire">
            {{ resumeTexte }}
          </p>
        </div>
        <UButton label="Ajouter" to="/studio/realisations/nouveau" icon="i-ph-plus" class="shrink-0" />
      </header>

      <p v-if="message" role="alert" class="message-erreur mt-4">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ message }}</span>
      </p>

      <div v-if="enChargement" role="status" class="mt-4 flex flex-col gap-4">
        <span class="sr-only">Chargement de vos réalisations</span>
        <USkeleton v-for="n in 4" :key="n" class="h-20 w-full" aria-hidden="true" />
      </div>

      <ul v-else ref="liste" class="m-0 mt-4 list-none border-t border-bordure p-0">
        <StudioRealisationLigne
          v-for="realisation in realisations"
          :key="realisation.id"
          :realisation="realisation"
          :occupe="occupes.includes(realisation.id)"
          :triable="realisations.length > 1"
          @basculer="(actif) => basculerVisibilite(realisation.id, actif)"
          @deplacer="(sens) => deplacer(realisation.id, sens)"
        />
      </ul>
      <p class="sr-only" aria-live="polite">
        {{ annonce }}
      </p>

      <p v-if="!enChargement" class="m-0 mt-6 text-base text-texte-secondaire">
        Les réalisations en vedette s’affichent en premier sur l’accueil. Les autres restent sur la page Réalisations.
      </p>
    </template>
  </div>
</template>
