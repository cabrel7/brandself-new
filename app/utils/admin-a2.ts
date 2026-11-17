// A2 (UI) : fonctions pures de l'administration des utilisateurs, vitrines et assistants. Aucune dépendance Vue ni
// Nuxt : testable seule. Les libellés suivent le vocabulaire du produit (CLAUDE.md §2), vouvoiement.
// Libellés d'erreur : jamais écrits ici, le serveur envoie le texte de `ERROR_MESSAGES` dans le corps de l'erreur.
import {
  ADMIN_ACTIONS,
  ADMIN_CIBLES,
  ADMIN_PREFIXE_API,
  ADMIN_REAUTH_CODE_FORMAT,
} from '#shared/admin'
import type { AdminAction, AdminCible } from '#shared/admin'
import {
  ADMIN_JOURS_MAX,
  ADMIN_JOURS_MIN,
  ADMIN_RECHERCHE_MIN,
} from '#shared/admin-a2'
import type { UtilisateurLigneDto, VitrineLigneDto } from '#shared/schemas/admin-a2'
import { ERREUR_GENERIQUE, motifValide } from './admin-paiements'

export const RECHERCHE_DELAI_MS = 300
export const JOURS_PAR_DEFAUT = 30

// --- Erreurs ---

/** Texte de l'erreur d'API : le `message` du corps est déjà le libellé du serveur (français, vouvoiement). */
export function messageDepuisErreurApi(erreur: unknown): string {
  if (typeof erreur !== 'object' || erreur === null) return ERREUR_GENERIQUE
  const corps = (erreur as { data?: unknown }).data
  if (typeof corps !== 'object' || corps === null) return ERREUR_GENERIQUE
  const message = (corps as { message?: unknown }).message
  return typeof message === 'string' && message.trim() !== '' ? message : ERREUR_GENERIQUE
}

// --- Recherche ---

/** Saisie à envoyer au serveur : texte rogné d'au moins `ADMIN_RECHERCHE_MIN` caractères, sinon `null`. */
export function termeRecherche(saisie: string): string | null {
  const terme = saisie.trim()
  return terme.length >= ADMIN_RECHERCHE_MIN ? terme : null
}

/** Saisie commencée mais trop courte : on l'indique sous le champ au lieu d'appeler le serveur. */
export function saisieTropCourte(saisie: string): boolean {
  const longueur = saisie.trim().length
  return longueur > 0 && longueur < ADMIN_RECHERCHE_MIN
}

// --- Étiquettes ---

export interface EtiquetteA2 {
  libelle: string
  /** Seules couleurs thématisées du projet. La couleur ne porte jamais seule le sens : libellé et icône suivent. */
  couleur: 'primary' | 'neutral' | 'error'
  icone: string
}

const ETIQUETTES_ETAT: Record<UtilisateurLigneDto['etat'], EtiquetteA2> = {
  gratuit: { libelle: 'Gratuit', couleur: 'neutral', icone: 'i-ph-circle' },
  actif: { libelle: 'Actif', couleur: 'primary', icone: 'i-ph-check-circle' },
  grace: { libelle: 'Grâce', couleur: 'neutral', icone: 'i-ph-hourglass' },
}
const ETIQUETTE_SUSPENDU: EtiquetteA2 = { libelle: 'Suspendu', couleur: 'error', icone: 'i-ph-prohibit' }
const ETIQUETTE_PUBLIEE: EtiquetteA2 = { libelle: 'Publiée', couleur: 'primary', icone: 'i-ph-eye' }
const ETIQUETTE_BLOQUEE: EtiquetteA2 = { libelle: 'Bloquée', couleur: 'error', icone: 'i-ph-lock-key' }
const ETIQUETTE_NON_PUBLIEE: EtiquetteA2 = { libelle: 'Non publiée', couleur: 'neutral', icone: 'i-ph-eye-slash' }
const ETIQUETTE_SANS_VITRINE: EtiquetteA2 = { libelle: 'Sans vitrine', couleur: 'neutral', icone: 'i-ph-storefront' }

