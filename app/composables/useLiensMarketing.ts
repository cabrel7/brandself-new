import { ROUTE_CONNEXION } from '~/data/landing'

/**
 * Liens de l'en-tête et du pied de page communs à la page d'accueil et à /tarifs. Sur la page d'accueil, les ancres
 * restent des ancres (défilement sur place). Ailleurs, elles mènent à la page d'accueil (`/#trouve`), sauf « Tarifs »
 * qui reste sur /tarifs ; « Créer ma vitrine » mène à la connexion, le champ d'adresse n'existant que sur l'accueil.
 */
const ROUTE_ACCUEIL = '/'
const ROUTE_TARIFS = '/tarifs'
const ANCRE_TARIFS = '#tarifs'
const ANCRE_CREER = '#adresse-fin'

export function useLiensMarketing() {
  const route = useRoute()
  const surAccueil = computed(() => route.path === ROUTE_ACCUEIL)

  function lienNav(ancre: string): string {
    if (surAccueil.value) return ancre
    return ancre === ANCRE_TARIFS ? ROUTE_TARIFS : `${ROUTE_ACCUEIL}${ancre}`
  }

  const lienCreer = computed(() => (surAccueil.value ? ANCRE_CREER : ROUTE_CONNEXION))
  /** Logo et lien d'évitement : haut de la page courante (accueil), sinon retour à l'accueil. */
  const lienLogo = computed(() => (surAccueil.value ? '#haut' : ROUTE_ACCUEIL))

  return { surAccueil, lienNav, lienCreer, lienLogo }
}
