<script setup lang="ts">
// « Être compris » : 4 étapes à lire, et la vitrine d'exemple qui change avec l'étape (cadre collant sur grand écran).
// Sous 961 px le cadre collant disparaît : chaque étape porte sa propre vitrine, qui apparaît en cascade à l'entrée à l'écran.
// Le contenu des deux affichages vient des MÊMES composants Cadre* ; tout le texte est présent dans le HTML serveur.
import { ETAPES_COMPRIS } from '~/data/landing'
import CadreLienBio from './CadreLienBio.vue'
import CadreRealisation from './CadreRealisation.vue'
import CadreServices from './CadreServices.vue'
import CadreTemoignages from './CadreTemoignages.vue'

const TEXTES = {
  surtitre: 'Être compris',
  titre: 'Ce que vous faites, simplement dit.',
  apercu: 'Aperçu d’une vitrine d’exemple',
} as const

// Même ordre que ETAPES_COMPRIS : services, réalisation, témoignages, lien en bio.
const CADRES = [CadreServices, CadreRealisation, CadreTemoignages, CadreLienBio] as const

// Zone de lecture : une étape devient « lue » quand elle traverse la bande centrale de l'écran.
const MARGE_LECTURE = '-45% 0px -45% 0px'
const SEUIL_APPARITION = 0.18

const etapeLue = ref(0)
const etapesVues = ref<boolean[]>(ETAPES_COMPRIS.map(() => false))
const etapes = useTemplateRef<HTMLElement[]>('refEtapes')

let observateurLecture: IntersectionObserver | null = null
let observateurApparition: IntersectionObserver | null = null

function indexDe(element: Element): number {
  return Number((element as HTMLElement).dataset.i)
}

onMounted(() => {
  const elements = etapes.value ?? []
  if (typeof IntersectionObserver === 'undefined') {
    // Sans observateur, rien ne déclencherait l'apparition : tout est montré.
    etapesVues.value = etapesVues.value.map(() => true)
    return
  }

  observateurLecture = new IntersectionObserver(
    (entrees) => {
      for (const entree of entrees) {
        if (entree.isIntersecting) etapeLue.value = indexDe(entree.target)
      }
    },
    { rootMargin: MARGE_LECTURE },
  )

  observateurApparition = new IntersectionObserver(
    (entrees) => {
      for (const entree of entrees) {
        if (!entree.isIntersecting) continue
        etapesVues.value[indexDe(entree.target)] = true
        observateurApparition?.unobserve(entree.target)
      }
    },
    { threshold: SEUIL_APPARITION },
  )

  for (const element of elements) {
    observateurLecture.observe(element)
    observateurApparition.observe(element)
  }
})

onBeforeUnmount(() => {
  observateurLecture?.disconnect()
  observateurApparition?.disconnect()
  observateurLecture = null
  observateurApparition = null
})
</script>

<template>
  <section id="compris" class="compris" aria-labelledby="compris-titre">
    <div class="conteneur">
      <MarketingTitreRubrique :surtitre="TEXTES.surtitre" :titre="TEXTES.titre" titre-id="compris-titre" />
    </div>

    <div class="conteneur grille">
      <div class="etapes">
        <article
          v-for="(etape, i) in ETAPES_COMPRIS"
          :key="etape.titre"
          ref="refEtapes"
          class="etape"
          :class="{ 'etape--vue': etapesVues[i] }"
          :data-i="i"
        >
          <div class="texte">
            <h3 class="etape-titre">
              {{ etape.titre }}
            </h3>
            <p class="etape-description">
              {{ etape.description }}
            </p>
            <ul class="points">
              <li v-for="point in etape.points" :key="point">
                <UIcon name="i-ph-check" class="coche" aria-hidden="true" />
                <span>{{ point }}</span>
              </li>
            </ul>
          </div>
          <div class="cliche" :class="{ 'cliche--vue': etapesVues[i] }">
            <div class="cliche-cadre">
              <component :is="CADRES[i]" />
            </div>
          </div>
        </article>
      </div>

      <div class="scene">
        <div class="vitrine" role="group" :aria-label="TEXTES.apercu">
          <div
            v-for="(Cadre, i) in CADRES"
            :key="i"
            class="couche"
            :class="{ 'couche--active': etapeLue === i }"
            :inert="etapeLue === i ? undefined : true"
          >
            <component :is="Cadre" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Barre de navigation fixe de la page d'accueil : hauteur à laquelle le cadre se colle. */
.compris {
  --compris-haut: 4.5rem;

  padding-block: 5rem 2.5rem;
}

.conteneur {
  width: 100%;
  max-width: 72.5rem;
  margin-inline: auto;
  padding-inline: max(1rem, env(safe-area-inset-left, 0px)) max(1rem, env(safe-area-inset-right, 0px));
}

.grille {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
}

