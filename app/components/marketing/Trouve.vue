<script setup lang="ts">
// « Être trouvé » : un navigateur factice joue la scène Google -> résultats -> vitrine.
// État de repos (serveur, sans JavaScript, mouvement réduit, hors écran) : les résultats sont visibles, rien ne bouge.
// La scène ne joue que lorsque la partie est au premier plan ; elle repart à chaque retour et revient au repos en sortant.
import { ROUTE_EXEMPLE } from '~/data/landing'
import { MARQUE } from '#shared/brand'

type Scene = 'accueil' | 'resultats' | 'vitrine'

interface Extrait {
  texte: string
  gras?: boolean
}

interface Resultat {
  hote: string
  url: string
  titre: string
  extrait: readonly Extrait[]
  vitrine?: boolean
}

const REQUETE = 'cardiologue douala'
const NOM_VITRINE_EXEMPLE = 'Dr Cabrel Nguesso'
const ADRESSE_VITRINE_EXEMPLE = `${MARQUE.domaine}${ROUTE_EXEMPLE}`

const TEXTES = {
  surtitre: 'Être trouvé',
  titre: 'Quand on cherche « cardiologue Douala », c’est vous qu’on voit.',
  apercu: 'Illustration : une recherche sur Google, puis l’ouverture de la vitrine',
  exemple: 'Exemple : résultats fictifs.',
  rejouer: 'Rejouer la scène',
  onglets: ['Tous', 'Images', 'Maps', 'Actualités'],
} as const

const PAGES: Record<Scene, { titre: string, adresse: string }> = {
  accueil: { titre: 'Google', adresse: 'google.com' },
  resultats: { titre: `${REQUETE} - Recherche Google`, adresse: `google.com/search?q=${REQUETE.replace(' ', '+')}` },
  vitrine: { titre: NOM_VITRINE_EXEMPLE, adresse: ADRESSE_VITRINE_EXEMPLE },
}

const RESULTATS: readonly Resultat[] = [
  {
    hote: MARQUE.nom,
    url: `${MARQUE.domaine} › ${ROUTE_EXEMPLE.replace('/', '')}`,
    titre: `${NOM_VITRINE_EXEMPLE}, cardiologue interventionnel à Douala`,
    extrait: [
      { texte: 'Consultations, bilans et suivi ' },
      { texte: 'cardiovasculaire', gras: true },
      { texte: ' à ' },
      { texte: 'Douala', gras: true },
      { texte: '. Réservez votre rendez-vous en ligne en quelques instants.' },
    ],
    vitrine: true,
  },
  {
    hote: 'Annuaire de santé',
    url: 'annuaire-exemple.test › douala',
    titre: 'Liste de cardiologues à Douala',
    extrait: [{ texte: 'Coordonnées et horaires des cabinets de cardiologie de la ville.' }],
  },
  {
    hote: 'Cliniques de Douala',
    url: 'cliniques-exemple.test',
    titre: 'Cliniques et hôpitaux à Douala',
    extrait: [{ texte: 'Services de cardiologie, urgences et consultations.' }],
  },
]

// Déroulé de la scène (millisecondes).
const DEBUT_SAISIE = 700
const PAS_FRAPPE = 80
const PAUSE_APRES_SAISIE = 650
const DECALAGES_RESULTATS = [300, 600, 800] as const
const DUREE_AFFICHAGE_RESULTATS = 2100
const DUREE_DEPLACEMENT_CURSEUR = 1200
const DELAI_CLIC_VERS_VITRINE = 520
const DELAI_FIN = 600

// Position du curseur : départ en bas à droite de la fenêtre, arrivée sur le résultat de la vitrine.
const DEPART_CURSEUR = { droite: 140, bas: 60 } as const
const ARRIVEE_CURSEUR = { partLargeur: 0.35, largeurMax: 220, decalageY: 38 } as const

const logoGoogle = useImageLanding('google')
const capture = useImageLanding('vitrinePc', 1200)

const mouvement = usePreferredReducedMotion()
const reduit = computed(() => mouvement.value === 'reduce')
const monte = ref(false)

