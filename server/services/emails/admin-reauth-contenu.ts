import { rendreEmail } from './gabarit'
import type { DocumentEmail } from './gabarit'
import type { EmailMessage } from './transport'

export interface AdminReauthEmailInput {
  destinataire: string
  code: string
  /** Libellé de l'action confirmée (jamais une donnée de la cible). */
  libelleAction: string
  /** Durée de validité du code, en minutes. */
  dureeMinutes: number
  /** URL publique du site (lien du logotype dans le HTML). */
  siteUrl: string
}

export const ERREUR_ADMIN_REAUTH_CODE_INVALIDE = 'ADMIN_REAUTH_CODE_INVALIDE'
export const OBJET_ADMIN_REAUTH = 'Code de confirmation d’une action d’administration'
/** Libellé de repli : une action absente de la table n'empêche jamais l'envoi du code. */
export const LIBELLE_ACTION_REPLI = 'une action d’administration'

/** Libellés lisibles des actions journalisées (`domaine.verbe`). Les sprints suivants complètent la table. */
const LIBELLES_ACTION: Readonly<Record<string, string>> = {
  'superadmin.creer': 'création d’un compte d’administration',
  'superadmin.reinitialiser': 'réinitialisation d’un compte d’administration',
  'utilisateur.suspendre': 'suspension d’un compte',
  'utilisateur.reactiver': 'réactivation d’un compte',
  'utilisateur.offrir_jours': 'jours offerts sur un abonnement',
  'utilisateur.changer_plan': 'changement de plan d’un compte',
  'utilisateur.revoquer_sessions': 'déconnexion de tous les appareils d’un compte',
  'utilisateur.retirer_assistants': 'retrait des assistants d’un compte',
  'utilisateur.supprimer': 'suppression d’un compte',
  'vitrine.depublier': 'dépublication d’une vitrine',
  'vitrine.republier': 'republication d’une vitrine',
  'assistant.retirer': 'retrait d’un assistant',
  'paiement.reverifier': 'vérification d’un paiement',
  'paiement.marquer_paye': 'confirmation manuelle d’un paiement',
  'abonnement.rappeler': 'envoi d’un rappel d’abonnement',
  'export.paiements': 'export des paiements',
  'reglage.modifier': 'modification d’un réglage',
  'job.relancer': 'relance d’une tâche en échec',
  'job.purger': 'purge des tâches en échec',
  'journal.exporter': 'export du journal d’administration',
  'capacite.accorder': 'octroi d’une capacité à un compte',
  'capacite.revoquer': 'retrait d’une capacité à un compte',
  'catalogue.creer': 'ajout d’une entrée de catalogue',
  'catalogue.modifier': 'modification d’une entrée de catalogue',
  'catalogue.supprimer': 'suppression d’une entrée de catalogue',
  'version.creer': 'création d’une version de configuration',
  'version.programmer': 'programmation d’une version de configuration',
  'version.activer': 'activation d’une version de configuration',
  'version.retour': 'retour à la version précédente d’une configuration',
  'version.valider_prix': 'validation de la grille de prix',
  'prompt.essai': 'essai à blanc d’un prompt',
}

export function libelleAction(action: string): string {
  return Object.hasOwn(LIBELLES_ACTION, action) ? (LIBELLES_ACTION[action] ?? LIBELLE_ACTION_REPLI) : LIBELLE_ACTION_REPLI
}

const CODE_REAUTH = /^\d{6}$/

/**
 * Contenu pur de l'e-mail de confirmation d'une action d'administration : aucun accès réseau ni base. Le code
 * n'apparaît ni dans l'objet ni dans le préheader. Aucune donnée de la cible (nom, e-mail, identifiant).
 */
export function buildAdminReauthEmail(input: AdminReauthEmailInput): EmailMessage {
  const { destinataire, code, dureeMinutes, siteUrl } = input
  if (!CODE_REAUTH.test(code)) throw new Error(ERREUR_ADMIN_REAUTH_CODE_INVALIDE)
  const duree = `${dureeMinutes} minute${dureeMinutes > 1 ? 's' : ''}`
  const document: DocumentEmail = {
    objet: OBJET_ADMIN_REAUTH,
    preheader: `Valable ${duree}. Ne communiquez ce code à personne.`,
    siteUrl,
    identite: { type: 'plateforme' },
    salutation: 'Bonjour,',
    elements: [
      { type: 'paragraphe', texte: `Action à confirmer : ${input.libelleAction}.` },
      { type: 'code', libelle: 'Votre code de confirmation', code },
      { type: 'encadre', texte: `Il est valable ${duree}. Si vous n’êtes pas à l’origine de cette demande, ignorez ce message.` },
    ],
    cloture: null,
    pied: null,
  }
  const { subject, text, html } = rendreEmail(document)
  return { to: destinataire, subject, text, html, attachments: [] }
}
