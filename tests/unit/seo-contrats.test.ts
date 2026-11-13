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
  construireTitreAgenda,
  construireTitreContact,
  construireDescriptionService,
  construireDescriptionRealisation,
  construireDescriptionListeServices,
  construireDescriptionListeRealisations,
  construireDescriptionContact,
  construireDescriptionAgenda,
  construireDescriptionLienBio,
  choisirImagePartage,
  directiveRobotsPage,
  normaliserChemin,
  urlAbsolue,
  urlCanonique,
  NOINDEX_ROUTES,
  ROBOTS_DISALLOW,
  ROBOTS_IA_ENTRAINEMENT,
  ROBOTS_IA_RECHERCHE,
  SEO_DESCRIPTION_MAX,
  SEO_DESCRIPTION_MIN,
} from '../../shared/seo'
import { isReserved } from '../../shared/reserved'

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

describe('URL absolues et canonique par chemin', () => {
  it('urlAbsolue : avec ou sans barre finale du site, avec ou sans barre initiale du chemin', () => {
    expect(urlAbsolue('https://jesuis.pro', '/brand/partage.jpg')).toBe('https://jesuis.pro/brand/partage.jpg')
    expect(urlAbsolue('https://jesuis.pro/', '/brand/partage.jpg')).toBe('https://jesuis.pro/brand/partage.jpg')
    expect(urlAbsolue('https://jesuis.pro//', 'brand/partage.jpg')).toBe('https://jesuis.pro/brand/partage.jpg')
  })

  it('urlAbsolue : une URL déjà absolue est rendue telle quelle, la casse du chemin est conservée', () => {
    expect(urlAbsolue('https://jesuis.pro', 'https://cdn.test/A.jpg')).toBe('https://cdn.test/A.jpg')
    expect(urlAbsolue('https://jesuis.pro', '/medias/AbC/1600.webp')).toBe('https://jesuis.pro/medias/AbC/1600.webp')
  })

  it('normaliserChemin : minuscules, sans barre finale, sans query ni fragment', () => {
    expect(normaliserChemin('/Dr-Cabrel/Services/?utm=1#x')).toBe('/dr-cabrel/services')
    expect(normaliserChemin('/')).toBe('/')
  })

  it.each([
    ['accueil', '/dr-cabrel', 'https://jesuis.pro/dr-cabrel'],
    ['services', '/dr-cabrel/services', 'https://jesuis.pro/dr-cabrel/services'],
    ['service', '/dr-cabrel/services/consultation', 'https://jesuis.pro/dr-cabrel/services/consultation'],
    ['realisations', '/dr-cabrel/realisations', 'https://jesuis.pro/dr-cabrel/realisations'],
    ['realisation', '/dr-cabrel/realisations/projet', 'https://jesuis.pro/dr-cabrel/realisations/projet'],
    ['contact', '/dr-cabrel/contact', 'https://jesuis.pro/dr-cabrel/contact'],
    ['agenda', '/dr-cabrel/agenda?service=x', 'https://jesuis.pro/dr-cabrel/agenda'],
    ['lien-bio', '/@dr-cabrel', 'https://jesuis.pro/@dr-cabrel'],
    ['accueil du site', '/', 'https://jesuis.pro/'],
  ])('urlCanonique : %s', (_page, chemin, attendu) => {
    expect(urlCanonique('https://jesuis.pro', chemin)).toBe(attendu)
    expect(urlCanonique('https://jesuis.pro/', chemin)).toBe(attendu)
  })

  it('choisirImagePartage : variante du DTO rendue absolue, sinon image par défaut absolue', () => {
    const variante = { url: '/medias/u/m/partage.jpg', largeur: 1200, hauteur: 630, alt: 'Portrait' }
    expect(choisirImagePartage(variante, 'https://jesuis.pro/', 'jesuis.pro').url).toBe('https://jesuis.pro/medias/u/m/partage.jpg')
    const defaut = choisirImagePartage(null, 'https://jesuis.pro', 'jesuis.pro')
    expect(defaut).toEqual({ url: 'https://jesuis.pro/brand/partage.jpg', largeur: 1200, hauteur: 630, alt: 'jesuis.pro' })
  })
})

