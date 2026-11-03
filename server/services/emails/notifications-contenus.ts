import {
  DESABONNEMENT_API_CHEMIN,
  DESABONNEMENT_PAGE_CHEMIN,
  LIST_UNSUBSCRIBE_POST_VALEUR,
  RAPPEL_JOURNEE_MAX_LIGNES,
  RESUME_JOUR_ISO,
} from '../../../shared/notifications'
import { DEVISES_EXPOSANT } from '../../../shared/paiements'
import { ABONNEMENT_CHEMIN, ABONNEMENT_GRACE_JOURS } from '../../../shared/plans'
import type { AbonnementRappelJours } from '../../../shared/plans'
import { schemaJetonDesabonnement } from '../../../shared/schemas/notifications'
import type { EmailMessage } from './transport'

// S9 (docs/specs/S9-notifications.md §5) : contenus des e-mails planifiés, en TEXTE SEUL (jamais de
// HTML, donc aucun pixel de suivi). Module feuille : `contenus.ts` l'importe, jamais l'inverse.
// Règles : toute valeur saisie passe par `singleLine` ; minimisation (#100) : ni e-mail, ni
// téléphone, ni motif ; chaque message se termine par la phrase « Vous recevez… ».

const LOCALE = 'fr-FR'
const PREMIER_DU_MOIS = '1'
const PREMIER_DU_MOIS_ECRIT = '1er'
const SEPARATEUR_PIED = '—'
/** Décimales d'une devise absente de `DEVISES_EXPOSANT` (usage ISO 4217 courant). */
const EXPOSANT_DEVISE_DEFAUT = 2
const BASE_DECIMALE = 10
/** Espaces insécables (dont l'espace fine d'Intl `fr-FR`) remplacés par une espace simple dans un e-mail texte. */
const ESPACES_INSECABLES = /[\u00A0\u202F]/g
/** Libellé d'une devise dans un montant écrit ; sans entrée, le code ISO. */
const LIBELLES_DEVISE: Readonly<Record<string, string>> = { XAF: 'FCFA', XOF: 'FCFA' }
const PERIODE_MOIS_UNITE = 'mois'
const JOURS_ISO = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const

