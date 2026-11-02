import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// U8 / CA37 — convention de nommage des routes (spec S2 §2).
// Jamais de point avant un crochet : `services.[slug].get.ts` ne définit PAS la route
// /services/:slug (le point n'est pas un séparateur), il est donc inatteignable.

const RACINE = path.resolve(import.meta.dirname, '../..')
const DOSSIERS_DE_ROUTES = ['server/api', 'server/routes']
const POINT_AVANT_CROCHET = /\.\[/

/** Toute exception a été supprimée : une nouvelle route fautive doit toujours échouer. */
const EXCEPTIONS_PAR_SPRINT: Record<string, string[]> = {}
const EXCEPTIONS = Object.values(EXCEPTIONS_PAR_SPRINT).flat()
const PLAFOND_EXCEPTIONS = 0

function listerFichiers(dossier: string): string[] {
  const absolu = path.join(RACINE, dossier)
  if (!existsSync(absolu)) return []
  return readdirSync(absolu, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile())
    .map((entree) => path.relative(RACINE, path.join(entree.parentPath, entree.name)).split(path.sep).join('/'))
    .sort()
}

const TOUS_LES_FICHIERS = DOSSIERS_DE_ROUTES.flatMap(listerFichiers)

describe('convention de routes (U8, CA37)', () => {
  it('CA37 should have no route file with a dot before a bracket', () => {
    const fautifs = TOUS_LES_FICHIERS.filter((f) => POINT_AVANT_CROCHET.test(f) && !EXCEPTIONS.includes(f))

    expect(fautifs).toEqual([])
  })

  it('CA37 should only list exceptions that still exist (the list can only shrink)', () => {
    const perimees = EXCEPTIONS.filter((f) => !TOUS_LES_FICHIERS.includes(f))

    expect(perimees).toEqual([])
  })

  it('CA37 should never grow the exception list again', () => {
    expect(EXCEPTIONS.length).toBeLessThanOrEqual(PLAFOND_EXCEPTIONS)
    expect(new Set(EXCEPTIONS).size).toBe(EXCEPTIONS.length)
  })

  it('should keep zero exception after the S5 route migration', () => {
    expect(Object.keys(EXCEPTIONS_PAR_SPRINT)).toEqual([])
    expect(EXCEPTIONS).toHaveLength(0)
  })

  it('CA43 should leave no route file named services.[...] (S3 renamed them to services/[id].<methode>.ts)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /\/services\.\[/.test(f))).toEqual([])
  })

  it('CA47 should leave no route file named realisations.[...] (S4 renamed them to realisations/[id].<methode>.ts)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /\/realisations\.\[/.test(f))).toEqual([])
  })

})

describe('routes S2 : emplacement cible (spec §2)', () => {
  const CIBLES = [
    'server/api/studio/vitrine/index.get.ts',
    'server/api/studio/vitrine/index.post.ts',
    'server/api/studio/vitrine/index.put.ts',
    'server/api/studio/vitrine/username.put.ts',
    'server/api/studio/vitrine/publier.post.ts',
    'server/api/studio/vitrine/depublier.post.ts',
    'server/api/studio/moi/index.get.ts',
    'server/api/studio/moi/index.put.ts',
    'server/api/studio/moi/index.delete.ts',
    'server/api/studio/medias/index.post.ts',
    'server/api/studio/medias/[id].delete.ts',
    'server/api/studio/appareils/index.get.ts',
    'server/api/studio/appareils/[id].delete.ts',
    'server/api/studio/username-disponible.get.ts',
    'server/api/public/[username]/index.get.ts',
    'server/routes/medias/[id]/[fichier].get.ts',
  ]

  const ANCIENS = [
    'server/api/studio/vitrine.get.ts',
    'server/api/studio/vitrine.post.ts',
    'server/api/studio/vitrine.put.ts',
    'server/api/studio/moi.get.ts',
    'server/api/studio/moi.put.ts',
    'server/api/studio/medias.post.ts',
    'server/api/studio/medias.[id].delete.ts',
    'server/api/public/[username].get.ts',
  ]

  it.each(CIBLES)('should provide %s', (fichier) => {
    expect(TOUS_LES_FICHIERS).toContain(fichier)
  })

  it.each(ANCIENS)('should no longer keep the pre-S2 file %s (it would shadow or duplicate the new route)', (fichier) => {
    expect(TOUS_LES_FICHIERS).not.toContain(fichier)
  })
})

