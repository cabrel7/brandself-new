<script setup lang="ts">
import { resumeListeTemoignages } from '#shared/temoignages'

definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Vos témoignages — Brandself' })

const liste = useTemplateRef<HTMLElement>('liste')
const {
  temoignages, resume, compteurs, enChargement, enErreur, absente, vide, refresh,
  message, annonce, occupes, basculerVisibilite, deplacer,
} = useStudioTemoignages(liste)

// Limite du plan atteinte : « Ajouter » affiche le message de limite au lieu d'ouvrir le formulaire.
const ajout = useLimiteAjout(computed(() => compteurs.value?.limitePlan))

const resumeTexte = computed(() =>
  resumeListeTemoignages(resume.value.visibles, resume.value.enVedette, resume.value.vedetteMax),
)
</script>

<template>
  <div>
    <UEmpty
      v-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos témoignages apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Vos témoignages ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Vos témoignages sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <StudioVide
      v-else-if="vide"
      icon="i-ph-chat-centered-text"
      title="Donnez la parole à vos clients"
      description="Ajoutez un premier témoignage : un client qui vous recommande rassure les visiteurs."
      action-label="Ajouter un témoignage"
      action-to="/studio/temoignages/nouveau"
    />

    <template v-else>
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
            Témoignages
          </h1>
          <p v-if="!enChargement" class="m-0 mt-1 text-base text-texte-secondaire">
            {{ resumeTexte }}
          </p>
        </div>
        <UButton
          label="Ajouter"
          :to="ajout.atteinte.value ? undefined : '/studio/temoignages/nouveau'"
          class="shrink-0"
          @click="ajout.tenter()"
        />
      </header>

      <StudioLimitePlanMessage
        v-if="ajout.affichee.value"
        class="mt-4"
        prendre-le-focus
        ressource="temoignages"
        :limite="ajout.limite.value"
      />
      <p v-else-if="message" role="alert" class="message-erreur mt-4">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ message }}</span>
      </p>

      <div v-if="enChargement" role="status" class="mt-4 flex flex-col border-t border-bordure">
        <span class="sr-only">Chargement de vos témoignages</span>
        <div v-for="n in 3" :key="n" class="flex items-center gap-3 border-b border-bordure py-3" aria-hidden="true">
          <USkeleton class="size-14 shrink-0 rounded-(--rayon-interne)" />
          <div class="flex min-w-0 flex-1 flex-col gap-2">
            <USkeleton class="h-5 w-2/3" />
            <USkeleton class="h-4 w-1/3" />
          </div>
        </div>
      </div>

      <ul v-else ref="liste" class="m-0 mt-4 list-none border-t border-bordure p-0">
        <StudioTemoignageLigne
          v-for="temoignage in temoignages"
          :key="temoignage.id"
          :temoignage="temoignage"
          :occupe="occupes.includes(temoignage.id)"
          :triable="temoignages.length > 1"
          @basculer="(actif) => basculerVisibilite(temoignage.id, actif)"
          @deplacer="(sens) => deplacer(temoignage.id, sens)"
        />
      </ul>
      <p class="sr-only" aria-live="polite">
        {{ annonce }}
      </p>

      <p v-if="!enChargement" class="m-0 mt-6 text-base text-texte-secondaire">
        Glissez les témoignages pour changer leur ordre. L’interrupteur masque un témoignage sans le supprimer.
      </p>
    </template>
  </div>
</template>
