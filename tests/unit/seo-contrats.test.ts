import { describe, expect, it } from 'vitest'
import {
  BUDGET_JS_KO,
  CACHE_HTML_ROUTES,
  CACHE_HTML_TTL_S,
  LLMS_NOTES,
  LLMS_SECTIONS,
  NOINDEX_ROUTES,
  OG_LOCALES_PAYS,
  ROBOTS_DISALLOW,
  ROBOTS_IA_ENTRAINEMENT,
  ROBOTS_IA_POLITIQUE_DEFAUT,
  SEO_DESCRIPTION_MAX,
  SITE_DESCRIPTION,
  cheminCanonique,
  construireDescriptionRealisation,
  construireDescriptionService,
  construireDescriptionVitrine,
  construireGroupesRobots,
  construireTitreRealisation,
  construireTitreService,
  construireTitreVitrine,
  estRouteCacheable,
  ogLocale,
  tronquerDescription,
} from '../../shared/seo'

const vitrine = {
  nomAffiche: 'Dr Cabrel Nguesso',
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  paysLibelle: 'Cameroun',
}

describe('titres (CA01, CA03)', () => {
  it('should build the vitrine title and prefer the typed seoTitre', () => {
    expect(construireTitreVitrine(vitrine)).toBe('Dr Cabrel Nguesso — Cardiologue interventionnel à Douala')
    expect(construireTitreVitrine({ ...vitrine, seoTitre: 'Cardiologue à Douala, Dr Nguesso' })).toBe('Cardiologue à Douala, Dr Nguesso')
    expect(construireTitreVitrine({ ...vitrine, seoTitre: '   ' })).toBe('Dr Cabrel Nguesso — Cardiologue interventionnel à Douala')
  })

  it('should build service and realisation titles', () => {
    expect(construireTitreService('Consultation de cardiologie', vitrine)).toBe('Consultation de cardiologie — Dr Cabrel Nguesso — Douala')
    expect(construireTitreRealisation('Clinique du Littoral', vitrine)).toBe('Clinique du Littoral — Dr Cabrel Nguesso')
  })
})

