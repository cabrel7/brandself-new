import { SERVICES_DEMO } from '~/data/landing'

// Agenda de DÉMONSTRATION de la page d'accueil : aucune donnée réelle, aucun appel réseau, aucune écriture.
// Les jours et les heures sont calculés au fuseau de la vitrine d'exemple, jamais au fuseau du navigateur.

export const FUSEAU_AGENDA_DEMO = 'Africa/Douala'
const LANGUE = 'fr-FR'
const NB_JOURS = 5
const MIDI_UTC = 12
const ESPACE_INSECABLE = '\u00A0'

interface HeureCreneau {
  heure: number
  minute: number
}

const CRENEAUX: readonly HeureCreneau[] = [
  { heure: 9, minute: 0 },
  { heure: 10, minute: 0 },
  { heure: 11, minute: 30 },
  { heure: 14, minute: 0 },
  { heure: 15, minute: 30 },
  { heure: 16, minute: 30 },
]

/** Créneau « pris » : motif déterministe (même résultat à chaque affichage, côté serveur comme côté navigateur). */
export function estCreneauPris(indexJour: number, indexCreneau: number): boolean {
  return (indexJour * 2 + indexCreneau) % 5 === 3
}

function formaterHeure({ heure, minute }: HeureCreneau): string {
  const base = `${heure}${ESPACE_INSECABLE}h`
  return minute === 0 ? base : `${base}${ESPACE_INSECABLE}${String(minute).padStart(2, '0')}`
}

function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1)
}

/** Jour calendaire « aujourd'hui » dans le fuseau de la vitrine. */
function aujourdhui(instant: number): { annee: number, mois: number, jour: number } {
  const parties = new Intl.DateTimeFormat('en-CA', {
    timeZone: FUSEAU_AGENDA_DEMO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const lire = (type: Intl.DateTimeFormatPartTypes): number => Number(parties.find(p => p.type === type)?.value)
  return { annee: lire('year'), mois: lire('month'), jour: lire('day') }
}

export interface JourDemo {
  index: number
  /** Midi UTC de la date calendaire (13 h à Douala, même date). */
  instant: number
  /** « mer » */
  court: string
  numero: number
  /** « mercredi » */
  semaine: string
  /** « Mercredi 18 novembre » */
  long: string
}

export interface CreneauDemo {
  index: number
  libelle: string
  pris: boolean
}

export function useAgendaDemo() {
  // `useState` : le serveur fixe l'instant, le navigateur reprend la même valeur à l'hydratation (pas de décalage),
  // puis la corrige au montage si la page a été mise en cache.
  const maintenant = useState<number>('agenda-demo-maintenant', () => Date.now())
  onMounted(() => {
    maintenant.value = Date.now()
  })

  const formatCourt = new Intl.DateTimeFormat(LANGUE, { timeZone: FUSEAU_AGENDA_DEMO, weekday: 'short' })
  const formatSemaine = new Intl.DateTimeFormat(LANGUE, { timeZone: FUSEAU_AGENDA_DEMO, weekday: 'long' })
  const formatLong = new Intl.DateTimeFormat(LANGUE, { timeZone: FUSEAU_AGENDA_DEMO, weekday: 'long', day: 'numeric', month: 'long' })
  const formatMois = new Intl.DateTimeFormat(LANGUE, { timeZone: FUSEAU_AGENDA_DEMO, month: 'long', year: 'numeric' })

  // Les 5 prochains jours hors dimanche. Chaque jour est représenté par midi UTC de sa date calendaire (13 h à Douala, même date).
  const jours = computed<JourDemo[]>(() => {
    const debut = aujourdhui(maintenant.value)
    const resultat: JourDemo[] = []
    for (let decalage = 1; resultat.length < NB_JOURS; decalage++) {
      const date = new Date(Date.UTC(debut.annee, debut.mois - 1, debut.jour + decalage, MIDI_UTC))
      if (date.getUTCDay() === 0) continue
      resultat.push({
        index: resultat.length,
        instant: date.getTime(),
        court: formatCourt.format(date).replace('.', ''),
        numero: Number(date.getUTCDate()),
        semaine: formatSemaine.format(date),
        long: majuscule(formatLong.format(date)),
      })
    }
    return resultat
  })

  const libelleMois = computed(() => {
    const premier = jours.value[0]
    const dernier = jours.value[jours.value.length - 1]
    if (!premier || !dernier) return ''
    const debut = formatMois.format(premier.instant)
    const fin = formatMois.format(dernier.instant)
    return debut === fin ? majuscule(debut) : `${majuscule(debut)} – ${fin}`
  })

  const services = SERVICES_DEMO.map((service, index) => ({
    index,
    titre: service.titre,
    duree: service.duree,
  }))

  const indexService = ref(0)
  const indexJour = ref(0)

  function creneauLibreProche(jour: number, prefere: number): number {
    if (!estCreneauPris(jour, prefere)) return prefere
    const libre = CRENEAUX.findIndex((_, i) => !estCreneauPris(jour, i))
    return libre === -1 ? prefere : libre
  }

  const indexCreneau = ref(creneauLibreProche(0, 1))
  const confirme = ref(false)

  const serviceChoisi = computed(() => services[indexService.value] ?? services[0])
  const jourChoisi = computed(() => jours.value[indexJour.value] ?? jours.value[0])
  const creneaux = computed<CreneauDemo[]>(() =>
    CRENEAUX.map((heure, index) => ({
      index,
      libelle: formaterHeure(heure),
      pris: estCreneauPris(indexJour.value, index),
    })),
  )
  const creneauChoisi = computed(() => creneaux.value[indexCreneau.value])
  const libelleConfirmer = computed(() => `Confirmer ${jourChoisi.value?.semaine ?? ''} à ${creneauChoisi.value?.libelle ?? ''}`)

  function choisirJour(index: number) {
    indexJour.value = index
    indexCreneau.value = creneauLibreProche(index, indexCreneau.value)
  }

  function choisirCreneau(index: number) {
    if (estCreneauPris(indexJour.value, index)) return
    indexCreneau.value = index
  }

  function confirmer() {
    confirme.value = true
  }

  function recommencer() {
    confirme.value = false
  }

  return {
    services,
    indexService,
    serviceChoisi,
    jours,
    libelleMois,
    indexJour,
    jourChoisi,
    creneaux,
    indexCreneau,
    libelleConfirmer,
    confirme,
    choisirJour,
    choisirCreneau,
    confirmer,
    recommencer,
  }
}
