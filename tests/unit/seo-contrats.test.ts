// S12 : tests unitaires des contrats SEO (pure, aucune base).
import { describe, expect, it } from 'vitest'
import {
  construireTitreVitrine,
  construireDescriptionVitrine,
  construireTitreService,
  construireTitreRealisation,
  construireTitreListeServices,
  construireTitreListeRealisations,
  construireTitreLienBio,
  tronquerDescription,
  ogLocale,
  estRouteCacheable,
  cheminCanonique,
  construireGroupesRobots,
  ROBOTS_IA_ENTRAINEMENT,
  ROBOTS_IA_RECHERCHE,
} from '../../shared/seo'

describe('titres (#143)', () => {
  it('vitrine sans seoTitre', () => {
    expect(
      construireTitreVitrine({
        nomAffiche: 'Dr Cabrel Nguesso',
        metier: 'Cardiologue interventionnel',
        ville: 'Douala',
        seoTitre: null,
      }),
    ).toBe('Dr Cabrel Nguesso — Cardiologue interventionnel à Douala')
  })

  it('vitrine avec seoTitre saisi', () => {
    expect(
      construireTitreVitrine({
        nomAffiche: 'Dr Cabrel Nguesso',
        metier: 'Cardiologue interventionnel',
        ville: 'Douala',
        seoTitre: 'Cardiologue à Douala, Dr Nguesso',
      }),
    ).toBe('Cardiologue à Douala, Dr Nguesso')
  })

  it('liste des services', () => {
    expect(
      construireTitreListeServices({
        nomAffiche: 'Dr Cabrel Nguesso',
        metier: 'Cardiologue interventionnel',
        ville: 'Douala',
      }),
    ).toBe('Services — Dr Cabrel Nguesso, Cardiologue interventionnel à Douala')
  })

  it('liste des réalisations', () => {
    expect(
      construireTitreListeRealisations({
        nomAffiche: 'Dr Cabrel Nguesso',
        metier: 'Cardiologue interventionnel',
        ville: 'Douala',
      }),
    ).toBe('Réalisations — Dr Cabrel Nguesso, Cardiologue interventionnel à Douala')
  })

  it('lien bio', () => {
    expect(
      construireTitreLienBio({ nomAffiche: 'Dr Cabrel Nguesso' }),
    ).toBe('Dr Cabrel Nguesso — liens')
  })

  it('détail service', () => {
    expect(
      construireTitreService('Consultation de cardiologie', {
        nomAffiche: 'Dr Cabrel Nguesso',
        ville: 'Douala',
      }),
    ).toBe('Consultation de cardiologie — Dr Cabrel Nguesso — Douala')
  })

  it('détail réalisation', () => {
    expect(
      construireTitreRealisation('Ma réalisation', { nomAffiche: 'Dr Cabrel Nguesso' }),
    ).toBe('Ma réalisation — Dr Cabrel Nguesso')
  })
})

describe('descriptions', () => {
  it('vitrine : accroche présente, tronquée sur fin de mot', () => {
    const resultat = construireDescriptionVitrine({
      nomAffiche: 'Dr Cabrel Nguesso',
      metier: 'Cardiologue interventionnel',
      ville: 'Douala',
      paysLibelle: 'Cameroun',
      accroche: 'A. '.repeat(60),
      bio: null,
      seoTitre: null,
      seoDescription: null,
    })
    expect(resultat.length).toBeLessThanOrEqual(160)
    expect(resultat.endsWith('…')).toBe(true)
    expect(resultat).toContain('Cardiologue interventionnel à Douala (Cameroun).')
  })

  it('vitrine : seoDescription prioritaire', () => {
    const resultat = construireDescriptionVitrine({
      nomAffiche: 'Dr Cabrel Nguesso',
      metier: 'Cardiologue interventionnel',
      ville: 'Douala',
      paysLibelle: 'Cameroun',
      accroche: null,
      bio: null,
      seoTitre: null,
      seoDescription: 'Ma description sur mesure.',
    })
    expect(resultat).toBe('Ma description sur mesure.')
  })

  it('jamais de chaîne vide', () => {
    const resultat = construireDescriptionVitrine({
      nomAffiche: 'X',
      metier: 'Y',
      ville: 'Z',
      paysLibelle: 'CM',
      accroche: null,
      bio: null,
      seoTitre: null,
      seoDescription: null,
    })
    expect(resultat.length).toBeGreaterThan(0)
  })
})

