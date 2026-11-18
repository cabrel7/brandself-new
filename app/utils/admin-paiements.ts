// A3 (UI) : fonctions pures de l'administration des abonnements et des paiements. Aucune dépendance Vue ni Nuxt :
// testable seule. Les libellés suivent le vocabulaire du produit (CLAUDE.md §2), vouvoiement.
import { ADMIN_MOTIF_MAX, ADMIN_MOTIF_MIN } from '#shared/admin'
import { DEVISES } from '#shared/compte'
import type { Devise } from '#shared/compte'
import { formatPrix } from '#shared/devises'
import type { AbonnementOrigine } from '#shared/admin-a2'
import {
  PAIEMENT_SOURCES,
  PAIEMENT_STATUTS_REMPLACABLES,
  type AbonnementOnglet,
  type PaiementSource,
  type ReverificationResultat,
} from '#shared/admin-paiements'
import type { ErrorCode } from '#shared/erreurs'
import { ABONNEMENT_FUSEAU_REPLI, PLAN_LIBELLES } from '#shared/plans'
import type { EtatAbonnement, PlanId } from '#shared/plans'
import { PAIEMENT_SOURCE_FOURNISSEUR, PAIEMENT_STATUTS } from '#shared/paiements'
import type { PaiementStatut } from '#shared/paiements'
import type { FiltresPaiements, PaiementDto } from '#shared/schemas/admin-paiements'

const LOCALE = 'fr-FR'
const CLE_IDEMPOTENCE_PREFIXE = 'ui-'
export const FILTRE_TOUS = 'tous'

const estDevise = (devise: string): devise is Devise => (DEVISES as readonly string[]).includes(devise)

