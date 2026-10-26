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
  S3: [
    'server/api/studio/services.[slug].delete.ts',
    'server/api/studio/services.[slug].get.ts',
    'server/api/studio/services.[slug].put.ts',
  ],
  S4: [
    'server/api/studio/realisations.[slug].delete.ts',
    'server/api/studio/realisations.[slug].get.ts',
    'server/api/studio/realisations.[slug].put.ts',
  ],
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
/** Plafond fixé à la fin de S2 : ne jamais l'augmenter. */
const PLAFOND_EXCEPTIONS = 12

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
  it('CA37 should have no route file with a dot before a bracket, apart from the explicit S3-S6 exceptions', () => {
    const fautifs = TOUS_LES_FICHIERS.filter((f) => POINT_AVANT_CROCHET.test(f) && !EXCEPTIONS.includes(f))

    expect(fautifs).toEqual([])
  })

  it('CA37 should only list exceptions that still exist (the list can only shrink)', () => {
    const perimees = EXCEPTIONS.filter((f) => !TOUS_LES_FICHIERS.includes(f))

    expect(perimees).toEqual([])
  })

  it('CA37 should never grow the exception list beyond the S2 ceiling', () => {
    expect(EXCEPTIONS.length).toBeLessThanOrEqual(PLAFOND_EXCEPTIONS)
    expect(new Set(EXCEPTIONS).size).toBe(EXCEPTIONS.length)
  })

  it('CA37 should only tolerate exceptions of the sprints that own them (S3 services, S4 realisations, S5 temoignages, S6 liens)', () => {
    const proprietaires: Record<string, string> = { S3: 'services', S4: 'realisations', S5: 'temoignages', S6: 'liens' }
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