describe('routes S2 : routes fines (architecture)', () => {
  const ROUTES_S2 = TOUS_LES_FICHIERS.filter(
    (f) =>
      /^server\/api\/studio\/(vitrine|moi|medias|appareils)\//.test(f)
      || f === 'server/api/studio/username-disponible.get.ts'
      || f.startsWith('server/api/public/[username]/')
      || f.startsWith('server/routes/medias/'),
  )

  it('should find the S2 routes to inspect', () => {
    expect(ROUTES_S2.length).toBeGreaterThanOrEqual(10)
  })

  it.each(ROUTES_S2)('%s should be wrapped in defineApiHandler', (fichier) => {
    expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).toContain('defineApiHandler')
  })

  it.each(ROUTES_S2)('%s should contain no SQL nor direct database access', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })
})

const CIBLES_S3 = [
  'server/api/studio/services/index.get.ts',
  'server/api/studio/services/index.post.ts',
  'server/api/studio/services/[id].get.ts',
  'server/api/studio/services/[id].put.ts',
  'server/api/studio/services/[id].delete.ts',
  'server/api/studio/services/reordonner.post.ts',
  'server/api/public/[username]/services/index.get.ts',
  'server/api/public/[username]/services/[slug].get.ts',
]

describe('routes S3 : emplacement cible (spec S3 §2, CA43)', () => {
  const ANCIENS = [
    'server/api/studio/services.get.ts',
    'server/api/studio/services.post.ts',
    'server/api/studio/services.[slug].get.ts',
    'server/api/studio/services.[slug].put.ts',
    'server/api/studio/services.[slug].delete.ts',
    'server/api/public/services.get.ts',
    'server/api/public/services/[slug].get.ts',
  ]

  it.each(CIBLES_S3)('should provide %s', (fichier) => {
    expect(TOUS_LES_FICHIERS).toContain(fichier)
  })

  it.each(ANCIENS)('should no longer keep the pre-S3 file %s (unreachable, or shadowing /api/public/:username)', (fichier) => {
    expect(TOUS_LES_FICHIERS).not.toContain(fichier)
  })

  it('should keep nothing under server/api/public/services/ (the folder would shadow /api/public/:username for the username "services")', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => f.startsWith('server/api/public/services'))).toEqual([])
  })

  it('should not provide the PATCH routes dropped by the specification (a single partial PUT carries every rule)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /^server\/api\/studio\/services\/.*\.patch\.ts$/.test(f))).toEqual([])
  })
})

