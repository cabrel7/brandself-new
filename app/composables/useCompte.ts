import type { AppareilDTO, MoiDTO } from '#shared/dto'
import { ACCOUNT_DELETION_PHRASE, DEVISES, LOCALES } from '#shared/compte'
import type { Devise, Locale } from '#shared/compte'
import type { MoiUpdateInput } from '#shared/schemas/moi'

export const LIBELLES_LOCALES: Record<Locale, string> = { fr: 'Français' }

export const LIBELLES_DEVISES: Record<Devise, string> = {
  XAF: 'Franc CFA (XAF)',
  EUR: 'Euro (EUR)',
  USD: 'Dollar américain (USD)',
}

export const ITEMS_LOCALES = LOCALES.map((valeur) => ({ label: LIBELLES_LOCALES[valeur], value: valeur }))
export const ITEMS_DEVISES = DEVISES.map((valeur) => ({ label: LIBELLES_DEVISES[valeur], value: valeur }))

const FUSEAUX_PROPOSES = [
  'Africa/Douala', 'Africa/Libreville', 'Africa/Kinshasa', 'Africa/Brazzaville', 'Africa/Dakar',
  'Africa/Abidjan', 'Africa/Lagos', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Algiers',
  'Europe/London', 'Europe/Paris', 'Europe/Brussels', 'Europe/Zurich', 'America/Montreal', 'America/New_York',
] as const

/** « Africa/Douala (UTC+1) » : décalage courant du fuseau, lisible sans zéro inutile. */
export function libelleFuseau(fuseau: string, date: Date = new Date()): string {
  try {
    const parties = new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, timeZoneName: 'longOffset' }).formatToParts(date)
    const brut = parties.find((p) => p.type === 'timeZoneName')?.value ?? ''
    const decalage = /([+\-−])(\d{2}):(\d{2})/.exec(brut)
    if (!decalage) return `${fuseau} (UTC)`
    const signe = decalage[1] === '−' ? '-' : decalage[1]
    const heures = String(Number(decalage[2]))
    const minutes = decalage[3] === '00' ? '' : `:${decalage[3]}`
    return `${fuseau} (UTC${signe}${heures}${minutes})`
  } catch {
    return fuseau
  }
}

export function itemsFuseaux(fuseauActuel: string): { label: string, value: string }[] {
  const valeurs: string[] = [...FUSEAUX_PROPOSES]
  if (!valeurs.includes(fuseauActuel)) valeurs.unshift(fuseauActuel)
  return valeurs.map((valeur) => ({ label: libelleFuseau(valeur), value: valeur }))
}

const ERREUR_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Réessayez dans un instant.'
const ERREUR_APPAREILS = 'Nous n’avons pas pu charger vos appareils. Réessayez dans un instant.'
const ERREUR_REVOCATION = 'Nous n’avons pas pu déconnecter cet appareil. Réessayez dans un instant.'
const ERREUR_SESSION_ACTUELLE = 'Pour quitter cet appareil, utilisez « Se déconnecter ».'
const ERREUR_CONFIRMATION = `La phrase saisie ne correspond pas. Saisissez « ${ACCOUNT_DELETION_PHRASE} » pour confirmer.`
const ERREUR_SESSION_ANCIENNE = 'Pour votre sécurité, reconnectez-vous puis réessayez.'
const ERREUR_SUPPRESSION = 'Nous n’avons pas pu supprimer votre compte. Réessayez dans un instant.'

/** Compte : informations (`/api/studio/moi`) et préférences. */
export function useMoi() {
  const { data, status, error, refresh } = useFetch<{ moi: MoiDTO }>('/api/studio/moi', {
    key: 'studio-moi',
    server: false,
    lazy: true,
  })
  const moi = computed(() => data.value?.moi ?? null)
  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const enErreur = computed(() => !data.value && Boolean(error.value))

  const enregistrement = ref(false)
  const erreur = ref('')
  const confirmation = ref('')
  const { start: masquerConfirmation, stop: annulerMasquage } = useTimeoutFn(() => {
    confirmation.value = ''
  }, 2000, { immediate: false })

  /** Mise à jour partielle ; retourne `false` si l'API refuse (le composant remet l'ancienne valeur). */
  async function mettreAJour(modification: MoiUpdateInput): Promise<boolean> {
    erreur.value = ''
    annulerMasquage()
    confirmation.value = ''
    enregistrement.value = true
    try {
      await $fetch('/api/studio/moi', { method: 'PUT', body: modification })
      await refresh()
      confirmation.value = 'Préférences enregistrées.'
      masquerConfirmation()
      return true
    } catch {
      erreur.value = ERREUR_ENREGISTREMENT
      return false
    } finally {
      enregistrement.value = false
    }
  }

  return { moi, enChargement, enErreur, refresh, enregistrement, erreur, confirmation, mettreAJour }
}

