<script setup lang="ts">
// Vitrine d'exemple « témoignages » : montrée dans le cadre collant (grand écran) ET dans chaque étape (petit écran).
import { TEMOIGNAGES_DEMO } from '~/data/landing'

const TEXTES = { apercu: 'Exemple de vitrine', etiquette: 'Témoignages · à la une', exemples: 'Exemples fictifs, pour la démonstration.' } as const
</script>

<template>
  <div class="cadre" role="img" :aria-label="TEXTES.apercu">
    <p class="etiquette" style="--k: 0">
      {{ TEXTES.etiquette }}
    </p>
    <figure
      v-for="(temoignage, i) in TEMOIGNAGES_DEMO"
      :key="temoignage.nom"
      class="temoignage"
      :class="{ 'temoignage--vedette': i === 0 }"
      :style="{ '--k': i + 1 }"
    >
      <blockquote class="citation">
        {{ temoignage.citation }}
      </blockquote>
      <figcaption class="auteur">
        <span class="initiale" aria-hidden="true">{{ temoignage.initiale }}</span>
        <span>
          <strong class="nom">{{ temoignage.nom }}</strong>
          <template v-if="i === 0"><br></template>
          <template v-else> · </template>
          {{ temoignage.contexte }}
        </span>
      </figcaption>
    </figure>
    <p class="exemple" :style="{ '--k': TEMOIGNAGES_DEMO.length + 1 }">
      {{ TEXTES.exemples }}
    </p>
  </div>
</template>

<style scoped>
.cadre {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 0.75rem;
  min-height: 0;
}

.etiquette {
  margin: 0;
  font-size: var(--fs-14);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-texte);
}

.temoignage {
  display: grid;
  gap: 0.625rem;
  margin: 0;
  padding: 1rem 1.375rem;
  border-radius: var(--rayon-carte);
  background: var(--surface);
}

.temoignage--vedette {
  gap: 1.125rem;
  padding: 1.25rem 1.5rem;
  background: var(--accent-doux);
}

/* Une citation n'est pas un titre : l'italique y reste permis. */
.citation {
  margin: 0;
  font-family: var(--font-titre);
  font-style: italic;
  font-size: var(--fs-16);
  line-height: 1.3;
}

.temoignage--vedette .citation {
  font-size: var(--fs-20);
}

.auteur {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: var(--fs-14);
  line-height: 1.35;
  color: var(--texte-secondaire);
}

.nom {
  color: var(--encre);
}

.initiale {
  display: grid;
  flex: none;
  place-items: center;
  width: 2.75rem;
  height: 2.75rem;
  border-radius: 50%;
  background: var(--accent);
  color: var(--sur-accent);
  font-family: var(--font-titre);
  font-size: var(--fs-20);
}

.exemple {
  margin: 0;
  font-size: var(--fs-14);
  color: var(--texte-secondaire);
}
</style>
