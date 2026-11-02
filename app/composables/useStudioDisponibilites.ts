import type { AgendaStudioReponse, DisponibiliteDTO, IndisponibiliteDTO } from '#shared/dto'
import type { PasCreneauMinutes } from '#shared/agenda'
import {
  DISPONIBILITES_MAX,
  HORIZON_JOURS_MAX,
  PAS_CRENEAU_MINUTES,
  PREAVIS_HEURES_MAX,
  RAISON_INDISPONIBILITE_MAX,
} from '#shared/agenda'
import { itemsFuseaux } from '~/composables/useCompte'

/** Partagé avec useStudioAgenda (split S7-bis) : mêmes options de fraîcheur pour le studio. */
export const TOUJOURS_FRAIS = { server: false, lazy: true, getCachedData: () => undefined } as const

export interface MessageStudioAgenda {
  type: 'erreur' | 'succes'
  texte: string
}

export type ChampPlageAgenda = 'debut' | 'fin'
export type ChampReglageAgenda = 'fuseau' | 'pasCreneauMin' | 'preavisHeures' | 'horizonJours'

export interface PlageAgendaEdition {
  cle: string
  id: string | null
  jourSemaine: number
  debut: string
  fin: string
}

export interface JourAgendaEdition {
  numero: number
  libelle: string
  plages: PlageAgendaEdition[]
}

export interface ReglagesAgendaEdition {
  fuseau: string
  pasCreneauMin: PasCreneauMinutes
  preavisHeures: string
  horizonJours: string
}

export interface ErreursDisponibilitesAgenda {
  plages: Record<string, Partial<Record<ChampPlageAgenda, string>>>
  preavisHeures?: string
  horizonJours?: string
}

export interface ErreursIndisponibiliteAgenda {
  date?: string
  raison?: string
}

export interface IndisponibiliteAgendaVue extends IndisponibiliteDTO {
  dateLibelle: string
}

interface DisponibilitesStudioReponse {
  items: DisponibiliteDTO[]
  reglages: AgendaStudioReponse['reglages']
}

interface IndisponibilitesStudioReponse {
  items: IndisponibiliteDTO[]
}

const HEURE_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/
const DATE_LOCALE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const DEBUT_PAR_DEFAUT = '09:00'
const FIN_PAR_DEFAUT = '17:00'

const JOURS_SEMAINE = [
  { numero: 1, libelle: 'Lundi' },
  { numero: 2, libelle: 'Mardi' },
  { numero: 3, libelle: 'Mercredi' },
  { numero: 4, libelle: 'Jeudi' },
  { numero: 5, libelle: 'Vendredi' },
  { numero: 6, libelle: 'Samedi' },
  { numero: 7, libelle: 'Dimanche' },
] as const

export function minutesDepuisMinuit(heure: string): number | null {
  if (!HEURE_REGEX.test(heure)) return null
  const [heures, minutes] = heure.split(':').map(Number)
  if (heures === undefined || minutes === undefined) return null
  return heures * 60 + minutes
}

export function entierValide(valeur: string, minimum: number, maximum: number): number | null {
  if (valeur.trim() === '') return null
  const nombre = Number(valeur)
  return Number.isInteger(nombre) && nombre >= minimum && nombre <= maximum ? nombre : null
}

export function dateLocaleValide(valeur: string): boolean {
  if (!DATE_LOCALE_REGEX.test(valeur)) return false
  const [annee, mois, jour] = valeur.split('-').map(Number)
  if (annee === undefined || mois === undefined || jour === undefined) return false
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  return date.getUTCFullYear() === annee && date.getUTCMonth() === mois - 1 && date.getUTCDate() === jour
}

function trierIndisponibilites(items: readonly IndisponibiliteDTO[]): IndisponibiliteDTO[] {
  return [...items].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}

function formaterDateLocale(date: string): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  if (!annee || !mois || !jour) return date
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(annee, mois - 1, jour)))
}

/**
 * Disponibilités, indisponibilités et réglages de l'agenda Studio (split S7-bis,
 * ancien panneau latéral devenu la page /studio/agenda/disponibilites).
 */
