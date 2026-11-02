<script setup lang="ts">
import { ONBOARDING_ETAPES, ONBOARDING_ETAPES_TOTAL } from '#shared/onboarding'
import type { EtatUsername } from '~/composables/useUsernameDisponible'

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
    // Le gabarit de titre de l'application ajoute déjà « | Brandself ».
    `${ONBOARDING_ETAPES[etape.value]} — Étape ${etape.value} sur ${ONBOARDING_ETAPES_TOTAL}`,
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
  if (actionDesactivee.value) return
  const avance = await continuer()
  if (avance) return
  await nextTick()
  etapeCourante.value?.focusErreur()
}

const attendProposition = computed(() => etape.value === 3 && etatProposition.value !== 'pret')
const proposition3EnErreur = computed(() => etape.value === 3 && etatProposition.value === 'erreur')
const libelleAction = computed(() => {
  if (etape.value !== 4) return 'Continuer'
  return enregistrement.value ? 'Publication…' : 'Publier ma vitrine'
})
const actionDesactivee = computed(() => attendProposition.value || (etape.value === 4 && !peutPublier.value))

const AIDES_ADRESSE: Partial<Record<EtatUsername, string>> = {
  vide: 'Choisissez une adresse pour continuer.',
  verification: 'Votre adresse est en cours de vérification.',
  pris: 'Cette adresse est déjà prise : choisissez-en une autre.',
  reserve: 'Cette adresse est réservée : choisissez-en une autre.',
  format: 'Corrigez votre adresse pour continuer.',
}
const aideAction = computed(() => {
  if (attendProposition.value) return 'Votre proposition est en cours de rédaction.'
  if (etape.value === 4) return AIDES_ADRESSE[etatUsername.value]
  return undefined
})

// Un seul message à la fois : l'erreur de l'étape (photo, proposition) ou d'un champ prime sur l'erreur générale.
const erreurEtape = computed(() => {
  if (etape.value === 2) return erreurs.value.photo ?? erreurTeleversement.value ?? undefined
  if (proposition3EnErreur.value) return messageErreurProposition.value
  return undefined
})
const aErreurChamp = computed(() => {
  const champs = etape.value === 4 ? { ...erreurs.value, username: erreurUsername.value } : erreurs.value
  return Object.values(champs).some(Boolean)
})
const messageBarre = computed(() => {
  if (erreurEtape.value || aErreurChamp.value) return ''
  return erreurGenerale.value
})

// Le squelette n'apparaît qu'après un court délai : pas de clignotement sur un chargement rapide.
const { ready: squeletteVisible } = useTimeout(200, { controls: true })
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

    <div v-else-if="chargement" role="status" aria-busy="true" aria-label="Chargement de votre inscription">
      <div v-if="squeletteVisible" class="flex flex-col gap-6 pt-12" aria-hidden="true">
        <USkeleton class="h-10 w-3/4" />
        <USkeleton class="h-14 w-full" />
        <USkeleton class="h-14 w-full" />
        <USkeleton class="h-14 w-full" />
      </div>
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
          :erreur="erreurEtape"
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
          :message-erreur="erreurEtape ?? ''"
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
        v-if="!proposition3EnErreur"
        :label="libelleAction"
        :loading="enregistrement"
        :disabled="actionDesactivee"
        :aide="aideAction"
        @continuer="surContinuer"
      >
        <template #message>
          <p v-if="messageBarre" role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ messageBarre }}</span>
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
