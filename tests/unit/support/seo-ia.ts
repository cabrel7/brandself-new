import { createHash } from 'node:crypto'

// Décision #24 : SEO automatique en 3 niveaux. Données et références PARTAGÉES par les tests unitaires ET
// d'intégration du SEO IA. La formule de la signature est recopiée ICI, indépendamment du code de production :
// si le backend dérive, les tests le voient (ils ne se contentent pas de comparer le code à lui-même).

export const VERSION_SIGNATURE_ATTENDUE = 'v1'
export const SEPARATEUR_SIGNATURE = '\u001f'

/** n(x) du contrat : NFC, trim, `\s+` → un espace, minuscules `fr`, null → ''. */
export function normaliserPourSignature(texte: string | null | undefined): string {
  return (texte ?? '').normalize('NFC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('fr')
}

export interface EntreesSignature {
  metier: string
  ville: string | null
  pays: string | null
  accroche: string | null
}

/** sha256 hex de [VERSION, n(metier), n(ville), pays ?? '', n(accroche)] joints par U+001F. */
export function signatureAttendue(entrees: EntreesSignature, version: string = VERSION_SIGNATURE_ATTENDUE): string {
  const morceaux = [
    version,
    normaliserPourSignature(entrees.metier),
    normaliserPourSignature(entrees.ville),
    entrees.pays ?? '',
    normaliserPourSignature(entrees.accroche),
  ]
  return createHash('sha256').update(morceaux.join(SEPARATEUR_SIGNATURE)).digest('hex')
}

export const SEO_IA_TITRE_MIN_ATTENDU = 10
export const SEO_IA_TITRE_MAX_ATTENDU = 50
export const SEO_IA_DESCRIPTION_MIN_ATTENDU = 50
export const SEO_IA_DESCRIPTION_MAX_ATTENDU = 160

export const ENTREE_SEO = {
  metier: 'Cardiologue',
  ville: 'Douala',
  pays: 'CM',
  accroche: 'Un suivi attentif et clair pour votre cœur au quotidien',
}

export interface SeoIaFixture {
  titre: string
  description: string
}

/** Proposition SEO conforme (forme, ville dans le titre ET la description, aucun fait inventé, accents). */
export const SEO_VALIDE: SeoIaFixture = {
  titre: 'Cardiologue à Douala',
  description: 'Consultations de cardiologie à Douala pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.',
}

const FILLER = 'suivi attentif et clair '

/** Texte de EXACTEMENT `longueur` caractères, commençant par `debut` et se terminant par une lettre. */
export function texteDeLongueur(debut: string, longueur: number): string {
  const texte = `${debut}${FILLER.repeat(20)}`.slice(0, longueur).replace(/ $/, 'e')
  if (texte.length !== longueur) throw new Error(`texteDeLongueur : ${texte.length} caractères au lieu de ${longueur}`)
  return texte
}

/** Titre de `longueur` caractères (≥ 20) qui contient la ville. */
export function titreDeLongueur(longueur: number): string {
  return texteDeLongueur('Cardiologue à Douala ', longueur)
}

/** Description de `longueur` caractères (≥ 24) qui contient la ville. */
export function descriptionDeLongueur(longueur: number): string {
  return texteDeLongueur('Consultations à Douala ', longueur)
}
