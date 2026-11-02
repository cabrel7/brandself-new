import { z } from 'zod'
import type { GenerationIa } from '../../shared/db/schema'
import type {
  AmeliorationDTO,
  GenerationDTO,
  PropositionOnboardingDTO,
  ServiceProposeBaseDTO,
} from '../../shared/dto'
import {
  AMELIORER_CHAMPS,
  GENERATION_PROGRESSION,
  GENERATION_STATUTS,
  GENERATION_STATUTS_TERMINAUX,
} from '../../shared/ia'
import type { GenerationProgression, GenerationStatut } from '../../shared/ia'
import { schemaPropositionRepli, schemaTexteAmeliore } from '../../shared/schemas/ia'
import { schemaEntreeAmelioration } from '../services/ia/entrees'

// S8 §3.5 : le DTO d'une génération ne contient JAMAIS l'entrée brute, le motif détaillé, les tokens,
// le fournisseur, le modèle, l'erreur ni le prompt. Liste blanche explicite : on ne spread jamais la ligne.

const STATUT_PAR_DEFAUT: GenerationStatut = 'en_attente'
const STATUTS_REPLI: readonly GenerationStatut[] = ['repli', 'expiree']

/** Forme d'une amélioration de repli, écrite telle quelle dans `sortie` par le service IA. */
const schemaAmeliorationStockee = z.strictObject({
  champ: z.enum(AMELIORER_CHAMPS),
  avant: z.string(),
  apres: z.string(),
  modifie: z.boolean(),
})

// Les colonnes sont du texte libre côté TypeScript (les CHECK de la base garantissent les valeurs) :
// on les rétrécit ici plutôt que de caster.
function asStatut(valeur: string): GenerationStatut {
  return GENERATION_STATUTS.find((statut) => statut === valeur) ?? STATUT_PAR_DEFAUT
}

function estTerminal(statut: GenerationStatut): boolean {
  return (GENERATION_STATUTS_TERMINAUX as readonly string[]).includes(statut)
}

function progressionDe(statut: GenerationStatut): GenerationProgression {
  if (estTerminal(statut)) return GENERATION_PROGRESSION.terminal
  return statut === 'en_cours' ? GENERATION_PROGRESSION.en_cours : GENERATION_PROGRESSION.en_attente
}

function toServiceBase(service: ServiceProposeBaseDTO): ServiceProposeBaseDTO {
  return {
    titre: service.titre,
    description: service.description,
    type: service.type,
    dureeMin: service.dureeMin,
    nbSeances: service.nbSeances,
  }
}

/** Sortie d'une inscription (IA ou repli) : la forme du repli, plus large, accepte les deux. Illisible : aucun résultat. */
function propositionDe(sortie: unknown): PropositionOnboardingDTO | null {
  const proposition = schemaPropositionRepli.safeParse(sortie)
  if (!proposition.success) return null
  return {
    accroches: [...proposition.data.accroches],
    presentation: proposition.data.presentation,
    services: proposition.data.services.map(toServiceBase),
  }
}

/**
 * Amélioration : un repli stocke déjà `{ champ, avant, apres, modifie }` ; une sortie IA stocke `{ texte }`,
 * le texte d'origine est relu dans l'entrée. Entrée purgée ou sortie illisible : aucun résultat.
 */
function ameliorationDe(ligne: GenerationIa): AmeliorationDTO | null {
  const stockee = schemaAmeliorationStockee.safeParse(ligne.sortie)
  if (stockee.success) return stockee.data
  const texte = schemaTexteAmeliore.safeParse(ligne.sortie)
  const entree = schemaEntreeAmelioration.safeParse(ligne.entree)
  if (!texte.success || !entree.success) return null
  return {
    champ: entree.data.champ,
    avant: entree.data.texte,
    apres: texte.data.texte,
    modifie: texte.data.texte !== entree.data.texte,
  }
}

export function toGenerationResource(ligne: GenerationIa): GenerationDTO {
  const statut = asStatut(ligne.statut)
  const terminal = estTerminal(statut)
  const base = {
    id: ligne.id,
    statut,
    progression: progressionDe(statut),
    repli: STATUTS_REPLI.includes(statut),
  }
  if (ligne.type === 'ameliorer_texte') {
    return { ...base, type: 'ameliorer_texte', resultat: terminal ? ameliorationDe(ligne) : null }
  }
  return { ...base, type: 'onboarding_vitrine', resultat: terminal ? propositionDe(ligne.sortie) : null }
}
