<script setup lang="ts">
import { ABONNEMENT_FUSEAU_REPLI } from '#shared/plans'

definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Votre agenda — Brandself' })

const {
  enChargement,
  enErreur,
  absente,
  rafraichir,
  message,
  activites,
  onglet,
  compteursOnglets,
  actionActiviteEnCours,
  confirmationActivite,
  changerOnglet,
  demanderActionActivite,
  annulerConfirmationActivite,
  confirmerActionActivite,
} = useStudioAgenda()

// Quota mensuel de réservations atteint : les visiteurs ne peuvent plus réserver jusqu'au mois suivant.
const quotaReservations = useQuotaAtteint('reservations_mois')
const { vitrine } = useStudioVitrine()
const finQuota = computed(() => premierJourMoisSuivant(new Date(), vitrine.value?.fuseau ?? ABONNEMENT_FUSEAU_REPLI))

function plurielDemandes(nombre: number): string {
  return nombre > 1 ? 'demandes' : 'demande'
}
</script>

<template>
  <div class="xl:relative xl:left-1/2 xl:w-[calc(100vw-3rem)] xl:max-w-7xl xl:-translate-x-1/2">
    <div v-if="enChargement" role="status" aria-label="Chargement de votre agenda">
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton class="h-10 w-48" />
        <USkeleton class="h-5 w-80 max-w-full" />
      </div>
      <div class="mt-8 flex flex-col gap-6" aria-hidden="true">
        <USkeleton class="h-12 w-full" />
        <USkeleton v-for="n in 3" :key="n" class="h-44 w-full" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Votre agenda apparaît ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Votre agenda ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos réservations et demandes sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: rafraichir }]"
    />

    <div v-else>
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
            Agenda
          </h1>
          <p class="m-0 mt-1 text-base text-texte-secondaire">
            {{ compteursOnglets.aVenir }} à venir<template v-if="compteursOnglets.demandes > 0"> · {{ compteursOnglets.demandes }} {{ plurielDemandes(compteursOnglets.demandes) }}</template>
          </p>
        </div>
        <UButton
          to="/studio/agenda/disponibilites"
          label="Disponibilités"
          size="lg"
          class="min-h-(--cible-tactile)"
        />
      </header>

      <StudioLimitePlanMessage
        v-if="quotaReservations.atteinte.value && !message"
        class="mt-5"
        ressource="reservations_mois"
        :limite="quotaReservations.limite.value"
        :date="finQuota"
      />

      <UAlert
        v-if="message"
        :role="message.type === 'erreur' ? 'alert' : 'status'"
        :aria-live="message.type === 'erreur' ? 'assertive' : 'polite'"
        :color="message.type === 'erreur' ? 'error' : 'neutral'"
        variant="soft"
        :icon="message.type === 'erreur' ? 'i-ph-warning-circle' : 'i-ph-check-circle'"
        :description="message.texte"
        class="mt-5"
      />

      <StudioAgendaActivite
        class="mt-6"
        :activites="activites"
        :onglet="onglet"
        :compteurs="compteursOnglets"
        :action-en-cours="actionActiviteEnCours"
        :confirmation="confirmationActivite"
        @changer-onglet="changerOnglet"
        @demander-action="demanderActionActivite"
        @annuler-confirmation="annulerConfirmationActivite"
        @confirmer-action="confirmerActionActivite"
      />
    </div>
  </div>
</template>
