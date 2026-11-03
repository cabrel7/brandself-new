import type {
  RealisationPublicCarteDTO,
  RealisationPublicDetailDTO,
  RealisationStudioDTO,
  RealisationsCompteursDTO,
} from '../../shared/dto'
import { displayName } from '../../shared/vitrine'
import type { MediaRow } from '../services/medias'
import type { CompteursAvecPlan } from '../services/plan-visibilite'
import type { RealisationRow, RealisationStudioRow } from '../services/realisations'
import type { VitrineRow } from '../services/vitrines'
import { toMediaResource } from './media'
import { truncateForSeo } from './seo'
import { asTitre } from './vitrine'

const ESPACES = /\s+/g

/** `galerie` arrive déjà dans l'ordre d'affichage : la ressource ne la retrie jamais. */
export function toRealisationStudioResource(
  row: RealisationStudioRow,
  image: MediaRow | null,
  galerie: readonly MediaRow[],
): RealisationStudioDTO {
  return {
    id: row.id,
    slug: row.slug,
    titre: row.titre,
    description: row.description,
    image: image ? toMediaResource(image) : null,
    galerie: galerie.map(toMediaResource),
    annee: row.annee,
    lieu: row.lieu,
    role: row.role,
    lien: row.lien,
    enVedette: row.enVedette,
    actif: row.actif,
    masqueParPlan: row.masqueParPlan,
    ordre: row.ordre,
    creeLe: row.createdAt.toISOString(),
    modifieLe: row.updatedAt.toISOString(),
  }
}

export function toRealisationsCompteursResource(compteurs: CompteursAvecPlan): RealisationsCompteursDTO {
  return {
    total: compteurs.total,
    visibles: compteurs.visibles,
    enVedette: compteurs.enVedette,
    vedetteMax: compteurs.vedetteMax,
    limitePlan: { ...compteurs.limitePlan },
  }
}

/** Carte publique : liste blanche explicite (ni id, ni ordre, ni vedette, ni visibilité, ni dates). */
export function toRealisationPublicCarteResource(row: RealisationRow, image: MediaRow | null): RealisationPublicCarteDTO {
  return {
    slug: row.slug,
    titre: row.titre,
    description: row.description,
    image: image ? toMediaResource(image) : null,
    annee: row.annee,
    lieu: row.lieu,
  }
}

/** Détail public : la carte plus rôle, lien, galerie et SEO. Ne renvoie rien de la vitrine hors le nom affiché. */
export function toRealisationPublicDetailResource(
  row: RealisationRow,
  image: MediaRow | null,
  galerie: readonly MediaRow[],
  vitrine: VitrineRow,
): RealisationPublicDetailDTO {
  const nomAffiche = displayName(asTitre(vitrine.titre), vitrine.prenom, vitrine.nom)
  const description = (row.description ?? '').replace(ESPACES, ' ').trim()
  return {
    ...toRealisationPublicCarteResource(row, image),
    role: row.role,
    lien: row.lien,
    galerie: galerie.map(toMediaResource),
    seo: {
      titre: `${row.titre} — ${nomAffiche}`,
      description:
        description === ''
          ? `${row.titre}, une réalisation de ${nomAffiche}, ${vitrine.metier}${vitrine.ville ? ` à ${vitrine.ville}` : ''}.`
          : truncateForSeo(description),
    },
  }
}
