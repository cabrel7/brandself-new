// Reconnaissance de la plateforme d'un lien, pour la pastille de la page publique (/@username).
// Fonction pure, sans effet de bord : partagée entre l'interface et les tests.
import { hoteUrl, LIEN_RESEAUX } from './liens'
import type { LienType } from './liens'

export const PLATEFORME_CLES = [
  'whatsapp',
  'linkedin',
  'instagram',
  'facebook',
  'youtube',
  'tiktok',
  'x',
  'telegram',
  'email',
  'telephone',
] as const
export type PlateformeCle = (typeof PLATEFORME_CLES)[number]

/** Domaines reconnus en plus de ceux des réseaux de `LIEN_RESEAUX` (liens libres). */
const DOMAINES_SUPPLEMENTAIRES: readonly { cle: PlateformeCle; domaines: readonly string[] }[] = [
  { cle: 'whatsapp', domaines: ['wa.me', 'whatsapp.com'] },
  { cle: 'telegram', domaines: ['t.me', 'telegram.me', 'telegram.org'] },
  { cle: 'facebook', domaines: ['fb.com'] },
]

function hoteCorrespond(hote: string, domaines: readonly string[]): boolean {
  return domaines.some((domaine) => hote === domaine || hote.endsWith(`.${domaine}`))
}

function estPlateformeConnue(valeur: string | null): valeur is PlateformeCle {
  return valeur !== null && (PLATEFORME_CLES as readonly string[]).includes(valeur)
}

function plateformeDepuisHote(url: string): PlateformeCle | null {
  if (url.startsWith('mailto:')) return 'email'
  if (url.startsWith('tel:')) return 'telephone'
  const hote = hoteUrl(url)
  if (!hote) return null
  const reseau = LIEN_RESEAUX.find((candidat) => hoteCorrespond(hote, candidat.domaines))
  if (reseau && estPlateformeConnue(reseau.id)) return reseau.id
  const supplement = DOMAINES_SUPPLEMENTAIRES.find((candidat) => hoteCorrespond(hote, candidat.domaines))
  return supplement?.cle ?? null
}

export interface LienPlateformeSource {
  type: LienType
  plateforme: string | null
  url: string
}

/**
 * Clé de plateforme d'un lien, ou `null` (lien libre inconnu, page interne de la vitrine).
 * Le type construit par le serveur prime ; pour un lien `libre` (ou un réseau sans plateforme),
 * la plateforme est déduite du nom de domaine de l'URL.
 */
export function plateformeDuLien({ type, plateforme, url }: LienPlateformeSource): PlateformeCle | null {
  switch (type) {
    case 'whatsapp':
      return 'whatsapp'
    case 'email':
      return 'email'
    case 'telephone':
      return 'telephone'
    case 'vitrine':
      return null
    case 'reseau':
      if (estPlateformeConnue(plateforme)) return plateforme
      return plateformeDepuisHote(url)
    case 'libre':
      return plateformeDepuisHote(url)
  }
}