describe('routes S3 : routes fines (architecture)', () => {
  // Liste statique (et non les fichiers trouvés) : une route manquante fait échouer SON test, jamais un it.each vide.
  const ROUTES_S3 = CIBLES_S3

  it('should find no S3 route besides the eight expected ones', () => {
    const trouvees = TOUS_LES_FICHIERS.filter(
      (f) => f.startsWith('server/api/studio/services/') || f.startsWith('server/api/public/[username]/services/'),
    )

    expect(trouvees.sort()).toEqual([...CIBLES_S3].sort())
  })

  it.each(ROUTES_S3)('%s should be wrapped in defineApiHandler', (fichier) => {
    expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).toContain('defineApiHandler')
  })

  it.each(ROUTES_S3)('%s should contain no SQL, no direct database access and no ORM import', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })

  it.each(ROUTES_S3)('%s should delegate to the service layer and never return a raw object (resource mapping)', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toMatch(/#server\/services\/services|\.\.\/services\/services/)
    if (!fichier.endsWith('.delete.ts')) {
      expect(source).toMatch(/#server\/resources\/service|resources\/service/)
    }
  })

  it.each(ROUTES_S3.filter((f) => f.startsWith('server/api/studio/')))('%s should require a user session before anything else', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
    const positionSession = source.indexOf('requireUserSession')

    expect(positionSession).toBeGreaterThan(-1)
    for (const lecture of ['readBodyWith', 'readParamsWith', 'readQueryWith']) {
      const position = source.indexOf(`${lecture}(`)
      if (position !== -1) expect(positionSession).toBeLessThan(position)
    }
  })

  it.each(ROUTES_S3.filter((f) => /\.(post|put)\.ts$/.test(f)))('%s should validate its body with a shared Zod schema (readBodyWith)', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readBodyWith')
    expect(source).toMatch(/#shared\/schemas\/service/)
  })

  it.each(ROUTES_S3.filter((f) => f.includes('[id]')))('%s should validate :id as a uuid', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readParamsWith')
    expect(source).toMatch(/z\.uuid\(\)/)
  })

  it('should answer 201 on creation and 204 on deletion', () => {
    const creation = readFileSync(path.join(RACINE, 'server/api/studio/services/index.post.ts'), 'utf-8')
    const suppression = readFileSync(path.join(RACINE, 'server/api/studio/services/[id].delete.ts'), 'utf-8')

    expect(creation).toMatch(/setResponseStatus\(\s*event\s*,\s*201\s*\)/)
    expect(suppression).toContain('sendNoContent')
  })

  it('should read process.env nowhere in the S3 routes (CLAUDE.md rule 7: the flag goes through the service options)', () => {
    for (const fichier of ROUTES_S3) {
      expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).not.toContain('process.env')
    }
  })
})

// S4 (S4-CA47) : réalisations, même patron que S3. Liste statique (et non les fichiers trouvés) :
// une route manquante fait échouer SON test, jamais un it.each vide.
const CIBLES_S4 = [
  'server/api/studio/realisations/index.get.ts',
  'server/api/studio/realisations/index.post.ts',
  'server/api/studio/realisations/[id].get.ts',
  'server/api/studio/realisations/[id].put.ts',
  'server/api/studio/realisations/[id].delete.ts',
  'server/api/studio/realisations/reordonner.post.ts',
  'server/api/public/[username]/realisations/index.get.ts',
  'server/api/public/[username]/realisations/[slug].get.ts',
]

describe('routes S4 : emplacement cible (spec S4 §2, CA47)', () => {
  const ANCIENS = [
    'server/api/studio/realisations.get.ts',
    'server/api/studio/realisations.post.ts',
    'server/api/studio/realisations.[slug].get.ts',
    'server/api/studio/realisations.[slug].put.ts',
    'server/api/studio/realisations.[slug].delete.ts',
  ]

  it.each(CIBLES_S4)('should provide %s', (fichier) => {
    expect(TOUS_LES_FICHIERS).toContain(fichier)
  })

  it.each(ANCIENS)('should no longer keep the pre-S4 file %s (unreachable, or shadowing realisations/index)', (fichier) => {
    expect(TOUS_LES_FICHIERS).not.toContain(fichier)
  })

  it('should no longer keep the pre-S4 studio page realisations/[slug].vue (the studio now edits by [id])', () => {
    expect(existsSync(path.join(RACINE, 'app/pages/studio/realisations/[slug].vue'))).toBe(false)
  })

  it('should keep nothing under server/api/public/realisations (the folder would shadow /api/public/:username for the username "realisations")', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => f.startsWith('server/api/public/realisations'))).toEqual([])
  })

  it('should not provide the PATCH routes dropped by the specification (a single partial PUT carries every rule)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /^server\/api\/studio\/realisations\/.*\.patch\.ts$/.test(f))).toEqual([])
  })

  it('should not provide gallery routes either (the gallery travels in the body of POST and PUT, decision #46)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /^server\/api\/studio\/realisations\/.*(images|galerie)/.test(f))).toEqual([])
  })
})