/** Textes réglables (vouvoiement chaleureux). Les gabarits à trous sont des fonctions. */
export const TEXTES_NOTIFICATIONS = {
  signatureMarque: 'Brandself',
  bonjourSansNom: 'Bonjour,',
  pied: {
    journee: "Vous recevez cet e-mail parce que vous avez des rendez-vous aujourd'hui.",
    resume: (jour: string) => `Vous recevez ce résumé chaque ${jour} parce qu'il est activé dans votre compte.`,
    rappelVisiteur: (professionnel: string) =>
      `Vous recevez ce rappel parce que vous l'avez demandé en réservant sur la vitrine de ${professionnel}. C'est le seul rappel prévu pour ce rendez-vous.`,
    // Même phrase pour la journée et le résumé : un seul libellé de désabonnement dans tous les e-mails planifiés.
    desabonnement: (url: string) => `Ne plus recevoir cet e-mail, en un clic : ${url}`,
    gerer: (url: string) => `Gérer vos e-mails : ${url}`,
  },
  journee: {
    cloture: 'Belle journée,',
    detail: (url: string) => `Le détail est dans votre agenda : ${url}`,
    surplus: (n: number) => `… et ${n} ${n > 1 ? 'autres' : 'autre'}.`,
    aConfirmer: ' (à confirmer)',
  },
  resume: {
    cloture: 'Bonne semaine,',
    studio: (url: string) => `Retrouvez tout dans votre studio : ${url}`,
    objetIdee: 'Une idée pour votre vitrine cette semaine',
    introIdee: "Votre vitrine n'a pas reçu de réservation ni de message cette semaine. Une seule idée pour la faire connaître :",
  },
  // S10 #122 : rappels d'échéance. Aucun prix : ils s'affichent dans le studio, depuis la configuration.
  abonnementRappel: {
    objet: (jours: AbonnementRappelJours) =>
      jours === 0 ? "Votre abonnement se termine aujourd'hui" : `Votre abonnement se termine dans ${jours} ${jours > 1 ? 'jours' : 'jour'}`,
    intro: (jours: AbonnementRappelJours, date: string) =>
      jours === 0
        ? `Aujourd'hui est le dernier jour de votre abonnement Brandself (jusqu'au ${date} inclus).`
        : `Votre abonnement Brandself est actif jusqu'au ${date} inclus.`,
    sansRenouvellementAuto: "Il ne se renouvelle pas automatiquement : rien n'est prélevé sans votre accord.",
    invitation: 'Pour le prolonger, renouvelez-le depuis votre studio :',
    action: 'Renouveler mon abonnement',
    grace: (jours: number) =>
      `Si vous ne le renouvelez pas, vous gardez tout pendant une période de grâce de ${jours} jours, puis votre vitrine revient au plan gratuit. Rien n'est supprimé : vos services, réalisations et témoignages restent enregistrés et réapparaissent dès le renouvellement.`,
    cloture: 'À bientôt,',
    pied: "Vous recevez cet e-mail parce que votre vitrine a un abonnement payant qui arrive à échéance. C'est un message de service : il ne peut pas être désactivé.",
  },
  // S10 #123 : reçu. Ce n'est pas une facture (la mention est obligatoire).
  paiementConfirme: {
    objet: 'Votre paiement est confirmé',
    intro: (date: string | null) =>
      date === null
        ? 'Merci, nous avons bien reçu votre paiement.'
        : `Merci, nous avons bien reçu votre paiement. Votre abonnement est actif jusqu'au ${date} inclus.`,
    montant: (valeur: string) => `Montant : ${valeur}`,
    periode: (valeur: string) => `Période : ${valeur}`,
    moyen: (valeur: string) => `Moyen de paiement : ${valeur}`,
    moyenInconnu: 'Paiement en ligne',
    numero: (valeur: string) => `Numéro : ${valeur}`,
    reference: (valeur: string) => `Référence : ${valeur}`,
    referenceFournisseur: (valeur: string) => `Référence de l'opérateur : ${valeur}`,
    echeance: (date: string) => `Nouvelle échéance : jusqu'au ${date} inclus`,
    pasUneFacture: "Ce récapitulatif n'est pas une facture.",
    cloture: 'À bientôt,',
    pied: "Vous recevez cet e-mail parce qu'un paiement a été effectué pour votre abonnement Brandself. C'est un message de service : il ne peut pas être désactivé.",
  },
} as const

/** Étape de la vitrine ou suggestion par défaut, telle que le résumé la présente. */
export interface SuggestionResume {
  titre: string
  texte: string
  /** Page du studio ; `null` : l'action ouvre un panneau (partager), le lien mène au studio. */
  chemin: string | null
}

export interface RendezVousJournee {
  debut: Date
  service: string
  visiteur: string
  /** `en_attente` : suffixe « (à confirmer) ». */
  statut: string
}

export interface CompteursResume {
  reservations: number
  demandes: number
  messages: number
  /** Rendez-vous confirmés de la semaine qui commence. */
  rendezVousSemaine: number
  /** `null` tant que le suivi n'existe pas (S11) : la ligne est omise. */
  visites: number | null
  clics: number | null
}

interface UtilisateurEmailBase {
  outboxId: string
  generatedAt: Date
  destinataire: string
  prenom: string
  /** Fuseau du destinataire (`users.fuseau`). */
  fuseau: string
  siteUrl: string
  /** Jeton signé du désabonnement (fonction `signUnsubscribeToken`, injectée par l'appelant). */
  jetonDesabonnement: string
}

export interface RappelJourneeContent extends UtilisateurEmailBase {
  type: 'utilisateur_rappel_journee'
  /** Un instant quelconque de la journée locale concernée. */
  jour: Date
  rendezVous: readonly RendezVousJournee[]
}

