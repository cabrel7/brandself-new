import { DEVISES } from '../../shared/compte'
import type { Devise } from '../../shared/compte'
import type {
  ServicePublicCarteDTO,
  ServicePublicDetailDTO,
  ServiceStudioDTO,
  ServicesCompteursDTO,
} from '../../shared/dto'
import { PAIEMENT_MODES, RYTHMES, SERVICE_TYPES, TARIFS } from '../../shared/services'
import type { PaiementMode, Rythme, ServiceType, Tarif } from '../../shared/services'
import { displayName } from '../../shared/vitrine'
import type { MediaRow } from '../services/medias'
import type { CompteursAvecPlan } from '../services/plan-visibilite'
import type { ServiceRow, ServiceStudioRow } from '../services/services'
import type { VitrineRow } from '../services/vitrines'
import { toMediaResource } from './media'
import { truncateForSeo } from './seo'
import { asTitre } from './vitrine'

const ESPACES = /\s+/g
const MODE_HORS_LIGNE: PaiementMode = 'sur_place'
const TYPE_PAR_DEFAUT: ServiceType = 'rdv'
const TARIF_PAR_DEFAUT: Tarif = 'gratuit'

export interface OptionsResource {
  paiementEnLigne: boolean
}

// Les colonnes sont du texte libre côté TypeScript (les CHECK de la base garantissent les valeurs) :
// on les rétrécit ici plutôt que de caster.
function asServiceType(value: string): ServiceType {
  return SERVICE_TYPES.find((type) => type === value) ?? TYPE_PAR_DEFAUT
}

function asTarif(value: string): Tarif {
  return TARIFS.find((tarif) => tarif === value) ?? TARIF_PAR_DEFAUT
}

function asRythme(value: string | null): Rythme | null {
  return RYTHMES.find((rythme) => rythme === value) ?? null
}

function asPaiementMode(value: string | null): PaiementMode | null {
  return PAIEMENT_MODES.find((mode) => mode === value) ?? null
}

function asDevise(value: string | null): Devise | null {
  return DEVISES.find((devise) => devise === value) ?? null
}

/** Mode de règlement effectif : tant que le paiement en ligne est coupé, tout mode non nul devient « sur place ». */
function effectivePaiementMode(value: string | null, { paiementEnLigne }: OptionsResource): PaiementMode | null {
  const mode = asPaiementMode(value)
  if (mode === null) return null
  return paiementEnLigne ? mode : MODE_HORS_LIGNE
}

export function toServiceStudioResource(row: ServiceStudioRow, image: MediaRow | null): ServiceStudioDTO {
  return {
    id: row.id,
    slug: row.slug,
    titre: row.titre,
    description: row.description,
    image: image ? toMediaResource(image) : null,
    type: asServiceType(row.type),
    nbSeances: row.nbSeances,
    rythme: asRythme(row.rythme),
    dureeMin: row.dureeMin,
    tarif: asTarif(row.tarif),
    prixMontant: row.prixMontant,
    prixDevise: asDevise(row.prixDevise),
    paiementMode: asPaiementMode(row.paiementMode),
    paiementInstructions: row.paiementInstructions,
    inclus: [...row.inclus],
    reservable: row.reservable,
    enVedette: row.enVedette,
    actif: row.actif,
    masqueParPlan: row.masqueParPlan,
    ordre: row.ordre,
    creeLe: row.createdAt.toISOString(),
    modifieLe: row.updatedAt.toISOString(),
  }
}

export function toServicesCompteursResource(compteurs: CompteursAvecPlan): ServicesCompteursDTO {
  return {
    total: compteurs.total,
    visibles: compteurs.visibles,
    enVedette: compteurs.enVedette,
    vedetteMax: compteurs.vedetteMax,
    limitePlan: { ...compteurs.limitePlan },
  }
}

/** Carte publique : liste blanche explicite (ni id, ni ordre, ni vedette, ni visibilité, ni dates). */
export function toServicePublicCarteResource(row: ServiceRow, image: MediaRow | null): ServicePublicCarteDTO {
  return {
    slug: row.slug,
    titre: row.titre,
    description: row.description,
    image: image ? toMediaResource(image) : null,
    type: asServiceType(row.type),
    nbSeances: row.nbSeances,
    rythme: asRythme(row.rythme),
    dureeMin: row.dureeMin,
    tarif: asTarif(row.tarif),
    prixMontant: row.prixMontant,
    prixDevise: asDevise(row.prixDevise),
    reservable: row.reservable,
  }
}

/** Détail public : la carte plus règlement, programme et SEO. Ne renvoie rien de la vitrine hors le nom affiché. */
export function toServicePublicDetailResource(
  row: ServiceRow,
  image: MediaRow | null,
  vitrine: VitrineRow,
  options: OptionsResource,
): ServicePublicDetailDTO {
  const nomAffiche = displayName(asTitre(vitrine.titre), vitrine.prenom, vitrine.nom)
  const description = (row.description ?? '').replace(ESPACES, ' ').trim()
  return {
    ...toServicePublicCarteResource(row, image),
    paiementMode: effectivePaiementMode(row.paiementMode, options),
    paiementInstructions: row.paiementInstructions,
    inclus: [...row.inclus],
    seo: {
      titre: `${row.titre} — ${nomAffiche}`,
      description:
        description === ''
          ? `${row.titre} avec ${nomAffiche}, ${vitrine.metier}${vitrine.ville ? ` à ${vitrine.ville}` : ''}.`
          : truncateForSeo(description),
    },
  }
}
