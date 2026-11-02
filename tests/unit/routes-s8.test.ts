import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// S8 §6 / CA52 / CA53 : les six routes de l'inscription guidée et de l'IA sont fines (valider, déléguer,
// répondre), authentifiées AVANT toute lecture de la requête, et ne divulguent rien d'interne.
// La clé du fournisseur n'est lue que par le worker : jamais dans le processus web (spec CHALLENGE n°4).

const RACINE = path.resolve(import.meta.dirname, '../..')

const ROUTES_S8 = [
  'server/api/studio/onboarding/index.get.ts',
  'server/api/studio/onboarding/index.put.ts',
  'server/api/studio/onboarding/generer.post.ts',
  'server/api/studio/onboarding/terminer.post.ts',
  'server/api/studio/generations/[id].get.ts',
  'server/api/studio/ia/ameliorer.post.ts',
] as const

const DOSSIERS_S8 = ['server/api/studio/onboarding', 'server/api/studio/generations', 'server/api/studio/ia']

function lire(fichier: string): string {
  return readFileSync(path.join(RACINE, fichier), 'utf-8')
}

function listerRecursif(dossier: string, extensions: string[]): string[] {
  const absolu = path.join(RACINE, dossier)
  if (!existsSync(absolu)) return []
  return readdirSync(absolu, { recursive: true, withFileTypes: true })
    .filter((entree) => entree.isFile() && extensions.some((ext) => entree.name.endsWith(ext)))
    .map((entree) => path.relative(RACINE, path.join(entree.parentPath, entree.name)).split(path.sep).join('/'))
    .sort()
}