const navigateur = useTemplateRef<HTMLElement>('refNavigateur')
const corps = useTemplateRef<HTMLElement>('refCorps')

const scene = ref<Scene>('resultats')
const animation = ref(false)
const resultatsVisibles = ref<boolean[]>(RESULTATS.map(() => true))
const surligne = ref(true)
const saisie = ref('')
const curseur = reactive({ visible: false, glisse: false, x: 0, y: 0 })
const clic = reactive({ compte: 0, x: 0, y: 0 })
const distanceDefilement = ref(0)

const page = computed(() => PAGES[scene.value])

let minuteries: ReturnType<typeof setTimeout>[] = []
let images: number[] = []

function planifier(delai: number, action: () => void) {
  minuteries.push(setTimeout(action, delai))
}

function imageSuivante(action: () => void) {
  images.push(requestAnimationFrame(action))
}

function arreter() {
  minuteries.forEach(clearTimeout)
  images.forEach(cancelAnimationFrame)
  minuteries = []
  images = []
}

/** État de repos : résultats visibles, résultat de la vitrine encadré. */
function repos() {
  arreter()
  animation.value = false
  resultatsVisibles.value = RESULTATS.map(() => true)
  surligne.value = true
  saisie.value = ''
  curseur.visible = false
  clic.compte = 0
  scene.value = 'resultats'
}

function centreDuResultat(): { x: number, y: number } | null {
  const element = corps.value?.querySelector<HTMLElement>('[data-vitrine]')
  if (!element || !corps.value) return null
  const a = element.getBoundingClientRect()
  const b = corps.value.getBoundingClientRect()
  return {
    x: a.left - b.left + Math.min(a.width * ARRIVEE_CURSEUR.partLargeur, ARRIVEE_CURSEUR.largeurMax),
    y: a.top - b.top + ARRIVEE_CURSEUR.decalageY,
  }
}

function deplacerCurseur() {
  const cible = centreDuResultat()
  const zone = corps.value
  if (!cible || !zone) return
  // 1) le curseur apparaît au point de départ sans transition, 2) il glisse vers sa cible au rendu suivant.
  curseur.glisse = false
  curseur.x = zone.clientWidth - DEPART_CURSEUR.droite
  curseur.y = zone.clientHeight - DEPART_CURSEUR.bas
  curseur.visible = true
  imageSuivante(() => imageSuivante(() => {
    curseur.glisse = true
    curseur.x = cible.x
    curseur.y = cible.y
  }))
}

function cliquer() {
  const cible = centreDuResultat()
  if (!cible) return
  clic.x = cible.x
  clic.y = cible.y
  clic.compte += 1
}

function jouer() {
  if (reduit.value) {
    repos()
    return
  }
  arreter()
  animation.value = true
  resultatsVisibles.value = RESULTATS.map(() => false)
  surligne.value = false
  curseur.visible = false
  clic.compte = 0
  saisie.value = ''
  scene.value = 'accueil'

  let t = DEBUT_SAISIE
  for (let n = 1; n <= REQUETE.length; n++) {
    planifier(t + n * PAS_FRAPPE, () => {
      saisie.value = REQUETE.slice(0, n)
    })
  }
  t += REQUETE.length * PAS_FRAPPE + PAUSE_APRES_SAISIE
  planifier(t, () => {
    scene.value = 'resultats'
  })
  DECALAGES_RESULTATS.forEach((decalage, i) => {
    planifier(t + decalage, () => {
      resultatsVisibles.value[i] = true
    })
  })
  t += DUREE_AFFICHAGE_RESULTATS
  planifier(t, deplacerCurseur)
  t += DUREE_DEPLACEMENT_CURSEUR
  planifier(t, cliquer)
  t += DELAI_CLIC_VERS_VITRINE
  planifier(t, () => {
    scene.value = 'vitrine'
    curseur.visible = false
  })
  t += DELAI_FIN
  planifier(t, () => {
    animation.value = false
  })
}

