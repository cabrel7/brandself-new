<script setup lang="ts">
// « Pour qui » : pile de cartes photo collantes. Chaque carte suivante recouvre la précédente, qui se réduit et s'assombrit.
// Tout le contenu est dans le HTML serveur ; l'effet (échelle et luminosité) s'ajoute après montage, sauf en mouvement réduit.
import { METIERS_DEMO } from '~/data/landing'

const TEXTES = {
  surtitre: 'Pour qui',
  titre: 'Pour celles et ceux qui vendent leur expertise.',
  exemple: 'Métiers et villes en exemple.',
} as const

// Intensité de l'effet de pile : réduction d'échelle et de luminosité de la carte entièrement recouverte,
// et part de la hauteur d'écran sur laquelle une carte entrante agit sur celles du dessous.
const REDUCTION_ECHELLE = 0.028
const REDUCTION_LUMINOSITE = 0.07
const PORTEE_ECRAN = 0.55
const LARGEUR_PHOTO_PX = 1000

const metiers = METIERS_DEMO.map(metier => ({ ...metier, photo: useImageLanding(metier.image, LARGEUR_PHOTO_PX) }))

const mouvement = usePreferredReducedMotion()
const cartes = useTemplateRef<HTMLElement[]>('refCartes')
const actif = ref(false)

let imageAnimation = 0
// Position collée de la première carte et écart entre deux cartes : lus dans le CSS rendu, jamais dupliqués ici.
let hautBase = 0
let pas = 0

function borner(valeur: number): number {
  return Math.min(1, Math.max(0, valeur))
}

function mesurer() {
  const liste = cartes.value ?? []
  const premiere = liste[0]
  const seconde = liste[1]
  if (!premiere) return
  hautBase = Number.parseFloat(getComputedStyle(premiere).top)
  pas = seconde ? Number.parseFloat(getComputedStyle(seconde).top) - hautBase : 0
}

function reinitialiser() {
  for (const carte of cartes.value ?? []) {
    carte.style.removeProperty('transform')
    carte.style.removeProperty('filter')
  }
}

function mettreAJour() {
  imageAnimation = 0
  const liste = cartes.value ?? []
  const hauteurEcran = window.innerHeight
  liste.forEach((carte, i) => {
    let recouvrement = 0
    for (let j = i + 1; j < liste.length; j++) {
      const suivante = liste[j]
      if (!suivante) continue
      recouvrement += borner(1 - (suivante.getBoundingClientRect().top - (hautBase + j * pas)) / (hauteurEcran * PORTEE_ECRAN))
    }
    carte.style.transform = `scale(${(1 - REDUCTION_ECHELLE * recouvrement).toFixed(4)})`
    carte.style.filter = `brightness(${(1 - REDUCTION_LUMINOSITE * recouvrement).toFixed(3)})`
  })
}

function planifier() {
  if (!actif.value || imageAnimation) return
  imageAnimation = requestAnimationFrame(mettreAJour)
}

function surRedimensionnement() {
  mesurer()
  planifier()
}

// Écouteurs retirés automatiquement au démontage.
useEventListener('scroll', planifier, { passive: true })
useEventListener('resize', surRedimensionnement)

onMounted(() => {
  actif.value = mouvement.value !== 'reduce'
  if (actif.value) {
    mesurer()
    mettreAJour()
  }
})

watch(mouvement, (valeur) => {
  actif.value = valeur !== 'reduce'
  if (actif.value) {
    mesurer()
    mettreAJour()
  }
  else {
    reinitialiser()
  }
})

onBeforeUnmount(() => {
  if (imageAnimation) cancelAnimationFrame(imageAnimation)
  imageAnimation = 0
})
</script>

