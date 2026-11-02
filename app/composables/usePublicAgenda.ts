import type { NuxtError } from '#app'
import type { CreneauDTO, CreneauxPublicsReponse } from '#shared/dto'

const JOURS_AGENDA_PUBLIC = 31
const LOCALE_FR = 'fr-FR'
/** Nombre maximal de mois navigables depuis le mois courant (le serveur borne de toute façon l'horizon). */
const MOIS_NAVIGABLES_MAX = 12

export type AgendaPublicStatut = 'idle' | 'pending' | 'success' | 'error'

export interface ProchainCreneauPublic extends CreneauDTO {
  serviceSlug: string
  fuseau: string
}

interface UsePublicAgendaOptions {
  username: string
  fuseau: string
  serviceSlug: string | null
  cle: string
  jours?: number
  mode?: 'accueil' | 'page'
}

/** Réponse du mois, enveloppée des bornes demandées pour valider la fraîcheur côté client. */
export interface ReponseMoisAgenda extends CreneauxPublicsReponse {
  du: string
  au: string
}

export interface RetourAgendaAccueil {
  serviceSlug: Ref<string | null>
  dateDebut: string
  dateFin: string
  reponse: ComputedRef<CreneauxPublicsReponse | null>
  creneaux: ComputedRef<CreneauDTO[]>
  prochainCreneau: ComputedRef<ProchainCreneauPublic | null>
  statut: Ref<AgendaPublicStatut>
  erreur: Ref<NuxtError<unknown> | undefined>
  choisirService: (slug: string) => void
  rafraichir: () => Promise<void>
}

export interface RetourAgendaPage {
  serviceSlug: Ref<string | null>
  /** Mois affiché, au format `YYYY-MM` (fuseau de la vitrine). */
  mois: Ref<string>
  /** Créneaux du mois affiché, groupés par date locale (`YYYY-MM-DD` du fuseau). */
  creneauxParJour: ComputedRef<Map<string, CreneauDTO[]>>
  peutReculer: ComputedRef<boolean>
  peutAvancer: ComputedRef<boolean>
  reponse: ComputedRef<ReponseMoisAgenda | null>
  statut: Ref<AgendaPublicStatut>
  erreur: Ref<NuxtError<unknown> | undefined>
  choisirService: (slug: string) => void
  changerMois: (direction: -1 | 1) => void
  rafraichir: () => Promise<void>
}

function partiesDate(date: Date, fuseau: string): Record<string, string> {
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuseau,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return Object.fromEntries(parties.map(partie => [partie.type, partie.value]))
}

/** Date locale ISO dans le fuseau de la vitrine, jamais dans celui du navigateur. */
export function dateLocaleAgenda(value: string | Date, fuseau: string): string {
  const date = value instanceof Date ? value : new Date(value)
  const parties = partiesDate(date, fuseau)
  return `${parties.year}-${parties.month}-${parties.day}`
}

/** Arithmétique sur une date civile, sans transition de fuseau. */
export function ajouterJoursAgenda(dateLocale: string, jours: number): string {
  const [annee = 0, mois = 1, jour = 1] = dateLocale.split('-').map(Number)
  const date = new Date(Date.UTC(annee, mois - 1, jour + jours))
  return date.toISOString().slice(0, 10)
}

/** Mois civile d'une date locale : `2026-10-23` -> `2026-10`. */
function moisDeDateAgenda(dateLocale: string): string {
  return dateLocale.slice(0, 7)
}

function debutMoisAgenda(mois: string): string {
  return `${mois}-01`
}

/** Dernier jour du mois, par arithmétique civile (le jour 0 du mois suivant). */
function finMoisAgenda(mois: string): string {
  const [annee = 0, moisNumero = 1] = mois.split('-').map(Number)
  return new Date(Date.UTC(annee, moisNumero, 0)).toISOString().slice(0, 10)
}

function decalerMoisAgenda(mois: string, delta: number): string {
  const [annee = 0, moisNumero = 1] = mois.split('-').map(Number)
  return new Date(Date.UTC(annee, moisNumero - 1 + delta, 1)).toISOString().slice(0, 7)
}

