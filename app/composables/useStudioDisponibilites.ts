import type { AgendaStudioReponse, DisponibiliteDTO, IndisponibiliteDTO } from '#shared/dto'
import type { IndisponibiliteCreateDTO } from '#shared/dto/agenda'
import type { PasCreneauMinutes } from '#shared/agenda'
import {
  DISPONIBILITES_MAX,
  HORIZON_JOURS_MAX,
  INDISPONIBILITE_PLAGE_MAX_JOURS,
  PAS_CRENEAU_MINUTES,
  PREAVIS_HEURES_MAX,
  RAISON_INDISPONIBILITE_MAX,
} from '#shared/agenda'
import { nombreJoursPlage } from '#shared/agenda-plage'
import type { ErreurApi } from './useApiErreur'
import { itemsFuseaux } from './useCompte'

export { nombreJoursPlage }

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

export type ModeIndisponibilite = 'date' | 'plage'
export type ChampIndisponibilite = 'date' | 'debut' | 'fin' | 'raison'

export interface ErreursIndisponibiliteAgenda {
  date?: string
  debut?: string
  fin?: string
  raison?: string
}

/** Retour de la zone Indisponibilités : `info` = neutre (rien à faire), `avertissement` = action à prévoir. */
export interface MessageIndisponibilite {
  type: 'succes' | 'info' | 'avertissement' | 'erreur'
  texte: string
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

/** Numéros ISO des sept jours, dans l'ordre d'affichage. */
export const JOURS_NUMEROS: readonly number[] = JOURS_SEMAINE.map((jour) => jour.numero)
/** Lundi à vendredi : jours remplis par la « Semaine type ». */
export const SEMAINE_TYPE_JOURS: readonly number[] = [1, 2, 3, 4, 5]
export const PLAGE_PAR_DEFAUT = { debut: DEBUT_PAR_DEFAUT, fin: FIN_PAR_DEFAUT } as const

/** Plage telle qu'éditée dans la feuille d'un jour : copie locale, sans jour ni identifiant serveur. */
export interface PlageSaisie {
  cle: string
  debut: string
  fin: string
}

export type ErreursPlages = Record<string, Partial<Record<ChampPlageAgenda, string>>>

export function minutesDepuisMinuit(heure: string): number | null {
  if (!HEURE_REGEX.test(heure)) return null
  const [heures, minutes] = heure.split(':').map(Number)
  if (heures === undefined || minutes === undefined) return null
  return heures * 60 + minutes
}

/** « 09:00 » → « 9h », « 09:30 » → « 9h30 ». Une valeur illisible est rendue telle quelle. */
export function formaterHeure(heure: string): string {
  const minutes = minutesDepuisMinuit(heure)
  if (minutes === null) return heure
  const reste = minutes % 60
  return reste === 0 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 60)}h${String(reste).padStart(2, '0')}`
}

/** Plages d'un jour triées par heure de début : « 9h–12h », « 14h–17h »… */
export function libellesPlages(plages: ReadonlyArray<Pick<PlageSaisie, 'debut' | 'fin'>>): string[] {
  const ordre = (heure: string): number => minutesDepuisMinuit(heure) ?? Number.MAX_SAFE_INTEGER
  return [...plages]
    .sort((a, b) => ordre(a.debut) - ordre(b.debut) || ordre(a.fin) - ordre(b.fin))
    .map((plage) => `${formaterHeure(plage.debut)}–${formaterHeure(plage.fin)}`)
}

/**
 * Phrase lisible à voix haute : « de 9h à 12h », « de 9h à 12h et de 14h à 17h »,
 * « de 8h à 10h, de 11h à 12h et de 14h à 17h ». Vide sans plage.
 */
export function decrirePlages(plages: ReadonlyArray<Pick<PlageSaisie, 'debut' | 'fin'>>): string {
  const ordre = (heure: string): number => minutesDepuisMinuit(heure) ?? Number.MAX_SAFE_INTEGER
  const phrases = [...plages]
    .sort((a, b) => ordre(a.debut) - ordre(b.debut) || ordre(a.fin) - ordre(b.fin))
    .map((plage) => `de ${formaterHeure(plage.debut)} à ${formaterHeure(plage.fin)}`)
  const derniere = phrases.at(-1)
  if (derniere === undefined) return ''
  return phrases.length === 1 ? derniere : `${phrases.slice(0, -1).join(', ')} et ${derniere}`
}

/** Nom accessible de la ligne d'un jour : « Lundi : de 9h à 12h et de 14h à 17h. Modifier ». */
export function nomLigneJour(libelle: string, plages: ReadonlyArray<Pick<PlageSaisie, 'debut' | 'fin'>>): string {
  return `${libelle} : ${plages.length === 0 ? 'fermé' : decrirePlages(plages)}. Modifier`
}

/**
 * La copie saisie dans la feuille diffère-t-elle du jour d'origine ? Compare les heures dans l'ordre
 * (les clés techniques sont ignorées : supprimer puis recréer la même plage n'est pas une modification).
 * Des jours cibles choisis comptent toujours comme une modification.
 */
export function jourModifie(
  origine: ReadonlyArray<Pick<PlageSaisie, 'debut' | 'fin'>>,
  saisies: ReadonlyArray<Pick<PlageSaisie, 'debut' | 'fin'>>,
  cibles: readonly number[] = [],
): boolean {
  if (cibles.length > 0 || origine.length !== saisies.length) return true
  return saisies.some((saisie, index) => {
    const initiale = origine[index]
    return !initiale || initiale.debut !== saisie.debut || initiale.fin !== saisie.fin
  })
}

/** Résumé d'un jour : « 9h–12h · 14h–17h », ou « Fermé » sans plage. */
export function resumeJour(plages: ReadonlyArray<Pick<PlageSaisie, 'debut' | 'fin'>>): string {
  return plages.length === 0 ? 'Fermé' : libellesPlages(plages).join(' · ')
}

/**
 * Valide les plages d'UN jour : heures lisibles, fin après début, pas de chevauchement.
 * Pure : renvoie les erreurs par clé de plage (objet vide = jour valide).
 */
export function validerPlagesJour(plages: readonly PlageSaisie[]): ErreursPlages {
  const erreurs: ErreursPlages = {}
  for (const plage of plages) {
    const debut = minutesDepuisMinuit(plage.debut)
    const fin = minutesDepuisMinuit(plage.fin)
    const erreursPlage: Partial<Record<ChampPlageAgenda, string>> = {}
    if (debut === null) erreursPlage.debut = 'Indiquez une heure de début valide.'
    if (fin === null) erreursPlage.fin = 'Indiquez une heure de fin valide.'
    else if (debut !== null && debut >= fin) erreursPlage.fin = 'La fin doit être après le début, le même jour.'
    if (Object.keys(erreursPlage).length > 0) erreurs[plage.cle] = erreursPlage
  }
  const ordonnees = plages
    .map((plage) => ({ plage, debut: minutesDepuisMinuit(plage.debut), fin: minutesDepuisMinuit(plage.fin) }))
    .filter((item): item is { plage: PlageSaisie, debut: number, fin: number } => item.debut !== null && item.fin !== null)
    .sort((a, b) => a.debut - b.debut || a.fin - b.fin)
  for (let index = 1; index < ordonnees.length; index += 1) {
    const precedente = ordonnees[index - 1]
    const courante = ordonnees[index]
    if (precedente && courante && courante.debut < precedente.fin) {
      erreurs[courante.plage.cle] = { ...erreurs[courante.plage.cle], debut: 'Cette plage chevauche la précédente.' }
    }
  }
  return erreurs
}

/**
 * Remplace les plages du jour `numero` par la copie saisie dans la feuille. Une plage dont la clé
 * existe déjà garde sa clé et son `id` ; une nouvelle plage reçoit une clé de `nouvelleCle` (id null).
 * Pure : l'entrée n'est pas mutée, les autres jours sont copiés à l'identique.
 */
export function remplacerPlagesDuJour(
  plages: readonly PlageAgendaEdition[],
  numero: number,
  saisies: readonly PlageSaisie[],
  nouvelleCle: () => string,
): PlageAgendaEdition[] {
  const existantes = new Map(plages.filter((plage) => plage.jourSemaine === numero).map((plage) => [plage.cle, plage]))
  const autres = plages.filter((plage) => plage.jourSemaine !== numero).map((plage) => ({ ...plage }))
  const duJour = saisies.map((saisie): PlageAgendaEdition => {
    const existante = existantes.get(saisie.cle)
    return {
      cle: existante ? existante.cle : nouvelleCle(),
      id: existante ? existante.id : null,
      jourSemaine: numero,
      debut: saisie.debut,
      fin: saisie.fin,
    }
  })
  return [...autres, ...duJour]
}

/**
 * Reproduit les plages du jour `depuisNumero` sur `joursCibles` : les plages actuelles des jours
 * cibles sont REMPLACÉES (un jour fermé est ouvert). Si le jour source n'a aucune plage, les jours
 * cibles sont fermés : « appliquer à » copie l'état du jour, fermé compris. Pure : les copies sont de
 * nouveaux objets (`id: null`, clé de `nouvelleCle`) ; l'entrée n'est pas mutée, les jours non ciblés
 * et le jour source sont inchangés. Le jour source et les numéros inconnus sont ignorés dans les cibles.
 */
export function appliquerPlagesAuxJours(
  plages: readonly PlageAgendaEdition[],
  depuisNumero: number,
  joursCibles: readonly number[],
  nouvelleCle: () => string,
): PlageAgendaEdition[] {
  const cibles = [...new Set(joursCibles)]
    .filter((numero) => numero !== depuisNumero && JOURS_NUMEROS.includes(numero))
    .sort((a, b) => a - b)
  const modele = plages.filter((plage) => plage.jourSemaine === depuisNumero)
  const conservees = plages.filter((plage) => !cibles.includes(plage.jourSemaine)).map((plage) => ({ ...plage }))
  const copies = cibles.flatMap((numero) => modele.map((plage): PlageAgendaEdition => ({
    cle: nouvelleCle(),
    id: null,
    jourSemaine: numero,
    debut: plage.debut,
    fin: plage.fin,
  })))
  return [...conservees, ...copies]
}

/** Semaine type : lundi à vendredi, 9h–17h, week-end fermé. Pure : nouvelles plages sans `id`. */
export function semaineType(nouvelleCle: () => string): PlageAgendaEdition[] {
  return SEMAINE_TYPE_JOURS.map((jourSemaine): PlageAgendaEdition => ({
    cle: nouvelleCle(),
    id: null,
    jourSemaine,
    ...PLAGE_PAR_DEFAUT,
  }))
}

/** Nombre de plages encore ajoutables au jour `numero`, la limite étant globale à la semaine. */
export function plagesRestantesPourJour(
  jours: ReadonlyArray<{ numero: number, plages: readonly unknown[] }>,
  numero: number,
): number {
  const autres = jours.filter((jour) => jour.numero !== numero).reduce((total, jour) => total + jour.plages.length, 0)
  return Math.max(0, DISPONIBILITES_MAX - autres)
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

/**
 * « 2026-12-15 » → « lundi 15 décembre » (l'année n'est ajoutée que si elle diffère de `anneeCourante`,
 * ou toujours si elle est omise). Date de calendrier pure : aucun décalage de fuseau.
 */
export function formaterDateLocale(date: string, anneeCourante?: number): string {
  const [annee, mois, jour] = date.split('-').map(Number)
  if (!annee || !mois || !jour) return date
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(annee === anneeCourante ? {} : { year: 'numeric' as const }),
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(annee, mois - 1, jour)))
}

const FUSEAU_REPLI = 'Africa/Douala'

/** Date du jour « AAAA-MM-JJ » dans le fuseau de la vitrine (repli sur Africa/Douala si le fuseau est inconnu). */
export function dateDuJourDansFuseau(maintenant: Date, fuseau: string): string {
  const formater = (zone: string): string => new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(maintenant)
  try {
    return formater(fuseau)
  }
  catch {
    return formater(FUSEAU_REPLI)
  }
}

/**
 * Sépare les indisponibilités : « à venir » (aujourd'hui compris) du plus proche au plus lointain,
 * « passées » de la plus récente à la plus ancienne. Pure : `aujourdhui` au format AAAA-MM-JJ.
 */
export function separerIndisponibilites<T extends { date: string, id: string }>(
  items: readonly T[],
  aujourdhui: string,
): { aVenir: T[], passees: T[] } {
  const ordre = (a: T, b: T): number => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)
  return {
    aVenir: items.filter((item) => item.date >= aujourdhui).sort(ordre),
    passees: items.filter((item) => item.date < aujourdhui).sort((a, b) => ordre(b, a)),
  }
}

const MESSAGE_DATE_INVALIDE = 'Choisissez une date valide.'
const MESSAGE_DATE_A_VENIR = 'Choisissez une date à venir.'
const MESSAGE_DATE_DEJA_FERMEE = 'Cette date est déjà indisponible.'
const MESSAGE_DATE_PASSEE_SERVEUR = 'Cette date est déjà passée. Choisissez une date à venir.'
const MESSAGE_FIN_AVANT_DEBUT = 'La date de fin doit être le même jour que le début, ou après.'
const MESSAGE_ERREUR_AJOUT = 'Nous n’avons pas pu ajouter cette indisponibilité. Réessayez dans un instant.'

/** « 1 jour », « 5 jours ». */
export function libelleNombreJours(nombre: number): string {
  return `${nombre} ${nombre > 1 ? 'jours' : 'jour'}`
}

/** Limite de la plage, au format du message sous le champ « Au ». */
export function messagePlageMax(maximum: number = INDISPONIBILITE_PLAGE_MAX_JOURS): string {
  return `Au maximum ${maximum} jours à la fois.`
}

/** Nombre de jours (bornes incluses) de la plage saisie ; `null` tant qu'une date est illisible ou que la fin précède le début. */
export function joursPlageSaisie(debut: string, fin: string): number | null {
  if (!dateLocaleValide(debut) || !dateLocaleValide(fin)) return null
  const jours = nombreJoursPlage(debut, fin)
  return jours >= 1 ? jours : null
}

/** Confort : le serveur fait autorité. Valide une date unique (lisible, à venir, pas déjà fermée). */
export function validerDateIndisponibilite(
  date: string,
  aujourdhui: string,
  datesFermees: readonly string[],
): string | undefined {
  if (!dateLocaleValide(date)) return MESSAGE_DATE_INVALIDE
  if (date < aujourdhui) return MESSAGE_DATE_A_VENIR
  if (datesFermees.includes(date)) return MESSAGE_DATE_DEJA_FERMEE
  return undefined
}

/** Confort : le serveur fait autorité. Valide « Du » / « Au » : dates lisibles, début à venir, fin ≥ début, limite de jours. */
export function validerPlageIndisponibilite(
  debut: string,
  fin: string,
  aujourdhui: string,
  maximum: number = INDISPONIBILITE_PLAGE_MAX_JOURS,
): Pick<ErreursIndisponibiliteAgenda, 'debut' | 'fin'> {
  const erreurs: Pick<ErreursIndisponibiliteAgenda, 'debut' | 'fin'> = {}
  const debutValide = dateLocaleValide(debut)
  if (!debutValide) erreurs.debut = MESSAGE_DATE_INVALIDE
  else if (debut < aujourdhui) erreurs.debut = MESSAGE_DATE_A_VENIR
  if (!dateLocaleValide(fin)) erreurs.fin = MESSAGE_DATE_INVALIDE
  else if (debutValide && fin < debut) erreurs.fin = MESSAGE_FIN_AVANT_DEBUT
  else if (debutValide && nombreJoursPlage(debut, fin) > maximum) erreurs.fin = messagePlageMax(maximum)
  return erreurs
}

/** Ajoute les lignes créées à la liste (sans doublon d'identifiant) et trie par date. Pure. */
export function fusionnerIndisponibilites(
  existantes: readonly IndisponibiliteDTO[],
  creees: readonly IndisponibiliteDTO[],
): IndisponibiliteDTO[] {
  const nouveaux = new Set(creees.map((item) => item.id))
  return trierIndisponibilites([...existantes.filter((item) => !nouveaux.has(item.id)), ...creees])
}

/** Texte de succès d'un ajout : date unique, plage (singulier/pluriel, dates déjà fermées) ou plage déjà entièrement fermée. */
export function libelleResultatIndisponibilites(reponse: IndisponibiliteCreateDTO): string {
  if (!('items' in reponse)) return 'Indisponibilité ajoutée.'
  if (reponse.creees === 0) return 'Ces dates étaient déjà fermées.'
  const fermes = `${reponse.creees} ${reponse.creees > 1 ? 'jours fermés' : 'jour fermé'}`
  if (reponse.ignorees === 0) return `${fermes}.`
  return `${fermes} (${reponse.ignorees} ${reponse.ignorees > 1 ? 'déjà fermés' : 'déjà fermé'}).`
}

/** Avertissement quand des réservations tombent sur les dates fermées (elles ne sont pas annulées). Vide si aucune. */
export function libelleAvertissementReservations(nombre: number): string {
  if (nombre <= 0) return ''
  if (nombre === 1) return '1 réservation existe déjà sur ces dates. Elle n’est pas annulée : traitez-la depuis l’agenda.'
  return `${nombre} réservations existent déjà sur ces dates. Elles ne sont pas annulées : traitez-les depuis l’agenda.`
}

/** Message unique de la zone après un ajout : l'avertissement REMPLACE le succès, le « déjà fermé » est neutre. */
export function messageResultatIndisponibilites(reponse: IndisponibiliteCreateDTO): MessageIndisponibilite {
  const avertissement = libelleAvertissementReservations(reponse.reservationsConcernees)
  if (avertissement) return { type: 'avertissement', texte: avertissement }
  const dejaFermees = 'items' in reponse && reponse.creees === 0
  return { type: dejaFermees ? 'info' : 'succes', texte: libelleResultatIndisponibilites(reponse) }
}

/**
 * Erreurs de champ d'une réponse 400/409/422 de l'ajout : le message du serveur est affiché sous le champ
 * concerné (`debut` en mode plage pour une date passée). Vide si l'erreur n'est pas liée à un champ.
 */
export function erreursIndisponibiliteDepuisApi(
  api: Pick<ErreurApi, 'code' | 'champs'>,
  mode: ModeIndisponibilite,
  messageServeur: string | null,
): ErreursIndisponibiliteAgenda {
  const champDate = mode === 'date' ? 'date' : 'debut'
  const erreurs: ErreursIndisponibiliteAgenda = {}
  if (api.code === 'INDISPONIBILITE_DATE_PASSEE') erreurs[champDate] = messageServeur ?? MESSAGE_DATE_PASSEE_SERVEUR
  else if (api.code === 'INDISPONIBILITE_EXISTANTE') erreurs[champDate] = messageServeur ?? MESSAGE_DATE_DEJA_FERMEE
  for (const champ of ['date', 'debut', 'fin', 'raison'] as const) {
    const premier = api.champs[champ]?.[0]
    if (premier && !erreurs[champ]) erreurs[champ] = premier
  }
  return erreurs
}

function lireMessageServeur(erreur: unknown): string | null {
  if (typeof erreur !== 'object' || erreur === null || !('data' in erreur)) return null
  const corps = erreur.data
  if (typeof corps !== 'object' || corps === null || !('message' in corps)) return null
  return typeof corps.message === 'string' && corps.message !== '' ? corps.message : null
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

  /** Message des HEURES de la semaine uniquement ; les indisponibilités ont le leur (zone distincte). */
  const message = ref<MessageStudioAgenda | null>(null)
  const messageIndisponibilite = ref<MessageIndisponibilite | null>(null)
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
  const aucunePlage = computed(() => plages.value.length === 0)
  const disponibilitesModifiees = computed(() => Boolean(disponibilitesData.value)
    && empreinteDisponibilites() !== derniereEmpreinte)

  function effacerMessage(): void {
    message.value = null
  }

  function afficherMessage(type: MessageStudioAgenda['type'], texte: string): void {
    message.value = { type, texte }
  }

  /** Retire des erreurs celles des plages qui n'existent plus ou dont le jour vient d'être réécrit. */
  function purgerErreurs(plagesRestantes: readonly PlageAgendaEdition[], joursTouches: readonly number[]): void {
    const conservees = new Set(plagesRestantes.filter((plage) => !joursTouches.includes(plage.jourSemaine)).map((plage) => plage.cle))
    erreursDisponibilites.value = {
      ...erreursDisponibilites.value,
      plages: Object.fromEntries(
        Object.entries(erreursDisponibilites.value.plages).filter(([cle]) => conservees.has(cle)),
      ),
    }
  }

  /**
   * « Appliquer » de la feuille d'un jour : applique la copie saisie au BROUILLON, puis la reproduit
   * sur `cibles` (leurs plages sont remplacées). Renvoie un message si rien n'a été appliqué
   * (heures invalides ou limite de plages dépassée), `null` en cas de succès.
   */
  function appliquerJour(numero: number, saisies: readonly PlageSaisie[], cibles: readonly number[]): string | null {
    if (Object.keys(validerPlagesJour(saisies)).length > 0) return 'Corrigez les heures signalées pour continuer.'
    const cle = (): string => nouvelleCle('plage')
    const resultat = appliquerPlagesAuxJours(remplacerPlagesDuJour(plages.value, numero, saisies, cle), numero, cibles, cle)
    if (resultat.length > DISPONIBILITES_MAX) return `Vous pouvez enregistrer jusqu’à ${DISPONIBILITES_MAX} plages.`
    effacerMessage()
    plages.value = resultat
    purgerErreurs(resultat, [numero, ...cibles])
    return null
  }

  /** Premier usage : remplit le brouillon avec la semaine type, uniquement si aucune plage n'existe. */
  function appliquerSemaineType(): void {
    if (plages.value.length > 0) return
    effacerMessage()
    plages.value = semaineType(() => nouvelleCle('plage'))
    erreursDisponibilites.value = { ...erreursDisponibilites.value, plages: {} }
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

    for (const jour of JOURS_SEMAINE) {
      Object.assign(erreurs.plages, validerPlagesJour(plages.value.filter((plage) => plage.jourSemaine === jour.numero)))
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
  const modeIndisponibilite = ref<ModeIndisponibilite>('date')
  const dateIndisponibilite = ref('')
  const debutIndisponibilite = ref('')
  const finIndisponibilite = ref('')
  const raisonIndisponibilite = ref('')
  const erreursIndisponibilite = ref<ErreursIndisponibiliteAgenda>({})
  const ajoutIndisponibiliteEnCours = ref(false)
  const suppressionIndisponibiliteEnCours = ref<string | null>(null)
  const suppressionIndisponibiliteAConfirmer = ref<string | null>(null)

  watch(indisponibilitesData, (reponse) => {
    if (reponse) indisponibilites.value = trierIndisponibilites(reponse.items)
  }, { immediate: true })

  const aujourdhui = computed(() => dateDuJourDansFuseau(new Date(), reglages.value.fuseau))
  const anneeCourante = computed(() => Number(aujourdhui.value.slice(0, 4)))
  const indisponibilitesSeparees = computed(() => {
    const { aVenir, passees } = separerIndisponibilites(indisponibilites.value, aujourdhui.value)
    const vue = (item: IndisponibiliteDTO): IndisponibiliteAgendaVue => ({
      ...item,
      dateLibelle: formaterDateLocale(item.date, anneeCourante.value),
    })
    return { aVenir: aVenir.map(vue), passees: passees.map(vue) }
  })
  const indisponibilitesAVenir = computed(() => indisponibilitesSeparees.value.aVenir)
  const indisponibilitesPassees = computed(() => indisponibilitesSeparees.value.passees)

  /** Nombre de jours de la plage en cours de saisie (« 5 jours » en direct), `null` si elle est illisible. */
  const joursPlage = computed(() => joursPlageSaisie(debutIndisponibilite.value, finIndisponibilite.value))
  const libelleJoursPlage = computed(() => (joursPlage.value === null ? '' : libelleNombreJours(joursPlage.value)))
  const plageTropLongue = computed(() => (joursPlage.value ?? 0) > INDISPONIBILITE_PLAGE_MAX_JOURS)
  const erreurLongueurPlage = computed(() => (plageTropLongue.value ? messagePlageMax() : undefined))
  const ajoutIndisponibilitePossible = computed(() => (modeIndisponibilite.value === 'date'
    ? dateIndisponibilite.value !== ''
    : debutIndisponibilite.value !== '' && finIndisponibilite.value !== '' && !plageTropLongue.value))

  function changerModeIndisponibilite(mode: ModeIndisponibilite): void {
    if (mode === modeIndisponibilite.value) return
    modeIndisponibilite.value = mode
    erreursIndisponibilite.value = {}
    messageIndisponibilite.value = null
  }

  function modifierIndisponibilite(champ: ChampIndisponibilite, valeur: string): void {
    messageIndisponibilite.value = null
    if (champ === 'date') dateIndisponibilite.value = valeur
    else if (champ === 'debut') debutIndisponibilite.value = valeur
    else if (champ === 'fin') finIndisponibilite.value = valeur
    else raisonIndisponibilite.value = valeur
    // Changer le début peut rendre la fin valide (ou invalide) : son ancienne erreur ne vaut plus.
    const effacees: readonly ChampIndisponibilite[] = champ === 'debut' ? ['debut', 'fin'] : [champ]
    erreursIndisponibilite.value = Object.fromEntries(
      Object.entries(erreursIndisponibilite.value).filter(([nom]) => !effacees.some((effacee) => effacee === nom)),
    )
  }

  async function ajouterIndisponibilite(): Promise<void> {
    if (ajoutIndisponibiliteEnCours.value) return
    messageIndisponibilite.value = null
    const mode = modeIndisponibilite.value
    const date = dateIndisponibilite.value
    const debut = debutIndisponibilite.value
    const fin = finIndisponibilite.value
    const raison = raisonIndisponibilite.value.trim()

    const erreurs: ErreursIndisponibiliteAgenda = mode === 'date'
      ? { date: validerDateIndisponibilite(date, aujourdhui.value, indisponibilites.value.map((item) => item.date)) }
      : validerPlageIndisponibilite(debut, fin, aujourdhui.value)
    if (raison.length > RAISON_INDISPONIBILITE_MAX) {
      erreurs.raison = `La raison est limitée à ${RAISON_INDISPONIBILITE_MAX} caractères.`
    }
    const invalide = Object.values(erreurs).some(Boolean)
    erreursIndisponibilite.value = invalide ? erreurs : {}
    if (invalide) return

    // Date unique : insertion immédiate (annulée en cas d'échec). Plage : on attend le serveur, qui ignore les dates déjà fermées.
    const temporaire: IndisponibiliteDTO | null = mode === 'date'
      ? { id: nouvelleCle('indisponibilite'), date, raison: raison || null }
      : null
    if (temporaire) {
      indisponibilites.value = trierIndisponibilites([...indisponibilites.value, temporaire])
      dateIndisponibilite.value = ''
      raisonIndisponibilite.value = ''
    }
    ajoutIndisponibiliteEnCours.value = true
    try {
      const reponse = await $fetch<IndisponibiliteCreateDTO>('/api/studio/agenda/indisponibilites', {
        method: 'POST',
        body: mode === 'date' ? { date, raison: raison || null } : { debut, fin, raison: raison || null },
      })
      const creees = 'items' in reponse ? reponse.items : [reponse.item]
      indisponibilites.value = fusionnerIndisponibilites(
        indisponibilites.value.filter((item) => item.id !== temporaire?.id),
        creees,
      )
      if (mode === 'plage') {
        debutIndisponibilite.value = ''
        finIndisponibilite.value = ''
        raisonIndisponibilite.value = ''
      }
      messageIndisponibilite.value = messageResultatIndisponibilites(reponse)
    }
    catch (erreur) {
      if (temporaire) {
        indisponibilites.value = indisponibilites.value.filter((item) => item.id !== temporaire.id)
        dateIndisponibilite.value = date
        raisonIndisponibilite.value = raison
      }
      const api = lireErreurApi(erreur)
      const parChamp = erreursIndisponibiliteDepuisApi(api, mode, lireMessageServeur(erreur))
      erreursIndisponibilite.value = parChamp
      // Erreur liée à un champ : elle s'affiche sous le champ, pas en doublon dans le retour de la zone.
      messageIndisponibilite.value = Object.keys(parChamp).length > 0
        ? null
        : { type: 'erreur', texte: MESSAGE_ERREUR_AJOUT }
      // Date déjà fermée ailleurs (autre appareil) : la liste affichée doit la montrer.
      if (api.code === 'INDISPONIBILITE_EXISTANTE') await refreshIndisponibilites()
    }
    finally {
      ajoutIndisponibiliteEnCours.value = false
    }
  }

  function demanderSuppressionIndisponibilite(id: string): void {
    messageIndisponibilite.value = null
    suppressionIndisponibiliteAConfirmer.value = id
  }

  function annulerSuppressionIndisponibilite(): void {
    suppressionIndisponibiliteAConfirmer.value = null
  }

  async function supprimerIndisponibilite(id: string): Promise<void> {
    const item = indisponibilites.value.find((courant) => courant.id === id)
    if (!item || suppressionIndisponibiliteEnCours.value) return
    messageIndisponibilite.value = null
    suppressionIndisponibiliteAConfirmer.value = null
    suppressionIndisponibiliteEnCours.value = id
    indisponibilites.value = indisponibilites.value.filter((courant) => courant.id !== id)
    try {
      await $fetch(`/api/studio/agenda/indisponibilites/${id}`, { method: 'DELETE' })
      messageIndisponibilite.value = { type: 'succes', texte: 'Indisponibilité supprimée.' }
    }
    catch {
      indisponibilites.value = trierIndisponibilites([...indisponibilites.value, item])
      messageIndisponibilite.value = { type: 'erreur', texte: 'Nous n’avons pas pu supprimer cette indisponibilité. Elle a été rétablie.' }
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
    messageIndisponibilite.value = null
    await Promise.all([refreshDisponibilites(), refreshIndisponibilites()])
  }

  return {
    enChargement, enErreur, absente, rafraichir, message, effacerMessage,
    jours, reglages, fuseauItems, pasItems, erreursDisponibilites,
    disponibilitesModifiees, enregistrementDisponibilites,
    aucunePlage, appliquerJour, appliquerSemaineType, modifierReglage, enregistrerDisponibilites,
    indisponibilitesAVenir,
    indisponibilitesPassees,
    messageIndisponibilite,
    dateMinIndisponibilite: aujourdhui,
    modeIndisponibilite,
    changerModeIndisponibilite,
    dateIndisponibilite,
    debutIndisponibilite,
    finIndisponibilite,
    joursPlage,
    libelleJoursPlage,
    erreurLongueurPlage,
    ajoutIndisponibilitePossible,
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
