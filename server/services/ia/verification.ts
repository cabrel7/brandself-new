import { ACCROCHE_MAX, BIO_MAX, TITRE_LABELS } from '../../../shared/vitrine'
import { MARQUE } from '../../../shared/brand'
import { PRESENTATION_MOTS_MAX, countWords } from '../../../shared/ia'
import type { IaType } from '../../../shared/ia'
import { schemaPropositionOnboarding, schemaSeoIa, schemaTexteAmeliore } from '../../../shared/schemas/ia'
import type { PropositionOnboarding, SeoIa, TexteAmeliore } from '../../../shared/schemas/ia'

// S8 §4.5 : la sortie du fournisseur n'est jamais crue sur parole. Ordre : forme (Zod : longueurs, cohérence),
// puis faits (déterministe) : rien n'est publiable s'il n'est pas dans les données de l'utilisateur.
// Décision #24 : accents, ville et formulations interdites s'ajoutent pour le SEO.
// Fonctions pures : aucune base, aucun réseau.

export type CodeRejetSortie = 'sortie_invalide' | 'faits_inventes' | 'accents_manquants' | 'formulation_interdite'

export type ResultatValidation<T> =
  | {
    ok: true
    valeur: T
    /** Proposition d'onboarding gardée SANS son bloc « seo » parce qu'il était invalide (le code dit pourquoi). */
    seoRejete?: CodeRejetSortie
  }
  | { ok: false, code: CodeRejetSortie }

/** Noms propres tolérés même absents des données (la marque et le canal de contact). */
const NOMS_PROPRES_AUTORISES = [MARQUE.nom, 'WhatsApp']

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

// ---------------------------------------------------------------------------------------------
// Décision #24 : formulations interdites et accents
// ---------------------------------------------------------------------------------------------

/**
 * Superlatifs, promesses de résultat et allégations de santé, en forme normalisée (minuscules, sans accent).
 * Frontières de mot : « Premier rendez-vous » et « soins dentaires » ne sont jamais signalés.
 */
const MOTIFS_FORMULATION_INTERDITE: readonly RegExp[] = [
  /(?<![a-z0-9])meilleur(?:e|s|es)?(?![a-z0-9])/,
  /(?<![a-z0-9])n\s*°\s*1(?![a-z0-9])/,
  /(?<![a-z0-9])numero\s+(?:1|un)(?![a-z0-9])/,
  /(?<![a-z0-9])(?:exceptionnel|incomparable|imbattable)(?:le|s|les)?(?![a-z0-9])/,
  /(?<![a-z0-9])garant(?:i|ie|is|ies|ir|it|issons|issez|ira)(?![a-z0-9])/,
  /(?<![a-z0-9])100\s*%/,
  /(?<![a-z0-9])gueri(?:r|rez|ra|son|sons|t|s|e|es)(?![a-z0-9])/,
  /(?<![a-z0-9])miracle(?:s)?(?![a-z0-9])/,
  /(?<![a-z0-9])miraculeu(?:x|se|ses)(?![a-z0-9])/,
  /(?<![a-z0-9])sans\s+(?:aucun\s+)?effets?\s+secondaires?(?![a-z0-9])/,
]
const POINT_EXCLAMATION = /!/
const EMOJI = /\p{Extended_Pictographic}/u

/** Vrai si le texte contient un superlatif, une promesse, une allégation de santé, un « ! » ou un emoji. */
export function contientFormulationInterdite(texte: string): boolean {
  if (POINT_EXCLAMATION.test(texte) || EMOJI.test(texte)) return true
  const normalise = normaliser(texte)
  return MOTIFS_FORMULATION_INTERDITE.some((motif) => motif.test(normalise))
}

/**
 * Mots français qui s'écrivent TOUJOURS avec un accent (ou une ligature) : écrits sans, c'est un texte qui a perdu
 * ses accents. Liste volontairement courte et sûre : aucun mot dont la forme sans accent existe en français
 * (« a », « ou », « la », « cote »…), pour ne jamais signaler un texte correct.
 */
const MOTS_TOUJOURS_ACCENTUES: readonly string[] = [
  'écoute', 'écouter', 'écoutons', 'clarté', 'santé', 'régulier', 'régulière', 'régulièrement', 'adaptée',
  'adaptées', 'accompagnée', 'échange', 'échanges', 'échanger', 'étape', 'étapes',
  'expérience', 'expériences', 'première', 'premières', 'séance', 'séances', 'intérêt', 'être', 'très', 'après',
  'déjà', 'même', 'également', 'nécessaire', 'nécessaires', 'difficulté', 'difficultés', 'qualité', 'sérénité',
  'sécurité', 'confidentialité', 'disponibilité', 'thérapie', 'thérapies', 'thérapeute', 'médecin', 'médical',
  'médicale', 'médicaux', 'cœur', 'pédiatre', 'kinésithérapeute', 'ostéopathe', 'spécialiste', 'spécialistes',
  'spécialisé', 'spécialisée', 'généraliste', 'général', 'générale', 'réel', 'réelle', 'résultat', 'résultats',
  'réponse', 'réponses', 'prévention', 'préparer', 'préparation', 'présentation', 'présence', 'précis',
  'précise', 'précieux', 'équilibre', 'équipe', 'éducation', 'élaborer', 'énergie', 'évaluation', 'évaluer',
  'évolution', 'créer', 'créé', 'créée', 'développer', 'développement', 'dépendance', 'décision', 'décisions',
  'défis', 'défi', 'délai', 'délais', 'détail', 'détails', 'détendu', 'détente', 'étudiant', 'étudiants', 'théorie',
]
const MARQUES_ACCENTS = /\p{M}/gu
/** Longueur minimale d'un mot de l'utilisateur pour exiger son accent (« à », « où », « là » sont ambigus). */
const LONGUEUR_MIN_MOT_SOURCE = 4