describe('routes S4 : routes fines (architecture)', () => {
  const ROUTES_S4 = CIBLES_S4

  it('should find no S4 route besides the eight expected ones', () => {
    const trouvees = TOUS_LES_FICHIERS.filter(
      (f) => f.startsWith('server/api/studio/realisations/') || f.startsWith('server/api/public/[username]/realisations/'),
    )

    expect(trouvees.sort()).toEqual([...CIBLES_S4].sort())
  })

  it.each(ROUTES_S4)('%s should be wrapped in defineApiHandler', (fichier) => {
    expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).toContain('defineApiHandler')
  })

  it.each(ROUTES_S4)('%s should contain no SQL, no direct database access and no ORM import', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })

  it.each(ROUTES_S4)('%s should delegate to the service layer and never return a raw object (resource mapping)', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toMatch(/#server\/services\/realisations|\.\.\/services\/realisations/)
    if (!fichier.endsWith('.delete.ts')) {
      expect(source).toMatch(/#server\/resources\/realisation|resources\/realisation/)
    }
  })

  it.each(ROUTES_S4.filter((f) => f.startsWith('server/api/studio/')))('%s should require a user session before anything else', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
    const positionSession = source.indexOf('requireUserSession')

    expect(positionSession).toBeGreaterThan(-1)
    for (const lecture of ['readBodyWith', 'readParamsWith', 'readQueryWith']) {
      const position = source.indexOf(`${lecture}(`)
      if (position !== -1) expect(positionSession).toBeLessThan(position)
    }
  })

  it.each(ROUTES_S4.filter((f) => f.startsWith('server/api/public/')))('%s should be public: no session required (a published vitrine is readable by anyone)', (fichier) => {
    expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).not.toContain('requireUserSession')
  })

  it.each(ROUTES_S4.filter((f) => /\.(post|put)\.ts$/.test(f)))('%s should validate its body with a shared Zod schema (readBodyWith)', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readBodyWith')
    expect(source).toMatch(/#shared\/schemas\/realisation/)
  })

  it.each(ROUTES_S4.filter((f) => f.includes('[id]')))('%s should validate :id as a uuid', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readParamsWith')
    expect(source).toMatch(/z\.uuid\(\)/)
  })

  it('should answer 201 on creation and 204 on deletion', () => {
    const creation = readFileSync(path.join(RACINE, 'server/api/studio/realisations/index.post.ts'), 'utf-8')
    const suppression = readFileSync(path.join(RACINE, 'server/api/studio/realisations/[id].delete.ts'), 'utf-8')

    expect(creation).toMatch(/setResponseStatus\(\s*event\s*,\s*201\s*\)/)
    expect(suppression).toContain('sendNoContent')
  })

  it('should read process.env nowhere in the S4 routes (CLAUDE.md rule 7)', () => {
    for (const fichier of ROUTES_S4) {
      expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).not.toContain('process.env')
    }
  })

  it('should let the public home route answer the counters of the navigation (getPublicVitrinePage + toContenusPublicsResource)', () => {
    const source = readFileSync(path.join(RACINE, 'server/api/public/[username]/index.get.ts'), 'utf-8')

    expect(source).toContain('getPublicVitrinePage')
    expect(source).toContain('toContenusPublicsResource')
    expect(source).toContain('toVitrinePublicResource')
  })
})

const CIBLES_S5 = [
  'server/api/studio/temoignages/index.get.ts',
  'server/api/studio/temoignages/index.post.ts',
  'server/api/studio/temoignages/[slug].get.ts',
  'server/api/studio/temoignages/[slug].put.ts',
  'server/api/studio/temoignages/[slug].delete.ts',
  'server/api/studio/temoignages/reordonner.post.ts',
  'server/api/public/[username]/temoignages/index.get.ts',
]

