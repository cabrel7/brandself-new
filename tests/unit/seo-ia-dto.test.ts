import { describe, expect, it } from 'vitest'
import type { vitrines } from '../../shared/db/schema'
import { SEPARATEUR_TITRE, construireDescriptionVitrine, construireTitreVitrine } from '../../shared/seo'
import { SEO_VALIDE, signatureAttendue } from './support/seo-ia'

// Décision #24, groupes B et G : les deux DTO de la vitrine.
//  - PUBLIC : forme INCHANGÉE (liste blanche). Le texte SEO IA n'y apparaît que RÉSOLU dans `seo.titre` et
//    `seo.description` ; jamais une clé `seo_ia*`, ni la signature.
//  - STUDIO : `seoTitre`/`seoDescription` (la saisie brute) et `seoAuto` = texte automatique résolu SANS les saisies.
// Fonctions pures (lignes fabriquées, aucune base).
const ressource = () => import('../../server/resources/vitrine')

type Ligne = typeof vitrines.$inferSelect

const ENTREES = { metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'CM', accroche: 'Votre cœur entre de bonnes mains' }
const SIGNATURE_FRAICHE = signatureAttendue(ENTREES)
const TITRE_SAISI = 'Cardiologue interventionnel à Douala, rendez-vous en ligne'
const DESCRIPTION_SAISIE = 'Prenez rendez-vous en ligne avec un cardiologue à Douala et retrouvez toutes les informations utiles avant votre venue.'

function ligne(surcharges: Partial<Ligne> = {}): Ligne {
  const date = new Date('2026-11-10T10:00:00.000Z')
  return {
    id: 'vitrine-1',
    userId: 'user-1',
    username: 'dr-cabrel',
    titre: 'dr',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    ...ENTREES,
    bio: 'Une présentation de plusieurs phrases.',
    photoMediaId: null,
    emailContact: 'contact@cabinet.cm',
    telephone: '+237699000000',
    whatsapp: null,
    palette: 'terracotta',
    seoTitre: null,
    seoDescription: null,
    seoIaTitre: SEO_VALIDE.titre,
    seoIaDescription: SEO_VALIDE.description,
    seoIaSignature: SIGNATURE_FRAICHE,
    seoIaGenereLe: date,
    sectionsMasquees: [],
    etapesIgnorees: [],
    partageeLe: null,
    fuseau: 'Africa/Douala',
    pasCreneauMin: 30,
    preavisHeures: 2,
    horizonJours: 60,
    publieeLe: date,
    createdAt: date,
    updatedAt: date,
    ...surcharges,
  }
}

const sansIa = (): Partial<Ligne> => ({ seoIaTitre: null, seoIaDescription: null, seoIaSignature: null, seoIaGenereLe: null })

const NOM_AFFICHE = 'Dr Cabrel Nguesso'
const GABARIT = {
  nomAffiche: NOM_AFFICHE,
  metier: ENTREES.metier,
  ville: ENTREES.ville,
  paysLibelle: 'Cameroun',
  accroche: ENTREES.accroche,
  bio: 'Une présentation de plusieurs phrases.',
}
const gabaritTitre = construireTitreVitrine({ nomAffiche: NOM_AFFICHE, metier: ENTREES.metier, ville: ENTREES.ville })
const gabaritDescription = construireDescriptionVitrine({ ...GABARIT, seoTitre: null, seoDescription: null })

describe('DTO public : forme inchangée (B)', () => {
  const CLES_ATTENDUES = [
    'accroche', 'badgeBrandself', 'bio', 'contact', 'fuseau', 'metier', 'modifieLe', 'nom', 'nomAffiche', 'palette',
    'pays', 'paysLibelle', 'photo', 'prenom', 'seo', 'titre', 'username', 'ville',
  ].sort()

  it('should keep exactly the same keys, with a SEO IA proposal stored', async () => {
    const { toVitrinePublicResource } = await ressource()

    const dto = toVitrinePublicResource({ vitrine: ligne(), photo: null }, false)

    expect(Object.keys(dto).sort()).toEqual(CLES_ATTENDUES)
    expect(Object.keys(dto.seo).sort()).toEqual(['description', 'image', 'titre'])
  })

  it('should never leak a seo_ia column, the signature or the generation date, whatever the proposal state', async () => {
    const { toVitrinePublicResource } = await ressource()

    const json = JSON.stringify([
      toVitrinePublicResource({ vitrine: ligne(), photo: null }, false),
      toVitrinePublicResource({ vitrine: ligne({ metier: 'Pédiatre' }), photo: null }, false),
      toVitrinePublicResource({ vitrine: ligne(sansIa()), photo: null }, true),
    ])

    expect(json).not.toMatch(/seo_?ia/i)
    expect(json).not.toContain(SIGNATURE_FRAICHE)
    expect(json).not.toContain('genereLe')
  })

  it('should publish « {nomAffiche} — {titre IA} » and the IA description when the proposal is fresh and nothing is typed', async () => {
    const { toVitrinePublicResource } = await ressource()

    const { seo } = toVitrinePublicResource({ vitrine: ligne(), photo: null }, false)

    expect(seo.titre).toBe(`${NOM_AFFICHE}${SEPARATEUR_TITRE}${SEO_VALIDE.titre}`)
    expect(seo.description).toBe(SEO_VALIDE.description)
  })

  it('should fall back to the template when the signature is stale (métier changed since the generation)', async () => {
    const { toVitrinePublicResource } = await ressource()

    const { seo } = toVitrinePublicResource({ vitrine: ligne({ metier: 'Pédiatre' }), photo: null }, false)

    const attendu = construireTitreVitrine({ nomAffiche: NOM_AFFICHE, metier: 'Pédiatre', ville: 'Douala' })
    expect(seo.titre).toBe(attendu)
    expect(seo.titre).not.toContain(SEO_VALIDE.titre)
    expect(seo.description).not.toBe(SEO_VALIDE.description)
  })

  it('should give the exact template (the pre-S24 output) when no proposal exists', async () => {
    const { toVitrinePublicResource } = await ressource()

    const { seo } = toVitrinePublicResource({ vitrine: ligne(sansIa()), photo: null }, false)

    expect(seo).toEqual({ titre: gabaritTitre, description: gabaritDescription, image: null })
  })

  it('should let the typed texts win over a fresh proposal, each field on its own', async () => {
    const { toVitrinePublicResource } = await ressource()

    const titre = toVitrinePublicResource({ vitrine: ligne({ seoTitre: TITRE_SAISI }), photo: null }, false).seo
    const description = toVitrinePublicResource({ vitrine: ligne({ seoDescription: DESCRIPTION_SAISIE }), photo: null }, false).seo

    expect(titre).toMatchObject({ titre: TITRE_SAISI, description: SEO_VALIDE.description })
    expect(description).toMatchObject({ titre: `${NOM_AFFICHE}${SEPARATEUR_TITRE}${SEO_VALIDE.titre}`, description: DESCRIPTION_SAISIE })
  })

  it('should use the template titre when « {nomAffiche} — {titre IA} » exceeds 70 characters', async () => {
    const { toVitrinePublicResource } = await ressource()
    const longNom = { prenom: 'Jean-Baptiste Emmanuel', nom: 'Nguesso Ndongo-Abessolo' }

    const { seo } = toVitrinePublicResource({ vitrine: ligne(longNom), photo: null }, false)

    expect(seo.titre).not.toContain(SEO_VALIDE.titre)
    expect(seo.description).toBe(SEO_VALIDE.description)
  })

  it('should not treat a stale half proposal (signature but no titre) as fresh', async () => {
    const { toVitrinePublicResource } = await ressource()

    const { seo } = toVitrinePublicResource({ vitrine: ligne({ seoIaTitre: null }), photo: null }, false)

    expect(seo.titre).toBe(gabaritTitre)
  })
})

