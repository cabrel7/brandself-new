<script setup lang="ts">
import { computed } from 'vue'
import { MARQUE } from '#shared/brand'

// Écran de consentement OAuth : page autonome, sans le chrome du studio (maquette « Autorisation »).
definePageMeta({ layout: false, ssr: false })
useSeoMeta({ title: `Autoriser l’assistant — ${MARQUE.nom}` })

const {
  etat, nomClient, destination, nomUtilisateur, emailUtilisateur,
  portees, choix, enCours, erreur, autoriser, refuser,
} = useAutorisationOauth()

// Le point de la marque porte l'accent, comme sur la maquette (logotype, pas un titre).
const [nomMarque = '', ...restesMarque] = MARQUE.nom.split('.')
const extensionMarque = restesMarque.join('.')

const initialeAssistant = computed(() => nomClient.value.charAt(0).toUpperCase())
</script>

<template>
  <div class="flex min-h-dvh flex-col items-center bg-fond px-5 pt-10 pb-8 sm:justify-center sm:px-4 sm:py-12">
    <div class="flex w-full max-w-138 flex-col sm:rounded-(--rayon-carte) sm:border sm:border-bordure sm:bg-surface sm:p-9">
      <p class="m-0 text-center font-(family-name:--font-titre) text-(length:--fs-24) font-bold text-encre">
        {{ nomMarque }}<span class="text-accent">.</span>{{ extensionMarque }}
      </p>

      <!-- Query absente, invalide ou expirée : aucun appel, un seul message, une sortie. -->
      <div v-if="etat === 'invalide'" class="mt-8 flex flex-col items-center gap-4 text-center" data-testid="autorisation-invalide">
        <span class="flex size-12 items-center justify-center rounded-xl bg-accent-doux">
          <UIcon name="i-ph-warning-circle" size="24" class="text-accent-texte" aria-hidden="true" />
        </span>
        <h1 class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre">
          Cette demande d’accès n’est pas valable
        </h1>
        <p class="m-0 text-base text-texte-secondaire">
          Le lien est incomplet ou n’est plus à jour. Retournez dans votre assistant et relancez la connexion
          depuis l’adresse du serveur.
        </p>
        <UButton to="/studio/assistants" label="Voir mes assistants" size="xl" block />
      </div>

      <!-- Lecture du plan et de la connexion en cours : squelette discret, jamais une page blanche. -->
      <div
        v-else-if="etat === 'chargement'"
        class="mt-8 flex flex-col items-center gap-4"
        role="status"
        aria-live="polite"
        data-testid="autorisation-chargement"
      >
        <span class="sr-only">Chargement de la demande d’accès</span>
        <span class="size-12 animate-pulse rounded-xl bg-champ motion-reduce:animate-none" aria-hidden="true" />
        <span class="h-8 w-3/4 animate-pulse rounded-(--rayon) bg-champ motion-reduce:animate-none" aria-hidden="true" />
        <span class="h-5 w-1/2 animate-pulse rounded-(--rayon) bg-champ motion-reduce:animate-none" aria-hidden="true" />
      </div>

      <!-- Compte gratuit : pas de bouton d'autorisation. Refuser reste permis (l'assistant reçoit access_denied). -->
      <div v-else-if="etat === 'plan-gratuit'" class="mt-8 flex flex-col items-stretch gap-4 text-center" data-testid="autorisation-plan-gratuit">
        <span class="mx-auto flex size-12 items-center justify-center rounded-xl bg-accent-doux">
          <UIcon name="i-ph-lock" size="24" class="text-accent-texte" aria-hidden="true" />
        </span>
        <h1 class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre">
          Votre plan ne permet pas encore de connecter un assistant
        </h1>
        <p class="m-0 text-base text-texte-secondaire">
          {{ nomClient }} souhaite accéder à votre vitrine. La connexion d’un assistant est réservée au plan payant.
        </p>
        <p
          v-if="erreur"
          role="alert"
          data-testid="autorisation-erreur"
          class="m-0 flex items-start justify-center gap-2 text-base text-error"
        >
          <UIcon name="i-ph-warning-circle" size="20" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ erreur }}
        </p>
        <UButton data-testid="passer-payant" to="/tarifs" label="Passer au plan payant" size="xl" block />
        <button
          type="button"
          data-testid="refuser"
          class="min-h-11 cursor-pointer bg-transparent text-center text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="enCours"
          @click="refuser"
        >
          Refuser
        </button>
      </div>

      <template v-else>
        <div class="mt-6 flex items-center justify-center gap-3" aria-hidden="true">
          <span class="flex size-12 items-center justify-center rounded-xl border border-bordure bg-champ">
            <img src="/brand/icone.png" alt="" class="size-8">
          </span>
          <UIcon name="i-ph-arrow-right" size="20" class="text-texte-secondaire" />
          <span class="flex size-12 items-center justify-center rounded-xl bg-accent-doux text-(length:--fs-20) font-bold text-accent-texte">
            {{ initialeAssistant }}
          </span>
        </div>

        <h1 class="m-0 mt-5 text-center text-(length:--fs-24) leading-tight sm:text-(length:--fs-32) font-bold wrap-break-word text-encre" data-testid="autorisation-titre">
          {{ nomClient }} demande l’accès à votre vitrine
        </h1>

        <p class="m-0 mt-5 text-center text-base leading-relaxed text-texte-secondaire">
          <template v-if="nomUtilisateur">Connecté en tant que {{ nomUtilisateur }}</template>
          <template v-else>Connecté en tant que</template>
        </p>
        <p v-if="emailUtilisateur" class="m-0 text-center text-base leading-relaxed text-texte-secondaire">
          {{ emailUtilisateur }}
        </p>

        <ul class="m-0 mt-6 list-none border-t border-bordure p-0">
          <li class="flex items-start gap-3 border-b border-bordure py-3">
            <div class="min-w-0 flex-1">
              <p class="m-0 text-base font-semibold text-encre">Lire votre vitrine</p>
              <p class="m-0 text-(length:--fs-14) text-texte-secondaire">Profil, services, réalisations, horaires et créneaux libres. Toujours accordé.</p>
            </div>
            <UIcon name="i-ph-lock" size="20" class="mt-1 shrink-0 text-texte-secondaire" aria-label="Toujours accordé" />
          </li>
          <li
            v-for="portee in portees"
            :key="portee.id"
            class="flex items-start gap-3 border-b border-bordure py-3"
          >
            <div class="min-w-0 flex-1">
              <p class="m-0 text-base font-semibold text-encre">{{ portee.titre }}</p>
              <p class="m-0 text-(length:--fs-14) text-texte-secondaire">{{ portee.description }}</p>
            </div>
            <USwitch
              v-model="choix[portee.id]"
              :data-testid="`portee-${portee.id}`"
              class="mt-0.5 shrink-0"
              :disabled="enCours"
              :aria-label="portee.libelleSwitch"
            />
          </li>
        </ul>

        <div class="mt-6 flex flex-col gap-3 rounded-(--rayon) bg-accent-doux px-4 py-3.5">
          <p class="m-0 text-(length:--fs-14) leading-relaxed text-encre">
            Votre assistant ne peut <strong>rien supprimer ni publier</strong>. Ce qu’il crée arrive masqué :
            vous le relisez avant de l’activer.
          </p>
          <!-- Sécurité : destination de la redirection, discrète mais lisible. -->
          <div v-if="destination" class="flex flex-col gap-0.5 border-t border-bordure pt-3 text-(length:--fs-14) leading-relaxed text-encre">
            <p class="m-0 flex items-center gap-2 font-semibold" data-testid="autorisation-hote">
              <UIcon name="i-ph-arrow-square-out" size="16" class="shrink-0" aria-hidden="true" />
              <span class="min-w-0 wrap-anywhere">Retour vers {{ destination.hote }}</span>
            </p>
            <p v-if="destination.surAppareil" class="m-0 text-texte-secondaire">Application sur votre appareil</p>
            <p class="m-0 text-texte-secondaire">
              Ce nom est déclaré par l’assistant : vérifiez que l’adresse de retour est bien celle attendue.
            </p>
          </div>
        </div>

        <p
          v-if="erreur"
          id="erreur-autorisation"
          role="alert"
          data-testid="autorisation-erreur"
          class="m-0 mt-6 flex items-start gap-2 text-base text-error"
        >
          <UIcon name="i-ph-warning-circle" size="20" class="mt-0.5 shrink-0" aria-hidden="true" />
          {{ erreur }}
        </p>

        <div class="mt-6 flex flex-col items-stretch gap-2">
          <UButton
            data-testid="autoriser"
            label="Autoriser"
            block
            size="xl"
            :loading="enCours"
            :disabled="enCours"
            @click="autoriser"
          />
          <button
            type="button"
            data-testid="refuser"
            class="min-h-11 cursor-pointer bg-transparent text-center text-base font-semibold text-texte-secondaire transition-colors hover:text-encre focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="enCours"
            @click="refuser"
          >
            Refuser
          </button>
        </div>

        <p class="m-0 mt-8 text-center text-(length:--fs-14) text-texte-secondaire">
          Vous pourrez retirer cet accès à tout moment dans Compte, Assistants.
        </p>
      </template>
    </div>
  </div>
</template>
