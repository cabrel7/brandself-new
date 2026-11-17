<script setup lang="ts">
// En-tête commun des parties interactives de la page d'accueil : surtitre + titre uniforme (aucun mot coloré ni en italique).
defineProps<{
  surtitre: string
  titre: string
  titreId: string
  /** Fond sombre : le surtitre s'éclaircit pour rester lisible. */
  sombre?: boolean
}>()
</script>

<template>
  <header class="entete" :class="{ 'entete--sombre': sombre }">
    <p class="surtitre">
      {{ surtitre }}
    </p>
    <h2 :id="titreId" class="titre">
      {{ titre }}
    </h2>
  </header>
</template>

<style scoped>
.entete {
  max-width: 50rem;
  margin: 0 auto 3rem;
  text-align: center;
}

.surtitre {
  margin: 0;
  font-size: var(--fs-14);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-texte);
}

.entete--sombre .surtitre {
  color: color-mix(in srgb, var(--accent) 55%, var(--fond));
}

.titre {
  margin: 0.875rem 0 0;
  font-family: var(--font-titre);
  font-weight: 500;
  font-size: clamp(2.125rem, 4.8vw, 3.625rem);
  line-height: 1.06;
  letter-spacing: -0.012em;
  text-wrap: balance;
}

@media (min-width: 60.0625rem) {
  .entete {
    margin-bottom: 4rem;
  }
}
</style>
