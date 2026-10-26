import type { StudioResumeDTO, VitrinePubliqueDTO, VitrineStudioDTO } from '../../shared/dto'
import { PALETTES, DEFAULT_PALETTE } from '../../shared/palettes'
import type { Palette } from '../../shared/palettes'
import { PAYS, TITRES, displayName } from '../../shared/vitrine'
import type { Titre } from '../../shared/vitrine'
import type { StudioSummary, VitrineAvecPhoto } from '../services/vitrines'
import { toMediaResource } from './media'

// Les colonnes sont du texte libre côté TypeScript (les CHECK de la base garantissent les valeurs) :
// on les rétrécit ici plutôt que de caster.
function asTitre(value: string | null): Titre | null {
  return TITRES.find((titre) => titre === value) ?? null
}

function asPalette(value: string): Palette {
  return PALETTES.find((palette) => palette === value) ?? DEFAULT_PALETTE
}

export function toVitrineStudioResource({ vitrine, photo }: VitrineAvecPhoto): VitrineStudioDTO {
  return {
    username: vitrine.username,
    titre: asTitre(vitrine.titre),
    prenom: vitrine.prenom,
    nom: vitrine.nom,
    nomAffiche: displayName(asTitre(vitrine.titre), vitrine.prenom, vitrine.nom),
    metier: vitrine.metier,
    ville: vitrine.ville,
    pays: vitrine.pays,
    accroche: vitrine.accroche,
    bio: vitrine.bio,
    photo: photo ? toMediaResource(photo) : null,
    emailContact: vitrine.emailContact,
    telephone: vitrine.telephone,
    whatsapp: vitrine.whatsapp,
    palette: asPalette(vitrine.palette),
    fuseau: vitrine.fuseau,
    publiee: vitrine.publieeLe !== null,
    publieeLe: vitrine.publieeLe?.toISOString() ?? null,
    creeLe: vitrine.createdAt.toISOString(),
    modifieLe: vitrine.updatedAt.toISOString(),
  }
}

export function toStudioResumeResource(resume: StudioSummary): StudioResumeDTO {
  return {
    compteurs: { ...resume.compteurs },
    prochaineEtape: resume.prochaineEtape,
    manquantsPourPublier: [...resume.manquants],
    statistiques7j: { visites: 0, clics: 0, reservations: 0 },
  }
}

/**
 * DTO public : liste blanche explicite. Ni id, ni userId, ni email du compte, ni téléphone du
 * compte, ni chemin disque, ni réglages internes — on ne spread jamais la ligne de base.
 */
export function toVitrinePublicResource({ vitrine, photo }: VitrineAvecPhoto): VitrinePubliqueDTO {
  const titre = asTitre(vitrine.titre)
  const nomAffiche = displayName(titre, vitrine.prenom, vitrine.nom)
  const ville = vitrine.ville ?? ''
  const pays = vitrine.pays ?? ''
  return {
    username: vitrine.username,
    titre,
    nomAffiche,
    prenom: vitrine.prenom,
    nom: vitrine.nom,
    metier: vitrine.metier,
    ville,
    pays,
    paysLibelle: PAYS.find((entree) => entree.code === pays)?.label ?? pays,
    accroche: vitrine.accroche,
    bio: vitrine.bio,
    photo: photo ? toMediaResource(photo) : null,
    contact: {
      email: vitrine.emailContact,
      telephone: vitrine.telephone,
      whatsapp: vitrine.whatsapp,
    },
    palette: asPalette(vitrine.palette),
    fuseau: vitrine.fuseau,
    seo: {
      titre: vitrine.seoTitre ?? `${nomAffiche} — ${vitrine.metier} à ${ville}`,
      description: vitrine.seoDescription ?? vitrine.accroche ?? `${nomAffiche}, ${vitrine.metier} à ${ville}.`,
    },
  }
}
