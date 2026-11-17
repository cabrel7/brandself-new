import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// A1 spec §7 : « Vérifier que ces fichiers sont lancés dans le workflow de CI ». Un test d'intégration n'existe que
// s'il tourne en CI (CLAUDE.md §7) : on lit le workflow et la configuration au lieu de le supposer.

const RACINE = path.resolve(import.meta.dirname, '../../..')
const lire = (fichier: string): string => readFileSync(path.join(RACINE, fichier), 'utf-8')

/** Texte d'un job du workflow : de `  <nom>:` au job suivant (indentation de 2 espaces). */
function job(ci: string, nom: string): string {
  const debut = ci.indexOf(`\n  ${nom}:\n`)
  if (debut === -1) throw new Error(`Job « ${nom} » absent du workflow.`)
  const suite = ci.slice(debut + 1).split(/\n {2}[a-z][\w-]*:\n/)
  return suite[0] ?? ''
}

describe('CI : les tests de l\'administration sont lancés', () => {
  const ci = lire('.github/workflows/ci.yml')

  it('should run unit AND integration projects in the verification job (pnpm test, no project filter)', () => {
    const verification = job(ci, 'verification')

    expect(verification).toMatch(/run: pnpm test\b(?! --project)/)
    expect(verification).not.toMatch(/--project (unit|integration)/)
  })

  it('should provide a real PostgreSQL and a real Redis to the verification job (the journal tests need both)', () => {
    const verification = job(ci, 'verification')

    expect(verification).toContain('postgres:')
    expect(verification).toContain('redis:')
    expect(verification).toMatch(/DATABASE_URL: .*_test/)
    expect(verification).toMatch(/REDIS_URL: .*\/15/)
  })

  it('should fail the verification job on a skipped test (a skipped test is not a passed test)', () => {
    expect(job(ci, 'verification')).toContain('verifier-tests-sautes')
  })

  it('should set ADMIN_HOST for the production builds, as an apex-distinct host', () => {
    for (const nom of ['verification', 'seo-perf']) {
      const texte = job(ci, nom)
      expect(texte, nom).toMatch(/ADMIN_HOST: [a-z0-9.-]+\.[a-z]+/)
      const adminHost = /ADMIN_HOST: ([^\s]+)/.exec(texte)?.[1]
      const siteUrl = /NUXT_PUBLIC_SITE_URL: https:\/\/([^\s/]+)/.exec(texte)?.[1]
      expect(adminHost, nom).not.toBe(siteUrl)
    }
  })

  it('should run the Playwright specs in the e2e job without filtering the administration ones out', () => {
    const e2e = job(ci, 'e2e')

    expect(e2e).toContain('run: pnpm e2e')
    expect(e2e).not.toMatch(/pnpm e2e .*--grep-invert/)
    expect(e2e).toMatch(/NODE_ENV: development/)
    expect(e2e).toContain('pnpm db:migrate')
  })

  it('should not set ADMIN_HOST in the e2e job: development falls back to admin.localhost, which Chromium maps to 127.0.0.1', () => {
    expect(job(ci, 'e2e')).not.toContain('ADMIN_HOST')
  })
})

describe('Playwright : configuration de l\'hôte d\'administration', () => {
  const config = lire('playwright.config.ts')

  it('should map admin.localhost to 127.0.0.1 for Chromium, so that pages answer on the administration host', () => {
    expect(config).toContain('--host-resolver-rules=MAP admin.localhost 127.0.0.1')
  })

  it('should keep the existing project and not ignore the administration specs', () => {
    expect(config).toContain("name: 'chromium'")
    expect(config).toContain("testIgnore: ['seo/**', 'a11y/**'")
    expect(config).not.toMatch(/testIgnore:[^\n]*admin/)
    expect(config).toContain("testDir: './e2e'")
  })

  it('should keep one worker (the machine is shared, two Chromium instances abort navigations)', () => {
    expect(config).toMatch(/workers: 1/)
  })

  it('should ship the administration specs and their helper', () => {
    for (const fichier of ['e2e/admin-acces.spec.ts', 'e2e/admin-surfaces.spec.ts', 'e2e/helpers/admin.ts']) {
      expect(existsSync(path.join(RACINE, fichier)), fichier).toBe(true)
    }
  })
})

describe('Vitest : les dossiers de tests de l\'administration sont collectés', () => {
  const vitest = lire('vitest.config.ts')

  it('should include tests/unit/** and tests/integration/** (admin tests live in sub-folders)', () => {
    expect(vitest).toContain("include: ['tests/unit/**/*.test.ts', 'tests/*.test.ts']")
    expect(vitest).toContain("include: ['tests/integration/**/*.test.ts']")
  })

  it('should have the administration test files where the specification puts them', () => {
    for (const fichier of [
      'tests/unit/admin/hote.test.ts',
      'tests/unit/admin/env-admin.test.ts',
      'tests/unit/admin/contrat-confidentialite.test.ts',
      'tests/integration/admin/journal.test.ts',
      'tests/integration/admin/reauth.test.ts',
      'tests/integration/admin/session-admin.test.ts',
      'tests/integration/admin/scripts.test.ts',
      'tests/integration/support/admin.ts',
      'tests/integration/migration-0028.test.ts',
    ]) {
      expect(existsSync(path.join(RACINE, fichier)), fichier).toBe(true)
    }
  })
})
