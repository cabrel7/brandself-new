import type { MessageStudioDTO, MessagesStudioReponse } from '#shared/dto'
import type { MessageStudioAgenda } from './useStudioDisponibilites'
import { TOUJOURS_FRAIS } from './useStudioDisponibilites'

/** Réponse de POST /api/studio/messages/:id/lu. */
interface MessageLuReponse {
  item: { id: string, luLe: string }
}

export interface MessageStudioVue extends MessageStudioDTO {
  initiale: string
  dateRelative: string
  /** Date complète lisible (fuseau du navigateur, comme `dateRelative`). */
  dateComplete: string
}

export interface VoisinsMessage {
  precedent: string | null
  suivant: string | null
  /** Rang 1-based du message dans la liste ; 0 si l'identifiant est inconnu. */
  position: number
  total: number
}

/** Message précédent et suivant dans l'ordre de la liste, et rang courant (« 2 sur 7 »). */
export function voisinsMessage(messages: ReadonlyArray<{ id: string }>, id: string | null): VoisinsMessage {
  const total = messages.length
  const index = id === null ? -1 : messages.findIndex((message) => message.id === id)
  if (index === -1) return { precedent: null, suivant: null, position: 0, total }
  return {
    precedent: index > 0 ? messages[index - 1]!.id : null,
    suivant: index < total - 1 ? messages[index + 1]!.id : null,
    position: index + 1,
    total,
  }
}

/** Message à afficher d'office sur grand écran : le premier non lu, sinon le premier. */
export function premierASelectionner(messages: ReadonlyArray<{ id: string, luLe: string | null }>): string | null {
  const nonLu = messages.find((message) => message.luLe === null)
  return (nonLu ?? messages[0])?.id ?? null
}

const LOCALE_FR = 'fr-FR'
const JOUR_MS = 86_400_000

function debutJour(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * « Aujourd'hui », « Hier », sinon le jour de la semaine (moins d'une semaine)
 * ou la date. Calculée dans le fuseau du navigateur : l'étiquette est relative
 * au lecteur, et le studio ne rend pas côté serveur.
 */
function libelleDateRelative(iso: string, maintenant: Date): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const differenceJours = Math.round((debutJour(maintenant) - debutJour(date)) / JOUR_MS)
  if (differenceJours <= 0) return 'Aujourd’hui'
  if (differenceJours === 1) return 'Hier'
  if (differenceJours < 7) {
    const jour = new Intl.DateTimeFormat(LOCALE_FR, { weekday: 'long' }).format(date)
    return jour.charAt(0).toLocaleUpperCase(LOCALE_FR) + jour.slice(1)
  }
  const options: Intl.DateTimeFormatOptions = date.getFullYear() === maintenant.getFullYear()
    ? { day: 'numeric', month: 'long' }
    : { day: 'numeric', month: 'long', year: 'numeric' }
  return new Intl.DateTimeFormat(LOCALE_FR, options).format(date)
}

function libelleDateComplete(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(LOCALE_FR, { dateStyle: 'full', timeStyle: 'short' }).format(date)
}

function enrichirMessage(item: MessageStudioDTO, maintenant: Date): MessageStudioVue {
  const initiale = item.nom.trim().charAt(0).toLocaleUpperCase(LOCALE_FR) || '?'
  return {
    ...item,
    initiale,
    dateRelative: libelleDateRelative(item.creeLe, maintenant),
    dateComplete: libelleDateComplete(item.creeLe),
  }
}

/**
 * Messages reçus depuis la vitrine (S7-bis) : liste, compteur de non-lus et
 * sélection (feuille ou volet de lecture), marquage « lu » à l'ouverture, optimiste et réversible.
 */
export function useStudioMessages() {
  const { data, status, error, refresh } = useFetch<MessagesStudioReponse>('/api/studio/messages', {
    key: 'studio-messages',
    ...TOUJOURS_FRAIS,
  })

  const maintenant = new Date()
  const messages = ref<MessageStudioVue[]>([])
  const idSelectionne = ref<string | null>(null)
  // Par identifiant : naviguer vite (Précédent/Suivant) ne doit pas laisser un message non marqué.
  const marquagesEnCours = new Set<string>()
  const erreurMarquageLu = ref<MessageStudioAgenda | null>(null)

  watch(data, (reponse) => {
    if (reponse) messages.value = reponse.items.map((item) => enrichirMessage(item, maintenant))
  }, { immediate: true })

  const nonLus = computed(() => messages.value.filter((message) => message.luLe === null).length)
  const donneesPretes = computed(() => data.value !== null && data.value !== undefined)
  const absente = computed(() => {
    const api = lireErreurApi(error.value)
    return error.value !== undefined && error.value !== null
      && (api.code === 'VITRINE_INTROUVABLE' || api.statut === 404)
  })
  const enErreur = computed(() => error.value !== undefined && error.value !== null && !absente.value)
  const enChargement = computed(() => !donneesPretes.value && !enErreur.value && !absente.value
    && (status.value === 'idle' || status.value === 'pending'))

  async function marquerLu(id: string): Promise<void> {
    const message = messages.value.find((item) => item.id === id)
    if (!message || message.luLe !== null || marquagesEnCours.has(id)) return
    erreurMarquageLu.value = null
    const luLeAvant = message.luLe
    message.luLe = new Date().toISOString()
    marquagesEnCours.add(id)
    try {
      const reponse = await $fetch<MessageLuReponse>(`/api/studio/messages/${id}/lu`, {
        method: 'POST',
        body: {},
      })
      message.luLe = reponse.item.luLe
    }
    catch {
      // Le point non lu revient : rien n'est perdu, le message reste ouvert.
      message.luLe = luLeAvant
      // L'alerte n'est affichée que si ce message est encore celui qu'on lit.
      if (idSelectionne.value === id) {
        erreurMarquageLu.value = {
          type: 'erreur',
          texte: 'Nous n’avons pas pu marquer ce message comme lu. Il restera signalé comme non lu.',
        }
      }
    }
    finally {
      marquagesEnCours.delete(id)
    }
  }

  /** Sélectionne un message (ouvre la feuille ou le volet) et le marque lu. */
  function ouvrir(id: string): void {
    if (!messages.value.some((message) => message.id === id)) return
    erreurMarquageLu.value = null
    idSelectionne.value = id
    void marquerLu(id)
  }

  function fermer(): void {
    erreurMarquageLu.value = null
    idSelectionne.value = null
  }

  const voisins = computed(() => voisinsMessage(messages.value, idSelectionne.value))

  function precedent(): void {
    if (voisins.value.precedent !== null) ouvrir(voisins.value.precedent)
  }

  function suivant(): void {
    if (voisins.value.suivant !== null) ouvrir(voisins.value.suivant)
  }

  async function rafraichir(): Promise<void> {
    fermer()
    await refresh()
  }

  return {
    messages,
    nonLus,
    idSelectionne,
    voisins,
    ouvrir,
    fermer,
    precedent,
    suivant,
    erreurMarquageLu,
    enChargement,
    enErreur,
    absente,
    rafraichir,
  }
}
