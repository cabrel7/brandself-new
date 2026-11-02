import { createHash } from 'node:crypto'
import type { ProgressionInscription } from '../../../shared/db/schema'
import type { AmeliorerInput } from '../../../shared/schemas/ia'
import { ACCROCHE_MAX, BIO_MAX, METIER_MAX, PAYS, TITRE_LABELS, VILLE_MAX } from '../../../shared/vitrine'
import type { Titre } from '../../../shared/vitrine'
import type { EntreeAmelioration, EntreeOnboarding } from './entrees'

// S8 §4.3 : nettoyage de l'entrée, détection d'injection, minimisation et empreinte. Fonctions pures :
// aucune base, aucun réseau. Le nettoyage ne réécrit jamais un texte suspect (la détection est une étape
// distincte : si une injection est suspectée, le fournisseur n'est pas appelé).

export interface OptionsNettoyage {
  max: number
  multiligne: boolean
}

/** Caractères de largeur nulle et marques bidirectionnelles (U+200B à U+200F, U+202A à U+202E, U+2066 à U+2069, U+FEFF). */
const INVISIBLES = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g
const CARACTERES_CONTROLE = /\p{Cc}/gu
const SAUT_DE_LIGNE = '\n'
const TABULATION = '\t'
const ESPACES_HORS_SAUT = /[^\S\n]+/g
const SAUTS_EXCESSIFS = /\n{3,}/g
const MARQUES_DIACRITIQUES = /\p{M}/gu

function retirerInvisibles(texte: string): string {
  return texte
    .replace(/\r\n?/g, SAUT_DE_LIGNE)
    .replace(INVISIBLES, '')
    .replace(CARACTERES_CONTROLE, (c) => {
      if (c === SAUT_DE_LIGNE) return c
      return c === TABULATION ? ' ' : ''
    })
}

export function nettoyerTexte(valeur: string | null | undefined, { max, multiligne }: OptionsNettoyage): string {
  let texte = retirerInvisibles(valeur ?? '').normalize('NFC')
  if (!multiligne) texte = texte.replace(/\n/g, ' ')
  texte = texte
    .replace(ESPACES_HORS_SAUT, ' ')
    .split(SAUT_DE_LIGNE)
    .map((ligne) => ligne.trim())
    .join(SAUT_DE_LIGNE)
    .replace(SAUTS_EXCESSIFS, '\n\n')
    .trim()
  // Troncature par caractère (point de code) : jamais de demi-paire de substitution.
  const caracteres = [...texte]
  return caracteres.length > max ? caracteres.slice(0, max).join('').trimEnd() : texte
}

const MOTIFS_INJECTION: readonly RegExp[] = [
  /\bignore[rz]? (?:tes|vos|les|toutes? les|ces) (?:instructions|consignes|regles)/,
  /\bignore (?:all |the )?(?:previous|above|prior) (?:instructions|prompts?)/,
  /\boublie[rz]? (?:tes|vos|toutes?) (?:instructions|consignes|regles)/,
  /\b(?:tu es|vous etes) (?:maintenant|desormais)/,
  /\byou are now\b/,
  /\bact as\b/,
  /\bjailbreak/,
  /\bdan\b mode/,
  /\b(?:revele|affiche|donne|repete)[a-z]*(?:-moi)? (?:ton|le|votre|tes) (?:prompt|instructions|consignes)/,
  /\bsystem prompt/,
  /<\s*\/?\s*(?:system|assistant|user|donnees)\s*>/,
  /\brole\s*:\s*system/,
  /```/,
]

function normaliserPourDetection(texte: string): string {
  // NFKC d'abord : plie les formes de compatibilité (pleine chasse « ｉｇｎｏｒｅ », ligatures) vers l'ASCII.
  return retirerInvisibles(texte)
    .normalize('NFKC')
    .normalize('NFD')
    .replace(MARQUES_DIACRITIQUES, '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** Vrai si le texte ressemble à une consigne adressée au modèle (forme normalisée : minuscules, sans accents). */
export function detecterInjection(texte: string): boolean {
  const normalise = normaliserPourDetection(texte)
  return normalise !== '' && MOTIFS_INJECTION.some((motif) => motif.test(normalise))
}

function canonique(valeur: unknown): unknown {
  if (Array.isArray(valeur)) return valeur.map(canonique)
  if (valeur !== null && typeof valeur === 'object') {
    return Object.fromEntries(
      Object.entries(valeur)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([cle, v]) => [cle, canonique(v)]),
    )
  }
  return valeur
}

/** sha256 hex du JSON canonique (clés triées à toute profondeur) de l'entrée et de l'identifiant du prompt. */
export function empreinte(entree: object, promptId: string): string {
  return createHash('sha256')
    .update(JSON.stringify(canonique({ entree, prompt: promptId })))
    .digest('hex')
}

export function libelleTitre(titre: string | null): string | null {
  if (titre === null) return null
  return Object.hasOwn(TITRE_LABELS, titre) ? TITRE_LABELS[titre as Titre] : null
}

export function libellePays(code: string | null): string | null {
  if (code === null) return null
  return PAYS.find((pays) => pays.code === code)?.label ?? code
}

/** Données envoyées pour l'inscription : titre, métier, ville, pays (libellés). Jamais le prénom ni le nom. */
export function entreeOnboarding(
  progression: Pick<ProgressionInscription, 'titre' | 'metier' | 'ville' | 'pays'>,
): EntreeOnboarding {
  return {
    titre: libelleTitre(progression.titre),
    metier: nettoyerTexte(progression.metier, { max: METIER_MAX, multiligne: false }),
    ville: nettoyerTexte(progression.ville, { max: VILLE_MAX, multiligne: false }),
    pays: libellePays(progression.pays) ?? '',
  }
}

export interface VitrineContexte {
  titre: string | null
  metier: string | null
  ville: string | null
  pays: string | null
}

/** Données envoyées pour l'amélioration d'un texte : le texte et un contexte minimal (jamais l'identité). */
export function entreeAmelioration(
  input: Pick<AmeliorerInput, 'champ' | 'texte' | 'objectif'>,
  vitrine: VitrineContexte,
): EntreeAmelioration {
  const estBio = input.champ === 'bio'
  return {
    champ: input.champ,
    objectif: input.objectif,
    texte: nettoyerTexte(input.texte, { max: estBio ? BIO_MAX : ACCROCHE_MAX, multiligne: estBio }),
    contexte: {
      titre: libelleTitre(vitrine.titre),
      metier: vitrine.metier === null ? null : nettoyerTexte(vitrine.metier, { max: METIER_MAX, multiligne: false }),
      ville: vitrine.ville === null ? null : nettoyerTexte(vitrine.ville, { max: VILLE_MAX, multiligne: false }),
      pays: libellePays(vitrine.pays),
    },
  }
}