function etiquetteVitrine(vitrine: { publiee: boolean, bloquee: boolean }): EtiquetteA2 {
  if (vitrine.bloquee) return ETIQUETTE_BLOQUEE
  return vitrine.publiee ? ETIQUETTE_PUBLIEE : ETIQUETTE_NON_PUBLIEE
}

export function etiquettesUtilisateur(utilisateur: Pick<UtilisateurLigneDto, 'etat' | 'suspendu' | 'vitrine'>): EtiquetteA2[] {
  return [
    ...(utilisateur.suspendu ? [ETIQUETTE_SUSPENDU] : []),
    ETIQUETTES_ETAT[utilisateur.etat],
    utilisateur.vitrine ? etiquetteVitrine(utilisateur.vitrine) : ETIQUETTE_SANS_VITRINE,
  ]
}

export function etiquettesVitrine(vitrine: Pick<VitrineLigneDto, 'publiee' | 'bloquee' | 'proprietaireSuspendu'>): EtiquetteA2[] {
  return [etiquetteVitrine(vitrine), ...(vitrine.proprietaireSuspendu ? [ETIQUETTE_SUSPENDU] : [])]
}

// --- Actions ---

export type IdActionA2 =
  | 'suspendre'
  | 'reactiver'
  | 'offrir_jours'
  | 'plan_payant'
  | 'plan_gratuit'
  | 'revoquer_sessions'
  | 'retirer_assistants'
  | 'supprimer'
  | 'depublier'
  | 'republier'
  | 'retirer_assistant'

export interface DefinitionActionA2 {
  id: IdActionA2
  /** Action journalisée : lie aussi le code de réauthentification (action, type de cible, cible). */
  action: AdminAction
  cibleType: AdminCible
  /** Libellé du bouton qui ouvre la boîte de dialogue. */
  libelle: string
  titre: string
  description: string
  /** Libellé du bouton de confirmation (verbe, jamais « OK »). */
  confirmation: string
  succes: string
  /** Code reçu par e-mail exigé (D-A2-07). */
  reauth: boolean
  destructive: boolean
  /** Champs en plus du motif. */
  jours: boolean
  emailConfirmation: boolean
}

const utilisateurApi = (id: string, segment: string): string =>
  `${ADMIN_PREFIXE_API}/utilisateurs/${encodeURIComponent(id)}/${segment}`

const BASE = { jours: false, emailConfirmation: false, destructive: false, reauth: false } as const