export interface ResumeHebdoContent extends UtilisateurEmailBase {
  type: 'utilisateur_resume_hebdo'
  /** `[debut, fin)` : minuit local du premier jour, minuit local du lundi. */
  periode: { debut: Date, fin: Date }
  compteurs: CompteursResume
  suggestion: SuggestionResume
}

export type UtilisateurEmailContent = RappelJourneeContent | ResumeHebdoContent

/** Socle des e-mails de service de l'abonnement (S10) : transactionnels, donc ni jeton ni List-Unsubscribe. */
interface AbonnementEmailBase {
  outboxId: string
  generatedAt: Date
  destinataire: string
  prenom: string
  /** Fuseau du destinataire (`users.fuseau`), déjà validé par l'appelant. */
  fuseau: string
  siteUrl: string
}

export interface AbonnementRappelContent extends AbonnementEmailBase {
  type: 'abonnement_rappel'
  /** Rappel J-7, J-3 ou J0 (lu dans l'occurrence). */
  jours: AbonnementRappelJours
  /** Échéance EXCLUSIVE (minuit local suivant le dernier jour payé). */
  expireLe: Date
  /** Période à présélectionner dans le lien de renouvellement (dernière période payée). */
  periodeMois: number
}

export interface PaiementConfirmeContent extends AbonnementEmailBase {
  type: 'paiement_confirme'
  /** Identifiant du paiement chez Brandself. */
  reference: string
  /** Référence de l'opérateur, si elle est connue. */
  referenceFournisseur: string | null
  /** Unité mineure de la devise (entier). */
  montant: number
  devise: string
  periodeMois: number
  /** Libellé du moyen (« MTN MoMo ») ; `null` : moyen absent du catalogue. */
  moyenLibelle: string | null
  /** Numéro DÉJÀ masqué (`+237 6•• ••• •89`) : le numéro complet n'existe nulle part. */
  telephoneMasque: string | null
  /** Échéance exclusive après application du paiement ; `null` si non renseignée. */
  nouvelleEcheance: Date | null
}

export type AbonnementEmailContent = AbonnementRappelContent | PaiementConfirmeContent

// Défense en profondeur : une valeur saisie et placée dans l'objet ou sur une ligne d'un e-mail ne
// peut contenir ni saut de ligne ni caractère de contrôle (injection d'en-têtes ou de lignes).
export function singleLine(value: string): string {
  return value.replaceAll(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ').trim()
}

function pluriel(n: number, singulier: string, plurielForme: string): string {
  return `${n} ${n > 1 ? plurielForme : singulier}`
}

export function joinUrl(siteUrl: string, chemin: string): string {
  return `${siteUrl.replace(/\/+$/, '')}${chemin}`
}

type PartiesDate = Record<string, string>

function parties(date: Date, fuseau: string): PartiesDate {
  const formateur = new Intl.DateTimeFormat(LOCALE, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: fuseau,
  })
  const resultat: PartiesDate = {}
  for (const partie of formateur.formatToParts(date)) resultat[partie.type] = partie.value
  return resultat
}

function jourDuMois(valeur: string | undefined): string {
  return valeur === PREMIER_DU_MOIS ? PREMIER_DU_MOIS_ECRIT : (valeur ?? '')
}

/** « mardi 10 novembre » (« 1er » pour le premier du mois), dans le fuseau donné. */
export function formatJour(date: Date, fuseau: string): string {
  const p = parties(date, fuseau)
  return `${p.weekday} ${jourDuMois(p.day)} ${p.month}`
}

/** « jeudi 12 novembre 2026 à 10:00 », dans le fuseau donné. */
export function formatJourComplet(date: Date, fuseau: string): string {
  const p = parties(date, fuseau)
  return `${p.weekday} ${jourDuMois(p.day)} ${p.month} ${p.year} à ${p.hour}:${p.minute}`
}

