<script setup lang="ts">
// Vitrine d'exemple « lien en bio » : montrée dans le cadre collant (grand écran) ET dans chaque étape (petit écran).
import { LIEN_BIO_DEMO } from '~/data/landing'

const TEXTES = { apercu: 'Exemple de vitrine', etiquette: 'Lien en bio' } as const

const avatar = useImageLanding('medecin', 128)
</script>

<template>
  <div class="cadre" role="img" :aria-label="TEXTES.apercu">
    <p class="etiquette" style="--k: 0">
      {{ TEXTES.etiquette }}
    </p>
    <div class="profil" style="--k: 1">
      <NuxtImg
        class="avatar"
        :src="avatar.src"
        :alt="avatar.alt"
        :width="avatar.width"
        :height="avatar.height"
        format="webp"
        loading="lazy"
      />
      <div>
        <p class="nom">
          {{ LIEN_BIO_DEMO.nom }}
        </p>
        <p class="precision">
          {{ LIEN_BIO_DEMO.precision }}
        </p>
      </div>
    </div>
    <span
      v-for="(lien, i) in LIEN_BIO_DEMO.liens"
      :key="lien.libelle"
      class="lien"
      :class="{ 'lien--principal': lien.principal }"
      :style="{ '--k': i + 2 }"
    >
      <span>{{ lien.libelle }}</span>
      <UIcon name="i-ph-arrow-right" class="size-5" aria-hidden="true" />
    </span>
  </div>
</template>

<style scoped>
.cadre {
  display: flex;
  flex: 1;
  flex-direction: column;
  justify-content: center;
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

.profil {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  margin-bottom: 0.25rem;
}

.avatar {
  flex: none;
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  object-fit: cover;
  object-position: 50% 25%;
}

.nom {
  margin: 0;
  font-family: var(--font-titre);
  font-size: var(--fs-24);
  font-weight: 500;
  line-height: 1.15;
}

.precision {
  margin: 0;
  font-size: var(--fs-14);
  color: var(--texte-secondaire);
}

.lien {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 3.25rem;
  padding: 0 1.25rem;
  border: 1.5px solid var(--bordure);
  border-radius: 99px;
  background: var(--fond);
  color: var(--encre);
  font-size: var(--fs-16);
  font-weight: 600;
}

.lien--principal {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--sur-accent);
}

</style>