export function libelleMoisAgenda(mois: string): string {
  const [annee = 0, moisNumero = 1] = mois.split('-').map(Number)
  const texte = new Intl.DateTimeFormat(LOCALE_FR, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(annee, moisNumero - 1, 1)))
  return texte.charAt(0).toLocaleUpperCase(LOCALE_FR) + texte.slice(1)
}

export function debutSemaineAgenda(dateLocale: string): string {
  const [annee = 0, mois = 1, jour = 1] = dateLocale.split('-').map(Number)
  const date = new Date(Date.UTC(annee, mois - 1, jour))
  const jourSemaine = date.getUTCDay() || 7
  return ajouterJoursAgenda(dateLocale, 1 - jourSemaine)
}

export function formaterHeureAgenda(iso: string, fuseau: string): string {
  const parties = new Intl.DateTimeFormat(LOCALE_FR, {
    timeZone: fuseau,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso))
  const heure = Number(parties.find(partie => partie.type === 'hour')?.value ?? 0)
  const minute = parties.find(partie => partie.type === 'minute')?.value ?? '00'
  return minute === '00' ? `${heure} h` : `${heure} h ${minute}`
}

export function formaterDateLongueAgenda(iso: string, fuseau: string): string {
  const texte = new Intl.DateTimeFormat(LOCALE_FR, {
    timeZone: fuseau,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso))
  return texte.charAt(0).toLocaleUpperCase(LOCALE_FR) + texte.slice(1)
}

export function formaterJourCreneauAgenda(iso: string, fuseau: string): string {
  const jour = new Intl.DateTimeFormat(LOCALE_FR, { timeZone: fuseau, weekday: 'short' })
    .format(new Date(iso))
    .replace('.', '')
  return `${jour.charAt(0).toLocaleUpperCase(LOCALE_FR)}${jour.slice(1)}. ${formaterHeureAgenda(iso, fuseau)}`
}

/**
 * Mode accueil : une fenêtre de `jours` jours depuis aujourd'hui, un seul appel.
 * (Utilisé par l'accueil gelé et l'étape de confirmation — API inchangée.)
 */
async function useAgendaAccueil(options: UsePublicAgendaOptions): Promise<RetourAgendaAccueil> {
  const serviceSlug = ref<string | null>(options.serviceSlug)
  const dateDebut = dateLocaleAgenda(new Date(), options.fuseau)
  const jours = Math.max(1, options.jours ?? JOURS_AGENDA_PUBLIC)
  const dateFin = ajouterJoursAgenda(dateDebut, jours - 1)

  const { data, status, error, refresh } = await useAsyncData<CreneauxPublicsReponse | null>(
    `agenda-public-${options.username}-${options.cle}`,
    async () => {
      if (serviceSlug.value === null) return null
      return await $fetch<CreneauxPublicsReponse>(
        `/api/public/${encodeURIComponent(options.username)}/creneaux`,
        { query: { service: serviceSlug.value, du: dateDebut, au: dateFin } },
      )
    },
    { watch: [serviceSlug] },
  )

  const reponse = computed(() => {
    if (data.value?.service.slug !== serviceSlug.value) return null
    return data.value
  })
  const creneaux = computed(() => reponse.value?.creneaux ?? [])
  const prochainCreneau = computed<ProchainCreneauPublic | null>(() => {
    const premier = creneaux.value[0]
    if (!premier || !serviceSlug.value) return null
    return { ...premier, serviceSlug: serviceSlug.value, fuseau: reponse.value?.fuseau ?? options.fuseau }
  })

  function choisirService(slug: string): void {
    if (slug !== serviceSlug.value) serviceSlug.value = slug
  }

  async function rafraichir(): Promise<void> {
    await refresh()
  }

  return {
    serviceSlug,
    dateDebut,
    dateFin,
    reponse,
    creneaux,
    prochainCreneau,
    statut: status as Ref<AgendaPublicStatut>,
    erreur: error,
    choisirService,
    rafraichir,
  }
}

