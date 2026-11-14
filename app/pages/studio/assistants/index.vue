<script setup lang="ts">
import { ref } from 'vue'
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Assistants' })

const {
  enChargement, enErreur, actif, planPayant, adresse, assistants, refresh,
  portees, connecteLe, nomAssistant,
  aConfirmer, enRetrait, erreurRetrait, demanderRetrait, annulerRetrait, confirmerRetrait,
  entrees, journalEnChargement, journalEnErreur, rafraichirJournal,
  adresseCopiee, erreurCopie, copierAdresse,
} = useStudioAssistants()

const connecteurs = [
  {
    id: 'claude',
    nom: 'Claude',
    instructions: 'Dans Claude, allez dans Paramètres > Connecteurs > Ajouter un connecteur MCP. Saisissez l’adresse du serveur et autorisez l’accès demandé.',
  },
  {
    id: 'chatgpt',
    nom: 'ChatGPT',
    instructions: 'Dans ChatGPT, allez dans Paramètres > Intégrations > MCP. Ajoutez une nouvelle intégration MCP avec l’adresse du serveur.',
  },
] as const

type ConnecteurId = (typeof connecteurs)[number]['id']
const ouvert = ref<Partial<Record<ConnecteurId, boolean>>>({})

function basculerConnecteur(id: ConnecteurId): void {
  ouvert.value[id] = !ouvert.value[id]
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <StudioRetour to="/studio/compte" label="Compte" />

    <div v-if="enChargement" role="status" aria-label="Chargement des assistants">
      <div class="flex flex-col gap-1" aria-hidden="true">
        <USkeleton class="h-10 w-40" />
        <USkeleton class="h-5 w-72" />
      </div>
      <div class="mt-6 flex flex-col gap-4" aria-hidden="true">
        <USkeleton v-for="n in 3" :key="n" class="h-20 w-full" />
      </div>
    </div>

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Les assistants ne s’affichent pas"
      description="Nous n’avons pas pu charger vos assistants."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <template v-else>
      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
          Assistants
        </h1>
        <p class="m-0 mt-1 text-base text-texte-secondaire">
          Gérez votre vitrine depuis Claude, ChatGPT ou un autre assistant.
        </p>
      </header>

      <!-- Plan gratuit : un seul message, conformément à la maquette « Assistants (gratuit) ». -->
      <div v-if="!planPayant" class="flex flex-col gap-4 rounded-(--rayon-carte) bg-accent-doux p-6">
        <span class="flex size-12 items-center justify-center rounded-xl bg-champ">
          <UIcon name="i-ph-sparkle" size="24" class="text-accent-texte" aria-hidden="true" />
        </span>
        <h2 class="m-0 text-(length:--fs-24) font-bold text-encre">
          Pilotez votre vitrine depuis votre assistant
        </h2>
        <p class="m-0 text-base text-texte-secondaire">
          Demandez à Claude ou ChatGPT d’ajouter un service, de préparer une réalisation ou de vous
          résumer vos réservations. Disponible avec le plan payant.
        </p>
        <UButton label="Passer au plan payant" to="/tarifs" block size="xl" />
        <NuxtLink
          to="/tarifs"
          class="inline-flex items-center gap-1 text-base font-semibold text-accent-texte no-underline transition-colors hover:text-accent"
        >
          Voir les tarifs
          <UIcon name="i-ph-caret-right" size="16" aria-hidden="true" />
        </NuxtLink>
      </div>

      <div v-else class="flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-x-10 md:gap-y-8">
        <section aria-labelledby="titre-serveur" class="flex flex-col gap-3">
          <h2 id="titre-serveur" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Adresse du serveur
          </h2>
          <div class="flex min-h-12 items-center gap-2 rounded-(--rayon) border border-bordure bg-surface py-1.5 pr-1.5 pl-4">
            <code data-testid="adresse-serveur" class="min-w-0 flex-1 truncate text-(length:--fs-14) text-encre">{{ adresse }}</code>
            <UButton
              data-testid="copier-adresse"
              :icon="adresseCopiee ? 'i-ph-check' : 'i-ph-copy'"
              variant="ghost"
              color="neutral"
              size="lg"
              class="min-h-11 min-w-11 justify-center"
              :aria-label="`Copier l’adresse du serveur (${adresse})`"
              @click="copierAdresse"
            />
          </div>
          <p role="status" aria-live="polite" class="m-0 min-h-6 text-(length:--fs-14) text-texte-secondaire">
            <template v-if="adresseCopiee">Adresse copiée.</template>
            <template v-else-if="erreurCopie">Impossible de copier l’adresse. Sélectionnez-la pour la copier manuellement.</template>
          </p>
          <p v-if="!actif" data-testid="mcp-inactif" class="m-0 text-(length:--fs-14) text-texte-secondaire">
            Pas encore disponible pour votre compte.
          </p>
        </section>

        <section aria-labelledby="titre-connecter" class="flex flex-col">
          <h2 id="titre-connecter" class="m-0 pb-2 text-(length:--fs-20) font-semibold text-encre">
            Comment connecter
          </h2>
          <div v-for="connecteur in connecteurs" :key="connecteur.id" class="border-t border-bordure">
            <button
              type="button"
              class="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 bg-transparent px-0 text-left text-base font-semibold text-encre transition-colors hover:bg-surface"
              :aria-expanded="Boolean(ouvert[connecteur.id])"
              @click="basculerConnecteur(connecteur.id)"
            >
              <span>{{ connecteur.nom }}</span>
              <UIcon
                name="i-ph-plus"
                class="size-5 text-texte-secondaire transition-transform"
                :class="{ 'rotate-45': ouvert[connecteur.id] }"
                aria-hidden="true"
              />
            </button>
            <div v-if="ouvert[connecteur.id]" class="pb-4 text-base text-texte-secondaire">
              {{ connecteur.instructions }}
            </div>
          </div>
          <div class="border-t border-bordure" />
        </section>

        <section aria-labelledby="titre-connectes" class="flex flex-col gap-3">
          <h2 id="titre-connectes" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Assistants connectés
          </h2>
          <p
            v-if="assistants.length === 0"
            data-testid="assistants-vide"
            class="m-0 border-t border-bordure pt-4 text-base text-texte-secondaire"
          >
            Aucun assistant connecté pour l’instant. Connectez-en un depuis Claude ou ChatGPT ci-dessus.
          </p>
          <ul v-else class="m-0 flex list-none flex-col border-t border-bordure p-0" data-testid="assistants-liste">
            <li
              v-for="assistant in assistants"
              :key="assistant.id"
              class="flex flex-col gap-3 border-b border-bordure py-4"
              data-testid="assistant"
            >
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0 flex-1">
                  <p class="m-0 text-base font-semibold wrap-break-word text-encre">{{ nomAssistant(assistant) }}</p>
                  <p class="m-0 text-(length:--fs-14) text-texte-secondaire">{{ connecteLe(assistant) }}</p>
                  <p v-if="portees(assistant).length" class="m-0 text-(length:--fs-14) text-texte-secondaire">
                    {{ portees(assistant).join(' · ') }}
                  </p>
                </div>
                <UButton
                  v-if="aConfirmer !== assistant.id"
                  data-testid="retirer-acces"
                  label="Retirer l’accès"
                  color="error"
                  variant="outline"
                  size="lg"
                  class="min-h-11 shrink-0"
                  :disabled="enRetrait !== null"
                  @click="demanderRetrait(assistant.id)"
                />
              </div>
              <div
                v-if="aConfirmer === assistant.id"
                role="group"
                :aria-label="`Retirer l’accès de ${nomAssistant(assistant)}`"
                class="flex flex-col gap-3 rounded-(--rayon) bg-accent-doux p-4"
                data-testid="confirmation-retrait"
              >
                <p class="m-0 text-(length:--fs-14) leading-relaxed text-encre">
                  {{ nomAssistant(assistant) }} ne pourra plus agir sur votre vitrine. Ce qu’il a déjà créé reste dans votre studio.
                </p>
                <p v-if="erreurRetrait" role="alert" class="m-0 flex items-start gap-2 text-(length:--fs-14) text-error">
                  <UIcon name="i-ph-warning-circle" size="18" class="mt-0.5 shrink-0" aria-hidden="true" />
                  {{ erreurRetrait }}
                </p>
                <div class="flex flex-col gap-2 sm:flex-row">
                  <UButton
                    data-testid="confirmer-retrait"
                    label="Retirer l’accès"
                    color="error"
                    size="lg"
                    class="min-h-11 justify-center"
                    :loading="enRetrait === assistant.id"
                    :disabled="enRetrait !== null"
                    @click="confirmerRetrait(assistant.id)"
                  />
                  <UButton
                    data-testid="annuler-retrait"
                    label="Annuler"
                    color="neutral"
                    variant="outline"
                    size="lg"
                    class="min-h-11 justify-center"
                    :disabled="enRetrait !== null"
                    @click="annulerRetrait"
                  />
                </div>
              </div>
            </li>
          </ul>
        </section>

        <section aria-labelledby="titre-journal" class="flex flex-col gap-3 md:col-span-2">
          <h2 id="titre-journal" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Dernières actions
          </h2>
          <div v-if="journalEnChargement" role="status" aria-label="Chargement des dernières actions" class="border-t border-bordure pt-4">
            <div class="flex flex-col gap-3" aria-hidden="true">
              <USkeleton v-for="n in 3" :key="n" class="h-6 w-full" />
            </div>
          </div>
          <div
            v-else-if="journalEnErreur"
            role="alert"
            data-testid="journal-erreur"
            class="flex flex-col items-start gap-3 border-t border-bordure pt-4"
          >
            <p class="m-0 text-base text-texte-secondaire">
              Nous n’avons pas pu charger les dernières actions.
            </p>
            <UButton label="Réessayer" variant="outline" color="neutral" size="lg" class="min-h-11" @click="rafraichirJournal()" />
          </div>
          <p
            v-else-if="entrees.length === 0"
            data-testid="journal-vide"
            class="m-0 border-t border-bordure pt-4 text-base text-texte-secondaire"
          >
            Aucune action pour l’instant.
          </p>
          <ul v-else class="m-0 list-none border-t border-bordure p-0" data-testid="journal-liste">
            <li
              v-for="entree in entrees"
              :key="entree.id"
              class="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 border-b border-bordure py-3 text-base"
            >
              <span class="text-(length:--fs-14) text-texte-secondaire">{{ entree.date }}</span>
              <span class="wrap-break-word text-encre">
                {{ entree.phrase }}
                <span v-if="entree.echec" class="sr-only">(échec)</span>
              </span>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </div>
</template>