describe('DTO studio : seoTitre, seoDescription et seoAuto (G)', () => {
  it('should expose the typed texts as they are stored, null when nothing was typed', async () => {
    const { toVitrineStudioResource } = await ressource()

    const vide = toVitrineStudioResource({ vitrine: ligne(), photo: null })
    const saisi = toVitrineStudioResource({ vitrine: ligne({ seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE }), photo: null })

    expect(vide).toMatchObject({ seoTitre: null, seoDescription: null })
    expect(saisi).toMatchObject({ seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })
  })

  it('should resolve seoAuto from the fresh proposal with origine « ia »', async () => {
    const { toVitrineStudioResource } = await ressource()

    const dto = toVitrineStudioResource({ vitrine: ligne(), photo: null })

    expect(dto.seoAuto).toEqual({
      titre: `${NOM_AFFICHE}${SEPARATEUR_TITRE}${SEO_VALIDE.titre}`,
      description: SEO_VALIDE.description,
      origine: 'ia',
    })
  })

  it('should resolve seoAuto from the template with origine « gabarit » when there is no proposal', async () => {
    const { toVitrineStudioResource } = await ressource()

    const dto = toVitrineStudioResource({ vitrine: ligne(sansIa()), photo: null })

    expect(dto.seoAuto).toEqual({ titre: gabaritTitre, description: gabaritDescription, origine: 'gabarit' })
  })

  it('should resolve seoAuto from the template when the proposal is stale', async () => {
    const { toVitrineStudioResource } = await ressource()

    const dto = toVitrineStudioResource({ vitrine: ligne({ ville: 'Yaoundé' }), photo: null })

    expect(dto.seoAuto.origine).toBe('gabarit')
    expect(dto.seoAuto.titre).not.toContain(SEO_VALIDE.titre)
  })

  it('should compute seoAuto WITHOUT the typed texts (the studio shows what « Revenir au texte automatique » would give)', async () => {
    const { toVitrineStudioResource } = await ressource()

    const avecSaisies = toVitrineStudioResource({ vitrine: ligne({ seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE }), photo: null })
    const sansSaisies = toVitrineStudioResource({ vitrine: ligne(), photo: null })
    const gabaritAvecSaisies = toVitrineStudioResource({ vitrine: ligne({ ...sansIa(), seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE }), photo: null })

    expect(avecSaisies.seoAuto).toEqual(sansSaisies.seoAuto)
    expect(gabaritAvecSaisies.seoAuto).toEqual({ titre: gabaritTitre, description: gabaritDescription, origine: 'gabarit' })
    expect(JSON.stringify(avecSaisies.seoAuto)).not.toContain(TITRE_SAISI)
    expect(JSON.stringify(avecSaisies.seoAuto)).not.toContain(DESCRIPTION_SAISIE)
  })

  it('should never expose the signature, the generation date or a seo_ia column in the studio DTO', async () => {
    const { toVitrineStudioResource } = await ressource()

    const json = JSON.stringify(toVitrineStudioResource({ vitrine: ligne(), photo: null }))

    expect(json).not.toMatch(/seo_?ia/i)
    expect(json).not.toContain(SIGNATURE_FRAICHE)
  })

  it('should keep a studio ville null when the vitrine has none, and still give a non-empty seoAuto', async () => {
    const { toVitrineStudioResource } = await ressource()

    const dto = toVitrineStudioResource({ vitrine: ligne({ ...sansIa(), ville: null, pays: null }), photo: null })

    expect(dto.ville).toBeNull()
    expect(dto.seoAuto.titre.trim()).not.toBe('')
    expect(dto.seoAuto.description.trim()).not.toBe('')
  })
})