describe('routes S5 : emplacement cible et fin des routes legacy', () => {
  const ANCIENS = [
    'server/api/studio/temoignages.get.ts',
    'server/api/studio/temoignages.post.ts',
    'server/api/studio/temoignages.[slug].get.ts',
    'server/api/studio/temoignages.[slug].put.ts',
    'server/api/studio/temoignages.[slug].delete.ts',
  ]

  it.each(CIBLES_S5)('should provide %s', (fichier) => {
    expect(TOUS_LES_FICHIERS).toContain(fichier)
  })

  it.each(ANCIENS)('should no longer keep legacy route %s', (fichier) => {
    expect(TOUS_LES_FICHIERS).not.toContain(fichier)
  })

  it('should expose exactly the expected studio and public testimony routes', () => {
    const trouvees = TOUS_LES_FICHIERS.filter(
      (f) => f.startsWith('server/api/studio/temoignages/') || f.startsWith('server/api/public/[username]/temoignages/'),
    )

    expect(trouvees.sort()).toEqual([...CIBLES_S5].sort())
  })
})

describe('routes S5 : routes fines, validées et sérialisées', () => {
  it.each(CIBLES_S5)('%s should be wrapped in defineApiHandler without direct database access', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('defineApiHandler')
    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })

  it.each(CIBLES_S5)('%s should delegate to the testimony service and map non-empty responses through resources', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toMatch(/#server\/services\/temoignages|\.\.\/services\/temoignages/)
    if (!fichier.endsWith('.delete.ts')) expect(source).toMatch(/#server\/resources\/temoignage|resources\/temoignage/)
  })

  it.each(CIBLES_S5.filter((f) => f.startsWith('server/api/studio/')))('%s should authenticate before validation', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
    const positionSession = source.indexOf('requireUserSession')

    expect(positionSession).toBeGreaterThan(-1)
    for (const lecture of ['readBodyWith', 'readParamsWith']) {
      const position = source.indexOf(`${lecture}(`)
      if (position !== -1) expect(positionSession).toBeLessThan(position)
    }
  })

  it.each(CIBLES_S5.filter((f) => f.includes('[slug]') && f.startsWith('server/api/studio/')))('%s should validate its slug with the shared schema', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readParamsWith')
    expect(source).toContain('schemaTemoignageParams')
  })

  it('should return DTO and counters from list, detail and update routes', () => {
    const liste = readFileSync(path.join(RACINE, 'server/api/studio/temoignages/index.get.ts'), 'utf-8')
    const detail = readFileSync(path.join(RACINE, 'server/api/studio/temoignages/[slug].get.ts'), 'utf-8')
    const modification = readFileSync(path.join(RACINE, 'server/api/studio/temoignages/[slug].put.ts'), 'utf-8')

    expect(liste).toContain('items.map(toTemoignageStudioResource)')
    for (const source of [liste, detail, modification]) {
      expect(source).toContain('toTemoignagesCompteursResource')
      expect(source).toContain('compteurs')
    }
    for (const source of [detail, modification]) expect(source).toContain('toTemoignageStudioResource(item)')
  })

  it('should validate PUT bodies and answer 204 on deletion', () => {
    const modification = readFileSync(path.join(RACINE, 'server/api/studio/temoignages/[slug].put.ts'), 'utf-8')
    const suppression = readFileSync(path.join(RACINE, 'server/api/studio/temoignages/[slug].delete.ts'), 'utf-8')

    expect(modification).toContain('readBodyWith')
    expect(modification).toContain('schemaTemoignageUpdate')
    expect(suppression).toContain('sendNoContent')
  })
})

// S6 (S6-CA48) : liens, même patron que S3/S4. Liste statique (et non les fichiers trouvés) :
// une route manquante fait échouer SON test, jamais un it.each vide.
const CIBLES_S6 = [
  'server/api/studio/liens/index.get.ts',
  'server/api/studio/liens/index.post.ts',
  'server/api/studio/liens/[id].get.ts',
  'server/api/studio/liens/[id].put.ts',
  'server/api/studio/liens/[id].delete.ts',
  'server/api/studio/liens/reordonner.post.ts',
  'server/api/public/[username]/liens/index.get.ts',
  'server/api/public/[username]/liens/[slug]/clic.post.ts',
]