describe('tronquerDescription', () => {
  it('should keep a short text and collapse whitespace', () => {
    expect(tronquerDescription('Un  texte\ncourt.')).toBe('Un texte court.')
  })

  it('should cut on a word boundary with an ellipsis, within the limit', () => {
    const texte = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')
    const coupe = tronquerDescription(texte)
    expect(coupe.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
    expect(coupe.endsWith('…')).toBe(true)
    const sansEllipse = coupe.slice(0, -1)
    expect(texte.startsWith(sansEllipse)).toBe(true)
    expect(texte.charAt(sansEllipse.length)).toMatch(/\s/)
  })

  it('should still cut a text without any space', () => {
    const coupe = tronquerDescription('a'.repeat(400))
    expect(coupe.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
    expect(coupe.length).toBeGreaterThan(100)
  })
})

describe('descriptions (CA02)', () => {
  it('should start with metier, ville and country, then the accroche', () => {
    const d = construireDescriptionVitrine({ ...vitrine, accroche: 'Votre cœur entre de bonnes mains.' })
    expect(d.startsWith('Cardiologue interventionnel à Douala (Cameroun).')).toBe(true)
    expect(d).toContain('Votre cœur entre de bonnes mains.')
  })

  it('should truncate a 300-character accroche on a word boundary', () => {
    const accroche = Array.from({ length: 60 }, () => 'soin').join(' ').slice(0, 300)
    const d = construireDescriptionVitrine({ ...vitrine, accroche })
    expect(d.length).toBeLessThanOrEqual(SEO_DESCRIPTION_MAX)
    expect(d.endsWith('…')).toBe(true)
  })

  it('should fall back on the bio, then on the template, never empty', () => {
    expect(construireDescriptionVitrine({ ...vitrine, accroche: null, bio: 'Quinze ans de pratique.' })).toContain('Quinze ans de pratique.')
    expect(construireDescriptionVitrine({ ...vitrine, accroche: '  ', bio: '' })).toBe('Dr Cabrel Nguesso, Cardiologue interventionnel à Douala (Cameroun).')
  })

  it('should prefer the typed seoDescription', () => {
    expect(construireDescriptionVitrine({ ...vitrine, accroche: 'x', seoDescription: 'Ma description saisie.' })).toBe('Ma description saisie.')
  })

  it('should build service and realisation descriptions with fallbacks', () => {
    expect(construireDescriptionService({ titre: 'Consultation', description: 'Un bilan complet.' }, vitrine)).toBe('Un bilan complet.')
    expect(construireDescriptionService({ titre: 'Consultation', description: null }, vitrine)).toBe(
      'Consultation avec Dr Cabrel Nguesso, Cardiologue interventionnel à Douala.',
    )
    expect(construireDescriptionRealisation({ titre: 'Clinique', description: '' }, vitrine)).toBe(
      'Clinique, réalisation de Dr Cabrel Nguesso, Cardiologue interventionnel à Douala.',
    )
    expect(construireDescriptionService({ titre: 'C', description: 'd', seoDescription: 'Saisie.' }, vitrine)).toBe('Saisie.')
  })
})

describe('ogLocale (CA04)', () => {
  it.each([
    ['CM', 'fr_CM'],
    ['cm', 'fr_CM'],
    ['US', 'fr_FR'],
    [null, 'fr_FR'],
    [undefined, 'fr_FR'],
    ['', 'fr_FR'],
  ])('should map %j to %s', (pays, attendu) => {
    expect(ogLocale(pays)).toBe(attendu)
  })

  it('should map every listed country to itself', () => {
    for (const code of OG_LOCALES_PAYS) expect(ogLocale(code)).toBe(`fr_${code}`)
  })
})

describe('estRouteCacheable (CA29)', () => {
  it.each(['/', '/tarifs', '/dr-cabrel', '/dr-cabrel/services', '/dr-cabrel/services/consultation', '/dr-cabrel/realisations', '/dr-cabrel/realisations/clinique-x', '/@dr-cabrel'])(
    'should cache %s',
    (path) => {
      expect(estRouteCacheable(path)).toBe(true)
    },
  )

  it.each([
    '/studio',
    '/studio/services',
    '/onboarding',
    '/connexion',
    '/connexion/code',
    '/desabonnement',
    '/dr-cabrel/reserver',
    '/dr-cabrel/reserver/confirmation',
    '/dr-cabrel/agenda',
    '/dr-cabrel/contact',
    '/api/public/dr-cabrel',
    '/medias/x/y',
    '/_nuxt/a.js',
    '/dr-cabrel/inexistant',
    '/dr-cabrel/services/a/b',
    '/@dr-cabrel/services',
  ])('should never cache %s', (path) => {
    expect(estRouteCacheable(path)).toBe(false)
  })

  it('should ignore the query string', () => {
    expect(estRouteCacheable('/dr-cabrel?utm=x')).toBe(true)
    expect(estRouteCacheable('/dr-cabrel/reserver?service=1')).toBe(false)
  })

  it('should expose the 8 whitelist patterns and a positive TTL', () => {
    expect(CACHE_HTML_ROUTES).toHaveLength(8)
    expect(CACHE_HTML_TTL_S).toBe(10)
  })
})

describe('cheminCanonique (CA26)', () => {
  it.each([
    ['/Dr-Cabrel/Services/', '/dr-cabrel/services'],
    ['/@Dr-Cabrel', '/@dr-cabrel'],
    ['/dr-cabrel/', '/dr-cabrel'],
    ['/Dr-Cabrel?utm_source=wa', '/dr-cabrel'],
    ['/dr-cabrel', null],
    ['/dr-cabrel?x=1', null],
    ['/', null],
    ['/api/Public/X', null],
    ['/_nuxt/A.js', null],
    ['/medias/ab/F.webp', null],
    ['/Studio', null],
    ['/Dr-Cabrel/photo.JPG', null],
  ])('should map %s to %j', (path, attendu) => {
    expect(cheminCanonique(path)).toBe(attendu)
  })
})

describe('construireGroupesRobots (CA17)', () => {
  const entrainement = (groupes: ReturnType<typeof construireGroupesRobots>) =>
    groupes.filter((g) => g.disallow.includes('/'))

  it('should default to recherche_seulement', () => {
    expect(ROBOTS_IA_POLITIQUE_DEFAUT).toBe('recherche_seulement')
  })

  it('should block training robots only, with the shared disallow list for *', () => {
    const groupes = construireGroupesRobots('recherche_seulement')
    expect(groupes[0]).toMatchObject({ userAgent: ['*'], disallow: [...ROBOTS_DISALLOW], allow: ['/'] })
    const bloques = entrainement(groupes)
    expect(bloques).toHaveLength(1)
    expect(bloques[0]?.userAgent).toEqual([...ROBOTS_IA_ENTRAINEMENT])
    expect(bloques[0]?.userAgent).not.toContain('OAI-SearchBot')
  })

  it('should add no AI group with tout_autoriser', () => {
    const groupes = construireGroupesRobots('tout_autoriser')
    expect(groupes).toHaveLength(1)
    expect(entrainement(groupes)).toHaveLength(0)
  })

  it('should never disallow the whole site for the * group nor list agenda/contact', () => {
    const tous = construireGroupesRobots().flatMap((g) => (g.userAgent.includes('*') ? g.disallow : []))
    expect(tous).not.toContain('/')
    expect(tous.some((d) => d.includes('agenda') || d.includes('contact'))).toBe(false)
  })
})

describe('constantes (aucune valeur vide)', () => {
  it('should have noindex directives for every route', () => {
    for (const [route, directive] of Object.entries(NOINDEX_ROUTES)) {
      expect(route.startsWith('/')).toBe(true)
      expect(directive).toMatch(/^noindex, (no)?follow$/)
    }
    expect(NOINDEX_ROUTES['/*/agenda']).toBe('noindex, follow')
    expect(NOINDEX_ROUTES['/studio/**']).toBe('noindex, nofollow')
  })

  it('should describe llms.txt without the module-owned "LLM Resources" section', () => {
    expect(LLMS_SECTIONS.map((s) => s.title)).toEqual(['À propos', 'Adresses publiques'])
    const liens = LLMS_SECTIONS.flatMap((s) => s.links ?? []).map((l) => l.href)
    expect(liens).toEqual(expect.arrayContaining(['/tarifs', '/sitemap_index.xml']))
    expect(LLMS_SECTIONS[0]?.description).toContain(SITE_DESCRIPTION)
    for (const note of LLMS_NOTES) expect(note.trim()).not.toBe('')
  })

  it('should keep non-empty texts and a positive JS budget', () => {
    expect(SITE_DESCRIPTION.trim()).not.toBe('')
    expect(BUDGET_JS_KO).toBeGreaterThan(0)
    expect(ROBOTS_IA_ENTRAINEMENT.every((r) => r.trim() !== '')).toBe(true)
  })
})