/** « 09:00 », dans le fuseau donné. */
export function formatHeure(date: Date, fuseau: string): string {
  const p = parties(date, fuseau)
  return `${p.hour}:${p.minute}`
}

/** Pied obligatoire : ligne vide, séparateur, puis la raison d'être du message. */
export function pied(lignes: readonly string[]): string[] {
  return ['', SEPARATEUR_PIED, ...lignes]
}

function salutation(prenom: string): string {
  const nom = singleLine(prenom)
  return nom ? `Bonjour ${nom},` : TEXTES_NOTIFICATIONS.bonjourSansNom
}

function jetonSur(content: UtilisateurEmailBase): string {
  // Le jeton part dans une URL ET dans un en-tête : on refuse tout ce qui n'a pas la forme exacte.
  const verdict = schemaJetonDesabonnement.safeParse(content.jetonDesabonnement)
  if (!verdict.success) throw new Error('JETON_DESABONNEMENT_INVALIDE')
  return verdict.data
}

function entetesDesabonnement(content: UtilisateurEmailBase, jeton: string): Record<string, string> {
  return {
    'List-Unsubscribe': `<${joinUrl(content.siteUrl, DESABONNEMENT_API_CHEMIN)}?jeton=${jeton}>`,
    'List-Unsubscribe-Post': LIST_UNSUBSCRIBE_POST_VALEUR,
  }
}

function lienDesabonnement(content: UtilisateurEmailBase, jeton: string): string {
  return `${joinUrl(content.siteUrl, DESABONNEMENT_PAGE_CHEMIN)}?jeton=${jeton}`
}

function ligneRendezVous(rdv: RendezVousJournee, fuseau: string): string {
  const suffixe = rdv.statut === 'en_attente' ? TEXTES_NOTIFICATIONS.journee.aConfirmer : ''
  return `• ${formatHeure(rdv.debut, fuseau)} — ${singleLine(rdv.service)} — ${singleLine(rdv.visiteur)}${suffixe}`
}

function introJournee(total: number, aConfirmer: number): string {
  const dont = aConfirmer > 0 ? `, dont ${aConfirmer} à confirmer` : ''
  return `Voici votre journée : ${total} rendez-vous${dont}.`
}

export function buildRappelJourneeEmail(content: RappelJourneeContent): EmailMessage {
  const jeton = jetonSur(content)
  const { journee, pied: textesPied } = TEXTES_NOTIFICATIONS
  const tries = [...content.rendezVous].sort((a, b) => a.debut.getTime() - b.debut.getTime())
  const aConfirmer = tries.filter((rdv) => rdv.statut === 'en_attente').length
  const detailles = tries.slice(0, RAPPEL_JOURNEE_MAX_LIGNES)
  const surplus = tries.length - detailles.length
  const jour = formatJour(content.jour, content.fuseau)
  return {
    to: content.destinataire,
    subject: tries.length === 1 ? `Votre rendez-vous du ${jour}` : `Vos rendez-vous du ${jour}`,
    text: [
      salutation(content.prenom),
      '',
      introJournee(tries.length, aConfirmer),
      '',
      ...detailles.map((rdv) => ligneRendezVous(rdv, content.fuseau)),
      ...(surplus > 0 ? [journee.surplus(surplus)] : []),
      '',
      journee.detail(joinUrl(content.siteUrl, '/studio/agenda')),
      '',
      journee.cloture,
      TEXTES_NOTIFICATIONS.signatureMarque,
      ...pied([
        textesPied.journee,
        textesPied.desabonnement(lienDesabonnement(content, jeton)),
        textesPied.gerer(joinUrl(content.siteUrl, '/studio/compte')),
      ]),
    ].join('\n'),
    attachments: [],
    headers: entetesDesabonnement(content, jeton),
  }
}

