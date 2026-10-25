<template>
  <main class="accueil">
    <h1>Brandself</h1>
    <p>Votre vitrine en ligne.</p>
    <p>
      <NuxtLink to="/connexion">Se connecter</NuxtLink>
    </p>
  </main>
</template>

<style scoped>
.accueil {
  min-height: 100vh;
  display: grid;
  place-content: center;
  gap: 0.75rem;
  text-align: center;
  padding: 1.5rem;
}

h1 {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
}

p {
  color: var(--texte-secondaire);
}

a {
  color: var(--accent);
}
</style>
