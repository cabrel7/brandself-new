import { plateformeDepuisUrl } from '../../shared/liens'
import type { LienType } from '../../shared/liens'
import type { LienPublicCarteDTO, LienStudioDTO, LiensCompteursDTO } from '../../shared/dto/lien'
import type { LienRow, LiensCompteurs } from '../services/liens'
import { getCurrentWeekClicks } from '../services/liens-regles'

export function toLienStudioResource(row: LienRow): LienStudioDTO {
  return {
    id: row.id,
    slug: row.slug,
    libelle: row.libelle,
    url: row.url,
    type: row.type as LienType,
    plateforme: row.type === 'reseau' ? plateformeDepuisUrl(row.url) : null,
    actif: row.actif,
    ordre: row.ordre,
    clics: row.clics,
    clicsSemaine: getCurrentWeekClicks(row),
    creeLe: row.createdAt.toISOString(),
    modifieLe: row.updatedAt.toISOString(),
  }
}

export function toLiensCompteursResource(compteurs: LiensCompteurs): LiensCompteursDTO {
  return {
    total: compteurs.total,
    visibles: compteurs.visibles,
    clicsSemaine: compteurs.clicsSemaine,
  }
}

/** Liste blanche publique : jamais id interne, vitrineId, ordre, actif, dates. */
export function toLienPublicCarteResource(row: LienRow): LienPublicCarteDTO {
  const type = row.type as LienType
  return {
    slug: row.slug,
    libelle: row.libelle,
    url: row.url,
    type,
    // Le pied de vitrine affiche l'icône du réseau : déduite de l'URL (cohérence imposée à l'écriture).
    plateforme: type === 'reseau' ? plateformeDepuisUrl(row.url) : null,
  }
}