export function useStudioDisponibilites() {
  const {
    data: disponibilitesData,
    status: disponibilitesStatus,
    error: disponibilitesError,
    refresh: refreshDisponibilites,
  } = useFetch<DisponibilitesStudioReponse>('/api/studio/agenda/disponibilites', {
    key: 'studio-agenda-disponibilites',
    ...TOUJOURS_FRAIS,
  })
  const {
    data: indisponibilitesData,
    status: indisponibilitesStatus,
    error: indisponibilitesError,
    refresh: refreshIndisponibilites,
  } = useFetch<IndisponibilitesStudioReponse>('/api/studio/agenda/indisponibilites', {
    key: 'studio-agenda-indisponibilites',
    ...TOUJOURS_FRAIS,
  })

  const message = ref<MessageStudioAgenda | null>(null)
  const plages = ref<PlageAgendaEdition[]>([])
  const reglages = ref<ReglagesAgendaEdition>({
    fuseau: 'Africa/Douala',
    pasCreneauMin: 30,
    preavisHeures: '2',
    horizonJours: '60',
  })
  const erreursDisponibilites = ref<ErreursDisponibilitesAgenda>({ plages: {} })
  const enregistrementDisponibilites = ref(false)
  let derniereEmpreinte = ''
  let compteurCle = 0

  function nouvelleCle(prefixe: string): string {
    compteurCle += 1
    return `${prefixe}-${compteurCle}`
  }

  function empreinteDisponibilites(): string {
    return JSON.stringify({
      items: plages.value.map(({ jourSemaine, debut, fin }) => ({ jourSemaine, debut, fin })),
      reglages: reglages.value,
    })
  }

  function appliquerDisponibilites(reponse: DisponibilitesStudioReponse): void {
    plages.value = reponse.items.map((item) => ({ ...item, cle: item.id }))
    reglages.value = {
      fuseau: reponse.reglages.fuseau,
      pasCreneauMin: reponse.reglages.pasCreneauMin as PasCreneauMinutes,
      preavisHeures: String(reponse.reglages.preavisHeures),
      horizonJours: String(reponse.reglages.horizonJours),
    }
    erreursDisponibilites.value = { plages: {} }
    derniereEmpreinte = empreinteDisponibilites()
  }

  watch(disponibilitesData, (reponse) => {
    if (reponse) appliquerDisponibilites(reponse)
  }, { immediate: true })

  const jours = computed<JourAgendaEdition[]>(() => JOURS_SEMAINE.map((jour) => ({
    ...jour,
    plages: plages.value.filter((plage) => plage.jourSemaine === jour.numero),
  })))
  const fuseauItems = computed(() => itemsFuseaux(reglages.value.fuseau))
  const pasItems = PAS_CRENEAU_MINUTES.map((valeur) => ({ label: `${valeur} minutes`, value: valeur }))
  const disponibilitesModifiees = computed(() => Boolean(disponibilitesData.value)
    && empreinteDisponibilites() !== derniereEmpreinte)

  function effacerMessage(): void {
    message.value = null
  }

  function afficherMessage(type: MessageStudioAgenda['type'], texte: string): void {
    message.value = { type, texte }
  }

  function ajouterPlage(jourSemaine: number): void {
    effacerMessage()
    if (plages.value.length >= DISPONIBILITES_MAX) {
      afficherMessage('erreur', `Vous pouvez enregistrer jusqu’à ${DISPONIBILITES_MAX} plages.`)
      return
    }
    plages.value.push({
      cle: nouvelleCle('plage'),
      id: null,
      jourSemaine,
      debut: DEBUT_PAR_DEFAUT,
      fin: FIN_PAR_DEFAUT,
    })
  }

  function supprimerPlage(cle: string): void {
    effacerMessage()
    plages.value = plages.value.filter((plage) => plage.cle !== cle)
    const erreurs = Object.fromEntries(
      Object.entries(erreursDisponibilites.value.plages).filter(([cleErreur]) => cleErreur !== cle),
    )
    erreursDisponibilites.value = { ...erreursDisponibilites.value, plages: erreurs }
  }

  function modifierPlage(cle: string, champ: ChampPlageAgenda, valeur: string): void {
    effacerMessage()
    const plage = plages.value.find((item) => item.cle === cle)
    if (!plage) return
    plage[champ] = valeur
    const autreChamp: ChampPlageAgenda = champ === 'debut' ? 'fin' : 'debut'
    const autreErreur = erreursDisponibilites.value.plages[cle]?.[autreChamp]
    erreursDisponibilites.value.plages[cle] = autreErreur ? { [autreChamp]: autreErreur } : {}
  }

  function modifierReglage(champ: ChampReglageAgenda, valeur: string | number): void {
    effacerMessage()
    if (champ === 'pasCreneauMin' && typeof valeur === 'number'
      && (PAS_CRENEAU_MINUTES as readonly number[]).includes(valeur)) {
      reglages.value.pasCreneauMin = valeur as PasCreneauMinutes
      return
    }
    if (champ !== 'pasCreneauMin' && typeof valeur === 'string') reglages.value[champ] = valeur
    if (champ === 'preavisHeures') erreursDisponibilites.value = {
      plages: erreursDisponibilites.value.plages,
      horizonJours: erreursDisponibilites.value.horizonJours,
    }
    if (champ === 'horizonJours') erreursDisponibilites.value = {
      plages: erreursDisponibilites.value.plages,
      preavisHeures: erreursDisponibilites.value.preavisHeures,
    }
  }

  function validerDisponibilites(): { preavisHeures: number, horizonJours: number } | null {
    const erreurs: ErreursDisponibilitesAgenda = { plages: {} }

    for (const plage of plages.value) {
      const debut = minutesDepuisMinuit(plage.debut)
      const fin = minutesDepuisMinuit(plage.fin)
      const erreursPlage: Partial<Record<ChampPlageAgenda, string>> = {}
      if (debut === null) erreursPlage.debut = 'Indiquez une heure de début valide.'
      if (fin === null) erreursPlage.fin = 'Indiquez une heure de fin valide.'
      else if (debut !== null && debut >= fin) erreursPlage.fin = 'La fin doit être après le début, le même jour.'
      if (Object.keys(erreursPlage).length > 0) erreurs.plages[plage.cle] = erreursPlage
    }

    for (const jour of JOURS_SEMAINE) {
      const ordonnees = plages.value
        .filter((plage) => plage.jourSemaine === jour.numero)
        .map((plage) => ({ plage, debut: minutesDepuisMinuit(plage.debut), fin: minutesDepuisMinuit(plage.fin) }))
        .filter((item): item is { plage: PlageAgendaEdition, debut: number, fin: number } => item.debut !== null && item.fin !== null)
        .sort((a, b) => a.debut - b.debut || a.fin - b.fin)
      for (let index = 1; index < ordonnees.length; index += 1) {
        const precedente = ordonnees[index - 1]
        const courante = ordonnees[index]
        if (precedente && courante && courante.debut < precedente.fin) {
          erreurs.plages[courante.plage.cle] = {
            ...erreurs.plages[courante.plage.cle],
            debut: 'Cette plage chevauche la précédente.',
          }
        }
      }
    }

    const preavisHeures = entierValide(reglages.value.preavisHeures, 0, PREAVIS_HEURES_MAX)
    const horizonJours = entierValide(reglages.value.horizonJours, 1, HORIZON_JOURS_MAX)
    if (preavisHeures === null) erreurs.preavisHeures = `Indiquez un nombre entier entre 0 et ${PREAVIS_HEURES_MAX}.`
    if (horizonJours === null) erreurs.horizonJours = `Indiquez un nombre entier entre 1 et ${HORIZON_JOURS_MAX}.`

    erreursDisponibilites.value = erreurs
    if (Object.keys(erreurs.plages).length > 0 || preavisHeures === null || horizonJours === null) return null
    return { preavisHeures, horizonJours }
  }

  async function enregistrerDisponibilites(): Promise<void> {
    effacerMessage()
    const valeurs = validerDisponibilites()
    if (!valeurs) {
      afficherMessage('erreur', 'Vérifiez les disponibilités et les réglages signalés.')
      return
    }

    const fuseauInitial = disponibilitesData.value?.reglages.fuseau
    const fuseauModifie = Boolean(fuseauInitial && fuseauInitial !== reglages.value.fuseau)
    let fuseauEnregistre = false
    enregistrementDisponibilites.value = true
    try {
      if (fuseauModifie) {
        await $fetch('/api/studio/moi', { method: 'PUT', body: { fuseau: reglages.value.fuseau } })
        fuseauEnregistre = true
      }
      const reponse = await $fetch<DisponibilitesStudioReponse>('/api/studio/agenda/disponibilites', {
        method: 'PUT',
        body: {
          items: [...plages.value]
            .sort((a, b) => a.jourSemaine - b.jourSemaine || a.debut.localeCompare(b.debut))
            .map(({ jourSemaine, debut, fin }) => ({ jourSemaine, debut, fin })),
          pasCreneauMin: reglages.value.pasCreneauMin,
          preavisHeures: valeurs.preavisHeures,
          horizonJours: valeurs.horizonJours,
        },
      })
      disponibilitesData.value = reponse
      appliquerDisponibilites(reponse)
      afficherMessage('succes', 'Vos disponibilités sont enregistrées.')
    }
    catch {
      await refreshDisponibilites()
      afficherMessage(
        'erreur',
        fuseauModifie && fuseauEnregistre
          ? 'Le fuseau a été enregistré, mais pas les autres réglages. Vérifiez-les puis réessayez.'
          : 'Nous n’avons pas pu enregistrer vos disponibilités. Réessayez dans un instant.',
      )
    }
    finally {
      enregistrementDisponibilites.value = false
    }
  }

  const indisponibilites = ref<IndisponibiliteDTO[]>([])
  const dateIndisponibilite = ref('')
  const raisonIndisponibilite = ref('')
  const erreursIndisponibilite = ref<ErreursIndisponibiliteAgenda>({})
  const ajoutIndisponibiliteEnCours = ref(false)
  const suppressionIndisponibiliteEnCours = ref<string | null>(null)
  const suppressionIndisponibiliteAConfirmer = ref<string | null>(null)

  watch(indisponibilitesData, (reponse) => {
    if (reponse) indisponibilites.value = trierIndisponibilites(reponse.items)
  }, { immediate: true })

  const indisponibilitesAffichees = computed<IndisponibiliteAgendaVue[]>(() => indisponibilites.value.map((item) => ({
    ...item,
    dateLibelle: formaterDateLocale(item.date),
  })))

  function modifierIndisponibilite(champ: 'date' | 'raison', valeur: string): void {
    effacerMessage()
    if (champ === 'date') dateIndisponibilite.value = valeur
    else raisonIndisponibilite.value = valeur
    erreursIndisponibilite.value = champ === 'date'
      ? { raison: erreursIndisponibilite.value.raison }
      : { date: erreursIndisponibilite.value.date }
  }

  async function ajouterIndisponibilite(): Promise<void> {
    effacerMessage()
    const erreurs: ErreursIndisponibiliteAgenda = {}
    const date = dateIndisponibilite.value
    const raison = raisonIndisponibilite.value.trim()
    if (!dateLocaleValide(date)) erreurs.date = 'Choisissez une date valide.'
    else if (indisponibilites.value.some((item) => item.date === date)) erreurs.date = 'Cette date est déjà indisponible.'
    if (raison.length > RAISON_INDISPONIBILITE_MAX) {
      erreurs.raison = `La raison est limitée à ${RAISON_INDISPONIBILITE_MAX} caractères.`
    }
    erreursIndisponibilite.value = erreurs
    if (erreurs.date || erreurs.raison) {
      afficherMessage('erreur', 'Vérifiez l’indisponibilité signalée.')
      return
    }

    const temporaire: IndisponibiliteDTO = { id: nouvelleCle('indisponibilite'), date, raison: raison || null }
    indisponibilites.value = trierIndisponibilites([...indisponibilites.value, temporaire])
    dateIndisponibilite.value = ''
    raisonIndisponibilite.value = ''
    ajoutIndisponibiliteEnCours.value = true
    try {
      const reponse = await $fetch<{ item: IndisponibiliteDTO }>('/api/studio/agenda/indisponibilites', {
        method: 'POST',
        body: { date, raison: raison || null },
      })
      indisponibilites.value = trierIndisponibilites(indisponibilites.value.map((item) =>
        item.id === temporaire.id ? reponse.item : item,
      ))
      afficherMessage('succes', 'L’indisponibilité est ajoutée.')
    }
    catch (erreur) {
      indisponibilites.value = indisponibilites.value.filter((item) => item.id !== temporaire.id)
      dateIndisponibilite.value = date
      raisonIndisponibilite.value = raison
      const api = lireErreurApi(erreur)
      erreursIndisponibilite.value = {
        date: api.champs.date?.[0],
        raison: api.champs.raison?.[0],
      }
      afficherMessage('erreur', 'Nous n’avons pas pu ajouter cette indisponibilité. Réessayez dans un instant.')
    }
    finally {
      ajoutIndisponibiliteEnCours.value = false
    }
  }

  function demanderSuppressionIndisponibilite(id: string): void {
    effacerMessage()
    suppressionIndisponibiliteAConfirmer.value = id
  }

  function annulerSuppressionIndisponibilite(): void {
    suppressionIndisponibiliteAConfirmer.value = null
  }

  async function supprimerIndisponibilite(id: string): Promise<void> {
    const item = indisponibilites.value.find((courant) => courant.id === id)
    if (!item || suppressionIndisponibiliteEnCours.value) return
    effacerMessage()
    suppressionIndisponibiliteAConfirmer.value = null
    suppressionIndisponibiliteEnCours.value = id
    indisponibilites.value = indisponibilites.value.filter((courant) => courant.id !== id)
    try {
      await $fetch(`/api/studio/agenda/indisponibilites/${id}`, { method: 'DELETE' })
      afficherMessage('succes', 'L’indisponibilité est supprimée.')
    }
    catch {
      indisponibilites.value = trierIndisponibilites([...indisponibilites.value, item])
      afficherMessage('erreur', 'Nous n’avons pas pu supprimer cette indisponibilité. Elle a été rétablie.')
    }
    finally {
      suppressionIndisponibiliteEnCours.value = null
    }
  }

  const donneesPretes = computed(() => Boolean(disponibilitesData.value && indisponibilitesData.value))
  const erreursChargement = computed(() => [disponibilitesError.value, indisponibilitesError.value].filter(Boolean))
  const absente = computed(() => erreursChargement.value.some((erreur) => {
    const api = lireErreurApi(erreur)
    return api.code === 'VITRINE_INTROUVABLE' || api.statut === 404
  }))
  const enErreur = computed(() => !donneesPretes.value && !absente.value && erreursChargement.value.length > 0)
  const enChargement = computed(() => !donneesPretes.value && !enErreur.value && !absente.value && [
    disponibilitesStatus.value,
    indisponibilitesStatus.value,
  ].some((statut) => statut === 'idle' || statut === 'pending'))

  async function rafraichir(): Promise<void> {
    effacerMessage()
    await Promise.all([refreshDisponibilites(), refreshIndisponibilites()])
  }

  return {
    enChargement, enErreur, absente, rafraichir, message, effacerMessage,
    jours, reglages, fuseauItems, pasItems, erreursDisponibilites,
    disponibilitesModifiees, enregistrementDisponibilites,
    ajouterPlage, supprimerPlage, modifierPlage, modifierReglage, enregistrerDisponibilites,
    indisponibilites: indisponibilitesAffichees,
    dateIndisponibilite,
    raisonIndisponibilite,
    raisonIndisponibiliteMax: RAISON_INDISPONIBILITE_MAX,
    erreursIndisponibilite,
    ajoutIndisponibiliteEnCours,
    suppressionIndisponibiliteEnCours,
    suppressionIndisponibiliteAConfirmer,
    modifierIndisponibilite,
    ajouterIndisponibilite,
    demanderSuppressionIndisponibilite,
    annulerSuppressionIndisponibilite,
    supprimerIndisponibilite,
  }
}
