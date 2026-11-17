<script setup lang="ts">
// Vitrine d'exemple « réalisation » : montrée dans le cadre collant (grand écran) ET dans chaque étape (petit écran).
import { REALISATION_DEMO } from '~/data/landing'

const TEXTES = { apercu: 'Exemple de vitrine', etiquette: 'Réalisations · à la une' } as const

const [clePrincipale, cleSecondeA, cleSecondeB] = REALISATION_DEMO.images
const principale = useImageLanding(clePrincipale, 1040)
const secondaires = [useImageLanding(cleSecondeA, 520), useImageLanding(cleSecondeB, 520)]
</script>

<template>
  <div class="cadre" role="img" :aria-label="TEXTES.apercu">
    <p class="etiquette" style="--k: 0">
      {{ TEXTES.etiquette }}
    </p>
    <NuxtImg
      class="principale"
      style="--k: 1"
      :src="principale.src"
      :alt="principale.alt"
      :width="principale.width"
      :height="principale.height"
      format="webp"
      loading="lazy"
    />
    <div class="secondaires" style="--k: 2">
      <NuxtImg
        v-for="image in secondaires"
        :key="image.src"
        class="secondaire"
        :src="image.src"
        :alt="image.alt"
        :width="image.width"
        :height="image.height"
        format="webp"
        loading="lazy"
      />
    </div>
    <p class="nom" style="--k: 3">
      {{ REALISATION_DEMO.titre }}
    </p>
    <p class="description" style="--k: 4">
      {{ REALISATION_DEMO.description }}
    </p>
    <ul class="etiquettes" style="--k: 5">
      <li v-for="etiquette in REALISATION_DEMO.etiquettes" :key="etiquette">
        {{ etiquette }}
      </li>
    </ul>
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

.principale {
  width: 100%;
  height: clamp(7.5rem, 22svh, 12.5rem);
  border-radius: var(--rayon);
  object-fit: cover;
}

.secondaires {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.75rem;
}

.secondaire {
  width: 100%;
  height: clamp(3.75rem, 11svh, 6rem);
  border-radius: var(--rayon-interne);
  object-fit: cover;
}

.nom {
  margin: 0;
  font-family: var(--font-titre);
  font-size: var(--fs-24);
  font-weight: 500;
  line-height: 1.2;
}

.description {
  margin: 0;
  font-size: var(--fs-16);
  line-height: 1.45;
  color: var(--texte-secondaire);
}

.etiquettes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.etiquettes li {
  padding: 0.3125rem 0.75rem;
  border: 1px solid var(--bordure);
  border-radius: 99px;
  background: var(--surface);
  font-size: var(--fs-14);
  font-weight: 600;
}
</style>
