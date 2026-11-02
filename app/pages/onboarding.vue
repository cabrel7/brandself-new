<script setup lang="ts">
import { ONBOARDING_ETAPES, ONBOARDING_ETAPES_TOTAL } from '#shared/onboarding'

const {
  etape, sousTitre, chargement, erreurChargement, enregistrement, erreurs, erreurGenerale, enLigne,
  identite, photo, televersement, erreurTeleversement, televerserPhoto,
  proposition, etatProposition, messageErreurProposition, attenteLongue,
  accrocheIndex, presentation, servicesActifs, reessayerProposition,
  username, palette, etatUsername, erreurUsername, peutPublier,
  charger, continuer, retour,
} = useOnboarding()

onMounted(charger)

useSeoMeta({
  title: computed(() =>
    `${ONBOARDING_ETAPES[etape.value]} — Étape ${etape.value} sur ${ONBOARDING_ETAPES_TOTAL} — Brandself`,
  ),
  robots: 'noindex',
})

// Le focus suit le titre à chaque étape (lecteurs d'écran et clavier).
const titre = useTemplateRef<HTMLHeadingElement>('titre')
watch(etape, async () => {
  await nextTick()
  titre.value?.focus()
})

interface EtapeFocalisable {
  focusErreur: () => void
}
const etapeCourante = useTemplateRef<EtapeFocalisable>('etapeCourante')

async function surContinuer(): Promise<void> {
  const avance = await continuer()
  if (avance) return
  await nextTick()
  etapeCourante.value?.focusErreur()
}

const attendProposition = computed(() => etape.value === 3 && etatProposition.value !== 'pret')
const libelleAction = computed(() => {
  if (etape.value !== 4) return 'Continuer'
  return enregistrement.value ? 'Publication…' : 'Publier ma vitrine'
})
const actionDesactivee = computed(() => attendProposition.value || (etape.value === 4 && !peutPublier.value))
const erreurPhoto = computed(() => erreurs.value.photo ?? erreurTeleversement.value)
</script>

<template>
  <VitrineEnLigne v-if="enLigne" :username="enLigne.username" :prochaine-etape="enLigne.prochaineEtape" />

  <main v-else class="mx-auto w-full max-w-120 px-6 pt-4 pb-48">
    <div v-if="erreurChargement" class="pt-8">
      <UEmpty
        icon="i-ph-warning-circle"
        title="Votre inscription ne s’affiche pas"
        description="Nous n’avons pas pu la charger. Vos informations sont gardées."
        :as="{ title: 'h1' }"
        :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => charger() }]"
      />
    </div>

    <div v-else-if="chargement" class="flex flex-col gap-6 pt-12" aria-busy="true" aria-label="Chargement de votre inscription">
      <USkeleton class="h-10 w-3/4" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
    </div>

    <template v-else>
      <OnboardingEntete :etape="etape" @retour="retour" />

      <h1
        ref="titre"
        tabindex="-1"
        class="mt-8 mb-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold text-encre outline-none"
      >
        {{ TITRES_ECRAN[etape] }}
      </h1>
      <p class="mt-3 mb-8 text-texte-secondaire">{{ sousTitre }}</p>

      <Transition name="etape" mode="out-in">
        <OnboardingEtapeIdentite
          v-if="etape === 1"
          ref="etapeCourante"
          v-model="identite"
          :erreurs="erreurs"
          :desactive="enregistrement"
          @soumettre="surContinuer"
        />
        <OnboardingEtapePhoto
          v-else-if="etape === 2"
          ref="etapeCourante"
          :photo="photo"
          :televersement="televersement"
          :erreur="erreurPhoto"
          @choisir="televerserPhoto"
        />
        <OnboardingEtapeProposition
          v-else-if="etape === 3"
          ref="etapeCourante"
          v-model:accroche-index="accrocheIndex"
          v-model:presentation="presentation"
          v-model:services-actifs="servicesActifs"
          :etat="etatProposition"
          :proposition="proposition"
          :attente-longue="attenteLongue"
          :message-erreur="messageErreurProposition"
          :erreur-presentation="erreurs.presentation"
          :desactive="enregistrement"
          @reessayer="reessayerProposition"
        />
        <OnboardingEtapeAdresse
          v-else
          ref="etapeCourante"
          v-model:username="username"
          v-model:palette="palette"
          :etat="etatUsername"
          :erreur="erreurUsername"
          :desactive="enregistrement"
          @soumettre="surContinuer"
        />
      </Transition>

      <OnboardingBarreAction
        :label="libelleAction"
        :loading="enregistrement"
        :disabled="actionDesactivee"
        @continuer="surContinuer"
      >
        <template #message>
          <p v-if="erreurGenerale" role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ erreurGenerale }}</span>
          </p>
        </template>
      </OnboardingBarreAction>
    </template>
  </main>
</template>

<style scoped>
.etape-enter-active,
.etape-leave-active {
  transition: opacity 0.2s ease;
}

.etape-enter-from,
.etape-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .etape-enter-active,
  .etape-leave-active {
    transition: none;
  }
}
</style>
