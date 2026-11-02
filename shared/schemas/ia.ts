import { z } from 'zod'
import {
  ACCROCHE_MOTS_MAX,
  ACCROCHE_MOTS_MIN,
  ACCROCHES_PROPOSEES,
  AMELIORER_CHAMPS,
  AMELIORER_OBJECTIFS,
  AMELIORER_TEXTE_MIN,
  DUREES_PROPOSEES,
  PRESENTATION_MOTS_MAX,
  PRESENTATION_MOTS_MIN,
  PROMPT_MAX_TOKENS_MAX,
  PROMPT_MAX_TOKENS_MIN,
  PROMPT_TEMPERATURE_MAX,
  PROMPT_TEMPERATURE_MIN,
  SEANCES_PROPOSEES,
  SERVICES_PROPOSES,
  SERVICE_DESCRIPTION_MOTS_MAX,
  SERVICE_DESCRIPTION_MOTS_MIN,
  SERVICE_TITRE_MOTS_MAX,
  SERVICE_TYPES_PROPOSABLES,
  countWords,
} from '../ia'
import { SERVICE_DESCRIPTION_MAX, SERVICE_TITRE_MAX } from '../services'
import { ACCROCHE_MAX, BIO_MAX } from '../vitrine'

// S8 §3.4 : sorties attendues du fournisseur (validées par Zod avant tout usage) et entrées des routes IA.

/** Identifiants de schéma de sortie, stockés dans `prompts_ia.schema_sortie`. */
export const SCHEMA_SORTIE_PROPOSITION = 'proposition_onboarding_v1'
export const SCHEMA_SORTIE_TEXTE = 'texte_ameliore_v1'

function entreMots(min: number, max: number) {
  return (texte: string): boolean => {
    const mots = countWords(texte)
    return mots >= min && mots <= max
  }
}

function toutesDistinctes(valeurs: readonly string[]): boolean {
  const normalisees = valeurs.map((v) => v.trim().toLocaleLowerCase('fr'))
  return new Set(normalisees).size === normalisees.length
}

/** Cohérence type / durée / séances (mêmes règles que les services du studio). */
function verifierCoherenceService(
  service: { type: string, dureeMin: number | null, nbSeances: number | null },
  ctx: z.RefinementCtx,
): void {
  const estDevis = service.type === 'devis'
  if (estDevis !== (service.dureeMin === null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['dureeMin'],
      message: estDevis ? 'Une prestation sur devis n’a pas de durée.' : 'La durée est requise.',
    })
  }
  const estAccompagnement = service.type === 'accompagnement'
  if (estAccompagnement !== (service.nbSeances !== null)) {
    ctx.addIssue({
      code: 'custom',
      path: ['nbSeances'],
      message: estAccompagnement
        ? 'Le nombre de séances est requis pour un accompagnement.'
        : 'Seul un accompagnement a un nombre de séances.',
    })
  }
}

const champsServiceCommuns = {
  type: z.enum(SERVICE_TYPES_PROPOSABLES),
  dureeMin: z.literal(DUREES_PROPOSEES).nullable(),
  nbSeances: z.literal(SEANCES_PROPOSEES).nullable(),
}

export const schemaServicePropose = z
  .strictObject({
    titre: z
      .string()
      .trim()
      .min(1)
      .max(SERVICE_TITRE_MAX)
      .refine(entreMots(1, SERVICE_TITRE_MOTS_MAX), `Le titre d’un service tient en ${SERVICE_TITRE_MOTS_MAX} mots au plus.`),
    description: z
      .string()
      .trim()
      .max(SERVICE_DESCRIPTION_MAX)
      .refine(
        entreMots(SERVICE_DESCRIPTION_MOTS_MIN, SERVICE_DESCRIPTION_MOTS_MAX),
        `La description d’un service compte ${SERVICE_DESCRIPTION_MOTS_MIN} à ${SERVICE_DESCRIPTION_MOTS_MAX} mots.`,
      ),
    ...champsServiceCommuns,
  })
  .superRefine(verifierCoherenceService)

