// A4 (UI) : fonctions pures du journal d'administration (filtres lus dans l'URL, libellés, lecture de `avant`/`apres`).
import { ADMIN_ACTIONS, ADMIN_ACTION_FORMAT, ADMIN_CIBLES, ADMIN_CIBLE_ID_MAX, ADMIN_CIBLE_TYPE_FORMAT } from '#shared/admin'
import type { FiltresJournal, JournalEntreeDto } from '#shared/schemas/admin-a4'

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/
const TIRET = '—'
const LONGUEUR_EMPREINTE_AFFICHEE = 12

/** Validateurs des filtres de l'URL (`useAdminListe`) : une valeur refusée est ignorée, le serveur reste le seul juge. */
export const VALIDATEURS_FILTRES_JOURNAL: Record<string, (valeur: string) => boolean> = {
  action: (valeur) => ADMIN_ACTION_FORMAT.test(valeur),
  cibleType: (valeur) => ADMIN_CIBLE_TYPE_FORMAT.test(valeur),
  cibleId: (valeur) => valeur.length <= ADMIN_CIBLE_ID_MAX,
  du: (valeur) => FORMAT_JOUR.test(valeur),
  au: (valeur) => FORMAT_JOUR.test(valeur),
}

export const FILTRE_JOURNAL_TOUS = 'tous'

const LIBELLES_ACTIONS: Record<string, string> = {
  'superadmin.creer': 'Création d’un administrateur',
  'superadmin.reinitialiser': 'Réinitialisation d’un administrateur',
  'utilisateur.suspendre': 'Suspension d’un compte',
  'utilisateur.reactiver': 'Réactivation d’un compte',
  'utilisateur.offrir_jours': 'Jours offerts',
  'utilisateur.changer_plan': 'Changement de plan',
  'utilisateur.revoquer_sessions': 'Appareils déconnectés',
  'utilisateur.retirer_assistants': 'Assistants retirés d’un compte',
  'utilisateur.supprimer': 'Suppression d’un compte',
  'vitrine.depublier': 'Dépublication d’une vitrine',
  'vitrine.republier': 'Republication d’une vitrine',
  'assistant.retirer': 'Assistant retiré',
  'paiement.reverifier': 'Paiement revérifié',
  'paiement.marquer_paye': 'Paiement marqué comme payé',
  'abonnement.rappeler': 'Rappel d’abonnement',
  'export.paiements': 'Export des paiements',
  'reglage.modifier': 'Modification d’un réglage',
  'job.relancer': 'Tâche relancée',
  'job.purger': 'Tâches en échec purgées',
  'journal.exporter': 'Export du journal',
  'capacite.accorder': 'Capacité accordée',
  'capacite.revoquer': 'Capacité révoquée',
}

const LIBELLES_CIBLES: Record<string, string> = {
  utilisateur: 'Utilisateur',
  vitrine: 'Vitrine',
  assistant: 'Assistant',
  paiement: 'Paiement',
  abonnement: 'Abonnement',
  export: 'Export',
  reglage: 'Réglage',
  job: 'Tâche',
  journal: 'Journal',
  catalogue: 'Catalogue',
  version: 'Version',
}

/** Libellé d'une action ; une action inconnue (ajoutée plus tard) s'affiche telle quelle, jamais une cellule vide. */
export function libelleActionJournal(action: string): string {
  return LIBELLES_ACTIONS[action] ?? action
}

export function libelleCibleJournal(cibleType: string): string {
  return LIBELLES_CIBLES[cibleType] ?? cibleType
}

/** `prompt.essai` n'est jamais journalisé : il n'a pas à être proposé comme filtre. */
export function optionsActionsJournal(): Array<{ label: string, value: string }> {
  const actions = Object.values(ADMIN_ACTIONS).filter((action) => action !== ADMIN_ACTIONS.promptEssai)
  return [
    { label: 'Toutes les actions', value: FILTRE_JOURNAL_TOUS },
    ...actions.map((action) => ({ label: libelleActionJournal(action), value: action })),
  ]
}

export function optionsCiblesJournal(): Array<{ label: string, value: string }> {
  return [
    { label: 'Toutes les cibles', value: FILTRE_JOURNAL_TOUS },
    ...Object.values(ADMIN_CIBLES).map((cible) => ({ label: libelleCibleJournal(cible), value: cible })),
  ]
}

export function empreinteCourte(empreinte: string): string {
  return `${empreinte.slice(0, LONGUEUR_EMPREINTE_AFFICHEE)}…`
}

export interface LigneEtatJournal {
  cle: string
  libelle: string
  valeur: string
}

function formaterValeurJournal(valeur: string | number | boolean | null): string {
  if (valeur === null) return TIRET
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non'
  return String(valeur)
}

/** `avant`/`apres` (objet plat) en lignes : clé lisible (`_` -> espace) et valeur formatée. */
export function lignesEtatJournal(etat: JournalEntreeDto['avant']): LigneEtatJournal[] {
  if (etat === null) return []
  return Object.entries(etat).map(([cle, valeur]) => ({
    cle,
    libelle: cle.replaceAll('_', ' '),
    valeur: formaterValeurJournal(valeur),
  }))
}

export function periodeJournalInvalide(du: string, au: string): boolean {
  return du !== '' && au !== '' && du > au
}

/** Filtres de l'URL -> corps de l'export (schéma strict : seules les clés connues, jamais la page ni la limite). */
export function filtresJournalDepuis(lus: Record<string, string>): FiltresJournal {
  const filtres: FiltresJournal = {}
  if (lus.action !== undefined) filtres.action = lus.action
  if (lus.cibleType !== undefined) filtres.cibleType = lus.cibleType
  if (lus.cibleId !== undefined) filtres.cibleId = lus.cibleId
  if (lus.du !== undefined) filtres.du = lus.du
  if (lus.au !== undefined) filtres.au = lus.au
  return filtres
}
