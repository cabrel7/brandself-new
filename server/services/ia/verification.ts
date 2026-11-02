import { ACCROCHE_MAX, BIO_MAX, TITRE_LABELS } from '../../../shared/vitrine'
import { PRESENTATION_MOTS_MAX, countWords } from '../../../shared/ia'
import type { IaType } from '../../../shared/ia'
import { schemaPropositionOnboarding, schemaTexteAmeliore } from '../../../shared/schemas/ia'
import type { PropositionOnboarding, TexteAmeliore } from '../../../shared/schemas/ia'

// S8 §4.5 : la sortie du fournisseur n'est jamais crue sur parole. Ordre : forme (Zod : longueurs, cohérence),
// puis faits (déterministe) : rien n'est publiable s'il n'est pas dans les données de l'utilisateur.
// Fonctions pures : aucune base, aucun réseau.

export type CodeRejetSortie = 'sortie_invalide' | 'faits_inventes'

export type ResultatValidation<T> = { ok: true, valeur: T } | { ok: false, code: CodeRejetSortie }

/** Noms propres tolérés même absents des données (la marque et le canal de contact). */
const NOMS_PROPRES_AUTORISES = ['Brandself', 'WhatsApp']

/** Faits sensibles : refusés s'ils ne figurent pas dans les sources (formes normalisées, sans accent). */
const TERMES_SENSIBLES = [
  'diplome',
  'docteur en',
  'doctorat',
  'master',
  'licence',
  'certifie',
  'agree',
  'laureat',
  'ancien',
  'membre de',
  'universite',
  'faculte',
  'ecole',
  'institut',
  'chu',
  'hopital',
  'hopitaux',
  'clinique',
  "ans d'experience",
  "annees d'experience",
  'depuis',
  'prix',
  'recompense',
  'prime',
]

const SUFFIXES_ACCORD = '(?:s|e|es|ne|nes)?'
const FRONTIERE_AVANT = '(?<![a-z0-9])'
const FRONTIERE_APRES = '(?![a-z0-9])'

const MOTIFS_SENSIBLES: readonly RegExp[] = TERMES_SENSIBLES.map(
  (terme) => new RegExp(`${FRONTIERE_AVANT}${terme.replace(/ /g, '\\s+')}${SUFFIXES_ACCORD}${FRONTIERE_APRES}`),
)

const NOMBRE_EN_LETTRES =
  '(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingts?|trente|quarante|cinquante|soixante|cents?)'
const NOMBRE_COMPOSE = `${NOMBRE_EN_LETTRES}(?:[- ](?:et[- ])?(?:${NOMBRE_EN_LETTRES}|un|une))*`
const MOTIF_QUANTITE_EN_LETTRES = new RegExp(
  `${FRONTIERE_AVANT}${NOMBRE_COMPOSE}\\s+(?:ans|annees|patients|clients)${FRONTIERE_APRES}`,
  'g',
)

