import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// U8 / CA37 — convention de nommage des routes (spec S2 §2).
// Jamais de point avant un crochet : `services.[slug].get.ts` ne définit PAS la route
// /services/:slug (le point n'est pas un séparateur), il est donc inatteignable.

const RACINE = path.resolve(import.meta.dirname, '../..')
const DOSSIERS_DE_ROUTES = ['server/api', 'server/routes']
const POINT_AVANT_CROCHET = /\.\[/

/**
 * Exceptions TEMPORAIRES, une liste par sprint. Cette liste ne peut que rétrécir :
 * à la fin de chaque sprint, le sprint concerné retire ses fichiers (et ce test échoue
 * si un fichier listé n'existe plus — on ne garde pas d'exception périmée).
 */
const EXCEPTIONS_PAR_SPRINT: Record<string, string[]> = {
  // S3 (services) et S4 (réalisations) ont retiré leurs fichiers `x.[slug].*` : plus aucune exception.
  S5: [
    'server/api/studio/temoignages.[slug].delete.ts',
    'server/api/studio/temoignages.[slug].get.ts',
    'server/api/studio/temoignages.[slug].put.ts',
  ],
  S6: [
    'server/api/studio/liens.[slug].delete.ts',
    'server/api/studio/liens.[slug].get.ts',
    'server/api/studio/liens.[slug].put.ts',
  ],
}
const EXCEPTIONS = Object.values(EXCEPTIONS_PAR_SPRINT).flat()
/** Plafond fixé à la fin de S2 (12), réduit à 9 à la fin de S3 puis à 6 à la fin de S4 : ne jamais l'augmenter. */
const PLAFOND_EXCEPTIONS = 6

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
  it('CA37 should have no route file with a dot before a bracket, apart from the explicit S5-S6 exceptions', () => {
    const fautifs = TOUS_LES_FICHIERS.filter((f) => POINT_AVANT_CROCHET.test(f) && !EXCEPTIONS.includes(f))

    expect(fautifs).toEqual([])
  })

  it('CA37 should only list exceptions that still exist (the list can only shrink)', () => {
    const perimees = EXCEPTIONS.filter((f) => !TOUS_LES_FICHIERS.includes(f))

    expect(perimees).toEqual([])
  })

  it('CA37 should never grow the exception list beyond the S4 ceiling (6)', () => {
    expect(EXCEPTIONS.length).toBeLessThanOrEqual(PLAFOND_EXCEPTIONS)
    expect(new Set(EXCEPTIONS).size).toBe(EXCEPTIONS.length)
  })

  it('CA47 should hold exactly 6 exceptions after S4 (S5 and S6 files, three each) and none for S3 nor S4', () => {
    expect(Object.keys(EXCEPTIONS_PAR_SPRINT).sort()).toEqual(['S5', 'S6'])
    expect(EXCEPTIONS).toHaveLength(6)
  })

  it('CA43 should leave no route file named services.[...] (S3 renamed them to services/[id].<methode>.ts)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /\/services\.\[/.test(f))).toEqual([])
  })

  it('CA47 should leave no route file named realisations.[...] (S4 renamed them to realisations/[id].<methode>.ts)', () => {
    expect(TOUS_LES_FICHIERS.filter((f) => /\/realisations\.\[/.test(f))).toEqual([])
  })

  it('CA37 should only tolerate exceptions of the sprints that own them (S5 temoignages, S6 liens)', () => {
    const proprietaires: Record<string, string> = { S5: 'temoignages', S6: 'liens' }
    for (const [sprint, fichiers] of Object.entries(EXCEPTIONS_PAR_SPRINT)) {
      for (const fichier of fichiers) {
        expect(fichier.startsWith(`server/api/studio/${proprietaires[sprint]}.[`)).toBe(true)
      }
    }
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