// La partie passe au premier plan : la scène joue. Elle repart à chaque retour et se remet au repos en sortant.
useScenePremierPlan(navigateur, {
  seuil: 0.6,
  auEntree: () => {
    if (!reduit.value) jouer()
  },
  auSortie: repos,
})

watch(reduit, (valeur) => {
  if (valeur) repos()
})

// Distance de défilement de la capture de la vitrine : hauteur de l'image moins celle de la fenêtre.
function mesurerDefilement() {
  const image = corps.value?.querySelector<HTMLImageElement>('.capture')
  const zone = corps.value
  if (!image || !zone) return
  distanceDefilement.value = Math.max(0, image.clientHeight - zone.clientHeight)
}

useResizeObserver(corps, mesurerDefilement)

onMounted(() => {
  monte.value = true
  mesurerDefilement()
})

onBeforeUnmount(arreter)
</script>

<template>
  <section id="trouve" class="trouve" aria-labelledby="trouve-titre">
    <!--
      Illustration d'interfaces TIERCES (page Google, barre du navigateur) : leurs couleurs sont celles de ces produits,
      pas celles de la marque. Elles sont déclarées ICI, une seule fois, dans le bloc --mock-* du CSS ci-dessous.
    -->
    <div class="conteneur">
      <MarketingTitreRubrique :surtitre="TEXTES.surtitre" :titre="TEXTES.titre" titre-id="trouve-titre" />

      <div
        ref="refNavigateur"
        class="navigateur"
        role="group"
        :aria-label="TEXTES.apercu"
        :style="{ '--distance': `${distanceDefilement}px` }"
      >
        <div class="onglets">
          <div class="pastilles" aria-hidden="true">
            <span /><span /><span />
          </div>
          <div class="onglet">
            <span class="favicon" aria-hidden="true">
              <span v-if="scene === 'vitrine'" class="favicon-j">j</span>
              <UIcon v-else name="i-ph-magnifying-glass" class="size-4" />
            </span>
            <span class="onglet-titre">{{ page.titre }}</span>
          </div>
        </div>

        <div class="barre">
          <UIcon name="i-ph-arrow-left" class="size-5 icone-barre" aria-hidden="true" />
          <UIcon name="i-ph-arrow-right" class="size-5 icone-barre" aria-hidden="true" />
          <UIcon name="i-ph-arrow-clockwise" class="size-5 icone-barre" aria-hidden="true" />
          <div class="adresse">
            <UIcon name="i-ph-lock-simple" class="size-4" aria-hidden="true" />
            <span class="adresse-texte">{{ page.adresse }}</span>
          </div>
        </div>

        <div ref="refCorps" class="corps">
          <div class="scene scene-accueil" :class="{ 'scene--visible': scene === 'accueil' }" aria-hidden="true">
            <img class="logo-grand" :src="logoGoogle.src" :alt="logoGoogle.alt" :width="logoGoogle.width" :height="logoGoogle.height" loading="lazy">
            <div class="champ-recherche">
              <UIcon name="i-ph-magnifying-glass" class="size-5 icone-champ" />
              <span class="requete">{{ saisie }}</span>
            </div>
          </div>

          <div class="scene scene-resultats" :class="{ 'scene--visible': scene === 'resultats' }">
            <div class="haut">
              <img class="logo-petit" :src="logoGoogle.src" :alt="logoGoogle.alt" :width="logoGoogle.width" :height="logoGoogle.height" loading="lazy">
              <div class="champ-recherche champ-recherche--compact">
                <UIcon name="i-ph-magnifying-glass" class="size-5 icone-champ" aria-hidden="true" />
                <span class="requete-fixe">{{ REQUETE }}</span>
              </div>
            </div>
            <ul class="filtres" aria-hidden="true">
              <li v-for="(filtre, i) in TEXTES.onglets" :key="filtre" :class="{ 'filtre--actif': i === 0 }">
                {{ filtre }}
              </li>
            </ul>
            <ul class="liste">
              <li
                v-for="(resultat, i) in RESULTATS"
                :key="resultat.titre"
                class="resultat"
                :class="{
                  'resultat--estompe': !resultat.vitrine,
                  'resultat--vitrine': resultat.vitrine,
                  'resultat--surligne': resultat.vitrine && surligne,
                  'resultat--cache': animation && !resultatsVisibles[i],
                }"
                :data-vitrine="resultat.vitrine ? '' : undefined"
              >
                <div class="source">
                  <span class="icone-site" :class="{ 'icone-site--marque': resultat.vitrine }" aria-hidden="true">
                    <template v-if="resultat.vitrine">j</template>
                  </span>
                  <span>
                    {{ resultat.hote }}
                    <small>{{ resultat.url }}</small>
                  </span>
                </div>
                <p class="resultat-titre">
                  {{ resultat.titre }}
                </p>
                <p class="extrait">
                  <template v-for="morceau in resultat.extrait" :key="morceau.texte">
                    <b v-if="morceau.gras">{{ morceau.texte }}</b>
                    <template v-else>{{ morceau.texte }}</template>
                  </template>
                </p>
              </li>
            </ul>
          </div>

          <div class="scene scene-vitrine" :class="{ 'scene--visible': scene === 'vitrine' }" aria-hidden="true">
            <NuxtImg
              class="capture"
              :src="capture.src"
              alt=""
              :width="capture.width"
              :height="capture.height"
              format="webp"
              loading="lazy"
              @load="mesurerDefilement"
            />
          </div>

          <span
            class="curseur"
            :class="{ 'curseur--visible': curseur.visible }"
            :style="{ transform: `translate(${curseur.x}px, ${curseur.y}px)`, transition: curseur.glisse ? undefined : 'none' }"
            aria-hidden="true"
          >
            <UIcon name="i-ph-cursor-fill" class="size-6" />
          </span>
          <span
            v-if="clic.compte > 0"
            :key="clic.compte"
            class="onde"
            :style="{ left: `${clic.x}px`, top: `${clic.y}px` }"
            aria-hidden="true"
          />
        </div>
      </div>

      <div class="pied">
        <span>{{ TEXTES.exemple }}</span>
        <BsButton v-if="monte && !reduit" variant="contour" @click="jouer">
          {{ TEXTES.rejouer }}
        </BsButton>
      </div>
    </div>
  </section>