/**
 * Mode page (S7-bis) : un mois à la fois, groupé par jour, avec un cache mémoire
 * par clé `service|mois`. La navigation entre mois ne refait pas d'appel pour un
 * mois déjà vu ; le serveur reste seul responsable du calcul des créneaux et borne
 * lui-même l'horizon (les mois au-delà reviennent simplement vides).
 */
async function useAgendaMensuel(options: UsePublicAgendaOptions): Promise<RetourAgendaPage> {
  const serviceSlug = ref<string | null>(options.serviceSlug)
  const moisCourant = moisDeDateAgenda(dateLocaleAgenda(new Date(), options.fuseau))
  const mois = ref(moisCourant)
  const dernierMoisNavigable = decalerMoisAgenda(moisCourant, MOIS_NAVIGABLES_MAX)
  const cacheMois = new Map<string, ReponseMoisAgenda>()
  const cleRequete = computed(() => `${serviceSlug.value ?? 'sans-service'}|${mois.value}`)

  const { data, status, error, refresh } = await useAsyncData<ReponseMoisAgenda | null>(
    `agenda-page-${options.username}-${options.cle}`,
    async () => {
      if (!serviceSlug.value) return null
      const cle = cleRequete.value
      const enCache = cacheMois.get(cle)
      if (enCache) return enCache
      const du = debutMoisAgenda(mois.value)
      const au = finMoisAgenda(mois.value)
      const reponse = await $fetch<CreneauxPublicsReponse>(
        `/api/public/${encodeURIComponent(options.username)}/creneaux`,
        { query: { service: serviceSlug.value, du, au } },
      )
      const enveloppe: ReponseMoisAgenda = { ...reponse, du, au }
      cacheMois.set(cle, enveloppe)
      return enveloppe
    },
    { watch: [cleRequete] },
  )

  // L'enveloppe porte ses bornes : une réponse d'un mois précédent n'est jamais affichée.
  const reponse = computed(() => {
    const valeur = data.value
    if (!valeur || valeur.service.slug !== serviceSlug.value) return null
    if (valeur.du !== debutMoisAgenda(mois.value) || valeur.au !== finMoisAgenda(mois.value)) return null
    return valeur
  })
  const fuseauEffectif = computed(() => reponse.value?.fuseau ?? options.fuseau)

  const creneauxParJour = computed(() => {
    const groupes = new Map<string, CreneauDTO[]>()
    for (const creneau of reponse.value?.creneaux ?? []) {
      const date = dateLocaleAgenda(creneau.debut, fuseauEffectif.value)
      if (!date.startsWith(mois.value)) continue
      groupes.set(date, [...(groupes.get(date) ?? []), creneau])
    }
    return groupes
  })

  const peutReculer = computed(() => mois.value > moisCourant)
  const peutAvancer = computed(() => mois.value < dernierMoisNavigable)

  function choisirService(slug: string): void {
    if (slug !== serviceSlug.value) serviceSlug.value = slug
  }

  function changerMois(direction: -1 | 1): void {
    const cible = decalerMoisAgenda(mois.value, direction)
    if (cible < moisCourant || cible > dernierMoisNavigable) return
    mois.value = cible
  }

  async function rafraichir(): Promise<void> {
    cacheMois.clear()
    await refresh()
  }

  return {
    serviceSlug,
    mois,
    creneauxParJour,
    peutReculer,
    peutAvancer,
    reponse,
    statut: status as Ref<AgendaPublicStatut>,
    erreur: error,
    choisirService,
    changerMois,
    rafraichir,
  }
}

/**
 * Source réactive unique des créneaux d'un écran public. Le serveur reste seul
 * responsable de leur calcul et recoupe encore le créneau lors de l'écriture.
 */
export function usePublicAgenda(options: UsePublicAgendaOptions & { mode?: 'accueil' }): Promise<RetourAgendaAccueil>
export function usePublicAgenda(options: UsePublicAgendaOptions & { mode: 'page' }): Promise<RetourAgendaPage>
export async function usePublicAgenda(options: UsePublicAgendaOptions): Promise<RetourAgendaAccueil | RetourAgendaPage> {
  if (options.mode === 'page') return useAgendaMensuel(options)
  return useAgendaAccueil(options)
}
