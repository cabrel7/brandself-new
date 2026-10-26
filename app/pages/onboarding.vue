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
  <main class="colonne-auth">
    <h1 class="titre-auth">Créer votre vitrine</h1>
    <p class="texte-intro">
      Quelques informations pour débuter. Vous pourrez les modifier plus tard depuis le studio.
    </p>

    <form class="formulaire" @submit.prevent="creerVitrine">
      <BsField v-slot="{ id }" label="Titre de votre vitrine">
        <input
          :id="id"
          v-model="titre"
          class="saisie"
          type="text"
          placeholder="Mon activité"
          required
        >
      </BsField>

      <BsField v-slot="{ id }" label="Prénom">
        <input
          :id="id"
          v-model="prenom"
          class="saisie"
          type="text"
          autocomplete="given-name"
          placeholder="Jean"
          required
        >
      </BsField>

      <BsField v-slot="{ id }" label="Nom">
        <input
          :id="id"
          v-model="nom"
          class="saisie"
          type="text"
          autocomplete="family-name"
          placeholder="Dupont"
          required
        >
      </BsField>

      <BsField v-slot="{ id }" label="Métier">
        <input
          :id="id"
          v-model="metier"
          class="saisie"
          type="text"
          placeholder="Cardiologue"
          required
        >
      </BsField>

      <BsField v-slot="{ id }" label="Adresse de votre vitrine">
        <div class="adresse">
          <span class="adresse__prefixe" aria-hidden="true">brandself.io/</span>
          <input
            :id="id"
            v-model="username"
            class="adresse__saisie"
            type="text"
            autocapitalize="none"
            autocomplete="off"
            spellcheck="false"
            placeholder="dr-cabrel"
            required
          >
        </div>
      </BsField>

      <p v-if="erreur" class="message-erreur" role="alert">
        <PhosphorIcon name="warning-circle" size="1.25rem" aria-hidden="true" />
        <span>{{ erreur }}</span>
      </p>

      <BsButton type="submit" block :loading="chargement">
        {{ chargement ? 'Création en cours…' : 'Créer ma vitrine' }}
      </BsButton>
    </form>
  </main>
</template>

<style scoped>
.formulaire {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* Même gabarit qu'un champ .saisie : le préfixe fait partie du cadre. */
.adresse {
  display: flex;
  align-items: center;
  min-height: var(--hauteur-controle);
  padding: 0 1rem;
  border: 1px solid var(--bordure);
  border-radius: var(--rayon);
  background-color: var(--champ);
  transition: border-color var(--transition);
}

.adresse:hover {
  border-color: var(--texte-secondaire);
}

.adresse:focus-within {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.adresse__prefixe {
  color: var(--texte-secondaire);
  font-size: var(--fs-16);
}

.adresse__saisie {
  flex: 1;
  min-width: 0;
  min-height: calc(var(--hauteur-controle) - 2px);
  padding: 0;
  border: none;
  background: transparent;
  color: var(--encre);
  font-family: var(--font-texte);
  font-size: var(--fs-16);
}

.adresse__saisie:focus-visible {
  outline: none;
}

.adresse__saisie::placeholder {
  color: var(--texte-secondaire);
}
</style>