</template>

<style scoped>
.trouve {
  /* Couleurs des interfaces tierces illustrées (Google, barre du navigateur). Seul endroit où elles existent. */
  --mock-page: #fff;
  /* Résultat mis en avant : 60 % de --accent-doux sur --mock-page (valeur fixe, `color-mix` illisible par l'audit Lighthouse). */
  --mock-surbrillance: #f7ebe4;
  --mock-texte: #202124;
  --mock-texte-doux: #4d5156;
  --mock-adresse-texte: #3c4043;
  --mock-icone: #5f6368;
  --mock-icone-clair: #9aa0a6;
  --mock-barre-onglets: #dee1e6;
  --mock-pastille: #b9bdc4;
  --mock-champ-adresse: #f1f3f4;
  --mock-trait: #e3e5e8;
  --mock-bordure-champ: #dfe1e5;
  --mock-lien: #1a0dab;
  --mock-lien-estompe: #5c6bc0;
  --mock-onglet-actif: #1a73e8;
  --mock-police: arial, 'Helvetica Neue', sans-serif;
  --mock-ombre-champ: color-mix(in srgb, var(--mock-texte) 18%, transparent);

  padding-block: 5rem;
  background: var(--surface);
}

.conteneur {
  width: 100%;
  max-width: 72.5rem;
  margin-inline: auto;
  padding-inline: max(1rem, env(safe-area-inset-left, 0px)) max(1rem, env(safe-area-inset-right, 0px));
}

/* ---------- Fenêtre de navigateur ---------- */

.navigateur {
  position: relative;
  max-width: 62.5rem;
  margin-inline: auto;
  overflow: hidden;
  border: 1px solid var(--bordure);
  border-radius: 0.875rem;
  background: var(--mock-page);
  color: var(--mock-texte);
  box-shadow: 0 2.125rem 4.375rem -2.25rem color-mix(in srgb, var(--encre) 55%, transparent);
}

