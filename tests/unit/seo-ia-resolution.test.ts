import { describe, expect, it } from 'vitest'
import {
  SEO_DESCRIPTION_MAX,
  SEO_TITRE_MAX,
  SEPARATEUR_TITRE,
  construireDescriptionVitrine,
  construireTitreVitrine,
  tronquerDescription,
} from '../../shared/seo'
import type { SeoVitrineSource } from '../../shared/seo'
import {
  SEO_IA_DESCRIPTION_MAX_ATTENDU,
  SEO_IA_TITRE_MAX_ATTENDU,
  SEO_IA_TITRE_MIN_ATTENDU,
  descriptionDeLongueur,
  titreDeLongueur,
} from './support/seo-ia'

// Décision #24, groupe B : trois niveaux, résolus CHAMP PAR CHAMP.
//   titre       : seoTitre saisi > « {nomAffiche} — {ia.titre} » (si ≤ 70) > gabarit
//   description : seoDescription saisie > ia.description (tronquée) > gabarit
// Fonction pure de shared/seo.ts (importée par le serveur, l'application et nuxt.config.ts).
const seo = () => import('../../shared/seo')

const SOURCE: SeoVitrineSource = {
  nomAffiche: 'Dr Cabrel Nguesso',
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  paysLibelle: 'Cameroun',
  accroche: 'Votre cœur entre de bonnes mains',
  bio: null,
  seoTitre: null,
  seoDescription: null,
}

const IA = {
  titre: 'Cardiologue à Douala',
  description: 'Consultations de cardiologie à Douala pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.',
}

const TITRE_SAISI = 'Cardiologue interventionnel à Douala, rendez-vous en ligne'
const DESCRIPTION_SAISIE = 'Prenez rendez-vous en ligne avec un cardiologue à Douala et retrouvez toutes les informations utiles avant votre venue.'

const gabaritTitre = (source: SeoVitrineSource = SOURCE) => construireTitreVitrine({ ...source, seoTitre: null })
const gabaritDescription = (source: SeoVitrineSource = SOURCE) => construireDescriptionVitrine({ ...source, seoDescription: null })

describe('constantes du SEO IA', () => {
  it('should bound the generated titre to 10..50 characters (the combined titre keeps 70 as its ceiling)', async () => {
    const { SEO_IA_TITRE_MIN, SEO_IA_TITRE_MAX } = await seo()

    expect(SEO_IA_TITRE_MIN).toBe(SEO_IA_TITRE_MIN_ATTENDU)
    expect(SEO_IA_TITRE_MAX).toBe(SEO_IA_TITRE_MAX_ATTENDU)
    expect(SEO_IA_TITRE_MAX + SEPARATEUR_TITRE.length + 'Dr Cabrel Nguesso'.length).toBeLessThanOrEqual(SEO_TITRE_MAX)
  })
})

describe('resoudreSeoVitrine : les trois niveaux (B)', () => {
  it('should use the deterministic template for both fields when there is no typed text and no fresh proposal', async () => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine(SOURCE, null)

    expect(resultat).toEqual({
      titre: gabaritTitre(),
      description: gabaritDescription(),
      origineTitre: 'gabarit',
      origineDescription: 'gabarit',
    })
  })

  it('should use the fresh proposal when nothing is typed: « {nomAffiche} — {ia.titre} » and the IA description', async () => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine(SOURCE, IA)

    expect(resultat).toEqual({
      titre: `Dr Cabrel Nguesso${SEPARATEUR_TITRE}Cardiologue à Douala`,
      description: IA.description,
      origineTitre: 'ia',
      origineDescription: 'ia',
    })
  })

  it('should let a typed titre win over the proposal, and keep the proposal for the description (field by field)', async () => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine({ ...SOURCE, seoTitre: TITRE_SAISI }, IA)

    expect(resultat).toMatchObject({ titre: TITRE_SAISI, origineTitre: 'personnalise', description: IA.description, origineDescription: 'ia' })
  })

  it('should let a typed description win over the proposal, and keep the proposal for the titre (field by field)', async () => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine({ ...SOURCE, seoDescription: DESCRIPTION_SAISIE }, IA)

    expect(resultat).toMatchObject({
      titre: `Dr Cabrel Nguesso${SEPARATEUR_TITRE}Cardiologue à Douala`,
      origineTitre: 'ia',
      description: DESCRIPTION_SAISIE,
      origineDescription: 'personnalise',
    })
  })

  it('should let typed texts win on both fields even when a fresh proposal exists', async () => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine({ ...SOURCE, seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE }, IA)

    expect(resultat).toEqual({ titre: TITRE_SAISI, description: DESCRIPTION_SAISIE, origineTitre: 'personnalise', origineDescription: 'personnalise' })
  })

  it('should mix a typed titre with the template description when there is no proposal', async () => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine({ ...SOURCE, seoTitre: TITRE_SAISI }, null)

    expect(resultat).toMatchObject({ titre: TITRE_SAISI, origineTitre: 'personnalise', description: gabaritDescription(), origineDescription: 'gabarit' })
  })

  it('should expose exactly titre, description, origineTitre and origineDescription', async () => {
    const { resoudreSeoVitrine } = await seo()

    expect(Object.keys(resoudreSeoVitrine(SOURCE, IA)).sort()).toEqual(['description', 'origineDescription', 'origineTitre', 'titre'])
  })
})

