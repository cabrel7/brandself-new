<script setup lang="ts">
const titre = ref('')
const prenom = ref('')
const nom = ref('')
const metier = ref('')
const username = ref('')
const chargement = ref(false)
const erreur = ref('')

const ERREUR_CREATION = "Nous n'avons pas pu créer votre vitrine. Réessayez dans un instant."
const ERREUR_SAISIE = 'Vérifiez les informations saisies, puis réessayez.'

function statusCodeOf(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'statusCode' in err) {
    const { statusCode } = err
    return typeof statusCode === 'number' ? statusCode : undefined
  }
  return undefined
}

async function creerVitrine(): Promise<void> {
  erreur.value = ''
  chargement.value = true
  try {
    await $fetch('/api/studio/vitrine', {
      method: 'POST',
      body: {
        titre: titre.value,
        prenom: prenom.value,
        nom: nom.value,
        metier: metier.value,
        username: username.value.trim().toLowerCase(),
      },
    })
    await navigateTo('/studio')
  } catch (err: unknown) {
    erreur.value = statusCodeOf(err) === 400 ? ERREUR_SAISIE : ERREUR_CREATION
  } finally {
    chargement.value = false
  }
}
</script>

<template>
  <main class="mx-auto flex w-full max-w-120 flex-col gap-4 px-6 pt-8 pb-12">
    <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">
      Créer votre vitrine
    </h1>
    <p class="text-muted">
      Quelques informations pour débuter. Vous pourrez les modifier plus tard depuis le studio.
    </p>

    <form class="flex flex-col gap-4" @submit.prevent="creerVitrine">
      <UFormField label="Titre de votre vitrine" name="titre">
        <UInput v-model="titre" type="text" placeholder="Mon activité" required />
      </UFormField>

      <UFormField label="Prénom" name="prenom">
        <UInput v-model="prenom" type="text" autocomplete="given-name" placeholder="Jean" required />
      </UFormField>

      <UFormField label="Nom" name="nom">
        <UInput v-model="nom" type="text" autocomplete="family-name" placeholder="Dupont" required />
      </UFormField>

      <UFormField label="Métier" name="metier">
        <UInput v-model="metier" type="text" placeholder="Cardiologue" required />
      </UFormField>

      <UFormField label="Adresse de votre vitrine" name="username">
        <UInput
          v-model="username"
          type="text"
          autocapitalize="none"
          autocomplete="off"
          spellcheck="false"
          placeholder="dr-cabrel"
          required
          :ui="{ base: 'ps-29' }"
        >
          <template #leading>
            <span class="pointer-events-none text-muted" aria-hidden="true">brandself.io/</span>
          </template>
        </UInput>
      </UFormField>

      <UAlert
        v-if="erreur"
        role="alert"
        color="error"
        variant="soft"
        icon="i-ph-warning-circle"
        :description="erreur"
      />

      <UButton type="submit" block :loading="chargement">
        {{ chargement ? 'Création en cours…' : 'Créer ma vitrine' }}
      </UButton>
    </form>
  </main>
</template>