describe('descriptions par page (50 à 160 caractères, sans répétition du métier)', () => {
  const v = { nomAffiche: 'Dr Cabrel Nguesso', ville: 'Douala', paysLibelle: 'Cameroun' }
  const identite = { nomAffiche: v.nomAffiche, metier: 'Cardiologue interventionnel', ville: v.ville }
  const longTitre = 'Un titre de service particulièrement long pour forcer la troncature'

  const descriptions: [string, string][] = [
    ['liste des services', construireDescriptionListeServices(v)],
    ['liste des services avec titres', construireDescriptionListeServices(v, ['Consultation', 'Bilan', 'Suivi'])],
    ['liste des services, titres très longs', construireDescriptionListeServices(v, [longTitre, longTitre, longTitre, longTitre, longTitre])],
    ['liste des réalisations', construireDescriptionListeRealisations(v)],
    ['liste des réalisations avec titres', construireDescriptionListeRealisations(v, ['Projet A', 'Projet B'])],
    ['contact', construireDescriptionContact(v)],
    ['agenda', construireDescriptionAgenda(v)],
    ['lien bio', construireDescriptionLienBio(v)],
    ['lien bio, vitrine minimale', construireDescriptionLienBio({ nomAffiche: 'A B', ville: '', paysLibelle: '' })],
    ['service sans description', construireDescriptionService({ titre: 'Bilan', description: null }, identite)],
    ['service, description courte complétée', construireDescriptionService({ titre: 'Bilan', description: 'Un bilan.' }, identite)],
    ['réalisation, description courte complétée', construireDescriptionRealisation({ titre: 'Projet', description: 'Court.' }, identite)],
    ['réalisation, description très longue', construireDescriptionRealisation({ titre: 'Projet', description: 'mot '.repeat(100) }, identite)],
  ]

  it.each(descriptions)('%s : longueur dans les bornes', (_nom, texte) => {
    expect(texte.length).toBeGreaterThanOrEqual(SEO_DESCRIPTION_MIN)
    expect(texte.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
  })

  it('les descriptions de liste, contact, agenda et lien bio ne citent pas le métier', () => {
    for (const [nom, texte] of descriptions.slice(0, 8)) {
      expect(texte.toLowerCase(), nom).not.toContain('cardiolog')
    }
  })

  it('les descriptions de pages diffèrent entre elles (pas de contenu dupliqué)', () => {
    const textes = descriptions.slice(0, 2).concat(descriptions.slice(3, 4), descriptions.slice(5, 8)).map(([, t]) => t)
    expect(new Set(textes).size).toBe(textes.length)
  })

  it('l’accueil ne répète pas le métier déjà cité par l’accroche', () => {
    const texte = construireDescriptionVitrine({
      nomAffiche: 'Dr Cabrel Nguesso', metier: 'Cardiologue interventionnel', ville: 'Douala', paysLibelle: 'Cameroun',
      accroche: 'Cardiologue interventionnel à Douala, rendez-vous en ligne.',
    })
    expect(texte).toBe('Cardiologue interventionnel à Douala, rendez-vous en ligne.')
  })

  it('titres d’agenda et de contact, avec ou sans ville', () => {
    expect(construireTitreAgenda(identite)).toBe('Agenda — Dr Cabrel Nguesso, Cardiologue interventionnel à Douala')
    expect(construireTitreContact({ ...identite, ville: '' })).toBe('Contact — Dr Cabrel Nguesso, Cardiologue interventionnel')
    expect(construireTitreService('Bilan', { nomAffiche: 'Dr X', ville: '' })).toBe('Bilan — Dr X')
  })
})

describe('indexation des pages et des routes techniques', () => {
  it('directiveRobotsPage : noindex, follow pour agenda, contact et lien bio ; null (indexable) ailleurs', () => {
    expect(directiveRobotsPage('agenda')).toBe('noindex, follow')
    expect(directiveRobotsPage('contact')).toBe('noindex, follow')
    expect(directiveRobotsPage('lien-bio')).toBe('noindex, follow')
    for (const page of ['accueil', 'services', 'service', 'realisations', 'realisation'] as const) {
      expect(directiveRobotsPage(page)).toBeNull()
    }
  })

  it('NOINDEX_ROUTES couvre /mcp, /.well-known/** et /api/auth/** (nofollow), et /connexion', () => {
    expect(NOINDEX_ROUTES['/mcp']).toBe('noindex, nofollow')
    expect(NOINDEX_ROUTES['/.well-known/**']).toBe('noindex, nofollow')
    expect(NOINDEX_ROUTES['/api/auth/**']).toBe('noindex, nofollow')
    expect(NOINDEX_ROUTES['/connexion/**']).toBe('noindex, nofollow')
    expect(NOINDEX_ROUTES['/studio/**']).toBe('noindex, nofollow')
    expect(NOINDEX_ROUTES['/desabonnement']).toBe('noindex, nofollow')
  })

  it('ROBOTS_DISALLOW interdit /mcp et /.well-known/ sans bloquer une vitrine dont le nom commence par mcp', () => {
    expect(ROBOTS_DISALLOW).toContain('/mcp$')
    expect(ROBOTS_DISALLOW).toContain('/mcp/')
    expect(ROBOTS_DISALLOW).toContain('/.well-known/')
    expect(ROBOTS_DISALLOW).not.toContain('/mcp')
    const groupes = construireGroupesRobots('recherche_seulement')
    expect(groupes[0]?.disallow).toEqual(expect.arrayContaining(['/mcp$', '/.well-known/']))
    expect(groupes[0]?.allow).toContain('/')
  })

  it('mcp est un mot réservé : jamais une vitrine, ni cacheable, ni redirigée en minuscules', () => {
    expect(isReserved('mcp')).toBe(true)
    expect(estRouteCacheable('/mcp')).toBe(false)
    expect(cheminCanonique('/MCP')).toBeNull()
    expect(estRouteCacheable('/.well-known/oauth-protected-resource/mcp')).toBe(false)
    expect(estRouteCacheable('/api/auth/token')).toBe(false)
  })
})