/** Mot sans accent, ligatures dépliées, en minuscules. */
function sansAccent(mot: string): string {
  return mot.normalize('NFD').replace(MARQUES_ACCENTS, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').toLowerCase()
}

function motsMinuscules(texte: string): string[] {
  return (texte.normalize('NFC').match(MOT) ?? []).map((mot) => mot.toLocaleLowerCase('fr'))
}

const MOTS_ACCENTUES_PAR_FORME_PLATE: ReadonlySet<string> = new Set(MOTS_TOUJOURS_ACCENTUES.map(sansAccent))

/**
 * Vrai si un des `textes` a perdu des accents : (a) il écrit sans accent un mot accentué des `sources` (« Yaounde » pour
 * « Yaoundé »), ou (b) il contient un mot de MOTS_TOUJOURS_ACCENTUES sans son accent (« ecoute », « coeur »). Un mot
 * écrit tel quel dans les sources n'est jamais signalé. Aucun texte, aucune faute.
 */
export function accentsManquants(textes: readonly string[], sources: readonly string[]): boolean {
  const motsSources = sources.flatMap(motsMinuscules)
  const ecritsDansSources = new Set(motsSources)
  const formesPlatesSources = new Set(
    motsSources.filter((mot) => mot.length >= LONGUEUR_MIN_MOT_SOURCE && sansAccent(mot) !== mot).map(sansAccent),
  )
  return textes.some((texte) =>
    motsMinuscules(texte).some((mot) => {
      if (ecritsDansSources.has(mot) || sansAccent(mot) !== mot) return false
      return formesPlatesSources.has(mot) || MOTS_ACCENTUES_PAR_FORME_PLATE.has(mot)
    }),
  )
}

/** Ville de l'entrée (vide si l'entrée n'en a pas) : le SEO doit la citer dans le titre ET la description. */
function villeDe(entree: object): string {
  return 'ville' in entree && typeof entree.ville === 'string' ? entree.ville : ''
}

function minusculesNfc(texte: string): string {
  return texte.normalize('NFC').toLocaleLowerCase('fr').replace(/\s+/g, ' ')
}

/**
 * Valide un bloc SEO. Ordre : forme (Zod, bornes après rognage) → accents → ville citée dans le titre ET la
 * description (casse et espaces ignorés, accents respectés) → lien/balise inventés → faits inventés →
 * formulations interdites. Rien n'est réécrit : la valeur rendue est celle que Zod a rognée.
 */
export function validerSeo(donnees: unknown, entree: object): ResultatValidation<SeoIa> {
  const forme = schemaSeoIa.safeParse(donnees)
  if (!forme.success) return { ok: false, code: 'sortie_invalide' }
  const seo = forme.data
  const textes = [seo.titre, seo.description]
  const sources = sourcesDe(entree)
  if (accentsManquants(textes, sources)) return { ok: false, code: 'accents_manquants' }
  const ville = minusculesNfc(villeDe(entree).trim())
  if (ville !== '' && !textes.every((texte) => minusculesNfc(texte).includes(ville))) return { ok: false, code: 'sortie_invalide' }
  if (contientLienOuMarkupInvente(textes, sources)) return { ok: false, code: 'sortie_invalide' }
  if (!verifierFaits(textes, sources)) return { ok: false, code: 'faits_inventes' }
  if (textes.some(contientFormulationInterdite)) return { ok: false, code: 'formulation_interdite' }
  return { ok: true, valeur: seo }
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
  // Accents d'abord : un texte qui a perdu ses accents est refusé (puis réessayé) avant toute autre analyse.
  if (accentsManquants(textes, sources)) return { ok: false, code: 'accents_manquants' }
  if (contientLienOuMarkupInvente(textes, sources)) return { ok: false, code: 'sortie_invalide' }
  if (!verifierFaits(textes, sources)) return { ok: false, code: 'faits_inventes' }
  return avecSeoValide(proposition, entree)
}

/**
 * Le bloc « seo » (décision #24) est validé À PART : invalide, il est retiré et la proposition est gardée telle
 * quelle (un seul appel, pas de nouvel essai). Absent (génération v1), il n'y a rien à faire.
 */
function avecSeoValide(proposition: PropositionOnboarding, entree: object): ResultatValidation<PropositionOnboarding> {
  const { seo, ...sansSeo } = proposition
  if (seo === undefined) return { ok: true, valeur: sansSeo }
  const verdict = validerSeo(seo, entree)
  if (verdict.ok) return { ok: true, valeur: { ...sansSeo, seo: verdict.valeur } }
  return { ok: true, valeur: sansSeo, seoRejete: verdict.code }
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
export function validerSortie(type: 'seo_vitrine', donnees: unknown, entree: object): ResultatValidation<SeoIa>
export function validerSortie(
  type: IaType,
  donnees: unknown,
  entree: object,
): ResultatValidation<PropositionOnboarding | TexteAmeliore | SeoIa>
export function validerSortie(
  type: IaType,
  donnees: unknown,
  entree: object,
): ResultatValidation<PropositionOnboarding | TexteAmeliore | SeoIa> {
  if (type === 'onboarding_vitrine') return validerProposition(donnees, entree)
  return type === 'seo_vitrine' ? validerSeo(donnees, entree) : validerTexte(donnees, entree)
}