/** Repli : mêmes champs, limites en caractères seulement (les textes sont écrits dans le code). */
const schemaServiceRepli = z
  .strictObject({
    titre: z.string().trim().min(1).max(SERVICE_TITRE_MAX),
    description: z.string().trim().min(1).max(SERVICE_DESCRIPTION_MAX),
    ...champsServiceCommuns,
  })
  .superRefine(verifierCoherenceService)

export const schemaPropositionOnboarding = z.strictObject({
  accroches: z
    .array(
      z
        .string()
        .trim()
        .max(ACCROCHE_MAX)
        .refine(entreMots(ACCROCHE_MOTS_MIN, ACCROCHE_MOTS_MAX), `Une accroche compte ${ACCROCHE_MOTS_MIN} à ${ACCROCHE_MOTS_MAX} mots.`),
    )
    .length(ACCROCHES_PROPOSEES)
    .refine(toutesDistinctes, 'Les accroches doivent être différentes.'),
  presentation: z
    .string()
    .trim()
    .max(BIO_MAX)
    .refine(
      entreMots(PRESENTATION_MOTS_MIN, PRESENTATION_MOTS_MAX),
      `La présentation compte ${PRESENTATION_MOTS_MIN} à ${PRESENTATION_MOTS_MAX} mots.`,
    ),
  services: z
    .array(schemaServicePropose)
    .length(SERVICES_PROPOSES)
    .refine((services) => toutesDistinctes(services.map((s) => s.titre)), 'Les services doivent avoir des titres différents.'),
})

export const schemaPropositionRepli = z.strictObject({
  accroches: z.array(z.string().trim().min(1).max(ACCROCHE_MAX)).length(ACCROCHES_PROPOSEES),
  presentation: z.string().trim().min(1).max(BIO_MAX),
  services: z.array(schemaServiceRepli).length(SERVICES_PROPOSES),
})

/** Bornes propres à chaque champ (caractères, mots) : vérifiées par le service. */
export const schemaTexteAmeliore = z.strictObject({ texte: z.string().trim().min(1) })

export const schemaAmeliorerInput = z
  .strictObject({
    champ: z.enum(AMELIORER_CHAMPS),
    texte: z
      .string()
      .trim()
      .min(AMELIORER_TEXTE_MIN, 'Écrivez au moins quelques mots avant de demander une amélioration.')
      .max(BIO_MAX, `Le texte est limité à ${BIO_MAX} caractères.`),
    objectif: z.enum(AMELIORER_OBJECTIFS).default('reformuler'),
  })
  .superRefine((valeur, ctx) => {
    if (valeur.champ === 'accroche' && valeur.texte.length > ACCROCHE_MAX) {
      ctx.addIssue({
        code: 'custom',
        path: ['texte'],
        message: `L’accroche est limitée à ${ACCROCHE_MAX} caractères.`,
      })
    }
  })

/** Réglages d'un prompt (colonne `parametres`), relus à chaque chargement. */
export const schemaPromptParametres = z.strictObject({
  temperature: z.number().min(PROMPT_TEMPERATURE_MIN).max(PROMPT_TEMPERATURE_MAX),
  maxTokens: z.int().min(PROMPT_MAX_TOKENS_MIN).max(PROMPT_MAX_TOKENS_MAX),
})

/** Données du job `ia-generer` : un identifiant, rien de personnel dans Redis. */
export const schemaIaJobData = z.strictObject({ generationId: z.uuid() })

export type ServicePropose = z.infer<typeof schemaServicePropose>
export type PropositionOnboarding = z.infer<typeof schemaPropositionOnboarding>
export type TexteAmeliore = z.infer<typeof schemaTexteAmeliore>
export type AmeliorerInput = z.infer<typeof schemaAmeliorerInput>
export type PromptParametres = z.infer<typeof schemaPromptParametres>
export type IaJobData = z.infer<typeof schemaIaJobData>
