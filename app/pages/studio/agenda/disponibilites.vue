<script setup lang="ts">
import type { RouteLocationNormalized } from 'vue-router'

definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Vos disponibilités' })

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
  aucunePlage,
  appliquerJour,
  appliquerSemaineType,
  modifierReglage,
  enregistrerDisponibilites,
  indisponibilitesAVenir,
  indisponibilitesPassees,
  messageIndisponibilite,
  dateMinIndisponibilite,
  modeIndisponibilite,
  changerModeIndisponibilite,
  dateIndisponibilite,
  debutIndisponibilite,
  finIndisponibilite,
  libelleJoursPlage,
  erreurLongueurPlage,
  ajoutIndisponibilitePossible,
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

const router = useRouter()
/** Destination retenue quand on tente de quitter la page avec un brouillon non enregistré. */
const sortieEnAttente = ref<RouteLocationNormalized | null>(null)
let sortieAutorisee = false

onBeforeRouteLeave((destination) => {
  if (sortieAutorisee || !disponibilitesModifiees.value) return true
  sortieEnAttente.value = destination
  return false
})

function avertirFermetureOnglet(evenement: BeforeUnloadEvent): void {
  if (!disponibilitesModifiees.value) return
  evenement.preventDefault()
  evenement.returnValue = ''
}

onMounted(() => window.addEventListener('beforeunload', avertirFermetureOnglet))
onBeforeUnmount(() => window.removeEventListener('beforeunload', avertirFermetureOnglet))

async function poursuivreSortie(): Promise<void> {
  const destination = sortieEnAttente.value
  sortieEnAttente.value = null
  if (!destination) return
  sortieAutorisee = true
  await router.push(destination.fullPath)
  sortieAutorisee = false
}

async function enregistrerPuisQuitter(): Promise<void> {
  await enregistrerDisponibilites()
  if (!disponibilitesModifiees.value && message.value?.type === 'succes') {
    await poursuivreSortie()
    return
  }
  sortieEnAttente.value = null
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <StudioRetour to="/studio/agenda" label="Agenda" />

    <div v-if="enChargement" role="status" aria-label="Chargement de vos disponibilités">
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton class="h-10 w-64" />
        <USkeleton class="h-5 w-80 max-w-full" />
      </div>
      <div class="mt-6 overflow-hidden rounded-(--rayon) border border-bordure" aria-hidden="true">
        <USkeleton v-for="n in 7" :key="n" class="h-14 w-full rounded-none border-b border-bordure" />
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

      <div class="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-x-10">
      <StudioAgendaDisponibilites
        :jours="jours"
        :reglages="reglages"
        :fuseau-items="fuseauItems"
        :pas-items="pasItems"
        :erreurs="erreursDisponibilites"
        :aucune-plage="aucunePlage"
        :appliquer="appliquerJour"
        @semaine-type="appliquerSemaineType"
        @modifier-reglage="modifierReglage"
      />

      <StudioAgendaIndisponibilites
        :a-venir="indisponibilitesAVenir"
        :passees="indisponibilitesPassees"
        :mode="modeIndisponibilite"
        :date="dateIndisponibilite"
        :debut="debutIndisponibilite"
        :fin="finIndisponibilite"
        :date-min="dateMinIndisponibilite"
        :libelle-jours="libelleJoursPlage"
        :erreur-longueur="erreurLongueurPlage"
        :ajout-possible="ajoutIndisponibilitePossible"
        :raison="raisonIndisponibilite"
        :raison-max="raisonIndisponibiliteMax"
        :erreurs="erreursIndisponibilite"
        :message="messageIndisponibilite"
        :ajout-en-cours="ajoutIndisponibiliteEnCours"
        :suppression-en-cours="suppressionIndisponibiliteEnCours"
        :suppression-a-confirmer="suppressionIndisponibiliteAConfirmer"
        @modifier="modifierIndisponibilite"
        @changer-mode="changerModeIndisponibilite"
        @ajouter="ajouterIndisponibilite"
        @demander-suppression="demanderSuppressionIndisponibilite"
        @annuler-suppression="annulerSuppressionIndisponibilite"
        @supprimer="supprimerIndisponibilite"
      />
      </div>

      <div class="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-bordure bg-fond py-3">
        <!-- Région live des HEURES uniquement ; les indisponibilités ont leur propre retour dans leur zone. -->
        <div role="status" aria-live="polite" class="empty:hidden">
          <p v-if="sortieEnAttente" class="m-0 flex items-start gap-2 text-base font-semibold text-encre">
            <UIcon name="i-ph-warning-circle" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
            <span>Vous avez des modifications non enregistrées.</span>
          </p>
          <p
            v-else-if="message"
            class="m-0 flex items-start gap-2 text-base font-semibold"
            :class="message.type === 'erreur' ? 'text-erreur' : 'text-encre'"
          >
            <UIcon
              :name="message.type === 'erreur' ? 'i-ph-warning-circle' : 'i-ph-check-circle'"
              class="mt-0.5 size-5 shrink-0"
              aria-hidden="true"
            />
            <span>{{ message.texte }}</span>
          </p>
          <p v-else-if="disponibilitesModifiees" class="m-0 text-(length:--fs-14) text-texte-secondaire">
            Modifications non enregistrées
          </p>
        </div>

        <div v-if="sortieEnAttente" class="flex flex-col gap-2 sm:flex-row-reverse">
          <UButton
            label="Enregistrer"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            :loading="enregistrementDisponibilites"
            :disabled="enregistrementDisponibilites"
            @click="enregistrerPuisQuitter"
          />
          <UButton
            label="Quitter sans enregistrer"
            variant="outline"
            color="neutral"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            :disabled="enregistrementDisponibilites"
            @click="poursuivreSortie"
          />
          <UButton
            label="Rester"
            variant="ghost"
            color="neutral"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            :disabled="enregistrementDisponibilites"
            @click="sortieEnAttente = null"
          />
        </div>
        <UButton
          v-else
          label="Enregistrer les heures"
          size="xl"
          block
          class="min-h-(--cible-tactile) md:max-w-xs md:self-end"
          :loading="enregistrementDisponibilites"
          :disabled="!disponibilitesModifiees || enregistrementDisponibilites"
          @click="enregistrerDisponibilites"
        />
      </div>
    </template>
  </div>
</template>
