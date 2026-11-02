import { PAYS, TITRE_LABELS } from '../../../shared/vitrine'
import type { Titre } from '../../../shared/vitrine'

// Données de test S8 communes aux tests unitaires ET d'intégration (aucune base, aucun réseau).
// Les textes sont fabriqués avec un vocabulaire volontairement « sûr » : tout en minuscules (sauf la
// première lettre d'une phrase), sans chiffre, sans mot de la liste des faits sensibles (diplôme, école,
// depuis, prix, ancien, institut, primé, licence, master...), avec des mots courts pour que 260 mots
// tiennent dans BIO_MAX (2000 caractères). Les comptes de mots sont exacts (countWords).

const MOTS_SURS = [
  'aide', 'soin', 'avec', 'pour', 'vous', 'nous', 'dans', 'sans', 'plus', 'bien',
  'tout', 'vers', 'chez', 'cela', 'mais', 'ainsi', 'lors', 'sur', 'par', 'une',
  'des', 'les', 'est', 'pas', 'qui', 'que', 'fait', 'temps', 'écoute', 'suivi',
  'clair', 'calme', 'juste', 'simple', 'utile', 'franc', 'doux', 'sûr', 'prêt', 'cadre',
] as const

const MOTS_PAR_PHRASE = 10
const PHRASES_PAR_PARAGRAPHE = 4

function majuscule(mot: string): string {
  return mot.charAt(0).toLocaleUpperCase('fr') + mot.slice(1)
}

/** `n` mots sûrs à partir de `decalage`, sans ponctuation. */
export function motsSurs(n: number, decalage = 0): string[] {
  return Array.from({ length: n }, (_, i) => MOTS_SURS[(decalage + i) % MOTS_SURS.length]!)
}

/** Une phrase de exactement `n` mots : majuscule initiale, point final. */
export function phraseDeMots(n: number, decalage = 0): string {
  return `${majuscule(motsSurs(n, decalage).join(' '))}.`
}

/** Un texte de exactement `n` mots : phrases de 10 mots, un paragraphe toutes les 4 phrases. */
export function texteDeMots(n: number, decalage = 0): string {
  const phrases: string[] = []
  for (let reste = n, i = 0; reste > 0; reste -= MOTS_PAR_PHRASE, i += 1) {
    phrases.push(phraseDeMots(Math.min(MOTS_PAR_PHRASE, reste), decalage + i * MOTS_PAR_PHRASE))
  }
  const paragraphes: string[] = []
  for (let i = 0; i < phrases.length; i += PHRASES_PAR_PARAGRAPHE) {
    paragraphes.push(phrases.slice(i, i + PHRASES_PAR_PARAGRAPHE).join(' '))
  }
  return paragraphes.join('\n\n')
}

export interface ServiceProposeFixture {
  titre: string
  description: string
  type: 'rdv' | 'accompagnement' | 'atelier' | 'devis'
  dureeMin: number | null
  nbSeances: number | null
}

export interface PropositionFixture {
  accroches: string[]
  presentation: string
  services: ServiceProposeFixture[]
}

const ACCROCHE_MOTS = 12
const PRESENTATION_MOTS = 90
const DESCRIPTION_MOTS = 14

/** Proposition conforme à `schemaPropositionOnboarding` ET à la vérification des faits (aucun fait inventé). */
export function propositionValide(): PropositionFixture {
  return {
    accroches: [
      phraseDeMots(ACCROCHE_MOTS, 0),
      phraseDeMots(ACCROCHE_MOTS, 12),
      phraseDeMots(ACCROCHE_MOTS, 24),
    ],
    presentation: texteDeMots(PRESENTATION_MOTS, 5),
    services: [
      { titre: 'Premier rendez-vous', description: phraseDeMots(DESCRIPTION_MOTS, 3), type: 'rdv', dureeMin: 60, nbSeances: null },
      { titre: 'Suivi régulier', description: phraseDeMots(DESCRIPTION_MOTS, 9), type: 'accompagnement', dureeMin: 45, nbSeances: 6 },
      { titre: 'Prestation sur mesure', description: phraseDeMots(DESCRIPTION_MOTS, 17), type: 'devis', dureeMin: null, nbSeances: null },
    ],
  }
}

/** Proposition dont les accroches ont 5 mots (sortie invalide, mode « invalide » du faux fournisseur). */
export function propositionAccrochesCourtes(): PropositionFixture {
  return { ...propositionValide(), accroches: [phraseDeMots(5, 0), phraseDeMots(5, 5), phraseDeMots(5, 10)] }
}

/** Proposition valide en forme mais dont la présentation invente des faits (mode « invente »). */
export function propositionFaitsInventes(): PropositionFixture {
  const base = propositionValide()
  const faits = "Je compte 15 ans d'expérience. Je suis diplômé de l'Université de Yaoundé."
  return { ...base, presentation: `${faits} ${texteDeMots(80, 7)}` }
}

export const TEXTE_AMELIORE_DEFAUT = `${phraseDeMots(12, 2)} ${phraseDeMots(10, 14)}`

export interface EntreeOnboardingFixture {
  titre: string | null
  metier: string
  ville: string
  pays: string
}

export function libellePays(code: string): string {
  const pays = PAYS.find((p) => p.code === code)
  if (!pays) throw new Error(`Pays inconnu dans le test : ${code}`)
  return pays.label
}

export function libelleTitre(titre: Titre | null): string | null {
  return titre === null ? null : TITRE_LABELS[titre]
}

/** Identité de démonstration de la spec (§8) : (dr, Cabrel, Nguesso, « Cardiologue interventionnel », Douala, CM). */
export const IDENTITE_DEMO = {
  titre: 'dr' as Titre,
  prenom: 'Cabrel',
  nom: 'Nguesso',
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  pays: 'CM',
}

/** Entrée envoyée au fournisseur pour l'identité de démonstration : jamais le prénom ni le nom. */
export const ENTREE_ONBOARDING_DEMO: EntreeOnboardingFixture = {
  titre: 'Dr',
  metier: IDENTITE_DEMO.metier,
  ville: IDENTITE_DEMO.ville,
  pays: libellePays(IDENTITE_DEMO.pays),
}

/** Ligne de progression complète (toutes les colonnes), utilisable par les fonctions pures. */
export interface ProgressionFixture {
  userId: string
  titre: string | null
  prenom: string | null
  nom: string | null
  metier: string | null
  ville: string | null
  pays: string | null
  photoMediaId: string | null
  generationId: string | null
  accroche: string | null
  presentation: string | null
  servicesProposes: unknown
  propositionValideeLe: Date | null
  termineLe: Date | null
  createdAt: Date
  updatedAt: Date
}

const T0 = new Date('2026-11-02T10:00:00.000Z')

export function progressionVide(surcharges: Partial<ProgressionFixture> = {}): ProgressionFixture {
  return {
    userId: 'u-test',
    titre: null,
    prenom: null,
    nom: null,
    metier: null,
    ville: null,
    pays: null,
    photoMediaId: null,
    generationId: null,
    accroche: null,
    presentation: null,
    servicesProposes: null,
    propositionValideeLe: null,
    termineLe: null,
    createdAt: T0,
    updatedAt: T0,
    ...surcharges,
  }
}

export function progressionIdentite(surcharges: Partial<ProgressionFixture> = {}): ProgressionFixture {
  return progressionVide({ ...IDENTITE_DEMO, ...surcharges })
}