export const ACTIONS_A2: Record<IdActionA2, DefinitionActionA2> = {
  suspendre: {
    ...BASE,
    id: 'suspendre',
    action: ADMIN_ACTIONS.utilisateurSuspendre,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Suspendre le compte',
    titre: 'Suspendre ce compte',
    description: 'Le professionnel est déconnecté et ne peut plus se reconnecter. Sa vitrine n’est plus visible. Le motif lui est communiqué.',
    confirmation: 'Suspendre',
    succes: 'Le compte est suspendu.',
    reauth: true,
    destructive: true,
  },
  reactiver: {
    ...BASE,
    id: 'reactiver',
    action: ADMIN_ACTIONS.utilisateurReactiver,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Réactiver le compte',
    titre: 'Réactiver ce compte',
    description: 'La connexion et la vitrine redeviennent accessibles.',
    confirmation: 'Réactiver',
    succes: 'Le compte est réactivé.',
  },
  offrir_jours: {
    ...BASE,
    id: 'offrir_jours',
    action: ADMIN_ACTIONS.utilisateurOffrirJours,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Offrir des jours',
    titre: 'Offrir des jours d’abonnement',
    description: 'Les jours s’ajoutent à la fin de l’abonnement en cours, ou à partir d’aujourd’hui s’il est terminé.',
    confirmation: 'Offrir',
    succes: 'Les jours sont offerts.',
    jours: true,
  },
  plan_payant: {
    ...BASE,
    id: 'plan_payant',
    action: ADMIN_ACTIONS.utilisateurChangerPlan,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Passer au plan payant',
    titre: 'Passer au plan payant',
    description: 'Indiquez la durée offerte. Aucun paiement n’est enregistré.',
    confirmation: 'Passer au plan payant',
    succes: 'Le compte est passé au plan payant.',
    reauth: true,
    jours: true,
  },
  plan_gratuit: {
    ...BASE,
    id: 'plan_gratuit',
    action: ADMIN_ACTIONS.utilisateurChangerPlan,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Passer au plan gratuit',
    titre: 'Passer au plan gratuit',
    description: 'L’abonnement est supprimé immédiatement, sans période de grâce. Les paiements restent consultables.',
    confirmation: 'Passer au plan gratuit',
    succes: 'Le compte est passé au plan gratuit.',
    reauth: true,
    destructive: true,
  },
  revoquer_sessions: {
    ...BASE,
    id: 'revoquer_sessions',
    action: ADMIN_ACTIONS.utilisateurRevoquerSessions,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Déconnecter les appareils',
    titre: 'Déconnecter tous les appareils',
    description: 'Toutes les sessions ouvertes sont fermées. Le professionnel peut se reconnecter.',
    confirmation: 'Déconnecter',
    succes: 'Les appareils sont déconnectés.',
  },
  retirer_assistants: {
    ...BASE,
    id: 'retirer_assistants',
    action: ADMIN_ACTIONS.utilisateurRetirerAssistants,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Retirer tous les assistants',
    titre: 'Retirer tous les assistants',
    description: 'Les assistants connectés à ce compte perdent leur accès immédiatement.',
    confirmation: 'Retirer',
    succes: 'Les assistants sont retirés.',
  },
  supprimer: {
    ...BASE,
    id: 'supprimer',
    action: ADMIN_ACTIONS.utilisateurSupprimer,
    cibleType: ADMIN_CIBLES.utilisateur,
    libelle: 'Supprimer le compte',
    titre: 'Supprimer ce compte',
    description: 'Le compte, la vitrine et toutes les images sont supprimés définitivement. Aucun e-mail n’est envoyé au professionnel.',
    confirmation: 'Supprimer définitivement',
    succes: 'Le compte est supprimé.',
    reauth: true,
    destructive: true,
    emailConfirmation: true,
  },
  depublier: {
    ...BASE,
    id: 'depublier',
    action: ADMIN_ACTIONS.vitrineDepublier,
    cibleType: ADMIN_CIBLES.vitrine,
    libelle: 'Dépublier la vitrine',
    titre: 'Dépublier cette vitrine',
    description: 'La vitrine n’est plus visible et le professionnel ne peut pas la republier. Le motif lui est communiqué.',
    confirmation: 'Dépublier',
    succes: 'La vitrine est dépubliée.',
    reauth: true,
    destructive: true,
  },
  republier: {
    ...BASE,
    id: 'republier',
    action: ADMIN_ACTIONS.vitrineRepublier,
    cibleType: ADMIN_CIBLES.vitrine,
    libelle: 'Republier la vitrine',
    titre: 'Republier cette vitrine',
    description: 'La vitrine redevient visible et le professionnel peut de nouveau la gérer.',
    confirmation: 'Republier',
    succes: 'La vitrine est republiée.',
  },
  retirer_assistant: {
    ...BASE,
    id: 'retirer_assistant',
    action: ADMIN_ACTIONS.assistantRetirer,
    cibleType: ADMIN_CIBLES.assistant,
    libelle: 'Retirer',
    titre: 'Retirer cet assistant',
    description: 'L’assistant perd son accès immédiatement.',
    confirmation: 'Retirer',
    succes: 'L’assistant est retiré.',
  },
}