describe('ogLocale (#148)', () => {
  it('CM → fr_CM', () => {
    expect(ogLocale('CM')).toBe('fr_CM')
  })
  it('pays inconnu → fr_FR', () => {
    expect(ogLocale('US')).toBe('fr_FR')
    expect(ogLocale(null)).toBe('fr_FR')
    expect(ogLocale(undefined)).toBe('fr_FR')
  })
})

describe('tronquerDescription', () => {
  it('texte court inchangé', () => {
    expect(tronquerDescription('Court.')).toBe('Court.')
  })
  it('texte long tronqué sur fin de mot avec ellipse', () => {
    const long = 'A '.repeat(200)
    const resultat = tronquerDescription(long)
    expect(resultat.length).toBeLessThanOrEqual(160)
    expect(resultat.endsWith('…')).toBe(true)
    expect(resultat.endsWith(' …')).toBe(false)
  })
})

describe('cache et canonique (#139, #146)', () => {
  it('estRouteCacheable : vraie pour les routes publiques', () => {
    expect(estRouteCacheable('/')).toBe(true)
    expect(estRouteCacheable('/tarifs')).toBe(true)
    expect(estRouteCacheable('/dr-cabrel')).toBe(true)
    expect(estRouteCacheable('/dr-cabrel/services')).toBe(true)
    expect(estRouteCacheable('/dr-cabrel/services/mon-service')).toBe(true)
    expect(estRouteCacheable('/dr-cabrel/realisations')).toBe(true)
    expect(estRouteCacheable('/dr-cabrel/realisations/mon-projet')).toBe(true)
    expect(estRouteCacheable('/@dr-cabrel')).toBe(true)
  })

  it('estRouteCacheable : fausse pour les routes non cacheables', () => {
    expect(estRouteCacheable('/studio')).toBe(false)
    expect(estRouteCacheable('/studio/services')).toBe(false)
    expect(estRouteCacheable('/onboarding')).toBe(false)
    expect(estRouteCacheable('/connexion')).toBe(false)
    expect(estRouteCacheable('/connexion/code')).toBe(false)
    expect(estRouteCacheable('/desabonnement')).toBe(false)
    expect(estRouteCacheable('/dr-cabrel/reserver')).toBe(false)
    expect(estRouteCacheable('/dr-cabrel/reserver/confirmation')).toBe(false)
    expect(estRouteCacheable('/dr-cabrel/agenda')).toBe(false)
    expect(estRouteCacheable('/dr-cabrel/contact')).toBe(false)
    expect(estRouteCacheable('/api/public/dr-cabrel')).toBe(false)
    expect(estRouteCacheable('/medias/x/y')).toBe(false)
  })

  it('cheminCanonique : minuscules, sans barre finale', () => {
    expect(cheminCanonique('/Dr-Cabrel/Services/')).toBe('/dr-cabrel/services')
    expect(cheminCanonique('/@Dr-Cabrel')).toBe('/@dr-cabrel')
    expect(cheminCanonique('/dr-cabrel')).toBe(null)
    expect(cheminCanonique('/api/Public/X')).toBe(null)
    expect(cheminCanonique('/_nuxt/A.js')).toBe(null)
    expect(cheminCanonique('/medias/ab/F.webp')).toBe(null)
    expect(cheminCanonique('/Studio')).toBe(null)
  })
})

describe('groupes robots (#152)', () => {
  it('recherche_seulement : entraînement bloqué, recherche autorisée', () => {
    const groupes = construireGroupesRobots('recherche_seulement')
    const entrainement = groupes.find((g) => g.userAgent.includes('GPTBot'))
    expect(entrainement?.disallow).toContain('/')
    const recherche = groupes.find((g) => g.userAgent.includes('OAI-SearchBot'))
    // Les robots de recherche ne figurent pas dans les groupes d'entraînement par défaut
    expect(recherche).toBeUndefined()
  })

  it('tout_autoriser : aucun blocage', () => {
    const groupes = construireGroupesRobots('tout_autoriser')
    for (const g of groupes) {
      expect(g.disallow).not.toContain('/')
    }
  })

  it('tout_bloquer : entraînement et recherche en Disallow: /', () => {
    const groupes = construireGroupesRobots('tout_bloquer')
    const groupesIA = groupes.filter((g) =>
      g.userAgent.some((ua) => [...ROBOTS_IA_ENTRAINEMENT, ...ROBOTS_IA_RECHERCHE].includes(ua)),
    )
    expect(groupesIA.length).toBe(2)
    for (const g of groupesIA) {
      expect(g.disallow).toContain('/')
    }
  })
})