describe('routes S8 : emplacement (CA52, convention U8)', () => {
  it.each(ROUTES_S8)('%s should exist', (fichier) => {
    expect(existsSync(path.join(RACINE, fichier))).toBe(true)
  })

  it('should provide exactly the six expected route files, no more', () => {
    const trouvees = DOSSIERS_S8.flatMap((dossier) => listerRecursif(dossier, ['.ts'])).sort()

    expect(trouvees).toEqual([...ROUTES_S8].sort())
  })

  it('should never place a dot before a bracket in a route file name (the route would be unreachable)', () => {
    for (const fichier of ROUTES_S8) expect(fichier).not.toMatch(/\.\[/)
  })

  it('should keep nothing under server/api/public that could shadow a username (onboarding, generations, ia)', () => {
    for (const nom of ['onboarding', 'generations', 'ia']) {
      expect(existsSync(path.join(RACINE, 'server/api/public', nom))).toBe(false)
    }
  })
})

describe('routes S8 : routes fines (architecture)', () => {
  it.each(ROUTES_S8)('%s should be wrapped in defineApiHandler', (fichier) => {
    expect(lire(fichier)).toContain('defineApiHandler')
  })

  it.each(ROUTES_S8)('%s should contain no SQL, no direct database access and no ORM import', (fichier) => {
    const source = lire(fichier)

    expect(source).not.toMatch(/from\s+['"]drizzle-orm/)
    expect(source).not.toMatch(/utils\/db['"]/)
    expect(source).not.toMatch(/shared\/db\/schema|#shared\/db\/schema/)
  })

  it.each(ROUTES_S8)('%s should delegate to the service layer', (fichier) => {
    expect(lire(fichier)).toMatch(/#server\/services\//)
  })

  it.each(ROUTES_S8)('%s should answer through a resource mapper, never a raw row', (fichier) => {
    expect(lire(fichier)).toMatch(/#server\/resources\//)
  })

  it.each(ROUTES_S8)('%s should require a user session before reading the request', (fichier) => {
    const source = lire(fichier)
    const positionSession = source.indexOf('requireUserSession')

    expect(positionSession).toBeGreaterThan(-1)
    for (const lecture of ['readBodyWith', 'readParamsWith', 'readQueryWith', 'readBody', 'getRouterParam', 'getQuery']) {
      const position = source.indexOf(`${lecture}(`)
      if (position !== -1) expect(positionSession, lecture).toBeLessThan(position)
    }
  })

  it.each(ROUTES_S8.filter((f) => /\.(post|put)\.ts$/.test(f)))('%s should validate its body with a shared Zod schema (readBodyWith)', (fichier) => {
    const source = lire(fichier)

    expect(source).toContain('readBodyWith')
    expect(source).toMatch(/#shared\/schemas\/(onboarding|ia)/)
  })

  it.each(ROUTES_S8)('%s should read process.env nowhere (CLAUDE.md rule 7)', (fichier) => {
    expect(lire(fichier)).not.toContain('process.env')
  })

  it.each(ROUTES_S8)('%s should not mention the provider key or call a provider directly', (fichier) => {
    const source = lire(fichier)

    expect(source).not.toContain('IA_CLE_API')
    expect(source).not.toMatch(/@anthropic-ai\/sdk|fournisseurs\//)
  })

  it('should answer 202 on generation and amelioration requests (the work happens in a job)', () => {
    expect(lire('server/api/studio/onboarding/generer.post.ts')).toMatch(/setResponseStatus[\s\S]*\b202\b/)
    expect(lire('server/api/studio/ia/ameliorer.post.ts')).toMatch(/setResponseStatus\(\s*event\s*,\s*202\s*\)/)
  })

  it('should answer 200 (not 202) for a deduplicated generation: the status depends on the service verdict', () => {
    const source = lire('server/api/studio/onboarding/generer.post.ts')

    expect(source).toMatch(/\b202\b/)
    expect(source).toMatch(/\?|if\s*\(/)
  })

  it('should answer 201 on creation and 200 on replay for terminer', () => {
    const source = lire('server/api/studio/onboarding/terminer.post.ts')

    expect(source).toMatch(/\b201\b/)
    expect(source).toMatch(/\?|if\s*\(/)
  })

  it('should forbid caching of a generation (CA53: Cache-Control no-store)', () => {
    const source = lire('server/api/studio/generations/[id].get.ts')

    expect(source).toMatch(/no-store/)
    expect(source).toMatch(/[Cc]ache-[Cc]ontrol/)
  })

  it('should treat a malformed generation id as « not found », never as a validation error', () => {
    const source = lire('server/api/studio/generations/[id].get.ts')

    expect(source).toMatch(/schemaGenerationIdParams/)
    expect(source).toMatch(/GENERATION_INTROUVABLE|NotFoundError|getOwnGeneration/)
  })
})

describe('clé du fournisseur : lue par le worker seul', () => {
  const AUTORISES = new Set([
    'shared/env.ts',
    'shared/ia.ts',
    'server/services/ia/fournisseurs/index.ts',
    'server/services/ia/fournisseurs/anthropic.ts',
    'worker/index.ts',
  ])

  it('should name IA_CLE_API only in the configuration file and the provider factory', () => {
    const fichiers = ['server', 'app', 'shared', 'worker', 'e2e']
      .flatMap((dossier) => listerRecursif(dossier, ['.ts', '.vue']))
      .filter((fichier) => !fichier.startsWith('e2e/') || fichier.includes('ia'))
    const utilisateurs = fichiers.filter((fichier) => lire(fichier).includes('IA_CLE_API'))

    expect(utilisateurs.filter((fichier) => !AUTORISES.has(fichier))).toEqual([])
  })

  it('should keep the key out of nuxt.config.ts (runtimeConfig and public config)', () => {
    expect(lire('nuxt.config.ts')).not.toContain('IA_CLE_API')
  })

  it('should keep the Anthropic SDK out of the Nuxt app and the routes', () => {
    const fichiers = ['app', 'server/api', 'server/routes', 'server/middleware'].flatMap((d) => listerRecursif(d, ['.ts', '.vue']))

    expect(fichiers.filter((fichier) => lire(fichier).includes('@anthropic-ai/sdk'))).toEqual([])
  })
})

describe('services IA : pas de process.env hors configuration (CLAUDE.md rule 7)', () => {
  it('should not read process.env in server/services/ia, server/jobs/ia.ts and the S8 onboarding services', () => {
    const fichiers = [
      ...listerRecursif('server/services/ia', ['.ts']),
      'server/jobs/ia.ts',
      'server/services/onboarding.ts',
      'server/services/onboarding-regles.ts',
      'server/services/plans.ts',
      'server/config/plans.ts',
    ].filter((fichier) => existsSync(path.join(RACINE, fichier)))

    expect(fichiers.length).toBeGreaterThan(0)
    expect(fichiers.filter((fichier) => lire(fichier).includes('process.env'))).toEqual([])
  })

  it('should find the S8 service files (RED until the backend lots exist)', () => {
    for (const fichier of [
      'server/services/ia/generations.ts',
      'server/services/ia/nettoyage.ts',
      'server/services/ia/verification.ts',
      'server/services/ia/repli.ts',
      'server/services/ia/prompts.ts',
      'server/services/ia/types.ts',
      'server/services/ia/fournisseurs/index.ts',
      'server/services/ia/fournisseurs/faux.ts',
      'server/services/ia/fournisseurs/anthropic.ts',
      'server/services/onboarding.ts',
      'server/services/onboarding-regles.ts',
      'server/services/plans.ts',
      'server/config/plans.ts',
      'server/jobs/ia.ts',
      'server/resources/generation.ts',
      'server/resources/onboarding.ts',
    ]) {
      expect(existsSync(path.join(RACINE, fichier)), fichier).toBe(true)
    }
  })
})