<template>
  <section id="pour-qui" class="pour-qui" aria-labelledby="pour-qui-titre">
    <div class="conteneur">
      <MarketingTitreRubrique :surtitre="TEXTES.surtitre" :titre="TEXTES.titre" titre-id="pour-qui-titre" />
    </div>

    <div class="conteneur pile">
      <article
        v-for="(metier, i) in metiers"
        :key="metier.metier"
        ref="refCartes"
        class="carte"
        :class="{ 'carte--animee': actif }"
        :style="{ '--i': i }"
      >
        <NuxtImg
          class="photo"
          :src="metier.photo.src"
          :alt="metier.photo.alt"
          :width="metier.photo.width"
          :height="metier.photo.height"
          format="webp"
          loading="lazy"
        />
        <span class="voile" aria-hidden="true" />
        <span class="fantome" aria-hidden="true">{{ metier.ville }}</span>
        <p class="onglet">
          <span aria-hidden="true">{{ metier.metier }}</span>
          <span class="onglet-ville">{{ metier.ville }}</span>
        </p>
        <div class="contenu">
          <h3 class="metier">
            {{ metier.metier }}
          </h3>
          <p class="phrase">
            {{ metier.phrase }}
          </p>
        </div>
      </article>
      <p class="exemple">
        {{ TEXTES.exemple }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.pour-qui {
  padding-block: 5rem 0;
}

.conteneur {
  width: 100%;
  max-width: 72.5rem;
  margin-inline: auto;
  padding-inline: max(1rem, env(safe-area-inset-left, 0px)) max(1rem, env(safe-area-inset-right, 0px));
}

.pile {
  padding-bottom: 6svh;
}

/* Cartes collantes : la carte n°i se colle à (barre de navigation + i x pas), laissant visible l'onglet des cartes du dessous. */
.carte {
  --pas: 2.5rem;

  position: sticky;
  top: calc(5.25rem + var(--i) * var(--pas));
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  height: max(25rem, calc(100svh - 5.25rem - 4 * var(--pas) - 1.75rem));
  max-height: 40rem;
  margin-bottom: 7svh;
  padding: 1.375rem;
  overflow: hidden;
  border-radius: var(--rayon-carte);
  background: var(--encre);
  color: var(--champ);
  transform-origin: 50% 0;
}

.carte--animee {
  will-change: transform;
}

.photo {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 28%;
}

/* Voile : garde le texte lisible sur n'importe quelle photo. */
.voile {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--encre) 46%, transparent);
}

.contenu {
  position: relative;
}

/* Texte fantôme : seulement dès 768 px, il gênerait la lecture sur téléphone. */
.fantome {
  display: none;
  position: absolute;
  left: 1.375rem;
  bottom: -0.16em;
  font-family: var(--font-titre);
  font-weight: 600;
  font-size: clamp(5.5rem, 20vw, 15.625rem);
  line-height: 1;
  letter-spacing: -0.04em;
  white-space: nowrap;
  opacity: 0.17;
  pointer-events: none;
}

.onglet {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  gap: 0.625rem;
  align-items: center;
  height: var(--pas);
  margin: 0;
  padding: 0 1.375rem;
  background: color-mix(in srgb, var(--encre) 35%, transparent);
  font-size: var(--fs-14);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.onglet-ville {
  font-weight: 500;
  color: var(--fond);
}

.metier {
  margin: 0;
  font-family: var(--font-titre);
  font-weight: 500;
  font-size: clamp(2.25rem, 5.4vw, 4rem);
  line-height: 1.02;
  letter-spacing: -0.012em;
}

.phrase {
  max-width: 24em;
  margin: 0.625rem 0 0;
  font-size: var(--fs-20);
  line-height: 1.4;
  color: var(--fond);
}

.exemple {
  margin: 0;
  font-size: var(--fs-14);
  text-align: center;
  color: var(--texte-secondaire);
}

@media (min-width: 48rem) {
  .fantome {
    display: block;
  }
}

@media (min-width: 60.0625rem) {
  .pour-qui {
    padding-block: 7.5rem 0;
  }

  .carte {
    --pas: 3.5rem;

    padding: 1.75rem;
  }

  .onglet {
    padding: 0 1.75rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .carte {
    will-change: auto;
    transform: none !important;
    filter: none !important;
  }
}
</style>
