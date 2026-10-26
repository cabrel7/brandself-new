<script setup lang="ts">
import { TITRE_LABELS, TITRES } from '#shared/vitrine'
import type { EtatUsername } from '~/composables/useUsernameDisponible'

const { titre, prenom, nom, metier, username, palette, chargement, erreurs, erreurGenerale, enLigne, soumettre }
  = useOnboardingVitrine()
const { etat } = useUsernameDisponible(username)

const optionsTitre = [
  { label: 'Sans titre', value: TITRE_AUCUN },
  ...TITRES.map((valeur) => ({ label: TITRE_LABELS[valeur], value: valeur })),
]

const MESSAGES_USERNAME: Partial<Record<EtatUsername, string>> = {
  pris: 'Cette adresse est déjà prise. Essayez-en une autre.',
  reserve: 'Cette adresse est réservée. Essayez-en une autre.',
  format: 'Utilisez 3 à 30 lettres minuscules, chiffres ou tirets, sans tiret au début ni à la fin.',
  erreur: "Nous n'avons pas pu vérifier cette adresse. Elle sera contrôlée à la création.",
}

const erreurUsername = computed(() => erreurs.value.username ?? MESSAGES_USERNAME[etat.value])
const bloque = computed(() => etat.value === 'pris' || etat.value === 'reserve' || etat.value === 'format')
</script>

<template>
  <VitrineEnLigne v-if="enLigne" :username="enLigne.username" :prochaine-etape="enLigne.prochaineEtape" />

  <main v-else class="mx-auto flex w-full max-w-120 flex-col gap-4 px-6 pt-8 pb-12">
    <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">
      Bienvenue. Construisons votre vitrine ensemble.
    </h1>
    <p class="text-texte-secondaire">
      Quelques informations pour débuter. Vous pourrez les modifier plus tard depuis le studio.
    </p>

    <form class="flex flex-col gap-4" novalidate @submit.prevent="soumettre">
      <UFormField label="Titre" name="titre" :error="erreurs.titre">
        <USelect v-model="titre" :items="optionsTitre" value-key="value" class="w-full" />
      </UFormField>

      <UFormField label="Prénom" name="prenom" :error="erreurs.prenom" required>
        <UInput v-model="prenom" type="text" autocomplete="given-name" placeholder="Cabrel" />
      </UFormField>

      <UFormField label="Nom" name="nom" :error="erreurs.nom" required>
        <UInput v-model="nom" type="text" autocomplete="family-name" placeholder="Nguesso" />
      </UFormField>

      <UFormField label="Métier" name="metier" :error="erreurs.metier" required>
        <UInput v-model="metier" type="text" placeholder="Cardiologue" />
      </UFormField>

      <UFormField label="Adresse de votre vitrine" name="username" :error="erreurUsername" required>
        <UInput
          v-model="username"
          type="text"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          placeholder="dr-cabrel"
          :loading="etat === 'verification'"
          :ui="{ base: 'ps-32!' }"
        >
          <template #leading>
            <span class="pointer-events-none text-muted" aria-hidden="true">{{ HOTE_VITRINES }}/</span>
          </template>
        </UInput>
        <template #help>
          <span v-if="etat === 'libre'" class="flex items-center gap-2 font-semibold text-[color-mix(in_srgb,var(--ui-success)_55%,var(--encre))]">
            <UIcon name="i-ph-check" /> Cette adresse est disponible
          </span>
        </template>
      </UFormField>

      <PaletteChoice v-model="palette" />

      <UAlert
        v-if="erreurGenerale"
        role="alert"
        color="error"
        variant="soft"
        icon="i-ph-warning-circle"
        :description="erreurGenerale"
      />

      <UButton type="submit" block :loading="chargement" :disabled="bloque">
        {{ chargement ? 'Création en cours…' : 'Créer ma vitrine' }}
      </UButton>
    </form>
  </main>
</template>