.onglets {
  display: flex;
  align-items: flex-end;
  gap: 0.5rem;
  padding: 0.625rem 0.75rem 0;
  background: var(--mock-barre-onglets);
}

.pastilles {
  display: none;
  gap: 0.4375rem;
  margin-right: 0.375rem;
  padding-bottom: 0.875rem;
}

.pastilles span {
  width: 0.6875rem;
  height: 0.6875rem;
  border-radius: 50%;
  background: var(--mock-pastille);
}

.onglet {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  max-width: 16.25rem;
  padding: 0.5625rem 0.875rem;
  border-radius: 0.625rem 0.625rem 0 0;
  background: var(--mock-page);
  font-size: var(--fs-14);
}

.favicon {
  display: grid;
  flex: none;
  place-items: center;
  width: 1rem;
  height: 1rem;
  color: var(--mock-icone);
}

.favicon-j {
  display: grid;
  place-items: center;
  width: 1rem;
  height: 1rem;
  border-radius: 0.25rem;
  background: var(--accent);
  color: var(--sur-accent);
  font-family: var(--font-titre);
  font-size: var(--fs-12);
  font-weight: 600;
}

.onglet-titre,
.adresse-texte {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.barre {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--mock-trait);
  background: var(--mock-page);
}

.icone-barre {
  flex: none;
  color: var(--mock-icone);
}

.adresse {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.5rem 1rem;
  border-radius: 99px;
  background: var(--mock-champ-adresse);
  color: var(--mock-adresse-texte);
  font-size: var(--fs-14);
}

.corps {
  position: relative;
  height: 25rem;
  overflow: hidden;
  background: var(--mock-page);
}

/* ---------- Scènes ---------- */

.scene {
  position: absolute;
  inset: 0;
  visibility: hidden;
  opacity: 0;
  transition:
    opacity 450ms ease-out,
    visibility 450ms;
}

.scene--visible {
  visibility: visible;
  opacity: 1;
}

.scene-accueil {
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 1.75rem;
}

.logo-grand {
  width: 10rem;
  height: auto;
}

.champ-recherche {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  width: min(35rem, 86%);
  padding: 0.8125rem 1.25rem;
  border: 1px solid var(--mock-bordure-champ);
  border-radius: 99px;
  background: var(--mock-page);
  box-shadow: 0 1px 6px var(--mock-ombre-champ);
  font-size: var(--fs-16);
}

.icone-champ {
  flex: none;
  color: var(--mock-icone-clair);
}

.requete,
.requete-fixe {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-align: left;
}

.requete::after {
  content: '';
  display: inline-block;
  width: 1.5px;
  height: 1.15em;
  margin-left: 1px;
  background: var(--mock-texte);
  vertical-align: -3px;
  animation: clignote 1s steps(1) infinite;
}

@keyframes clignote {
  50% {
    opacity: 0;
  }
}

.scene-resultats {
  padding: 1rem 1rem 0;
  overflow: hidden;
}

.haut {
  display: flex;
  align-items: center;
  gap: 1.625rem;
}

.logo-petit {
  flex: none;
  width: 4rem;
  height: auto;
}

.champ-recherche--compact {
  width: min(36.25rem, 100%);
  padding: 0.625rem 1.125rem;
  border-color: var(--mock-bordure-champ);
  box-shadow: none;
}

.filtres {
  display: flex;
  gap: 1rem;
  margin: 1rem 0 0;
  padding: 0;
  overflow: hidden;
  border-bottom: 1px solid var(--mock-trait);
  color: var(--mock-icone);
  font-size: var(--fs-14);
  list-style: none;
}

.filtres li {
  padding: 0.625rem 0;
}

.filtre--actif {
  border-bottom: 3px solid var(--mock-onglet-actif);
  color: var(--mock-onglet-actif);
  font-weight: 500;
}

