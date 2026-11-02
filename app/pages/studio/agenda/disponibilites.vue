<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Vos disponibilités — Brandself' })

const {
  enChargement,
  enErreur,
  absente,
  rafraichir,
  message,
  jours,
  reglages,
  fuseauItems,
  pasItems,
  erreursDisponibilites,
  disponibilitesModifiees,
  enregistrementDisponibilites,
  ajouterPlage,
  basculerJour,
  supprimerPlage,
  modifierPlage,
  modifierReglage,
  enregistrerDisponibilites,
  indisponibilites,
  dateIndisponibilite,
  raisonIndisponibilite,
  raisonIndisponibiliteMax,
  erreursIndisponibilite,
  ajoutIndisponibiliteEnCours,
  suppressionIndisponibiliteEnCours,
  suppressionIndisponibiliteAConfirmer,
  modifierIndisponibilite,
  ajouterIndisponibilite,
  demanderSuppressionIndisponibilite,
  annulerSuppressionIndisponibilite,
  supprimerIndisponibilite,
} = useStudioDisponibilites()
</script>

<template>
  <div class="flex flex-col gap-6">
    <StudioRetour to="/studio/agenda" label="Agenda" />

    <div v-if="enChargement" role="status" aria-label="Chargement de vos disponibilités">
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton class="h-10 w-64" />
        <USkeleton class="h-5 w-80 max-w-full" />
      </div>
      <div class="mt-6 flex flex-col gap-4" aria-hidden="true">
        <USkeleton v-for="n in 4" :key="n" class="h-24 w-full" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos disponibilités apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Vos disponibilités ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Elles restent appliquées sur votre vitrine."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: rafraichir }]"
    />

    <template v-else>
      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
          Vos disponibilités
        </h1>
        <p class="m-0 mt-1 max-w-2xl text-base text-texte-secondaire">
          Les visiteurs ne peuvent réserver que dans ces plages.
        </p>
      </header>

      <UAlert
        v-if="message"
        :role="message.type === 'erreur' ? 'alert' : 'status'"
        :aria-live="message.type === 'erreur' ? 'assertive' : 'polite'"
        :color="message.type === 'erreur' ? 'error' : 'neutral'"
        variant="soft"
        :icon="message.type === 'erreur' ? 'i-ph-warning-circle' : 'i-ph-check-circle'"
        :description="message.texte"
      />

      <StudioAgendaDisponibilites
        :jours="jours"
        :reglages="reglages"
        :fuseau-items="fuseauItems"
        :pas-items="pasItems"
        :erreurs="erreursDisponibilites"
        @ajouter="ajouterPlage"
        @basculer="basculerJour"
        @supprimer="supprimerPlage"
        @modifier-plage="modifierPlage"
        @modifier-reglage="modifierReglage"
      />

      <div class="flex flex-col gap-1">
        <h2 class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre">
          Indisponibilités
        </h2>
        <p class="m-0 text-base text-texte-secondaire">
          Congés, déplacements : ces jours-là, personne ne peut réserver.
        </p>
      </div>

      <StudioAgendaIndisponibilites
        :items="indisponibilites"
        :date="dateIndisponibilite"
        :raison="raisonIndisponibilite"
        :raison-max="raisonIndisponibiliteMax"
        :erreurs="erreursIndisponibilite"
        :ajout-en-cours="ajoutIndisponibiliteEnCours"
        :suppression-en-cours="suppressionIndisponibiliteEnCours"
        :suppression-a-confirmer="suppressionIndisponibiliteAConfirmer"
        @modifier="modifierIndisponibilite"
        @ajouter="ajouterIndisponibilite"
        @demander-suppression="demanderSuppressionIndisponibilite"
        @annuler-suppression="annulerSuppressionIndisponibilite"
        @supprimer="supprimerIndisponibilite"
      />

      <div class="sticky bottom-0 bg-fond py-3">
        <UButton
          label="Enregistrer"
          size="xl"
          block
          class="min-h-(--cible-tactile)"
          :loading="enregistrementDisponibilites"
          :disabled="!disponibilitesModifiees || enregistrementDisponibilites"
          @click="enregistrerDisponibilites"
        />
      </div>
    </template>
  </div>
</template>