.scene {
  display: none;
}

/* ---------- Étapes (petit écran : une colonne ; tablette : texte/vitrine en alternance) ---------- */

.etape {
  display: flex;
  flex-direction: column;
  gap: 0.875rem;
  padding-block: 2.25rem;
  border-top: 1px solid var(--bordure);
}

.etape:first-child {
  border-top: 0;
}

.texte {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.etape-titre {
  margin: 0;
  font-family: var(--font-titre);
  font-weight: 500;
  font-size: clamp(2rem, 3.6vw, 2.75rem);
  line-height: 1.1;
  letter-spacing: -0.012em;
  text-wrap: balance;
}

.etape-description {
  max-width: 22em;
  margin: 0;
  font-size: var(--fs-20);
  line-height: 1.5;
  color: var(--texte-secondaire);
}

.points {
  display: grid;
  gap: 0.625rem;
  max-width: 24em;
  margin: 0.625rem 0 0;
  padding: 0;
  list-style: none;
}

.points li {
  display: grid;
  grid-template-columns: 1.25rem minmax(0, 1fr);
  gap: 0.5rem;
  align-items: start;
  font-size: var(--fs-16);
  line-height: 1.4;
}

.coche {
  width: 1.25rem;
  height: 1.25rem;
  margin-top: 0.0625rem;
  color: var(--accent-texte);
}

.cliche-cadre {
  display: flex;
  flex-direction: column;
  padding: 1.25rem;
  border: 1px solid var(--bordure);
  border-radius: var(--rayon-carte);
  background: var(--champ);
}

/* ---------- Apparition en cascade (sous 961 px, jamais en mouvement réduit) ---------- */
/* L'état initial (masqué) est posé par CSS dès le rendu serveur : plus de contenu visible puis masqué à l'hydratation.
   Amélioration progressive : `scripting: enabled` n'est vrai que si le JavaScript peut s'exécuter ; sans JS (ou dans un
   navigateur qui ne connaît pas cette condition, la requête est alors fausse), rien n'est masqué et tout le contenu reste lisible.
   `prefers-reduced-motion: no-preference` est évalué en direct par le navigateur : aucun effet en mouvement réduit.
   La transition ne s'applique qu'à l'ENTRÉE (état « vue ») : le masquage initial est immédiat, sans fondu qui fausserait
   le contraste mesuré par un test d'accessibilité. */

@media (max-width: 60rem) and (prefers-reduced-motion: no-preference) and (scripting: enabled) {
  .etape:not(.etape--vue) .texte {
    opacity: 0;
    transform: translateY(1.125rem);
  }

  .etape.etape--vue .texte {
    opacity: 1;
    transform: none;
    transition:
      opacity 600ms ease-out,
      transform 600ms ease-out;
  }

  .cliche:not(.cliche--vue) :deep(.cadre > *) {
    opacity: 0;
    transform: translateY(1.625rem);
  }

  .cliche:not(.cliche--vue) :deep(.cadre > .principale) {
    transform: translateY(1.625rem) scale(0.92);
  }

  .cliche.cliche--vue :deep(.cadre > *) {
    opacity: 1;
    transform: none;
    transition:
      opacity 650ms ease-out,
      transform 650ms cubic-bezier(0.2, 0.7, 0.2, 1);
    transition-delay: calc(var(--k, 0) * 110ms);
  }
}

@media (min-width: 42.5rem) and (max-width: 60rem) {
  .etape {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 2rem;
    align-items: center;
    padding-block: 2.75rem;
  }

  .etape:nth-child(even) .texte {
    order: 2;
  }
}

/* ---------- Grand écran : cadre collant ---------- */

@media (min-width: 60.0625rem) {
  .compris {
    padding-block: 7.5rem 0;
  }

  .grille {
    grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
    gap: 4rem;
  }

  .etape {
    justify-content: center;
    min-height: 78svh;
    padding-block: 0;
    border-top: 0;
  }

  .cliche {
    display: none;
  }

  .scene {
    position: sticky;
    top: var(--compris-haut);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 0;
    height: calc(100svh - var(--compris-haut));
  }

  .vitrine {
    position: relative;
    width: 100%;
    max-width: 32.5rem;
    height: min(36.875rem, 84svh);
    overflow: hidden;
    border: 1px solid var(--bordure);
    border-radius: var(--rayon-carte);
    background: var(--champ);
    box-shadow: 0 1.875rem 3.75rem -2.375rem color-mix(in srgb, var(--encre) 50%, transparent);
  }

  .couche {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    padding: 1.5rem;
    opacity: 0;
    transition: opacity 350ms ease-out;
    pointer-events: none;
  }

  .couche--active {
    opacity: 1;
    pointer-events: auto;
  }
}

@media (prefers-reduced-motion: reduce) {
  .couche {
    transition: none;
  }
}
</style>
