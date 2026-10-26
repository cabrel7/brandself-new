import type { ServicePublicDetailDTO, ServicePublicReponse } from '#shared/dto'
import type { PaiementMode } from '#shared/services'
import { formatPrix } from '#shared/devises'
import { libellePrix, SERVICE_ACTIONS, serviceActionHref } from '#shared/services'

const LIBELLE_CONTACT = 'Me contacter'
const CIBLE_CONTACT = '#contact'

const TEXTE_SUR_PLACE = 'Vous réglez sur place, au moment de la séance.'

const PAIEMENT_PHRASES: Record<PaiementMode, string> = {
  en_ligne: 'en ligne',
  sur_place: 'sur place',
  au_choix: 'en ligne ou sur place',
}

export interface ServiceLien {
  libelle: string
  to: string
  externe: boolean
}

/**
 * Lecture seule d'un service visible et de ses voisins (rendu serveur).
 * Toute erreur devient une erreur de page : 404 si la vitrine ou le service est introuvable ou masqué.
 */
export async function usePublicService(username: string, slug: string): Promise<Ref<ServicePublicReponse>> {
  const { data, error } = await useAsyncData(`service-public-${username}-${slug}`, () =>
    $fetch<ServicePublicReponse>(`/api/public/${encodeURIComponent(username)}/services/${encodeURIComponent(slug)}`),
  )

  if (error.value || !data.value) throw erreurPagePublique(error.value ?? { statusCode: 404 })

  return computed(() => data.value!) as Ref<ServicePublicReponse>
}

/** Lien WhatsApp avec un texte prérempli encodé ; `null` sans numéro exploitable. */
export function lienWhatsapp(numero: string | null, texte: string): string | null {
  const chiffres = numero?.replace(/\D/g, '')
  return chiffres ? `https://wa.me/${chiffres}?text=${encodeURIComponent(texte)}` : null
}

/** Prix sans le préfixe « Forfait » (déjà porté par le surtitre de la carte tarif). */
export function prixSeul(s: ServicePublicDetailDTO): string {
  return s.tarif === 'payant' && s.prixMontant !== null && s.prixDevise !== null
    ? formatPrix(s.prixMontant, s.prixDevise)
    : libellePrix(s)
}

/** « 15 000 XAF · sur place » ; le mode de règlement n'a de sens que pour un service payant. */
export function prixEtReglement(s: ServicePublicDetailDTO): string {
  const prix = libellePrix(s)
  return s.tarif === 'payant' && s.paiementMode !== null ? `${prix} · ${PAIEMENT_PHRASES[s.paiementMode]}` : prix
}

export function phraseReglement(s: ServicePublicDetailDTO): string | null {
  return s.tarif === 'payant' && s.paiementMode !== null ? `Paiement ${PAIEMENT_PHRASES[s.paiementMode]}` : null
}

/** Précision de règlement d'un service payant : instructions du professionnel, sinon phrase par défaut. */
export function texteReglement(s: ServicePublicDetailDTO): string | null {
  if (s.tarif !== 'payant') return null
  if (s.paiementInstructions) return s.paiementInstructions
  return s.paiementMode === 'sur_place' ? TEXTE_SUR_PLACE : null
}

/** Action principale du détail : action du type si réservable, sinon contact (WhatsApp, à défaut le pied de page). */
export function actionDetail(
  s: ServicePublicDetailDTO,
  username: string,
  whatsapp: string | null,
  forme: 'court' | 'long',
): ServiceLien {
  if (s.reservable) {
    return { libelle: SERVICE_ACTIONS[s.type][forme], to: serviceActionHref(username, s.slug), externe: false }
  }
  return whatsapp === null
    ? { libelle: LIBELLE_CONTACT, to: CIBLE_CONTACT, externe: false }
    : { libelle: LIBELLE_CONTACT, to: whatsapp, externe: true }
}