const SEQUENCE_CHIFFRES = /\d+/g
const MOT = /\p{L}[\p{L}\p{M}]*/gu
const MAJUSCULE_INITIALE = /^\p{Lu}/u
const MARQUES_DIACRITIQUES = /\p{M}/gu
const OUVERTURE_DE_PHRASE = /[\s«"“'‘([\-–—*•]+$/u
const FIN_DE_PHRASE = /[.!?…:]$/u

function normaliser(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(MARQUES_DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
}

function chiffresDe(texte: string): string[] {
  return texte.match(SEQUENCE_CHIFFRES) ?? []
}

function quantitesEnLettresDe(texte: string): string[] {
  return normaliser(texte).match(MOTIF_QUANTITE_EN_LETTRES) ?? []
}

function motsDe(texte: string): string[] {
  return (texte.match(MOT) ?? []).map(normaliser)
}

/** Mots à majuscule qui ne sont ni le premier d'une ligne ni le premier d'une phrase. */
function motsMajusculesHorsDebutDePhrase(texte: string): string[] {
  const trouves: string[] = []
  for (const ligne of texte.split('\n')) {
    for (const correspondance of ligne.matchAll(MOT)) {
      const mot = correspondance[0]
      if (!MAJUSCULE_INITIALE.test(mot)) continue
      const avant = ligne.slice(0, correspondance.index).replace(OUVERTURE_DE_PHRASE, '')
      if (avant === '' || FIN_DE_PHRASE.test(avant)) continue
      trouves.push(normaliser(mot))
    }
  }
  return trouves
}

/**
 * Vrai si aucun fait n'est inventé : tout nombre, tout fait sensible et tout nom propre des `textes`
 * figure dans les `sources` (valeurs de l'entrée, texte d'origine) ou dans la liste blanche.
 */
export function verifierFaits(textes: readonly string[], sources: readonly string[]): boolean {
  const sourcesNormalisees = sources.map(normaliser).join('\n')

  const chiffresSources = new Set(sources.flatMap(chiffresDe))
  const quantitesSources = new Set(sources.flatMap(quantitesEnLettresDe))
  const motsSources = new Set([
    ...sources.flatMap(motsDe),
    ...NOMS_PROPRES_AUTORISES.flatMap(motsDe),
    ...Object.values(TITRE_LABELS).flatMap(motsDe),
  ])

  for (const texte of textes) {
    // (a) nombres, en chiffres ou en lettres devant « ans », « patients »...
    if (chiffresDe(texte).some((nombre) => !chiffresSources.has(nombre))) return false
    if (quantitesEnLettresDe(texte).some((quantite) => !quantitesSources.has(quantite))) return false
    // (b) faits sensibles (diplôme, établissement, ancienneté...).
    const normalise = normaliser(texte)
    if (MOTIFS_SENSIBLES.some((motif) => motif.test(normalise) && !motif.test(sourcesNormalisees))) return false
    // (c) noms propres (lieux, personnes) absents des données.
    if (motsMajusculesHorsDebutDePhrase(texte).some((mot) => !motsSources.has(mot))) return false
  }
  return true
}

/** Toutes les valeurs texte de l'entrée (à toute profondeur) : les seules sources de faits autorisées. */
function sourcesDe(valeur: unknown): string[] {
  if (typeof valeur === 'string') return [valeur]
  if (Array.isArray(valeur)) return valeur.flatMap(sourcesDe)
  if (valeur !== null && typeof valeur === 'object') return Object.values(valeur).flatMap(sourcesDe)
  return []
}

/** Adresses web et e-mails : jetons entiers (jusqu'à l'espace), comparés aux sources. */
const JETON_LIEN = /(?:https?:|www\.)\S*|\S*@\S*/giu
const PONCTUATION_FINALE = /[.,;:!?)»"'’\]]+$/u
/** Chevrons HTML et lien markdown `](` : interdits sauf s'ils figurent déjà dans les sources. */
const MARQUEURS_MARKUP: readonly RegExp[] = [/[<>]/u, /\]\(/u]

/**
 * Vrai si les textes contiennent une URL, un e-mail, un chevron HTML ou un lien markdown ABSENT des sources
 * (ce que l'utilisateur a écrit lui-même reste autorisé). Un texte publié sur une vitrine ne doit jamais
 * porter un lien ou une balise inventés par le modèle (hameçonnage, injection de markup).
 */
export function contientLienOuMarkupInvente(textes: readonly string[], sources: readonly string[]): boolean {
  const sourcesBrutes = sources.join('\n').toLowerCase()
  return textes.some((texte) => {
    const jetons = texte.match(JETON_LIEN) ?? []
    if (jetons.some((jeton) => !sourcesBrutes.includes(jeton.replace(PONCTUATION_FINALE, '').toLowerCase()))) return true
    return MARQUEURS_MARKUP.some((marqueur) => marqueur.test(texte) && !sources.some((source) => marqueur.test(source)))
  })
}

function champDe(entree: object): 'bio' | 'accroche' {
  return 'champ' in entree && entree.champ === 'accroche' ? 'accroche' : 'bio'
}

function validerProposition(donnees: unknown, entree: object): ResultatValidation<PropositionOnboarding> {
  const forme = schemaPropositionOnboarding.safeParse(donnees)
  if (!forme.success) return { ok: false, code: 'sortie_invalide' }
  const proposition = forme.data
  const textes = [
    ...proposition.accroches,
    proposition.presentation,
    ...proposition.services.flatMap((service) => [service.titre, service.description]),
  ]
  const sources = sourcesDe(entree)
  if (contientLienOuMarkupInvente(textes, sources)) return { ok: false, code: 'sortie_invalide' }
  if (!verifierFaits(textes, sources)) return { ok: false, code: 'faits_inventes' }
  return { ok: true, valeur: proposition }
}

function validerTexte(donnees: unknown, entree: object): ResultatValidation<TexteAmeliore> {
  const forme = schemaTexteAmeliore.safeParse(donnees)
  if (!forme.success) return { ok: false, code: 'sortie_invalide' }
  const { texte } = forme.data
  const dansLesBornes =
    champDe(entree) === 'accroche'
      ? texte.length <= ACCROCHE_MAX
      : texte.length <= BIO_MAX && countWords(texte) <= PRESENTATION_MOTS_MAX
  if (!dansLesBornes) return { ok: false, code: 'sortie_invalide' }
  const sources = sourcesDe(entree)
  if (contientLienOuMarkupInvente([texte], sources)) return { ok: false, code: 'sortie_invalide' }
  if (!verifierFaits([texte], sources)) return { ok: false, code: 'faits_inventes' }
  return { ok: true, valeur: forme.data }
}

export function validerSortie(
  type: 'onboarding_vitrine',
  donnees: unknown,
  entree: object,
): ResultatValidation<PropositionOnboarding>
export function validerSortie(type: 'ameliorer_texte', donnees: unknown, entree: object): ResultatValidation<TexteAmeliore>
export function validerSortie(
  type: IaType,
  donnees: unknown,
  entree: object,
): ResultatValidation<PropositionOnboarding | TexteAmeliore>
export function validerSortie(
  type: IaType,
  donnees: unknown,
  entree: object,
): ResultatValidation<PropositionOnboarding | TexteAmeliore> {
  return type === 'onboarding_vitrine' ? validerProposition(donnees, entree) : validerTexte(donnees, entree)
}
