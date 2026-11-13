import { OAUTH_PORTEE_RENOUVELLEMENT } from '#shared/mcp'

/** Portées qui ne se règlent pas : toujours accordées si demandées. */
const PORTEE_VITRINE = 'vitrine:lecture'

export interface PorteeReglable {
  id: 'contenu:ecriture' | 'reservations:lecture' | 'messages:lecture'
  titre: string
  description: string
  libelleSwitch: string
}

/** Portées que l'utilisateur peut refuser une par une (ordre d'affichage). */
export const PORTEES_REGLABLES: readonly PorteeReglable[] = [
  {
    id: 'contenu:ecriture',
    titre: 'Ajouter et modifier',
    description: 'Des services et des réalisations, qui arrivent masqués.',
    libelleSwitch: 'Autoriser l’assistant à ajouter et modifier',
  },
  {
    id: 'reservations:lecture',
    titre: 'Consulter vos réservations',
    description: 'Réservations et demandes : date, service et prénom seulement.',
    libelleSwitch: 'Autoriser l’assistant à consulter vos réservations',
  },
  {
    id: 'messages:lecture',
    titre: 'Consulter vos messages',
    description: 'Date, prénom et sujet seulement.',
    libelleSwitch: 'Autoriser l’assistant à consulter vos messages',
  },
]

export const NOM_ASSISTANT_REPLI = 'Un assistant'

const ERREUR_ENVOI = 'Nous n’avons pas pu enregistrer votre choix. Réessayez dans un instant.'
const ERREUR_EXPIREE = 'Cette demande a expiré. Retournez dans votre assistant et relancez la connexion.'
const ERREUR_REDIRECTION = 'Votre choix est enregistré, mais nous n’avons pas pu vous renvoyer vers votre assistant. Retournez-y pour continuer.'
const SCHEMAS_INTERDITS = ['javascript:', 'data:', 'vbscript:']
const CODE_PLAN_PAYANT_REQUIS = 'PLAN_PAYANT_REQUIS'
const STATUT_INTERDIT = 403

/** Ce que l'écran affiche : exactement un de ces états, jamais rien. */
export type EtatAutorisation = 'chargement' | 'invalide' | 'plan-gratuit' | 'pret'

interface ReponseAssistantsPlan {
  planPayant?: boolean
}

/**
 * La demande est exploitable : query signée présente, au moins une portée, et non expirée.
 * `exp` (secondes Unix, signé par Better Auth) absent = pas de contrôle côté page ; le serveur tranche toujours.
 */
export function demandeValable(oauthQuery: string, maintenantMs: number): boolean {
  if (oauthQuery === '') return false
  const params = new URLSearchParams(oauthQuery)
  if ((params.get('scope') ?? '').split(/\s+/).filter(Boolean).length === 0) return false
  const exp = params.get('exp')
  if (exp !== null && exp !== '') {
    const secondes = Number(exp)
    if (!Number.isFinite(secondes) || secondes * 1000 <= maintenantMs) return false
  }
  return true
}

interface ReponseConsentement {
  redirect?: boolean
  url?: string
}

interface ReponseClientPublic {
  client_name?: string
}

/** Adresse de retour affichée : l'hôte seul, jamais l'URL complète ni sa query. */
export interface DestinationRetour {
  hote: string
  /** Redirection vers l'appareil de l'utilisateur (localhost, 127.0.0.1, ::1, schéma d'application). */
  surAppareil: boolean
}

const HOTES_LOCAUX = ['localhost', '127.0.0.1', '[::1]']
const SCHEMAS_WEB = ['http:', 'https:']

/**
 * Hôte de la redirect_uri de la requête d'autorisation (signée par Better Auth, déjà contrôlée contre les adresses
 * enregistrées du client). Le point d'accès public-client ne renvoie PAS les redirect_uris : la requête est la seule source.
 */
export function lireDestinationRetour(redirectUri: string | null): DestinationRetour | null {
  if (!redirectUri) return null
  try {
    const url = new URL(redirectUri)
    if (SCHEMAS_INTERDITS.includes(url.protocol)) return null
    if (SCHEMAS_WEB.includes(url.protocol)) {
      return { hote: url.hostname, surAppareil: HOTES_LOCAUX.includes(url.hostname) }
    }
    // Schéma d'application (ex. cursor://) : pas d'hôte fiable, on affiche le nom du schéma.
    return { hote: url.protocol.slice(0, -1), surAppareil: true }
  }
  catch {
    return null
  }
}

export function lireErreurOauth(erreur: unknown): { statut: number | null, code: string | null } {
  if (typeof erreur !== 'object' || erreur === null) return { statut: null, code: null }
  const brut = erreur as { statusCode?: unknown, status?: unknown, data?: unknown }
  const statut = typeof brut.statusCode === 'number' ? brut.statusCode : typeof brut.status === 'number' ? brut.status : null
  // Corps d'erreur : Better Auth `{ error: 'invalid_signature' }` ou format du projet `{ statusMessage, data: { code } }`.
  const corps = typeof brut.data === 'object' && brut.data !== null
    ? (brut.data as { error?: unknown, code?: unknown, statusMessage?: unknown, data?: unknown })
    : null
  const imbrique = typeof corps?.data === 'object' && corps.data !== null ? (corps.data as { code?: unknown }) : null
  const candidats = [corps?.error, corps?.code, imbrique?.code, corps?.statusMessage]
  const code = candidats.find((valeur): valeur is string => typeof valeur === 'string') ?? null
  return { statut, code }
}