/** Montant entier en plus petite unité -> texte (« 15 000 XAF », « 12,50 € »). Devise inconnue : code brut, entier. */
export function formaterMontantAdmin(montant: number, devise: string): string {
  if (estDevise(devise)) return formatPrix(montant, devise)
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(montant)} ${devise}`
}

/** Montant ou tiret quand la valeur n'est pas connue (frais et net K-PAY absents tant qu'aucune interrogation n'a répondu). */
export function formaterMontantOuTiret(montant: number | null, devise: string): string {
  return montant === null ? '—' : formaterMontantAdmin(montant, devise)
}

export function formaterDate(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeZone: ABONNEMENT_FUSEAU_REPLI }).format(new Date(iso))
}

export function formaterDateHeureAdmin(iso: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: ABONNEMENT_FUSEAU_REPLI,
  }).format(new Date(iso))
}

/** Nombre entier groupé par milliers (compteurs). */
export function formaterNombre(nombre: number): string {
  return new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 0 }).format(nombre)
}

// --- Libellés ---

export const LIBELLES_ONGLETS: Record<AbonnementOnglet, string> = {
  renouvellement: 'À renouveler dans 7 jours',
  grace: 'En grâce',
  expires: 'Expirés récemment (30 jours)',
}

/** Libellés courts des onglets (390 px) ; le libellé complet s'affiche sous les onglets. */
export const LIBELLES_ONGLETS_COURTS: Record<AbonnementOnglet, string> = {
  renouvellement: 'À renouveler',
  grace: 'En grâce',
  expires: 'Expirés',
}

export const LIBELLES_VIDE_ONGLET: Record<AbonnementOnglet, string> = {
  renouvellement: 'Aucun abonnement n’arrive à échéance dans les 7 prochains jours.',
  grace: 'Aucun abonnement n’est en période de grâce.',
  expires: 'Aucun abonnement n’a expiré ces 30 derniers jours.',
}

export const LIBELLES_STATUT: Record<PaiementStatut, string> = {
  cree: 'Créé',
  en_attente: 'En attente',
  reussi: 'Réussi',
  echoue: 'Échoué',
  annule: 'Annulé',
  expire: 'Expiré',
  anomalie: 'Anomalie',
}

export type CouleurBadge = 'primary' | 'neutral' | 'error'

/** La couleur ne porte jamais seule l'information : le libellé du statut est toujours affiché. */
export const COULEURS_STATUT: Record<PaiementStatut, CouleurBadge> = {
  cree: 'neutral',
  en_attente: 'neutral',
  reussi: 'primary',
  echoue: 'error',
  annule: 'neutral',
  expire: 'neutral',
  anomalie: 'error',
}

export const LIBELLES_SOURCE: Record<PaiementSource, string> = { fournisseur: 'Fournisseur', manuel: 'Manuel' }

export const LIBELLES_ETAT_ABONNEMENT: Record<EtatAbonnement, string> = {
  gratuit: 'Gratuit',
  actif: 'Actif',
  grace: 'En grâce',
}

export const LIBELLES_ORIGINE: Record<AbonnementOrigine, string> = {
  paiement: 'Paiement',
  offert: 'Offert',
  admin: 'Administration',
}

export function libellePlan(plan: PlanId): string {
  return PLAN_LIBELLES[plan]
}

export function libellePeriodeAdmin(mois: number): string {
  return mois === 1 ? '1 mois' : `${mois} mois`
}

export const LIBELLES_RESULTAT_REVERIFICATION: Record<ReverificationResultat, string> = {
  applique: 'Le paiement est confirmé et l’abonnement est prolongé.',
  deja_applique: 'Ce paiement était déjà appliqué. L’abonnement n’a pas été prolongé une seconde fois.',
  refuse_anomalie: 'Ce paiement est en anomalie : il n’a pas été appliqué.',
  non_reussi: 'K-PAY ne signale aucun encaissement pour ce paiement.',
  en_attente: 'K-PAY n’a pas encore tranché. Revérifiez dans quelques minutes.',
}

export const MESSAGE_REJOUE = 'Cette demande avait déjà été traitée : nous affichons son résultat.'

export const ERREUR_GENERIQUE = 'L’opération n’a pas abouti. Réessayez dans un instant.'

/** Messages par code d'erreur du contrat (`ERROR_CODES`). Un code absent retombe sur le message générique. */
const MESSAGES_ERREUR: Partial<Record<ErrorCode, string>> = {
  VALIDATION: 'Vérifiez le motif : il doit comporter au moins 5 caractères.',
  REAUTH_REQUISE: 'Saisissez le code de confirmation reçu par e-mail.',
  REAUTH_INVALIDE: 'Code invalide ou expiré. Demandez-en un nouveau.',
  PAIEMENT_OUVERT: 'Cet utilisateur a déjà un paiement en cours. Attendez son issue ou revérifiez-le.',
  DEJA_PAYE: 'Ce paiement est déjà réussi : rien à marquer.',
  REVERIFICATION_REQUISE: 'Revérifiez d’abord ce paiement auprès de K-PAY (moins de 30 minutes) avant de le marquer comme payé.',
  RAPPEL_RECENT: 'Un rappel a déjà été envoyé à cet abonné ces dernières 24 heures.',
  EXPORT_TROP_GRAND: 'Trop de paiements pour un seul fichier. Resserrez la période ou les filtres.',
  FOURNISSEUR_INDISPONIBLE: 'K-PAY est indisponible pour le moment. Réessayez dans un instant.',
  TROP_DE_REQUETES: 'Trop de demandes. Patientez une minute avant de réessayer.',
}

export function messageErreurAdmin(code: ErrorCode | null): string {
  return (code && MESSAGES_ERREUR[code]) || ERREUR_GENERIQUE
}

export const MESSAGE_MOTIF = `Indiquez un motif de ${ADMIN_MOTIF_MIN} à ${ADMIN_MOTIF_MAX} caractères.`

/** Même règle que `schemaMotifAdmin` : motif rogné de 5 à 500 caractères. Le serveur revalide toujours. */
export function motifValide(motif: string): boolean {
  const longueur = motif.trim().length
  return longueur >= ADMIN_MOTIF_MIN && longueur <= ADMIN_MOTIF_MAX
}

// --- Règles d'affichage des actions (le serveur reste la seule autorité) ---

/** Une revérification n'a de sens que pour un paiement de fournisseur (un paiement manuel n'a pas d'identifiant fournisseur). */
export function peutReverifier(paiement: Pick<PaiementDto, 'source'>): boolean {
  return paiement.source === PAIEMENT_SOURCE_FOURNISSEUR
}

/** D-A3-03 : seuls `echoue`, `expire`, `annule` et `anomalie` d'origine fournisseur se marquent comme payés. */
export function peutMarquerPaye(paiement: Pick<PaiementDto, 'source' | 'statut'>): boolean {
  return (
    paiement.source === PAIEMENT_SOURCE_FOURNISSEUR &&
    (PAIEMENT_STATUTS_REMPLACABLES as readonly string[]).includes(paiement.statut)
  )
}

/** Clé d'idempotence d'une action : jeu de caractères restreint (UUID), générée à l'ouverture de la boîte de dialogue. */
export function nouvelleCleIdempotence(): string {
  return `${CLE_IDEMPOTENCE_PREFIXE}${crypto.randomUUID()}`
}

// --- Filtres de la liste des paiements (URL <-> requête) ---

type ValeurQuery = string | null | Array<string | null> | undefined

const premiere = (valeur: ValeurQuery): string | undefined => {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur
  return typeof brut === 'string' && brut !== '' ? brut : undefined
}

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/

/** Lit les filtres de l'URL. Une valeur inconnue est ignorée : le serveur reste le seul juge, ceci évite un 400 évitable. */
export function lireFiltresPaiements(
  query: Record<string, ValeurQuery>,
  statuts: readonly string[],
  sources: readonly string[],
): FiltresPaiements {
  const statut = premiere(query.statut)
  const source = premiere(query.source)
  const devise = premiere(query.devise)
  const du = premiere(query.du)
  const au = premiere(query.au)
  const filtres: FiltresPaiements = {}
  if (statut && statuts.includes(statut)) filtres.statut = statut as PaiementStatut
  if (source && sources.includes(source)) filtres.source = source as PaiementSource
  if (devise && estDevise(devise)) filtres.devise = devise
  if (du && FORMAT_JOUR.test(du)) filtres.du = du
  if (au && FORMAT_JOUR.test(au)) filtres.au = au
  return filtres
}

/** Remplace un filtre (valeur vide : le retire). Le résultat repasse par la lecture validée, jamais de clé arbitraire. */
export function modifierFiltre(filtres: FiltresPaiements, cle: keyof FiltresPaiements, valeur: string): FiltresPaiements {
  const query: Record<string, string | undefined> = { ...filtres, [cle]: valeur === '' ? undefined : valeur }
  return lireFiltresPaiements(query, PAIEMENT_STATUTS, PAIEMENT_SOURCES)
}

/** Période incohérente (début après la fin) : message sous le champ, jamais d'appel. */
export function periodeInvalide(filtres: Pick<FiltresPaiements, 'du' | 'au'>): boolean {
  return filtres.du !== undefined && filtres.au !== undefined && filtres.du > filtres.au
}

export function lirePage(valeur: ValeurQuery): number {
  const page = Number(premiere(valeur))
  return Number.isInteger(page) && page >= 1 ? page : 1
}

/** Date locale d'un instant, pour nommer le fichier exporté (AAAA-MM-JJ). */
export function nomFichierExport(prefixe: string, maintenant: Date): string {
  return `${prefixe}${maintenant.toISOString().slice(0, 10)}.csv`
}
