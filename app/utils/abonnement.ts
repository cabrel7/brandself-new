import { DEVISES } from '#shared/compte'
import type { Devise } from '#shared/compte'
import { DEVISE_AFFICHAGE } from '#shared/devises'
import type { PrixPeriodeDTO } from '#shared/dto'
import { PAIEMENT_STATUTS_OUVERTS } from '#shared/paiements'
import type { PaiementStatut } from '#shared/paiements'
import { ABONNEMENT_FUSEAU_REPLI, ABONNEMENT_RAPPELS_JOURS } from '#shared/plans'
import type { PeriodeMois, RessourceQuota } from '#shared/plans'

// S10 : formats et libellés de l'abonnement. Pur (aucune requête) : aucun prix ni limite chiffrée ici,
// tout vient de l'API (CLAUDE.md §4 règle 11).

const LOCALE_FR = 'fr-FR'
const MOIS_PAR_AN = 12
const CHIFFRES_MIN_TELEPHONE = 8

/** Libellé court du nom d'une devise payable (note de la carte Abonnement). */
const NOMS_DEVISES: Readonly<Record<string, string>> = { XAF: 'francs CFA', XOF: 'francs CFA' }

/** Message au visiteur quand le professionnel ne prend plus de réservation ce mois-ci : jamais un mot sur un plan. */
export const MESSAGE_RESERVATIONS_INDISPONIBLES =
  'Ce professionnel ne prend plus de nouvelle réservation en ligne ce mois-ci. Vous pouvez le contacter directement.'

/** Libellés des quotas affichés sur la carte du plan gratuit. */
export const LIBELLES_QUOTAS: Readonly<Record<RessourceQuota, string>> = {
  services: 'Services',
  realisations: 'Réalisations',
  temoignages: 'Témoignages',
  reservations_mois: 'Réservations ce mois-ci',
  generations_ia_mois: 'Propositions de l’IA ce mois-ci',
}

function estDeviseConnue(devise: string): devise is Devise {
  return (DEVISES as readonly string[]).includes(devise)
}

/** `48000, 'XAF', 0` -> « 48 000 XAF » (espaces insécables d'Intl) ; EUR et USD avec leur symbole. */
export function formaterMontant(montant: number, devise: string, exposant: number): string {
  const diviseur = 10 ** exposant
  return new Intl.NumberFormat(LOCALE_FR, {
    style: 'currency',
    currency: devise,
    currencyDisplay: estDeviseConnue(devise) ? DEVISE_AFFICHAGE[devise] : 'code',
    minimumFractionDigits: exposant,
    maximumFractionDigits: exposant,
  }).format(montant / diviseur)
}

function fuseauValide(fuseau: string): string {
  try {
    new Intl.DateTimeFormat(LOCALE_FR, { timeZone: fuseau })
    return fuseau
  } catch {
    return ABONNEMENT_FUSEAU_REPLI
  }
}

function formaterJourCivil(annee: number, mois: number, jour: number): string {
  return new Intl.DateTimeFormat(LOCALE_FR, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(annee, mois - 1, jour, 12)))
}

/** `'2026-11-22'` (date locale du dernier jour payé) -> « 22 novembre 2026 ». Chaîne illisible : renvoyée telle quelle. */
export function formaterJourLocal(dateLocale: string): string {
  const morceaux = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLocale)
  if (!morceaux) return dateLocale
  return formaterJourCivil(Number(morceaux[1]), Number(morceaux[2]), Number(morceaux[3]))
}

/**
 * Dernier jour INCLUS d'une échéance exclusive (`expireLe`, `graceJusquau`, `abonnementExpireLe`) :
 * la date, dans le fuseau du compte, de l'instant qui précède l'échéance. « Jusqu'au 22 novembre »
 * veut dire que le 22 est encore couvert.
 */
export function dernierJourAvant(echeanceIso: string, fuseau: string): string {
  const echeance = new Date(echeanceIso)
  if (Number.isNaN(echeance.getTime())) return echeanceIso
  const parties = new Intl.DateTimeFormat(LOCALE_FR, {
    day: 'numeric', month: 'numeric', year: 'numeric', timeZone: fuseauValide(fuseau),
  }).formatToParts(new Date(echeance.getTime() - 1))
  const lire = (type: string): number => Number(parties.find((p) => p.type === type)?.value)
  return formaterJourCivil(lire('year'), lire('month'), lire('day'))
}

/** Premier jour du mois suivant, dans le fuseau de la vitrine : fin du quota mensuel de réservations. */
export function premierJourMoisSuivant(maintenant: Date, fuseau: string): string {
  const parties = new Intl.DateTimeFormat(LOCALE_FR, {
    month: 'numeric', year: 'numeric', timeZone: fuseauValide(fuseau),
  }).formatToParts(maintenant)
  const annee = Number(parties.find((p) => p.type === 'year')?.value)
  const mois = Number(parties.find((p) => p.type === 'month')?.value)
  const suivant = mois === MOIS_PAR_AN ? { annee: annee + 1, mois: 1 } : { annee, mois: mois + 1 }
  return formaterJourCivil(suivant.annee, suivant.mois, 1)
}

/** « Il vous reste 31 jours. » ; le dernier jour est dit comme tel. */
export function libelleJoursRestants(jours: number): string {
  if (jours <= 0) return 'C’est le dernier jour de votre abonnement.'
  return `Il vous reste ${jours} ${jours > 1 ? 'jours' : 'jour'}.`
}

export function libellePeriode(mois: PeriodeMois | number): string {
  return `${mois} mois`
}

/** Seconde ligne d'un choix de durée : le prix de la période, puis l'avantage s'il y en a un. */
export function detailPeriode(prix: PrixPeriodeDTO, devise: string, exposant: number): string {
  const montant = formaterMontant(prix.montant, devise, exposant)
  if (prix.miseEnAvant) return `${montant} · le plus avantageux`
  return prix.remisePct > 0 ? `${montant} · plus avantageux` : montant
}

/** Chiffres seuls d'une saisie de numéro : espaces, points, tirets et « + » retirés. */
export function chiffresTelephone(saisie: string): string {
  return saisie.replace(/\D/g, '')
}

export function telephoneSaisiPlausible(saisie: string): boolean {
  return chiffresTelephone(saisie).length >= CHIFFRES_MIN_TELEPHONE
}

/** Nom de la devise du paiement quand elle diffère de celle du compte (« francs CFA »). */
export function nomDevise(devise: string): string {
  return Object.hasOwn(NOMS_DEVISES, devise) ? (NOMS_DEVISES[devise] ?? devise) : devise
}

/** Un paiement est « en cours » tant que le fournisseur n'a pas rendu de statut final. */
export function paiementEstOuvert(statut: PaiementStatut): boolean {
  return (PAIEMENT_STATUTS_OUVERTS as readonly string[]).includes(statut)
}

/** « 7 jours et 3 jours avant, puis le jour de l’échéance » : lu dans la configuration partagée des rappels. */
export function phraseRappels(): string {
  const avant = ABONNEMENT_RAPPELS_JOURS.filter((jours) => jours > 0)
  const liste = avant.map((jours) => `${jours} jours`).join(' et ')
  return `Nous vous envoyons un rappel ${liste} avant, puis le jour de l’échéance.`
}