/** Appareils connectés : liste et révocation d'une session. */
export function useAppareils() {
  const { data, status, error, refresh } = useFetch<{ appareils: AppareilDTO[] }>('/api/studio/appareils', {
    key: 'studio-appareils',
    server: false,
    lazy: true,
  })
  const appareils = computed(() => data.value?.appareils ?? [])
  const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
  const messageChargement = computed(() => (error.value && !data.value ? ERREUR_APPAREILS : ''))

  const revocationEnCours = ref<string | null>(null)
  const erreurRevocation = ref('')

  async function revoquer(id: string): Promise<void> {
    erreurRevocation.value = ''
    revocationEnCours.value = id
    try {
      await $fetch(`/api/studio/appareils/${id}`, { method: 'DELETE' })
      await refresh()
    } catch (e) {
      erreurRevocation.value = lireErreurApi(e).code === 'SESSION_ACTUELLE' ? ERREUR_SESSION_ACTUELLE : ERREUR_REVOCATION
    } finally {
      revocationEnCours.value = null
    }
  }

  return { appareils, enChargement, messageChargement, refresh, revocationEnCours, erreurRevocation, revoquer }
}

/** Suppression du compte : saisie de la phrase, 400 / 403 expliqués, puis retour à /connexion. */
export function useSuppressionCompte() {
  const enCours = ref(false)
  const erreur = ref('')

  async function supprimer(saisie: string): Promise<void> {
    erreur.value = ''
    enCours.value = true
    try {
      await $fetch('/api/studio/moi', { method: 'DELETE', body: { confirmation: saisie } })
      // Rechargement complet : l'état de session du client est effacé.
      await navigateTo('/connexion', { external: true })
    } catch (e) {
      const { code } = lireErreurApi(e)
      if (code === 'CONFIRMATION_INVALIDE') erreur.value = ERREUR_CONFIRMATION
      else if (code === 'SESSION_TROP_ANCIENNE') erreur.value = ERREUR_SESSION_ANCIENNE
      else erreur.value = ERREUR_SUPPRESSION
    } finally {
      enCours.value = false
    }
  }

  return { enCours, erreur, supprimer }
}

const SYSTEMES: readonly [RegExp, string][] = [
  [/iPhone|iPad/, 'iPhone ou iPad'],
  [/Android/, 'Android'],
  [/Windows/, 'Windows'],
  [/Mac OS X|Macintosh/, 'Mac'],
  [/Linux/, 'Linux'],
]

// Ordre : Edge et Opera contiennent « Chrome » ; Chrome contient « Safari ».
const NAVIGATEURS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\/|CriOS\//, 'Chrome'],
  [/Safari\//, 'Safari'],
]

/** « Chrome sur Windows » à partir d'un user-agent ; « Appareil inconnu » sinon. */
export function libelleAppareil(userAgent: string | null): string {
  if (!userAgent) return 'Appareil inconnu'
  const navigateur = NAVIGATEURS.find(([motif]) => motif.test(userAgent))?.[1]
  const systeme = SYSTEMES.find(([motif]) => motif.test(userAgent))?.[1]
  if (navigateur && systeme) return `${navigateur} sur ${systeme}`
  return navigateur ?? systeme ?? 'Appareil inconnu'
}

/** Date et heure dans le fuseau du compte (règle : jamais le fuseau du navigateur). */
export function formaterDateHeure(iso: string, fuseau: string): string {
  try {
    return new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: fuseau }).format(new Date(iso))
  } catch {
    return iso
  }
}