.liste {
  display: grid;
  gap: 1.625rem;
  max-width: 38.75rem;
  margin: 1.375rem 0 0;
  padding: 0;
  list-style: none;
}

.resultat {
  border-radius: 0.75rem;
  transition:
    opacity 500ms ease-out,
    transform 500ms ease-out;
}

.resultat--cache {
  opacity: 0;
  transform: translateY(1rem);
}

.resultat--vitrine {
  margin: -0.625rem -0.75rem;
  padding: 0.625rem 0.75rem;
}

.resultat--surligne {
  background: var(--mock-surbrillance);
  box-shadow: 0 0 0 2px var(--accent);
}

.source {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  margin-bottom: 0.25rem;
  font-size: var(--fs-14);
}

.source small {
  display: block;
  color: var(--mock-texte-doux);
  font-size: var(--fs-12);
  line-height: 1.3;
}

.icone-site {
  display: grid;
  flex: none;
  place-items: center;
  width: 1.625rem;
  height: 1.625rem;
  border-radius: 50%;
  background: var(--mock-champ-adresse);
}

.icone-site--marque {
  background: var(--accent);
  color: var(--sur-accent);
  font-family: var(--font-titre);
  font-size: var(--fs-14);
  font-weight: 600;
}

.resultat-titre {
  margin: 0.25rem 0;
  color: var(--mock-lien);
  font-family: var(--mock-police);
  font-size: var(--fs-20);
  line-height: 1.3;
}

.resultat--estompe .resultat-titre {
  color: var(--mock-lien-estompe);
}

.extrait {
  margin: 0;
  color: var(--mock-texte-doux);
  font-family: var(--mock-police);
  font-size: var(--fs-14);
  line-height: 1.58;
}

.extrait b {
  color: var(--mock-texte);
  font-weight: 700;
}

.scene-vitrine {
  overflow: hidden;
  background: var(--mock-page);
}

.capture {
  display: block;
  width: 100%;
  height: auto;
}

.scene-vitrine.scene--visible .capture {
  animation: derive 16s ease-in-out 600ms infinite alternate;
}

@keyframes derive {
  to {
    transform: translateY(calc(-1 * var(--distance, 0px)));
  }
}

/* ---------- Curseur et clic ---------- */

.curseur {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 5;
  width: 1.625rem;
  height: 1.625rem;
  color: var(--mock-texte);
  opacity: 0;
  pointer-events: none;
  filter: drop-shadow(0 2px 3px color-mix(in srgb, var(--mock-texte) 35%, transparent));
  transition:
    transform 900ms cubic-bezier(0.5, 0, 0.2, 1),
    opacity 300ms ease-out;
}

.curseur--visible {
  opacity: 1;
}

.onde {
  position: absolute;
  z-index: 4;
  width: 2.75rem;
  height: 2.75rem;
  margin: -1.375rem 0 0 -1.375rem;
  border: 3px solid var(--accent);
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
  animation: onde 600ms ease-out;
}

@keyframes onde {
  from {
    opacity: 0.9;
    transform: scale(0.3);
  }

  to {
    opacity: 0;
    transform: scale(1.5);
  }
}

.pied {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  max-width: 62.5rem;
  margin: 1.375rem auto 0;
  font-size: var(--fs-14);
  color: var(--texte-secondaire);
}

@media (min-width: 32.5625rem) {
  .pastilles {
    display: flex;
  }

  .corps {
    height: 27.5rem;
  }

  .logo-grand {
    width: 13.75rem;
  }
}

@media (min-width: 60.0625rem) {
  .trouve {
    padding-block: 7.5rem;
  }

  .corps {
    height: 35rem;
  }

  .scene-resultats {
    padding: 1.25rem 1.75rem 0;
  }

  .logo-petit {
    width: 5.75rem;
  }

  .filtres {
    gap: 1.625rem;
    margin-left: 7.375rem;
  }

  .liste {
    margin-left: 7.375rem;
  }
}

@media (prefers-reduced-motion: reduce) {
  .requete::after,
  .scene-vitrine.scene--visible .capture {
    animation: none;
  }
}
</style>
