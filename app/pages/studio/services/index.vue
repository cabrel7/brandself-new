<script setup lang="ts">
definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Vos services' })

const liste = useTemplateRef<HTMLElement>('liste')
const {
  services, resume, compteurs, enChargement, enErreur, absente, vide, refresh,
  message, annonce, occupes, basculerVisibilite, deplacer,
} = useStudioServices(liste)

// Limite du plan atteinte : « Ajouter » affiche le message de limite au lieu d'ouvrir le formulaire.
const ajout = useLimiteAjout(computed(() => compteurs.value?.limitePlan))

// Sous-titre : segments omis à zéro (maquettes S3 « 5 visibles · 3 en vedette sur 3 » et
// S16 « 6 visibles · 2 brouillons »).
const sousTitre = computed(() => {
  const segments = [`${resume.value.visibles} ${resume.value.visibles > 1 ? 'visibles' : 'visible'}`]
  if (resume.value.brouillons > 0) segments.push(`${resume.value.brouillons} ${resume.value.brouillons > 1 ? 'brouillons' : 'brouillon'}`)
  if (resume.value.enVedette > 0) segments.push(`${resume.value.enVedette} en vedette sur ${resume.value.vedetteMax}`)
  return segments.join(' · ')
})

// Éléments créés par l'assistant et encore masqués : un seul message à l'écran, la bannière
// cède la place au message de limite ou d'erreur.
const brouillonsAssistant = computed(() => resume.value.brouillonsAssistant)
const banniereVisible = computed(() =>
  brouillonsAssistant.value > 0 && !enChargement.value && !ajout.affichee.value && !message.value
)
const libelleBanniere = computed(() => (brouillonsAssistant.value === 1 ? '1 élément créé par votre assistant attend votre relecture.' : `${brouillonsAssistant.value} éléments créés par votre assistant attendent votre relecture.`))
const aideBanniere = computed(() => (brouillonsAssistant.value === 1 ? 'Relisez-le, puis activez l’interrupteur « Visible » pour le publier.' : 'Relisez-les, puis activez l’interrupteur « Visible » pour les publier.'))
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
            {{ sousTitre }}
          </p>
        </div>
        <StudioBoutonAjouter
          :to="ajout.atteinte.value ? undefined : '/studio/services/nouveau'"
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

      <div v-if="banniereVisible" class="mt-4 rounded-(--rayon) bg-accent-doux p-5">
        <p class="m-0 text-base font-semibold text-encre">{{ libelleBanniere }}</p>
        <p class="m-0 mt-1 text-base text-texte-secondaire">
          {{ aideBanniere }}
        </p>
      </div>

      <div v-if="enChargement" role="status" class="mt-4 flex flex-col gap-4 md:grid md:grid-cols-2">
        <span class="sr-only">Chargement de vos services</span>
        <USkeleton v-for="n in 4" :key="n" class="h-20 w-full" aria-hidden="true" />
      </div>

      <ul v-else ref="liste" class="m-0 mt-4 list-none border-t border-bordure p-0 md:grid md:grid-cols-2 md:gap-x-8">
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