describe('routes S6 : emplacement cible (spec S6, CA48)', () => {
  const ANCIENS = [
    'server/api/studio/liens.get.ts',
    'server/api/studio/liens.post.ts',
    'server/api/studio/liens.[slug].get.ts',
    'server/api/studio/liens.[slug].put.ts',
    'server/api/studio/liens.[slug].delete.ts',
  ]

  it.each(CIBLES_S6)('should provide %s', (fichier) => {
    expect(TOUS_LES_FICHIERS).toContain(fichier)
  })

  it.each(ANCIENS)('should no longer keep the pre-S6 file %s (unreachable, or shadowing the studio folder)', (fichier) => {
    expect(TOUS_LES_FICHIERS).not.toContain(fichier)
  })

  it('should keep nothing under server/api/public/liens (the folder would shadow /api/public/:username for the username "liens")', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => f.startsWith('server/api/public/liens'))).toEqual([])
  })

  it('should not provide the PATCH routes dropped by the specification (a single partial PUT carries every rule)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /^server\/api\/studio\/liens\/.*\.patch\.ts$/.test(f))).toEqual([])
  })
})

describe('routes S6 : routes fines (architecture)', () => {
  const ROUTES_S6 = CIBLES_S6

  it('should find no S6 route besides the eight expected ones', () => {
    const trouvees = TOUS_LES_FICHIERS.filter(
      (f) => f.startsWith('server/api/studio/liens/') || f.startsWith('server/api/public/[username]/liens/'),
    )

    expect(trouvees.sort()).toEqual([...CIBLES_S6].sort())
  })

  it.each(ROUTES_S6)('%s should be wrapped in defineApiHandler', (fichier) => {
    expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).toContain('defineApiHandler')
  })

  it.each(ROUTES_S6)('%s should contain no SQL, no direct database access and no ORM import', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })

  it.each(ROUTES_S6)('%s should delegate to the service layer and never return a raw object (resource mapping)', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toMatch(/#server\/services\/liens|\.\.\/services\/liens/)
    if (!fichier.endsWith('.delete.ts') && !fichier.endsWith('clic.post.ts')) {
      expect(source).toMatch(/#server\/resources\/lien|resources\/lien/)
    }
  })

  it.each(ROUTES_S6.filter((f) => f.startsWith('server/api/studio/')))('%s should require a user session before anything else', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
    const positionSession = source.indexOf('requireUserSession')

    expect(positionSession).toBeGreaterThan(-1)
    for (const lecture of ['readBodyWith', 'readParamsWith', 'readQueryWith']) {
      const position = source.indexOf(`${lecture}(`)
      if (position !== -1) expect(positionSession).toBeLessThan(position)
    }
  })

  it.each(ROUTES_S6.filter((f) => f.startsWith('server/api/public/')))('%s should be public: no session required (a published vitrine is readable by anyone)', (fichier) => {
    expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).not.toContain('requireUserSession')
  })

  it.each(ROUTES_S6.filter((f) => /\.(post|put)\.ts$/.test(f) && !f.endsWith('clic.post.ts')))('%s should validate its body with a shared Zod schema (readBodyWith)', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readBodyWith')
    expect(source).toMatch(/#shared\/schemas\/lien/)
  })

  it.each(ROUTES_S6.filter((f) => f.includes('[id]')))('%s should validate :id as a uuid', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(source).toContain('readParamsWith')
    expect(source).toMatch(/z\.uuid\(\)/)
  })

  it('should answer 201 on creation and 204 on deletion', () => {
    const creation = readFileSync(path.join(RACINE, 'server/api/studio/liens/index.post.ts'), 'utf-8')
    const suppression = readFileSync(path.join(RACINE, 'server/api/studio/liens/[id].delete.ts'), 'utf-8')

    expect(creation).toMatch(/setResponseStatus\(\s*event\s*,\s*201\s*\)/)
    expect(suppression).toContain('sendNoContent')
  })

  it('should read process.env nowhere in the S6 routes (CLAUDE.md rule 7)', () => {
    for (const fichier of ROUTES_S6) {
      expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).not.toContain('process.env')
    }
  })

  it('should pass the resolved IP to the public click rate limit', () => {
    const source = readFileSync(path.join(RACINE, 'server/api/public/[username]/liens/[slug]/clic.post.ts'), 'utf-8')

    expect(source).toContain('recordLienClic(username, slug, ip)')
  })
})

