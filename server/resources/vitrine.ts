import type { ContenusPublicsDTO, StudioResumeDTO, VitrinePubliqueDTO, VitrineStudioDTO } from '../../shared/dto'
import { asPalette } from '../../shared/palettes'
import { PAYS, TITRES, displayName } from '../../shared/vitrine'
import type { Titre } from '../../shared/vitrine'
import type { ContenusPublics, StudioSummary, VitrineAvecPhoto } from '../services/vitrines'
import { toMediaResource } from './media'
import { construireImagePartage, resoudreSeoVitrine } from '../../shared/seo'
import type { SeoVitrineSource } from '../../shared/seo'
import { seoIaFraiche } from '../services/ia/seo-regles'

// Les colonnes sont du texte libre côté TypeScript (les CHECK de la base garantissent les valeurs) :
// on les rétrécit ici plutôt que de caster.
export function asTitre(value: string | null): Titre | null {
  return TITRES.find((titre) => titre === value) ?? null
}

function sourceSeo(vitrine: VitrineAvecPhoto['vitrine'], nomAffiche: string): SeoVitrineSource {
  const pays = vitrine.pays ?? ''
  return {
    nomAffiche,
    metier: vitrine.metier,
    ville: vitrine.ville ?? '',
    paysLibelle: PAYS.find((entree) => entree.code === pays)?.label ?? pays,
    accroche: vitrine.accroche,
    bio: vitrine.bio,
    seoTitre: vitrine.seoTitre,
    seoDescription: vitrine.seoDescription,
  }
}

export function toVitrineStudioResource({ vitrine, photo }: VitrineAvecPhoto): VitrineStudioDTO {
  const nomAffiche = displayName(asTitre(vitrine.titre), vitrine.prenom, vitrine.nom)
  // Texte automatique résolu SANS les saisies : ce que « Revenir au texte automatique » donnerait.
  const auto = resoudreSeoVitrine({ ...sourceSeo(vitrine, nomAffiche), seoTitre: null, seoDescription: null }, seoIaFraiche(vitrine))
  return {
    username: vitrine.username,
    titre: asTitre(vitrine.titre),
    prenom: vitrine.prenom,
    nom: vitrine.nom,
    nomAffiche,
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
    seoTitre: vitrine.seoTitre,
    seoDescription: vitrine.seoDescription,
    seoAuto: {
      titre: auto.titre,
      description: auto.description,
      origine: auto.origineTitre === 'ia' || auto.origineDescription === 'ia' ? 'ia' : 'gabarit',
    },
  }
}

export function toStudioResumeResource(resume: StudioSummary): StudioResumeDTO {
  return {
    compteurs: { ...resume.compteurs },
    prochaineEtape: resume.prochaineEtape,
    manquantsPourPublier: [...resume.manquants],
    // S11 #185 : totaux réels calculés par `getTotaux7J` (jamais de littéral 0 en dur).
    statistiques7j: { ...resume.statistiques7j },
  }
}

/** Compteurs de navigation publique : deux entiers, un drapeau agenda, rien d'autre. */
export function toContenusPublicsResource(contenus: ContenusPublics): ContenusPublicsDTO {
  return { services: contenus.services, realisations: contenus.realisations, agenda: contenus.agenda }
}

/**
 * DTO public : liste blanche explicite. Ni id, ni userId, ni email du compte, ni téléphone du
 * compte, ni chemin disque, ni réglages internes — on ne spread jamais la ligne de base.
 * S10 : `badgeBrandself` (plan gratuit) est le SEUL reflet public du plan ; le statut d'abonnement n'est jamais exposé.
 * S12 : `seo.image` (variante `partage` de la photo ; null → image par défaut OG_IMAGE_DEFAUT), `modifieLe` pour le sitemap.
 */
export function toVitrinePublicResource(
  { vitrine, photo }: VitrineAvecPhoto,
  badgeBrandself: boolean,
): VitrinePubliqueDTO {
  const titre = asTitre(vitrine.titre)
  const nomAffiche = displayName(titre, vitrine.prenom, vitrine.nom)
  const ville = vitrine.ville ?? ''
  const pays = vitrine.pays ?? ''
  const paysLibelle = PAYS.find((entree) => entree.code === pays)?.label ?? pays
  const resolu = resoudreSeoVitrine(sourceSeo(vitrine, nomAffiche), seoIaFraiche(vitrine))
  const seoPublic = { titre: resolu.titre, description: resolu.description }
  return {
    username: vitrine.username,
    titre,
    nomAffiche,
    prenom: vitrine.prenom,
    nom: vitrine.nom,
    metier: vitrine.metier,
    ville,
    pays,
    paysLibelle,
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
      ...seoPublic,
      image: construireImagePartage(photo?.id, nomAffiche),
    },
    modifieLe: vitrine.updatedAt.toISOString(),
    badgeBrandself,
  }
}
