import type { ComputedRef } from 'vue'
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

/** Partie du Compte qui a lancé l'enregistrement : chacune affiche son propre message, jamais deux à la fois. */
export type ZoneCompte = 'informations' | 'emails'

/** Préférences d'e-mail (`PUT /api/studio/moi`). */
export type PreferenceCle = 'emailHebdo' | 'emailRappelJour'

export interface PreferenceEmailAffichee {
  cle: PreferenceCle
  /** Identifiant de l'interrupteur : sert à lui rendre le focus après l'enregistrement. */
  id: string
  label: string
  description: string
}

export const PREFERENCES_EMAIL_AFFICHEES: readonly PreferenceEmailAffichee[] = [
  {
    cle: 'emailHebdo',
    id: 'preference-email-hebdo',
    label: 'Résumé de la semaine',
    description: 'Chaque lundi matin, l’activité de votre vitrine en un coup d’œil.',
  },
  {
    cle: 'emailRappelJour',
    id: 'preference-email-rappel-jour',
    label: 'Rendez-vous du jour',
    description: 'Le matin, la liste de vos rendez-vous de la journée.',
  },
]

export const NOTE_EMAILS_TRANSACTIONNELS =
  'Les e-mails liés à vos réservations et à vos messages sont toujours envoyés : ils font partie du service.'

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
  const zone = ref<ZoneCompte>('informations')
  const erreur = ref('')
  const confirmation = ref('')
  const { start: masquerConfirmation, stop: annulerMasquage } = useTimeoutFn(() => {
    confirmation.value = ''
  }, 2000, { immediate: false })

  const erreurInformations = computed(() => (zone.value === 'informations' ? erreur.value : ''))
  const confirmationInformations = computed(() => (zone.value === 'informations' ? confirmation.value : ''))
  const erreurEmails = computed(() => (zone.value === 'emails' ? erreur.value : ''))
  const confirmationEmails = computed(() => (zone.value === 'emails' ? confirmation.value : ''))

  /** Mise à jour partielle ; retourne `false` si l'API refuse (le composant remet l'ancienne valeur). */
  async function mettreAJour(modification: MoiUpdateInput, origine: ZoneCompte = 'informations'): Promise<boolean> {
    zone.value = origine
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

  return {
    moi, enChargement, enErreur, refresh, enregistrement, mettreAJour,
    erreurInformations, confirmationInformations, erreurEmails, confirmationEmails,
  }
}

type MoiCourant = ComputedRef<MoiDTO | null>
type MettreAJour = (modification: MoiUpdateInput, origine: ZoneCompte) => Promise<boolean>

/**
 * Interrupteurs des préférences d'e-mail : affichage immédiat, retour à la valeur serveur si l'enregistrement échoue,
 * et focus rendu à l'interrupteur une fois qu'il est de nouveau actif.
 */
export function usePreferencesEmail(moi: MoiCourant, mettreAJour: MettreAJour) {
  const valeurs = reactive<Record<PreferenceCle, boolean>>({ emailHebdo: true, emailRappelJour: true })
  const enCours = ref<PreferenceCle | null>(null)

  watch(moi, (courant) => {
    if (!courant) return
    valeurs.emailHebdo = courant.emailHebdo
    valeurs.emailRappelJour = courant.emailRappelJour
  }, { immediate: true })

  async function basculer(preference: PreferenceEmailAffichee, valeur: boolean): Promise<void> {
    enCours.value = preference.cle
    const enregistre = await mettreAJour({ [preference.cle]: valeur }, 'emails')
    if (!enregistre && moi.value) valeurs[preference.cle] = moi.value[preference.cle]
    enCours.value = null
    await nextTick()
    document.getElementById(preference.id)?.focus()
  }

  return { valeurs, enCours, basculer }
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