function objetResume(compteurs: CompteursResume): string {
  const termes = [
    ...(compteurs.reservations > 0 ? [pluriel(compteurs.reservations, 'réservation', 'réservations')] : []),
    ...(compteurs.demandes > 0 ? [pluriel(compteurs.demandes, 'demande', 'demandes')] : []),
    ...(compteurs.messages > 0 ? [pluriel(compteurs.messages, 'message', 'messages')] : []),
  ]
  return `Votre semaine : ${termes.join(', ')}`
}

function lignesCompteurs(compteurs: CompteursResume): string[] {
  return [
    `• Réservations reçues : ${compteurs.reservations}`,
    `• Demandes reçues : ${compteurs.demandes}`,
    `• Messages reçus : ${compteurs.messages}`,
    ...(compteurs.visites === null ? [] : [`• Visites : ${compteurs.visites}`]),
    ...(compteurs.clics === null ? [] : [`• Clics sur vos liens : ${compteurs.clics}`]),
  ]
}

function lignesRendezVousSemaine(n: number): string[] {
  if (n <= 0) return []
  const forme = n > 1 ? `${n} rendez-vous sont prévus` : '1 rendez-vous est prévu'
  return [`Cette semaine, ${forme}.`, '']
}

function libellePeriode(periode: { debut: Date, fin: Date }, fuseau: string): string {
  // Dernier jour = le jour local du dernier instant de la période (fin exclue).
  const dernierInstant = new Date(periode.fin.getTime() - 1)
  return `du ${formatJour(periode.debut, fuseau)} au ${formatJour(dernierInstant, fuseau)}`
}

export function buildResumeHebdoEmail(content: ResumeHebdoContent): EmailMessage {
  const jeton = jetonSur(content)
  const { resume, pied: textesPied } = TEXTES_NOTIFICATIONS
  const { compteurs } = content
  const avecActivite = compteurs.reservations + compteurs.demandes + compteurs.messages > 0
  const piedResume = pied([
    textesPied.resume(JOURS_ISO[RESUME_JOUR_ISO - 1] ?? ''),
    textesPied.desabonnement(lienDesabonnement(content, jeton)),
    textesPied.gerer(joinUrl(content.siteUrl, '/studio/compte')),
  ])
  const corps = avecActivite
    ? [
        salutation(content.prenom),
        '',
        `Voici l'activité de votre vitrine ${libellePeriode(content.periode, content.fuseau)} :`,
        '',
        ...lignesCompteurs(compteurs),
        '',
        ...lignesRendezVousSemaine(compteurs.rendezVousSemaine),
        resume.studio(joinUrl(content.siteUrl, '/studio')),
        '',
        resume.cloture,
        TEXTES_NOTIFICATIONS.signatureMarque,
        ...piedResume,
      ]
    : [
        salutation(content.prenom),
        '',
        resume.introIdee,
        '',
        singleLine(content.suggestion.titre),
        singleLine(content.suggestion.texte),
        joinUrl(content.siteUrl, content.suggestion.chemin ?? '/studio'),
        '',
        resume.cloture,
        TEXTES_NOTIFICATIONS.signatureMarque,
        ...piedResume,
      ]
  return {
    to: content.destinataire,
    subject: avecActivite ? objetResume(compteurs) : resume.objetIdee,
    text: corps.join('\n'),
    attachments: [],
    headers: entetesDesabonnement(content, jeton),
  }
}

export function buildUtilisateurEmail(content: UtilisateurEmailContent): EmailMessage {
  return content.type === 'utilisateur_rappel_journee' ? buildRappelJourneeEmail(content) : buildResumeHebdoEmail(content)
}

// --- S10 : abonnement (rappels d'échéance et reçu de paiement) ---

/** « 3 décembre 2026 » (« 1er » pour le premier du mois), dans le fuseau donné. */
export function formatDateLongue(date: Date, fuseau: string): string {
  const p = parties(date, fuseau)
  return `${jourDuMois(p.day)} ${p.month} ${p.year}`
}

/**
 * Dernier jour payé, inclus : `expire_le` est EXCLUSIF (minuit local suivant), donc la date locale de son
 * dernier instant payé. Pour une échéance alignée sur minuit, c'est la date locale de `expire_le − 1 jour`.
 */
