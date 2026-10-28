import type { TemoignagePublicCarteDTO, TemoignageStudioDTO, TemoignagesCompteursDTO } from '../../shared/dto'
import type { Compteurs } from '../services/listes-regles'
import type { TemoignageRow } from '../services/temoignages'

export function toTemoignageStudioResource(row: TemoignageRow): TemoignageStudioDTO {
  return {
    id: row.id,
    slug: row.slug,
    auteur: row.auteur,
    fonction: row.fonction,
    texte: row.texte,
    enVedette: row.enVedette,
    actif: row.actif,
    ordre: row.ordre,
    creeLe: row.createdAt.toISOString(),
    modifieLe: row.updatedAt.toISOString(),
  }
}

export function toTemoignagesCompteursResource(compteurs: Compteurs): TemoignagesCompteursDTO {
  return {
    total: compteurs.total,
    visibles: compteurs.visibles,
    enVedette: compteurs.enVedette,
    vedetteMax: compteurs.vedetteMax,
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