const CIBLES_S7 = [
  'server/api/public/[username]/creneaux/index.get.ts',
  'server/api/public/[username]/reservations/index.post.ts',
  'server/api/public/[username]/demandes/index.post.ts',
  'server/api/public/[username]/confirmation/index.get.ts',
  'server/api/public/[username]/confirmation/agenda.ics.get.ts',
  'server/api/studio/agenda/disponibilites/index.get.ts',
  'server/api/studio/agenda/disponibilites/index.put.ts',
  'server/api/studio/agenda/indisponibilites/index.get.ts',
  'server/api/studio/agenda/indisponibilites/index.post.ts',
  'server/api/studio/agenda/indisponibilites/[id].delete.ts',
  'server/api/studio/reservations/index.get.ts',
  'server/api/studio/reservations/[id]/confirmer.patch.ts',
  'server/api/studio/reservations/[id]/annuler.patch.ts',
  'server/api/studio/demandes/index.get.ts',
  'server/api/studio/demandes/[id].patch.ts',
]

describe('routes S7 : contrats, isolation et réponses', () => {
  it.each(CIBLES_S7)('should provide %s as a thin API handler without direct database access', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
    expect(TOUS_LES_FICHIERS).toContain(fichier)
    expect(source).toContain('defineApiHandler')
    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })

  it.each(CIBLES_S7.filter((f) => f.startsWith('server/api/studio/')))('%s should authenticate before validation', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
    const session = source.indexOf('requireUserSession')
    expect(session).toBeGreaterThan(-1)
    for (const lecture of ['readBodyWith', 'readParamsWith', 'readQueryWith']) {
      const position = source.indexOf(`${lecture}(`)
      if (position !== -1) expect(session).toBeLessThan(position)
    }
  })

  it('should validate and fail closed on both public writes', () => {
    for (const fichier of CIBLES_S7.filter((f) => /\/(reservations|demandes)\/index\.post\.ts$/.test(f))) {
      const source = readFileSync(path.join(RACINE, fichier), 'utf-8')
      expect(source).toContain('readBodyWith')
      expect(source).toContain("failClosed: true")
      expect(source).toMatch(/#shared\/schemas\/agenda/)
      expect(source).toMatch(/#server\/resources\/agenda/)
    }
  })

  it('should keep confirmation JSON and ICS private-cache free', () => {
    for (const fichier of CIBLES_S7.filter((f) => f.includes('/confirmation/'))) {
      expect(readFileSync(path.join(RACINE, fichier), 'utf-8')).toContain('no-store')
    }
  })
})

const CONSOMMATEURS_IP_CLIENT = [
  'server/api/public/[username]/reservations/index.post.ts',
  'server/api/public/[username]/demandes/index.post.ts',
  'server/middleware/otp-limiteur.ts',
  'server/api/public/[username]/liens/[slug]/clic.post.ts',
]

describe('IP client : convention anti-spoofing', () => {
  it.each(CONSOMMATEURS_IP_CLIENT)('%s should use client-ip without trusting getRequestIP xForwardedFor', (fichier) => {
    const source = readFileSync(path.join(RACINE, fichier), 'utf-8')

    expect(
      /from\s+['"][^'"]*utils\/client-ip['"]/.test(source),
      `${fichier} doit importer server/utils/client-ip`,
    ).toBe(true)
    expect(
      /\b(?:resolveClientIp|getClientIp)\s*\(/.test(source),
      `${fichier} doit appeler le helper client-ip`,
    ).toBe(true)
    expect(
      /getRequestIP\s*\([\s\S]*?xForwardedFor\s*:\s*true/.test(source),
      `${fichier} ne doit plus faire confiance directement a X-Forwarded-For`,
    ).toBe(false)
  })
})
