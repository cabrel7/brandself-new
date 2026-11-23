// E1 : textes de l'essai gratuit. Fonctions pures ; la durée vient toujours de la donnée serveur, jamais d'une constante.
import { ESSAI_RAPPELS_JOURS } from '#shared/essai'
import { accorder } from './pluriel'

const AUCUN_PAIEMENT = 'Aucun paiement demandé.'

/** « 14 jours » / « 1 jour ». */
const duree = (jours: number): string => `${jours} ${accorder(jours, 'jour', 'jours')}`

/** Mention publique (/tarifs, landing) : « 14 jours du plan payant offerts à la création de votre vitrine. Aucun paiement demandé. » */
export function mentionEssaiPublic(jours: number): string {
  return `${duree(jours)} du plan payant ${accorder(jours, 'offert', 'offerts')} à la création de votre vitrine. ${AUCUN_PAIEMENT}`
}

/** Écran de fin d'inscription : l'essai vient d'être accordé. */
export function messageEssaiAccorde(jours: number): string {
  return `${duree(jours)} du plan payant ${accorder(jours, 'vous est offert', 'vous sont offerts')}. ${AUCUN_PAIEMENT}`
}

/** Carte Abonnement pendant l'essai : « Essai gratuit jusqu'au 7 décembre 2026 inclus ». `jourFin` : dernier jour inclus, déjà formaté. */
export const titreEssaiEnCours = (jourFin: string): string => `Essai gratuit jusqu’au ${jourFin} inclus`

/** Rappels d'un essai, lus dans la configuration partagée (J-7 supprimé, D9) : « 3 jours avant la fin, puis le dernier jour ». */
export function phraseRappelsEssai(): string {
  const avant = ESSAI_RAPPELS_JOURS.filter((jours) => jours > 0).map(duree).join(' et ')
  return `Nous vous prévenons ${avant} avant la fin, puis le dernier jour.`
}

/** Jours d'essai restants au moment d'un paiement : `prolonger` part de max(maintenant, fin d'essai), la période payée s'ajoute. */
export const MESSAGE_JOURS_ESSAI_CONSERVES = 'Les jours d’essai qu’il vous reste sont conservés : la période payée s’ajoute à la fin de l’essai.'

/** Après un essai : aucune période de grâce (D9), la vitrine repasse tout de suite au plan gratuit. */
export const MESSAGE_APRES_ESSAI =
  'Sans paiement, votre vitrine repasse ensuite au plan gratuit. Ce qui dépasse les limites du plan gratuit est masqué, jamais supprimé.'