export function dernierJourInclus(expireLe: Date, fuseau: string): string {
  return formatDateLongue(new Date(expireLe.getTime() - 1), fuseau)
}

/** « 48 000 FCFA » : entier en unité mineure, décimales selon l'exposant de la devise, espace simple. */
export function formatMontant(montant: number, devise: string): string {
  const exposant = DEVISES_EXPOSANT[devise] ?? EXPOSANT_DEVISE_DEFAUT
  const nombre = new Intl.NumberFormat(LOCALE, { minimumFractionDigits: exposant, maximumFractionDigits: exposant })
    .format(montant / BASE_DECIMALE ** exposant)
  return `${nombre.replaceAll(ESPACES_INSECABLES, ' ')} ${LIBELLES_DEVISE[devise] ?? devise}`
}

/** `{site}/studio/compte?periode=3#abonnement` : l'ancre vient du chemin partagé `ABONNEMENT_CHEMIN`. */
function lienRenouvellement(siteUrl: string, periodeMois: number): string {
  const [chemin = '', ancre] = ABONNEMENT_CHEMIN.split('#')
  return `${joinUrl(siteUrl, chemin)}?periode=${Math.trunc(periodeMois)}${ancre === undefined ? '' : `#${ancre}`}`
}

/** S10 #122 : rappel J-7, J-3 ou J0. Texte seul, sans List-Unsubscribe (message de service). */
export function buildAbonnementRappelEmail(content: AbonnementRappelContent): EmailMessage {
  const t = TEXTES_NOTIFICATIONS.abonnementRappel
  const date = dernierJourInclus(content.expireLe, content.fuseau)
  return {
    to: content.destinataire,
    subject: t.objet(content.jours),
    text: [
      salutation(content.prenom),
      '',
      t.intro(content.jours, date),
      t.sansRenouvellementAuto,
      '',
      t.invitation,
      `${t.action} : ${lienRenouvellement(content.siteUrl, content.periodeMois)}`,
      '',
      t.grace(ABONNEMENT_GRACE_JOURS),
      '',
      t.cloture,
      TEXTES_NOTIFICATIONS.signatureMarque,
      ...pied([t.pied]),
    ].join('\n'),
    attachments: [],
  }
}

/** S10 #123 : reçu. Ni numéro complet (seul le masque existe), ni mention de facture. */
export function buildPaiementConfirmeEmail(content: PaiementConfirmeContent): EmailMessage {
  const t = TEXTES_NOTIFICATIONS.paiementConfirme
  const echeance = content.nouvelleEcheance === null ? null : dernierJourInclus(content.nouvelleEcheance, content.fuseau)
  return {
    to: content.destinataire,
    subject: t.objet,
    text: [
      salutation(content.prenom),
      '',
      t.intro(echeance),
      '',
      t.montant(formatMontant(content.montant, content.devise)),
      t.periode(`${content.periodeMois} ${PERIODE_MOIS_UNITE}`),
      t.moyen(singleLine(content.moyenLibelle ?? t.moyenInconnu)),
      ...(content.telephoneMasque === null ? [] : [t.numero(singleLine(content.telephoneMasque))]),
      t.reference(singleLine(content.reference)),
      ...(content.referenceFournisseur === null ? [] : [t.referenceFournisseur(singleLine(content.referenceFournisseur))]),
      ...(echeance === null ? [] : [t.echeance(echeance)]),
      '',
      t.pasUneFacture,
      '',
      t.cloture,
      TEXTES_NOTIFICATIONS.signatureMarque,
      ...pied([t.pied]),
    ].join('\n'),
    attachments: [],
  }
}

export function buildAbonnementEmail(content: AbonnementEmailContent): EmailMessage {
  return content.type === 'abonnement_rappel' ? buildAbonnementRappelEmail(content) : buildPaiementConfirmeEmail(content)
}
