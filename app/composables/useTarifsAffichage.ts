import { PERIODES_MOIS } from '#shared/plans'
import { ROUTE_CONNEXION } from '~/data/landing'

/**
 * Affichage des deux plans, partagé par la page /tarifs et par les cartes de la page d'accueil : prix du plan payant
 * (par mois, précision de facturation), lien de l'action payante selon la connexion, cartes prêtes à afficher et
 * sélecteurs de devise et de durée. Tout vient de `useTarifs()` : aucun prix ni aucune limite écrits ici (règle 4.11).
 */
export interface CartePlan {
  id: 'gratuit' | 'payant'
  titre: string
  accroche: string
  /** Prix déjà formaté ; `null` quand aucun prix n'est publié. */
  prix: string | null
  precision?: string
  lignes: string[]
  /** Plan payant : fond d'encre, texte clair. */
  sombre: boolean
  action?: { label: string, to: string }
  /** Texte à la place du bouton quand l'action n'est pas encore possible. */
  note?: string
}

export interface OptionsTarifsAffichage {
  /** Accroche « À partir de » au-dessus du prix payant (utile quand la durée n'est pas choisie par le visiteur). */
  accrochePayant?: boolean
}

const TEXTES = {
  gratuit: { titre: 'Gratuit', accroche: 'Pour présenter votre vitrine', action: 'Commencer gratuitement' },
  payant: { titre: 'Payant', accroche: 'À partir de', action: 'Passer au plan payant', note: 'Le paiement en ligne arrive bientôt.' },
} as const

const LIEN_STUDIO_ABONNEMENT = '/studio/compte'

export function useTarifsAffichage(source: Awaited<ReturnType<typeof useTarifs>>, options: OptionsTarifsAffichage = {}) {
  const { tarifs, erreur, gratuit, payant, paiementDisponible, devises, devise, deviseChoisie, deviseOffre, prixPeriodes, periode, prixChoisi, moyensLibelles } = source
  const { loggedIn } = useUserSession()

  const exposant = computed(() => deviseOffre.value?.exposant ?? 0)

  const prixGratuit = computed(() => (devise.value ? formaterMontant(0, devise.value, exposant.value) : null))
  const prixPayant = computed(() => {
    const choisi = prixChoisi.value
    return choisi && devise.value ? formaterMontant(montantParMoisPaye(choisi), devise.value, exposant.value) : null
  })
  const precisionPayant = computed(() => {
    const choisi = prixChoisi.value
    if (!choisi || !devise.value) return undefined
    if (choisi.periodeMois === 1) return 'par mois'
    return `par mois, facturé ${formaterMontant(montantPaye(choisi), devise.value, exposant.value)} pour ${libellePeriode(choisi.periodeMois)}`
  })

  // Connecté : sa carte Abonnement s'ouvre, la durée choisie est présélectionnée. Visiteur : il commence par se connecter
  // (aucun retour vers l'abonnement après la connexion n'existe : il le retrouve depuis son compte).
  const lienPayant = computed(() => {
    if (!loggedIn.value) return ROUTE_CONNEXION
    return periode.value ? `${LIEN_STUDIO_ABONNEMENT}?periode=${periode.value}#abonnement` : `${LIEN_STUDIO_ABONNEMENT}#abonnement`
  })

  const cartes = computed<CartePlan[]>(() => {
    const liste: CartePlan[] = []
    if (gratuit.value) {
      liste.push({
        id: 'gratuit',
        titre: TEXTES.gratuit.titre,
        accroche: TEXTES.gratuit.accroche,
        prix: prixGratuit.value,
        lignes: lignesPlan(gratuit.value),
        sombre: false,
        action: { label: TEXTES.gratuit.action, to: ROUTE_CONNEXION },
      })
    }
    if (payant.value) {
      liste.push({
        id: 'payant',
        titre: TEXTES.payant.titre,
        accroche: options.accrochePayant && prixPayant.value ? TEXTES.payant.accroche : '',
        prix: prixPayant.value,
        precision: precisionPayant.value,
        lignes: lignesPlan(payant.value),
        sombre: true,
        action: paiementDisponible.value ? { label: TEXTES.payant.action, to: lienPayant.value } : undefined,
        note: TEXTES.payant.note,
      })
    }
    return liste
  })

  const indisponible = computed(() => Boolean(erreur.value) || !tarifs.value || cartes.value.length === 0)

  const itemsDevises = computed(() => devises.value.map((d) => ({ value: d.devise, label: d.devise })))
  const itemsPeriodes = computed(() => prixPeriodes.value.map((p) => ({ value: String(p.periodeMois), label: libellePeriode(p.periodeMois) })))
  const deviseTexte = computed({
    get: () => devise.value ?? '',
    set: (valeur: string) => {
      deviseChoisie.value = valeur
    },
  })
  const periodeTexte = computed({
    get: () => String(periode.value ?? ''),
    set: (texte: string) => {
      periode.value = PERIODES_MOIS.find((p) => String(p) === texte) ?? null
    },
  })
  const moyensTexte = computed(() => moyensLibelles.value.join(' ou '))

  return { cartes, indisponible, lienPayant, itemsDevises, itemsPeriodes, deviseTexte, periodeTexte, moyensTexte }
}
