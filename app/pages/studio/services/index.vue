<script setup lang="ts">
definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Vos services — Brandself' })

const liste = useTemplateRef<HTMLElement>('liste')
const {
  services, resume, compteurs, enChargement, enErreur, absente, vide, refresh,
  message, annonce, occupes, basculerVisibilite, deplacer,
} = useStudioServices(liste)

// Limite du plan atteinte : « Ajouter » affiche le message de limite au lieu d'ouvrir le formulaire.
const ajout = useLimiteAjout(computed(() => compteurs.value?.limitePlan))
</script>

<template>
  <div>
    <UEmpty
      v-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos services apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Vos services ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Vos services sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <StudioVide
      v-else-if="vide"
      icon="i-ph-briefcase"
      title="Présentez ce que vous proposez"
      description="Ajoutez votre premier service : vos visiteurs sauront comment travailler avec vous."
      action-label="Ajouter un service"
      action-to="/studio/services/nouveau"
    />

    <template v-else>
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
            Services
          </h1>
          <p v-if="!enChargement" class="m-0 mt-1 text-base text-texte-secondaire">
            {{ resume.visibles }} {{ resume.visibles > 1 ? 'visibles' : 'visible' }} · {{ resume.enVedette }} en vedette sur {{ resume.vedetteMax }}
          </p>
        </div>
        <UButton
          label="Ajouter"
          :to="ajout.atteinte.value ? undefined : '/studio/services/nouveau'"
          icon="i-ph-plus"
          class="shrink-0"
          @click="ajout.tenter()"
        />
      </header>

      <StudioLimitePlanMessage
        v-if="ajout.affichee.value"
        class="mt-4"
        prendre-le-focus
        ressource="services"
        :limite="ajout.limite.value"
      />
      <p v-else-if="message" role="alert" class="message-erreur mt-4">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ message }}</span>
      </p>

      <div v-if="enChargement" role="status" class="mt-4 flex flex-col gap-4">
        <span class="sr-only">Chargement de vos services</span>
        <USkeleton v-for="n in 4" :key="n" class="h-20 w-full" aria-hidden="true" />
      </div>

      <ul v-else ref="liste" class="m-0 mt-4 list-none border-t border-bordure p-0">
        <StudioServiceLigne
          v-for="service in services"
          :key="service.id"
          :service="service"
          :occupe="occupes.includes(service.id)"
          :triable="services.length > 1"
          @basculer="(actif) => basculerVisibilite(service.id, actif)"
          @deplacer="(sens) => deplacer(service.id, sens)"
        />
      </ul>
      <p class="sr-only" aria-live="polite">
        {{ annonce }}
      </p>

      <p v-if="!enChargement" class="m-0 mt-6 text-base text-texte-secondaire">
        L’interrupteur masque un service sur votre vitrine sans le supprimer. Les services en vedette s’affichent en premier sur l’accueil.
      </p>
    </template>
  </div>
</template>
