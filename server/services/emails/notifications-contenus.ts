import {
  DESABONNEMENT_API_CHEMIN,
  DESABONNEMENT_PAGE_CHEMIN,
  LIST_UNSUBSCRIBE_POST_VALEUR,
  RAPPEL_JOURNEE_MAX_LIGNES,
  RESUME_JOUR_ISO,
} from '../../../shared/notifications'
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
    desabonnementJournee: (url: string) => `Ne plus le recevoir, en un clic : ${url}`,
    desabonnementResume: (url: string) => `Vous désabonner en un clic : ${url}`,
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
        textesPied.desabonnementJournee(lienDesabonnement(content, jeton)),
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
    textesPied.desabonnementResume(lienDesabonnement(content, jeton)),
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
