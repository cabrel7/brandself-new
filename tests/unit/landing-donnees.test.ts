// Page d'accueil : contrat de cohérence des données `app/data/landing.ts` avec les fichiers réels
// (images de `public/landing/`) et les composants (ancres).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateUsername } from '../../shared/schemas/username'
import {
  ADRESSES_EXEMPLES,
  ETAPES_COMPRIS,
  FAQ,
  IMAGES,
  LIEN_BIO_DEMO,
  METIERS_DEMO,
  NAV_LIENS,
  REALISATION_DEMO,
  ROUTE_CONNEXION,
  ROUTE_EXEMPLE,
  SERVICES_DEMO,
  TEMOIGNAGES_DEMO,
} from '../../app/data/landing'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const DOSSIER_MARKETING = path.join(RACINE, 'app/components/marketing')
const PAGE_ACCUEIL = path.join(RACINE, 'app/pages/index.vue')
const DOSSIER_PUBLIC = path.join(RACINE, 'public')

const IDS_ATTENDUS = ['haut', 'trouve', 'compris', 'contact', 'pour-qui', 'tarifs', 'faq', 'adresse-fin']

function fichiersVue(): string[] {
  return [
    ...readdirSync(DOSSIER_MARKETING).filter(f => f.endsWith('.vue')).map(f => path.join(DOSSIER_MARKETING, f)),
    PAGE_ACCUEIL,
  ]
}

/** ids statiques (`id="x"`, pas `:id="x"`) déclarés dans les composants et la page. */
function idsDeclares(): string[] {
  const ids: string[] = []
  for (const fichier of fichiersVue()) {
    const source = readFileSync(fichier, 'utf8')
    for (const m of source.matchAll(/(?<![:\w-])id="([^"]+)"/g)) ids.push(m[1] as string)
  }
  return ids
}

/** Toutes les chaînes d'un objet de données (récursif), pour scanner le texte visible. */
function chaines(valeur: unknown): string[] {
  if (typeof valeur === 'string') return [valeur]
  if (Array.isArray(valeur)) return valeur.flatMap(chaines)
  if (valeur && typeof valeur === 'object') return Object.values(valeur).flatMap(chaines)
  return []
}

describe('IMAGES', () => {
  it.each(Object.entries(IMAGES))('should point %s to a real file of public/landing', (_cle, image) => {
    expect(image.src.startsWith('/landing/')).toBe(true)
    expect(existsSync(path.join(DOSSIER_PUBLIC, image.src))).toBe(true)
  })

  it('should give every image a non-empty alternative text', () => {
    for (const image of Object.values(IMAGES)) expect(image.alt.trim().length).toBeGreaterThan(0)
  })

  it('should leave no orphan file in public/landing', () => {
    const referencees = new Set(Object.values(IMAGES).map(i => path.basename(i.src)))
    const presents = readdirSync(path.join(DOSSIER_PUBLIC, 'landing'))

    expect(presents.filter(f => !referencees.has(f))).toEqual([])
  })

  it('should only be referenced by components through existing keys', () => {
    const cles = new Set(Object.keys(IMAGES))
    for (const fichier of fichiersVue()) {
      const source = readFileSync(fichier, 'utf8')
      for (const m of source.matchAll(/\bIMAGES\.(\w+)/g)) expect(cles.has(m[1] as string)).toBe(true)
    }
  })
})

describe('références d’images des données', () => {
  const cles = new Set(Object.keys(IMAGES))

  it('should reference an existing IMAGES key for each demo service', () => {
    for (const service of SERVICES_DEMO) expect(cles.has(service.image)).toBe(true)
  })

  it('should reference 3 existing IMAGES keys for the demo realisation', () => {
    expect(REALISATION_DEMO.images).toHaveLength(3)
    for (const cle of REALISATION_DEMO.images) expect(cles.has(cle)).toBe(true)
  })

  it('should reference an existing IMAGES key for each trade', () => {
    for (const metier of METIERS_DEMO) expect(cles.has(metier.image)).toBe(true)
  })
})

describe('ETAPES_COMPRIS', () => {
  it('should contain 4 steps', () => {
    expect(ETAPES_COMPRIS).toHaveLength(4)
  })

  it('should give each step 3 non-empty points, a title and a description', () => {
    for (const etape of ETAPES_COMPRIS) {
      expect(etape.titre.trim()).not.toBe('')
      expect(etape.description.trim()).not.toBe('')
      expect(etape.points).toHaveLength(3)
      for (const point of etape.points) expect(point.trim()).not.toBe('')
    }
  })

  it('should have distinct step titles', () => {
    expect(new Set(ETAPES_COMPRIS.map(e => e.titre)).size).toBe(ETAPES_COMPRIS.length)
  })
})

