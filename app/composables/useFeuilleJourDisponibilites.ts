import { DISPONIBILITES_MAX } from '#shared/agenda'
import type { ChampPlageAgenda, ErreursPlages, JourAgendaEdition, PlageSaisie } from './useStudioDisponibilites'
import { jourModifie, PLAGE_PAR_DEFAUT, validerPlagesJour } from './useStudioDisponibilites'

export type AppliquerJour = (numero: number, plages: PlageSaisie[], cibles: number[]) => string | null

interface OptionsFeuilleJour {
  jour: () => JourAgendaEdition
  ouverte: () => boolean
  /** Nombre de plages encore ajoutables à ce jour (limite globale de la semaine). */
  limite: () => number
  appliquer: AppliquerJour
}

const ANNONCE_JOUR_FERME = 'Jour fermé'

/**
 * État de la feuille d'édition d'un jour : travaille sur une COPIE locale des plages du jour,
 * rien n'est écrit dans le brouillon avant « Appliquer ». La copie est reprise à chaque ouverture.
 */
export function useFeuilleJour(options: OptionsFeuilleJour) {
  const saisies = ref<PlageSaisie[]>([])
  const cibles = ref<number[]>([])
  const erreurs = ref<ErreursPlages>({})
  const erreurGlobale = ref<string | null>(null)
  /** Fermeture demandée alors que la copie diffère du jour d'origine : propose Appliquer / Abandonner. */
  const confirmationAbandon = ref(false)
  /** Texte d'une région live : annonce les changements que le focus seul ne dit pas. */
  const annonce = ref('')
  let compteurCle = 0

  function nouvelleSaisie(): PlageSaisie {
    compteurCle += 1
    return { cle: `saisie-${compteurCle}`, ...PLAGE_PAR_DEFAUT }
  }

  function reinitialiser(): void {
    saisies.value = options.jour().plages.map(({ cle, debut, fin }) => ({ cle, debut, fin }))
    cibles.value = []
    // Un jour déjà signalé « À corriger » montre son erreur dès l'ouverture.
    erreurs.value = validerPlagesJour(saisies.value)
    erreurGlobale.value = null
    confirmationAbandon.value = false
    annonce.value = ''
  }

  watch([options.ouverte, () => options.jour().numero], ([ouverte]) => {
    if (ouverte) reinitialiser()
  }, { immediate: true })

  /** Toute saisie annule le message en cours : un seul message à la fois. */
  function toucher(): void {
    erreurGlobale.value = null
    confirmationAbandon.value = false
    annonce.value = ''
  }

  const modifiee = computed(() => jourModifie(options.jour().plages, saisies.value, cibles.value))

  const ouvert = computed({
    get: () => saisies.value.length > 0,
    set: (valeur: boolean) => {
      toucher()
      if (valeur && saisies.value.length === 0) saisies.value = [nouvelleSaisie()]
      if (!valeur) {
        saisies.value = []
        erreurs.value = {}
      }
    },
  })

  const peutAjouter = computed(() => saisies.value.length < options.limite())

  function ajouter(): void {
    if (!peutAjouter.value) return
    toucher()
    saisies.value = [...saisies.value, nouvelleSaisie()]
  }

  /**
   * Retire une plage. Renvoie la clé de la plage où replacer le focus (la précédente, ou la suivante
   * si c'était la première), ou `null` s'il n'en reste aucune : le jour est alors fermé et annoncé.
   */
  function supprimer(cle: string): string | null {
    toucher()
    const index = saisies.value.findIndex((saisie) => saisie.cle === cle)
    saisies.value = saisies.value.filter((saisie) => saisie.cle !== cle)
    erreurs.value = Object.fromEntries(Object.entries(erreurs.value).filter(([cleErreur]) => cleErreur !== cle))
    if (saisies.value.length === 0) {
      annonce.value = ANNONCE_JOUR_FERME
      return null
    }
    return saisies.value[Math.max(0, index - 1)]?.cle ?? null
  }

  function modifier(cle: string, champ: ChampPlageAgenda, valeur: string): void {
    toucher()
    const saisie = saisies.value.find((item) => item.cle === cle)
    if (!saisie) return
    saisie[champ] = valeur
    const autre: ChampPlageAgenda = champ === 'debut' ? 'fin' : 'debut'
    const autreErreur = erreurs.value[cle]?.[autre]
    erreurs.value = { ...erreurs.value, [cle]: autreErreur ? { [autre]: autreErreur } : {} }
  }

  function basculerCible(numero: number): void {
    toucher()
    cibles.value = cibles.value.includes(numero)
      ? cibles.value.filter((courant) => courant !== numero)
      : [...cibles.value, numero]
  }

  /**
   * « Appliquer » : valide la copie, l'applique au brouillon via `appliquer`, renvoie `true` si la
   * feuille peut se fermer. Les erreurs de champ restent sous leurs champs ; `erreurGlobale` ne porte
   * que les refus qui ne se rattachent à aucun champ (limite de plages).
   */
  function terminer(): boolean {
    toucher()
    erreurs.value = validerPlagesJour(saisies.value)
    if (Object.keys(erreurs.value).length > 0) return false
    const refus = options.appliquer(options.jour().numero, saisies.value, cibles.value)
    if (refus) {
      erreurGlobale.value = refus
      return false
    }
    return true
  }

  /**
   * Échap, clic hors de la feuille ou « Annuler » : `true` si la feuille peut se fermer tout de suite
   * (rien n'a changé). Sinon la fermeture est retenue et la proposition Appliquer / Abandonner s'affiche.
   */
  function demanderFermeture(): boolean {
    if (!modifiee.value) return true
    erreurGlobale.value = null
    confirmationAbandon.value = true
    return false
  }

  return {
    saisies, cibles, erreurs, erreurGlobale, confirmationAbandon, annonce, modifiee, ouvert, peutAjouter,
    limiteMax: DISPONIBILITES_MAX,
    ajouter, supprimer, modifier, basculerCible, terminer, demanderFermeture,
  }
}
