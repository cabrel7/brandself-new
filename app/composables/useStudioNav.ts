export interface EntreeNav {
  to: string
  label: string
  icon: string
}

export const ENTREES_NAV: readonly EntreeNav[] = [
  { to: '/studio', label: 'Vitrine', icon: 'i-ph-house' },
  { to: '/studio/services', label: 'Services', icon: 'i-ph-briefcase' },
  { to: '/studio/realisations', label: 'Réalisations', icon: 'i-ph-squares-four' },
  { to: '/studio/liens', label: 'Liens', icon: 'i-ph-link' },
  { to: '/studio/agenda', label: 'Agenda', icon: 'i-ph-calendar-blank' },
]

/** Écrans enfants : ils ont leur propre retour, la barre du bas est masquée. */
const ECRANS_ENFANTS: readonly string[] = [
  '/studio/profil',
  '/studio/compte',
  // S7-bis : disponibilités détaillées (retour « ← Agenda ») et messages (retour « ← Vitrine »).
  '/studio/agenda/disponibilites',
  '/studio/messages',
]

/** Écrans enfants par préfixe : formulaires de service, réalisation, témoignage et lien (nouveau, modification). */
const PREFIXES_ENFANTS: readonly string[] = ['/studio/services/', '/studio/realisations/', '/studio/temoignages/', '/studio/liens/']

/** Écrans rattachés à l'entrée « Vitrine » (accueil, profil, témoignages). */
const RATTACHES_VITRINE: readonly string[] = ['/studio/profil', '/studio/temoignages']

function estSousChemin(chemin: string, base: string): boolean {
  return chemin === base || chemin.startsWith(`${base}/`)
}

export function useStudioNav() {
  const route = useRoute()

  function estActive(to: string): boolean {
    if (to === '/studio') {
      return route.path === '/studio' || RATTACHES_VITRINE.some((base) => estSousChemin(route.path, base))
    }
    return estSousChemin(route.path, to)
  }

  const estEcranEnfant = computed(() =>
    ECRANS_ENFANTS.includes(route.path) || PREFIXES_ENFANTS.some((prefixe) => route.path.startsWith(prefixe)),
  )

  return { entrees: ENTREES_NAV, estActive, estEcranEnfant }
}