describe('ancres', () => {
  const ids = idsDeclares()

  it('should find every expected anchor id in the components and the page', () => {
    for (const id of IDS_ATTENDUS) expect(ids).toContain(id)
  })

  it('should declare each id only once across the page', () => {
    const doublons = ids.filter((id, i) => ids.indexOf(id) !== i)

    expect(doublons).toEqual([])
  })

  it('should point every NAV_LIENS entry to an existing id', () => {
    for (const lien of NAV_LIENS) {
      expect(lien.ancre).toMatch(/^#[a-z0-9-]+$/)
      expect(ids).toContain(lien.ancre.slice(1))
    }
  })

  it('should point every demo bio link to an existing id', () => {
    for (const lien of LIEN_BIO_DEMO.liens) expect(ids).toContain(lien.ancre.slice(1))
  })

  it('should have exactly one main bio link', () => {
    expect(LIEN_BIO_DEMO.liens.filter(l => 'principal' in l && l.principal)).toHaveLength(1)
  })

  it('should point every hash link written in the components to an existing id', () => {
    for (const fichier of fichiersVue()) {
      const source = readFileSync(fichier, 'utf8')
      const liens = [...source.matchAll(/(?:href|to)="#([a-z0-9-]+)"/g), ...source.matchAll(/'#([a-z0-9-]+)'/g)]
      for (const m of liens) expect(ids, `${path.basename(fichier)} → #${m[1]}`).toContain(m[1])
    }
  })

  it('should have no empty or duplicated navigation label', () => {
    const libelles = NAV_LIENS.map(l => l.libelle)

    expect(libelles.every(l => l.trim() !== '')).toBe(true)
    expect(new Set(libelles).size).toBe(libelles.length)
  })
})

describe('vocabulaire interdit côté utilisateur', () => {
  const INTERDITS = /(?<![\p{L}-])(espaces?|blocs?|modules?|widgets?|sections?)(?![\p{L}-])/iu
  const exports = { NAV_LIENS, IMAGES, SERVICES_DEMO, REALISATION_DEMO, TEMOIGNAGES_DEMO, LIEN_BIO_DEMO, ETAPES_COMPRIS, METIERS_DEMO, FAQ, ADRESSES_EXEMPLES }

  it.each(Object.entries(exports))('should not use a forbidden word in %s', (_nom, valeur) => {
    const fautifs = chaines(valeur).filter(texte => INTERDITS.test(texte))

    expect(fautifs).toEqual([])
  })

  it('should not use a forbidden word in the visible text of the components', () => {
    const fautifs: string[] = []
    for (const fichier of fichiersVue()) {
      const source = readFileSync(fichier, 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/<\/?section\b/g, '<')
      const m = INTERDITS.exec(source)
      if (m) fautifs.push(`${path.basename(fichier)} : « ${m[0]} »`)
    }

    expect(fautifs).toEqual([])
  })
})

describe('aucune donnée de plan en dur', () => {
  it('should mention a currency only in SERVICES_DEMO prices', () => {
    const hors = { NAV_LIENS, IMAGES, REALISATION_DEMO, TEMOIGNAGES_DEMO, LIEN_BIO_DEMO, ETAPES_COMPRIS, METIERS_DEMO, FAQ, ADRESSES_EXEMPLES }

    expect(chaines(hors).filter(t => /XAF|FCFA|CFA|€|\$/.test(t))).toEqual([])
  })

  it('should not announce a plan limit in the FAQ or the steps', () => {
    const textes = chaines({ FAQ, ETAPES_COMPRIS })

    expect(textes.filter(t => /\b\d+\s*(services?|réalisations?|témoignages?|liens?|vitrines?|Mo|Go|photos?)\b/i.test(t))).toEqual([])
  })
})

describe('SERVICES_DEMO', () => {
  it('should contain at least one service', () => {
    expect(SERVICES_DEMO.length).toBeGreaterThan(0)
  })

  it.each(SERVICES_DEMO.map(s => [s.titre, s] as const))('should keep meta equal to duree and prix for %s', (_titre, service) => {
    expect(service.meta).toBe(`${service.duree} · ${service.prix}`)
  })

  it.each(SERVICES_DEMO.map(s => [s.titre, s] as const))('should use a well-formed duration and an integer price for %s', (_titre, service) => {
    expect(service.duree).toMatch(/^\d+ (min|séances?)$/)
    expect(service.prix).toMatch(/^\d{1,3}( \d{3})* XAF$/)
    expect(Number.parseInt(service.prix.replace(/\D/g, ''), 10)).toBeGreaterThan(0)
  })

  it('should have distinct titles', () => {
    expect(new Set(SERVICES_DEMO.map(s => s.titre)).size).toBe(SERVICES_DEMO.length)
  })
})

describe('autres données', () => {
  it('should provide a non-empty initial, name and quote for every testimonial, with an uppercase initial taken from the name', () => {
    for (const t of TEMOIGNAGES_DEMO) {
      expect(t.citation.trim()).not.toBe('')
      expect(t.nom.trim()).not.toBe('')
      expect(t.initiale).toHaveLength(1)
      expect(t.initiale).toBe(t.initiale.toUpperCase())
      expect(t.nom).toContain(t.initiale)
    }
  })

  it('should provide a non-empty answer for every FAQ question, without duplicates', () => {
    for (const q of FAQ) {
      expect(q.question.trim()).not.toBe('')
      expect(q.reponse.trim()).not.toBe('')
    }
    expect(new Set(FAQ.map(q => q.question)).size).toBe(FAQ.length)
  })

  it('should propose only valid and non-reserved example addresses', () => {
    for (const adresse of ADRESSES_EXEMPLES) expect(validateUsername(adresse).success, adresse).toBe(true)
  })

  it('should use a valid username for the example vitrine route', () => {
    expect(ROUTE_EXEMPLE.startsWith('/')).toBe(true)
    expect(validateUsername(ROUTE_EXEMPLE.slice(1)).success).toBe(true)
  })

  it('should use the reserved login route for the connection link', () => {
    expect(ROUTE_CONNEXION).toBe('/connexion')
    expect(validateUsername(ROUTE_CONNEXION.slice(1)).success).toBe(false)
  })
})