/** Chemin de l'écriture pour une action et sa cible. */
export function cheminAction(id: IdActionA2, cibleId: string): string {
  const cible = encodeURIComponent(cibleId)
  switch (id) {
    case 'suspendre': return utilisateurApi(cibleId, 'suspendre')
    case 'reactiver': return utilisateurApi(cibleId, 'reactiver')
    case 'offrir_jours': return utilisateurApi(cibleId, 'offrir-jours')
    case 'plan_payant':
    case 'plan_gratuit': return utilisateurApi(cibleId, 'changer-plan')
    case 'revoquer_sessions': return utilisateurApi(cibleId, 'revoquer-sessions')
    case 'retirer_assistants': return utilisateurApi(cibleId, 'retirer-assistants')
    case 'supprimer': return utilisateurApi(cibleId, 'supprimer')
    case 'depublier': return `${ADMIN_PREFIXE_API}/vitrines/${cible}/depublier`
    case 'republier': return `${ADMIN_PREFIXE_API}/vitrines/${cible}/republier`
    case 'retirer_assistant': return `${ADMIN_PREFIXE_API}/assistants/${cible}/retirer`
  }
}

export interface SaisieActionA2 {
  motif: string
  code: string
  jours: number
  emailConfirmation: string
}

/** Corps de l'écriture (schémas stricts du serveur : aucune clé en trop). */
export function corpsAction(id: IdActionA2, saisie: SaisieActionA2): Record<string, string | number> {
  const motif = saisie.motif.trim()
  switch (id) {
    case 'offrir_jours': return { motif, jours: saisie.jours }
    case 'plan_payant': return { plan: 'payant', motif, jours: saisie.jours }
    case 'plan_gratuit': return { plan: 'gratuit', motif }
    case 'supprimer': return { motif, emailConfirmation: saisie.emailConfirmation.trim() }
    default: return { motif }
  }
}

export function joursValides(jours: number): boolean {
  return Number.isInteger(jours) && jours >= ADMIN_JOURS_MIN && jours <= ADMIN_JOURS_MAX
}

/** L'e-mail ressaisi doit être celui du compte (comparaison insensible à la casse, comme le serveur). */
export function emailConfirme(saisi: string, attendu: string): boolean {
  return saisi.trim().toLowerCase() === attendu.trim().toLowerCase() && attendu.trim() !== ''
}

export function codeReauthValide(code: string): boolean {
  return ADMIN_REAUTH_CODE_FORMAT.test(code)
}

/**
 * Le bouton de confirmation n'est actif que si tout ce que le serveur exige est présent. Le serveur revalide :
 * ceci évite seulement un aller-retour inutile.
 */
export function saisieActionValide(definition: DefinitionActionA2, saisie: SaisieActionA2, emailAttendu: string): boolean {
  if (!motifValide(saisie.motif)) return false
  if (definition.jours && !joursValides(saisie.jours)) return false
  if (definition.emailConfirmation && !emailConfirme(saisie.emailConfirmation, emailAttendu)) return false
  if (definition.reauth && !codeReauthValide(saisie.code)) return false
  return true
}

// --- Affichage ---

const TIRET = '—'

/** Valeur absente : tiret, jamais une cellule vide. */
export function valeurOuTiret(valeur: string | null | undefined): string {
  return valeur && valeur.trim() !== '' ? valeur : TIRET
}

/** Portées d'un assistant, dans la langue du produit (les clés restent celles du serveur MCP). */
const LIBELLES_PORTEES: Record<string, string> = {
  'vitrine:lecture': 'Lire la vitrine',
  'contenu:ecriture': 'Ajouter et modifier',
  'reservations:lecture': 'Consulter les réservations',
  'messages:lecture': 'Consulter les messages',
}

export function libellePorteeAdmin(portee: string): string {
  return LIBELLES_PORTEES[portee] ?? portee
}