describe('resoudreSeoVitrine : cas limites (B)', () => {
  /** nomAffiche de `longueur` caractères. */
  const nom = (longueur: number): string => 'N'.repeat(longueur)
  const titreIa50 = titreDeLongueur(SEO_IA_TITRE_MAX_ATTENDU)

  it('should accept a combined titre of exactly 70 characters', async () => {
    const { resoudreSeoVitrine } = await seo()
    const longueurNom = SEO_TITRE_MAX - SEPARATEUR_TITRE.length - titreIa50.length

    const resultat = resoudreSeoVitrine({ ...SOURCE, nomAffiche: nom(longueurNom) }, { titre: titreIa50, description: IA.description })

    expect(resultat.titre).toHaveLength(SEO_TITRE_MAX)
    expect(resultat).toMatchObject({ titre: `${nom(longueurNom)}${SEPARATEUR_TITRE}${titreIa50}`, origineTitre: 'ia' })
  })

  it('should fall back to the template titre when the combined titre is 71 characters, and still use the IA description', async () => {
    const { resoudreSeoVitrine } = await seo()
    const source = { ...SOURCE, nomAffiche: nom(SEO_TITRE_MAX + 1 - SEPARATEUR_TITRE.length - titreIa50.length) }

    const resultat = resoudreSeoVitrine(source, { titre: titreIa50, description: IA.description })

    expect(resultat).toMatchObject({
      titre: gabaritTitre(source),
      origineTitre: 'gabarit',
      description: IA.description,
      origineDescription: 'ia',
    })
  })

  it('should fall back to the template titre for a long display name (title above 70)', async () => {
    const { resoudreSeoVitrine } = await seo()
    const source = { ...SOURCE, nomAffiche: 'Professeur Jean-Baptiste Nguesso Ndongo-Abessolo' }

    const resultat = resoudreSeoVitrine(source, { titre: 'Cardiologue interventionnel à Douala', description: IA.description })

    expect(`${source.nomAffiche}${SEPARATEUR_TITRE}Cardiologue interventionnel à Douala`.length).toBeGreaterThan(SEO_TITRE_MAX)
    expect(resultat).toMatchObject({ titre: gabaritTitre(source), origineTitre: 'gabarit' })
  })

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
    ['newline and tab only', '\n\t '],
  ])('should treat a %s seoTitre as not typed', async (_nom, saisie) => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine({ ...SOURCE, seoTitre: saisie }, IA)

    expect(resultat.origineTitre).toBe('ia')
  })

  it.each([
    ['empty', ''],
    ['spaces only', '   '],
  ])('should treat a %s seoDescription as not typed', async (_nom, saisie) => {
    const { resoudreSeoVitrine } = await seo()

    const resultat = resoudreSeoVitrine({ ...SOURCE, seoDescription: saisie }, null)

    expect(resultat).toMatchObject({ description: gabaritDescription(), origineDescription: 'gabarit' })
  })

  it('should cut an IA description that exceeds 160 characters on a word end, ellipsis included (defence against a corrupted row)', async () => {
    const { resoudreSeoVitrine } = await seo()
    const trop = descriptionDeLongueur(SEO_IA_DESCRIPTION_MAX_ATTENDU + 40)

    const resultat = resoudreSeoVitrine(SOURCE, { titre: IA.titre, description: trop })

    expect(resultat.description).toBe(tronquerDescription(trop))
    expect(resultat.description.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
    expect(resultat.description.endsWith('…')).toBe(true)
    expect(resultat.origineDescription).toBe('ia')
  })

  it('should never return an empty titre or description, even without ville, accroche or bio', async () => {
    const { resoudreSeoVitrine } = await seo()
    const nu: SeoVitrineSource = { nomAffiche: 'Cabrel Nguesso', metier: 'Coach', ville: '', paysLibelle: '', accroche: null, bio: null, seoTitre: null, seoDescription: null }

    const resultat = resoudreSeoVitrine(nu, null)

    expect(resultat.titre.trim()).not.toBe('')
    expect(resultat.description.trim()).not.toBe('')
  })

  it('should not mutate its inputs', async () => {
    const { resoudreSeoVitrine } = await seo()
    const source = structuredClone(SOURCE)
    const ia = structuredClone(IA)

    resoudreSeoVitrine(source, ia)

    expect(source).toEqual(SOURCE)
    expect(ia).toEqual(IA)
  })
})
