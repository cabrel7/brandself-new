import type { JourStatDTO, StatistiquesDTO } from '#shared/dto'
import { PERIODES_STATISTIQUES } from '#shared/statistiques'
import type { PeriodeStat } from '#shared/statistiques'

const LOCALE_FR = 'fr-FR'

const MESSAGE_STATISTIQUES = 'Nous n’avons pas pu charger vos statistiques.'
const MESSAGE_PERIODE = 'Cette période n’est pas incluse dans votre plan.'

/** Une période du sélecteur : `disabled` verrouille les périodes hors plan (#175, #188). */
export interface PeriodeOption {
  value: string
  label: string
  disabled: boolean
}

/** Une ligne de la répartition, enrichie de sa date affichée (fuseau de la vitrine côté serveur). */
export interface JourVue extends JourStatDTO {
  libelle: string
}

/** Jour civil `AAAA-MM-JJ` (fuseau de la vitrine) affiché en toutes lettres. */
function libelleJour(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return iso
  const memeAnnee = date.getUTCFullYear() === new Date().getFullYear()
  const options: Intl.DateTimeFormatOptions = memeAnnee
    ? { day: 'numeric', month: 'long', timeZone: 'UTC' }
    : { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
  return new Intl.DateTimeFormat(LOCALE_FR, options).format(date)
}

/**
 * Statistiques du panneau détail (S11 §8) : état de la période, chargement à
 * l'ouverture du panneau et à chaque changement de période, erreurs traduites.
 * Aucun rendu ici : le composant affiche, ce composable appelle l'API.
 */
export function useStatistiques() {
  const periode = ref<PeriodeStat>(7)
  const donnees = ref<StatistiquesDTO | null>(null)
  const chargement = ref(false)
  const erreur = ref<string | null>(null)
  /** Limite du plan de la dernière réponse : conservée même après une erreur (le sélecteur reste juste). */
  const joursMax = ref<number | null>(null)
  /** Numéro de la dernière requête : une réponse tardive d'une période précédente est ignorée. */
  let requete = 0

  const periodeTexte = computed({
    get: () => String(periode.value),
    set: (texte: string) => {
      const suivante = PERIODES_STATISTIQUES.find((jour) => String(jour) === texte)
      if (!suivante || suivante === periode.value) return
      periode.value = suivante
      void charger()
    },
  })

  const periodes = computed<PeriodeOption[]>(() => {
    const limite = joursMax.value ?? 7
    return PERIODES_STATISTIQUES.map((jour) => ({
      value: String(jour),
      label: `${jour} j`,
      // 7 jours toujours active ; 30 et 90 désactivées dès que le plan les refuse.
      disabled: jour !== 7 && limite < jour,
    }))
  })

  /** Les deux périodes longues sont verrouillées : la phrase de déblocage s'affiche (#188). */
  const phrasePlanPayant = computed(() => {
    const limite = joursMax.value
    if (limite === null) return false
    return PERIODES_STATISTIQUES.filter((jour) => jour > 7).every((jour) => limite < jour)
  })

  const jours = computed<JourVue[]>(() =>
    (donnees.value?.parJour ?? []).map((jour) => ({ ...jour, libelle: libelleJour(jour.jour) })),
  )

  /** État vide : aucun événement sur la période (visites, clics et réservations à 0, #8). */
  const vide = computed(() => {
    const totaux = donnees.value?.totaux
    if (!totaux) return false
    return totaux.visites === 0 && totaux.clics === 0 && totaux.reservations === 0
  })

  async function charger(): Promise<void> {
    const numero = ++requete
    chargement.value = true
    try {
      const reponse = await $fetch<StatistiquesDTO>('/api/studio/statistiques', {
        query: { periode: String(periode.value) },
      })
      if (numero !== requete) return
      donnees.value = reponse
      joursMax.value = reponse.joursMax
      erreur.value = null
    } catch (e) {
      if (numero !== requete) return
      const api = lireErreurApi(e)
      donnees.value = null
      if (api.statut === 401) {
        // Session perdue : retour à l'écran de connexion (rechargement complet, état client effacé).
        await navigateTo('/connexion', { external: true })
        return
      }
      if (api.statut === 403) {
        // Repli explicite sur 7 jours (#175) : jamais un 30 silencieux, le message explique.
        if (typeof api.donnees.joursMax === 'number') joursMax.value = api.donnees.joursMax
        periode.value = 7
        erreur.value = api.code === 'STATISTIQUES_PERIODE_INTERDITE' ? MESSAGE_PERIODE : MESSAGE_STATISTIQUES
        return
      }
      erreur.value = MESSAGE_STATISTIQUES
    } finally {
      if (numero === requete) chargement.value = false
    }
  }

  return {
    periode,
    periodeTexte,
    periodes,
    phrasePlanPayant,
    donnees,
    jours,
    chargement,
    erreur,
    vide,
    charger,
  }
}
