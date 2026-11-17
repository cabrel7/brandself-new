<script setup lang="ts">
import { MARQUE } from '#shared/brand'

// Mention « Propulsé par » : lien vers l'accueil de la plateforme, sans paramètre de suivi.
// Le point du logotype prend le terracotta de la marque, quelle que soit la palette de la vitrine.
const [nomAvantPoint = '', ...resteNom] = MARQUE.nom.split('.')
const nomApresPoint = resteNom.join('.')
const href = `https://${MARQUE.domaine}`
</script>

<template>
  <a
    :href="href"
    target="_blank"
    rel="noopener"
    class="inline-flex min-h-(--cible-tactile) items-center text-(length:--fs-14) text-texte-secondaire underline-offset-4 transition-colors hover:text-accent-texte hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
  >
    <span>Propulsé par {{ nomAvantPoint }}<span class="text-(--marque-jesuispro)">.</span>{{ nomApresPoint }}</span>
    <span class="sr-only"> (nouvel onglet)</span>
  </a>
</template>
