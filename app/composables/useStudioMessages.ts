import type { MessageStudioDTO, MessagesStudioReponse } from '#shared/dto'
import type { MessageStudioAgenda } from '~/composables/useStudioDisponibilites'
import { TOUJOURS_FRAIS } from '~/composables/useStudioDisponibilites'

/** Réponse de POST /api/studio/messages/:id/lu. */
interface MessageLuReponse {
  item: { id: string, luLe: string }
}

export interface MessageStudioVue extends MessageStudioDTO {
  initiale: string
  dateRelative: string
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

function enrichirMessage(item: MessageStudioDTO, maintenant: Date): MessageStudioVue {
  const initiale = item.nom.trim().charAt(0).toLocaleUpperCase(LOCALE_FR) || '?'
  return { ...item, initiale, dateRelative: libelleDateRelative(item.creeLe, maintenant) }
}

/**
 * Messages reçus depuis la vitrine (S7-bis) : liste, compteur de non-lus et
 * marquage « lu » au premier dépliage, optimiste et réversible.
 */
export function useStudioMessages() {
  const { data, status, error, refresh } = useFetch<MessagesStudioReponse>('/api/studio/messages', {
    key: 'studio-messages',
    ...TOUJOURS_FRAIS,
  })

  const maintenant = new Date()
  const messages = ref<MessageStudioVue[]>([])
  const idDeplie = ref<string | null>(null)
  const marquageLuEnCours = ref<string | null>(null)
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
    if (!message || message.luLe !== null || marquageLuEnCours.value) return
    erreurMarquageLu.value = null
    const luLeAvant = message.luLe
    message.luLe = new Date().toISOString()
    marquageLuEnCours.value = id
    try {
      const reponse = await $fetch<MessageLuReponse>(`/api/studio/messages/${id}/lu`, {
        method: 'POST',
        body: {},
      })
      message.luLe = reponse.item.luLe
    }
    catch {
      // Le point non lu revient : rien n'est perdu, le message reste déplié.
      message.luLe = luLeAvant
      erreurMarquageLu.value = {
        type: 'erreur',
        texte: 'Nous n’avons pas pu marquer ce message comme lu. Il restera signalé comme non lu.',
      }
    }
    finally {
      marquageLuEnCours.value = null
    }
  }

  /** Déplie (ou replie) un message, puis le marque lu au premier dépliage. */
  function basculer(id: string): void {
    erreurMarquageLu.value = null
    idDeplie.value = idDeplie.value === id ? null : id
    void marquerLu(id)
  }

  async function rafraichir(): Promise<void> {
    erreurMarquageLu.value = null
    idDeplie.value = null
    await refresh()
  }

  return {
    messages,
    nonLus,
    idDeplie,
    basculer,
    erreurMarquageLu,
    enChargement,
    enErreur,
    absente,
    rafraichir,
  }
}