/** La redirection est choisie par le serveur d'autorisation (adresse enregistrée du client) : on écarte seulement les schémas exécutables. */
function redirectionSure(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return !SCHEMAS_INTERDITS.includes(protocol)
  }
  catch {
    return false
  }
}

/**
 * Écran de consentement OAuth d'un assistant : portées demandées, choix de l'utilisateur,
 * envoi à Better Auth (`/api/auth/oauth2/consent`) puis redirection vers l'assistant.
 */
export function useAutorisationOauth() {
  const { user, loggedIn } = useUserSession()
  const reprise = useRepriseOauth()

  // Page rendue côté client uniquement : la query brute est lisible dès le setup.
  const oauthQuery = lireQueryOauthBrute()
  const params = new URLSearchParams(oauthQuery)
  const clientId = params.get('client_id') ?? ''
  const demandees = (params.get('scope') ?? '').split(/\s+/).filter(Boolean)
  const valide = demandeValable(oauthQuery, Date.now())
  const destination = lireDestinationRetour(params.get('redirect_uri'))

  const nomClient = ref(NOM_ASSISTANT_REPLI)
  const portees = PORTEES_REGLABLES.filter((p) => demandees.includes(p.id))
  const vitrineDemandee = demandees.includes(PORTEE_VITRINE)
  const choix = reactive<Record<string, boolean>>(Object.fromEntries(portees.map((p) => [p.id, true])))

  const enCours = ref(false)
  const erreur = ref('')
  // Le plan se lit avant d'afficher les boutons : un compte gratuit ne voit jamais « Autoriser ».
  const planConnu = ref(false)
  const planGratuit = ref(false)

  const etat = computed<EtatAutorisation>(() => {
    if (!valide) return 'invalide'
    if (!planConnu.value) return 'chargement'
    return planGratuit.value ? 'plan-gratuit' : 'pret'
  })

  const nomUtilisateur = computed(() => user.value?.name?.trim() ?? '')
  const emailUtilisateur = computed(() => user.value?.email ?? '')

  /** Portées envoyées : vitrine (si demandée), réglages activés, renouvellement (si demandé, jamais affiché). */
  function porteesAcceptees(): string[] {
    return [
      ...(vitrineDemandee ? [PORTEE_VITRINE] : []),
      ...portees.filter((p) => choix[p.id]).map((p) => p.id),
      ...(demandees.includes(OAUTH_PORTEE_RENOUVELLEMENT) ? [OAUTH_PORTEE_RENOUVELLEMENT] : []),
    ]
  }

  async function chargerNomClient(): Promise<void> {
    if (!clientId) return
    try {
      const reponse = await $fetch<ReponseClientPublic>('/api/auth/oauth2/public-client', { query: { client_id: clientId } })
      const nom = reponse.client_name?.trim()
      if (nom) nomClient.value = nom
    }
    catch {
      // Repli : « Un assistant ». Le nom n'est qu'un confort, jamais une condition du consentement.
    }
  }

  async function chargerPlan(): Promise<void> {
    try {
      const reponse = await $fetch<ReponseAssistantsPlan>('/api/studio/assistants')
      planGratuit.value = reponse.planPayant === false
    }
    catch {
      // Lecture impossible : on laisse l'utilisateur continuer, le serveur refuse de toute façon un compte gratuit.
    }
    planConnu.value = true
  }

  async function repondre(accept: boolean): Promise<void> {
    if (enCours.value || !valide) return
    enCours.value = true
    erreur.value = ''
    try {
      const reponse = await $fetch<ReponseConsentement>('/api/auth/oauth2/consent', {
        method: 'POST',
        body: { accept, scope: accept ? porteesAcceptees().join(' ') : undefined, oauth_query: oauthQuery },
      })
      if (reponse.redirect === true && typeof reponse.url === 'string' && redirectionSure(reponse.url)) {
        // enCours reste vrai : la page quitte le site, aucun second envoi possible.
        window.location.href = reponse.url
        return
      }
      erreur.value = ERREUR_REDIRECTION
    }
    catch (e) {
      const { statut, code } = lireErreurOauth(e)
      if (accept && statut === STATUT_INTERDIT && code === CODE_PLAN_PAYANT_REQUIS) {
        // Le plan a changé depuis le chargement : même écran que pour un compte gratuit, sans message d'erreur en plus.
        planGratuit.value = true
        enCours.value = false
        return
      }
      erreur.value = code === 'invalid_signature' || statut === 401 ? ERREUR_EXPIREE : ERREUR_ENVOI
    }
    enCours.value = false
  }

  onMounted(() => {
    // Demande invalide : l'écran d'erreur s'affiche tel quel, sans détour par la connexion.
    if (!valide) return
    if (!loggedIn.value) {
      // Garde-fou : la règle de route renvoie déjà vers /connexion ; on y garde la query d'autorisation.
      void navigateTo(reprise.versConnexion('/connexion'))
      return
    }
    void Promise.all([chargerNomClient(), chargerPlan()])
  })

  return {
    etat, nomClient, destination, nomUtilisateur, emailUtilisateur,
    portees, choix, enCours, erreur,
    autoriser: () => repondre(true),
    refuser: () => repondre(false),
  }
}
