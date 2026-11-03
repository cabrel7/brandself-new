import type { TemoignagePublicCarteDTO, TemoignageStudioDTO, TemoignagesCompteursDTO } from '../../shared/dto'
import type { CompteursAvecPlan } from '../services/plan-visibilite'
import type { TemoignageRow, TemoignageStudioRow } from '../services/temoignages'

export function toTemoignageStudioResource(row: TemoignageStudioRow): TemoignageStudioDTO {
  return {
    id: row.id,
    slug: row.slug,
    auteur: row.auteur,
    fonction: row.fonction,
    texte: row.texte,
    enVedette: row.enVedette,
    actif: row.actif,
    masqueParPlan: row.masqueParPlan,
    ordre: row.ordre,
    creeLe: row.createdAt.toISOString(),
    modifieLe: row.updatedAt.toISOString(),
  }
}

export function toTemoignagesCompteursResource(compteurs: CompteursAvecPlan): TemoignagesCompteursDTO {
  return {
    total: compteurs.total,
    visibles: compteurs.visibles,
    enVedette: compteurs.enVedette,
    vedetteMax: compteurs.vedetteMax,
    limitePlan: { ...compteurs.limitePlan },
  }
}

/** Liste blanche publique : jamais id, vitrineId, ordre, actif, enVedette, dates. */
export function toTemoignagePublicCarteResource(row: TemoignageRow): TemoignagePublicCarteDTO {
  return {
    slug: row.slug,
    auteur: row.auteur,
    fonction: row.fonction,
    texte: row.texte,
  }
}
