<script setup lang="ts">
// Vitrine d'exemple « services » : montrée dans le cadre collant (grand écran) ET dans chaque étape (petit écran).
import { SERVICES_DEMO } from '~/data/landing'

const TEXTES = { apercu: 'Exemple de vitrine', etiquette: 'Services · à la une', reserver: 'Réserver' } as const

// Affichée à 84 px : version à 2 fois la densité.
const LARGEUR_MINIATURE_PX = 168

const services = SERVICES_DEMO.map(service => ({ ...service, photo: useImageLanding(service.image, LARGEUR_MINIATURE_PX) }))
</script>

<template>
  <div class="cadre" role="img" :aria-label="TEXTES.apercu">
    <p class="etiquette" style="--k: 0">
      {{ TEXTES.etiquette }}
    </p>
    <article v-for="(service, i) in services" :key="service.titre" class="service" :style="{ '--k': i + 1 }">
      <NuxtImg
        class="miniature"
        :src="service.photo.src"
        :alt="service.photo.alt"
        :width="service.photo.width"
        :height="service.photo.height"
        format="webp"
        loading="lazy"
      />
      <div class="corps">
        <p class="nom">
          {{ service.titre }}
        </p>
        <p class="description">
          {{ service.description }}
        </p>
        <p class="meta">
          {{ service.meta }}
        </p>
      </div>
      <span class="reserver">{{ TEXTES.reserver }}</span>
    </article>
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

.service {
  display: grid;
  grid-template-columns: 4rem minmax(0, 1fr);
  gap: 0.875rem;
  align-items: center;
  padding: 0.6875rem;
  border: 1px solid var(--bordure);
  border-radius: var(--rayon);
  background: var(--fond);
}

.miniature {
  width: 4rem;
  height: 4rem;
  border-radius: var(--rayon-interne);
  object-fit: cover;
}

.nom {
  margin: 0;
  font-family: var(--font-titre);
  font-size: var(--fs-20);
  font-weight: 500;
  line-height: 1.2;
}

.description {
  margin: 0.1875rem 0 0.3125rem;
  font-size: var(--fs-14);
  line-height: 1.4;
  color: var(--texte-secondaire);
}

.meta {
  margin: 0;
  font-size: var(--fs-14);
  font-weight: 600;
  color: var(--accent-texte);
}

.reserver {
  grid-column: 1 / -1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: var(--cible-tactile);
  padding: 0 1rem;
  border-radius: var(--rayon-interne);
  background: var(--accent);
  color: var(--sur-accent);
  font-size: var(--fs-14);
  font-weight: 600;
}

@media (min-width: 32.5rem) {
  .service {
    grid-template-columns: 5.25rem minmax(0, 1fr) auto;
  }

  .miniature {
    width: 5.25rem;
    height: 5.25rem;
  }

  .reserver {
    grid-column: auto;
  }
}
</style>
