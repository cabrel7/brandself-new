<script setup lang="ts">
import { ref } from 'vue'
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Assistants' })

interface AssistantConnecte {
  id: string
  nom: string
  clientId: string
  createdAt: string
}

interface EntreeJournal {
  id: string
  outil: string
  statut: string
  createdAt: string
}

const mcpActif = false
const serveurMcp = 'https://mcp.jesuis.pro/mcp'
const assistantsConnectes: AssistantConnecte[] = []
const detailAutorise = ref(false)
const journal: EntreeJournal[] = []
const enChargement = true

const erreur = ref<string | null>(null)
const _confirmation = ref<string | null>(null)
</script>

<template>
  <div class="flex flex-col gap-6">
    <StudioRetour to="/studio/compte" label="Compte" />

    <div v-if="enChargement" role="status" aria-label="Chargement des assistants">
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton class="h-10 w-48" />
        <USkeleton class="h-5 w-24" />
      </div>
      <div class="mt-6 flex flex-col gap-4" aria-hidden="true">
        <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
      </div>
    </div>

    <UEmpty
      v-else-if="erreur"
      icon="i-ph-warning-circle"
      title="Les assistants ne s’affichent pas"
      description="Nous n’avons pas pu charger la liste. Vos données sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl' }]"
    />

    <template v-else>
      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
          Assistants
        </h1>
        <p class="m-0 mt-1 text-base text-texte-secondaire">
          Connectez votre assistant (Claude, ChatGPT…) à votre vitrine pour gérer vos services et réalisations.
        </p>
      </header>

      <section aria-labelledby="titre-serveur" class="flex flex-col gap-4">
        <h2 id="titre-serveur" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Adresse du serveur
        </h2>
        <p class="m-0 text-base text-texte-secondaire">
          Copiez cette adresse dans votre assistant pour établir la connexion.
        </p>
        <div class="flex flex-col sm:flex-row gap-3">
          <div class="flex-1 border border-bordure rounded-(--rayon) bg-surface">
            <code class="block px-4 py-3 text-(length:--fs-14) text-encre break-all">
              {{ serveurMcp }}
            </code>
          </div>
          <UButton label="Copier" size="sm" variant="outline" />
        </div>
        <p v-if="!mcpActif" class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
          Le serveur MCP est actuellement désactivé. Il sera activé pour votre compte dès que votre abonnement payant sera confirmé.
        </p>
      </section>

      <section aria-labelledby="titre-instructions" class="flex flex-col gap-4">
        <h2 id="titre-instructions" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Instructions de connexion
        </h2>

        <UAccordion :model-value="['claude', 'chatgpt']">
          <UAccordionItem header="Claude" value="claude" icon="i-ph-claude">
            <p class="m-0 text-base text-texte-secondaire">
              Dans Claude, allez dans Paramètres > Connecteurs > Ajouter un connecteur MCP. Saisissez l’adresse du serveur et autorisez les portées demandées.
            </p>
          </UAccordionItem>
          <UAccordionItem header="ChatGPT" value="chatgpt" icon="i-ph-chatgpt">
            <p class="m-0 text-base text-texte-secondaire">
              Dans ChatGPT, allez dans Paramètres > Intégrations > MCP. Ajoutez une nouvelle intégration MCP avec l’adresse du serveur.
            </p>
          </UAccordionItem>
        </UAccordion>
      </section>

      <section aria-labelledby="titre-assistants" class="flex flex-col gap-4">
        <h2 id="titre-assistants" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Assistants connectés
        </h2>

        <UEmpty
          v-if="assistantsConnectes.length === 0"
          icon="i-ph-robot"
          title="Aucun assistant connecté"
          description="Connectez votre premier assistant depuis Claude ou ChatGPT."
          class="rounded-(--rayon) border border-bordure bg-surface"
        />

        <ul v-else class="m-0 list-none border border-bordure rounded-(--rayon) p-0">
          <li
            v-for="assistant in assistantsConnectes"
            :key="assistant.id"
            class="flex items-center justify-between gap-4 border-b border-bordure py-4 last:border-b-0"
          >
            <div class="min-w-0 flex-1">
              <p class="m-0 text-base font-semibold text-encre">{{ assistant.nom }}</p>
                <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
                  {{ assistant.clientId }} · {{ new Date(assistant.createdAt).toLocaleDateString('fr-FR') }}
                </p>
            </div>
            <UButton
              label="Révoquer"
              variant="outline"
              color="neutral"
              size="sm"
              :loading="false"
              @click="() => {}"
            />
          </li>
        </ul>
      </section>

      <section aria-labelledby="titre-detail" class="flex flex-col gap-4">
        <h2 id="titre-detail" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Détail des réservations et messages
        </h2>
        <USwitch
          :id="'switch-detail'"
          v-model="detailAutorise"
          :label="'Autoriser mon assistant à lire le détail des réservations et des messages'"
          :description="
            'Lorsque cette option est activée, votre assistant peut lire les emails, numéros de téléphone et textes des messages des visiteurs. Désactivé par défaut pour protéger la confidentialité de vos visiteurs.'
          "
          :disabled="!mcpActif"
          :ui="{ root: 'w-full flex-row-reverse items-center justify-between gap-4', wrapper: 'ms-0' }"
        />
        <p class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
          Ce réglage s’applique à tous les assistants connectés. Modifiez-le à tout moment.
        </p>
      </section>

      <section aria-labelledby="titre-journal" class="flex flex-col gap-4">
        <h2 id="titre-journal" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Journal des actions de l’assistant
        </h2>
        <p class="m-0 text-base text-texte-secondaire">
          Les 50 dernières actions effectuées par votre assistant via le MCP.
        </p>

        <UEmpty
          v-if="journal.length === 0"
          icon="i-ph-clipboard-text"
          title="Aucune action pour l’instant"
          description="Le journal se remplit dès que votre assistant effectue une action."
          class="rounded-(--rayon) border border-bordure bg-surface"
        />

        <ul v-else class="m-0 list-none border border-bordure rounded-(--rayon) p-0">
          <li
            v-for="entree in journal"
            :key="entree.id"
            class="border-b border-bordure py-3 last:border-b-0"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <p class="m-0 text-base font-semibold text-encre">{{ entree.outil }}</p>
                <p class="m-0 text-(length:--fs-14) text-texte-secondaire">{{ new Date(entree.createdAt).toLocaleDateString('fr-FR') }}</p>
              </div>
              <span class="shrink-0 text-(length:--fs-12) text-texte-secondaire">{{ entree.statut }}</span>
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>