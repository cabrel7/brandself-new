// S12 (#162) : cohérence des budgets Lighthouse, du workflow CI et de la configuration Playwright SEO. Lecture de fichiers, aucune base.
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BUDGET_CLS,
  BUDGET_LCP_MS,
  BUDGET_SCORE_A11Y,
  BUDGET_SCORE_BONNES_PRATIQUES,
  BUDGET_SCORE_PERF,
  BUDGET_SCORE_SEO,
  BUDGET_TBT_MS,
  LIGHTHOUSE_PASSAGES,
} from '../../shared/seo'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const lire = (fichier: string): string => readFileSync(path.join(RACINE, fichier), 'utf-8')

interface Assertion { 0: string, 1: { minScore?: number, maxNumericValue?: number } }
interface LighthouseRc {
  ci: {
    collect: { numberOfRuns: number, url: string[], startServerCommand?: string }
    assert: { assertions: Record<string, Assertion> }
    upload: { target: string }
  }
}

function chargerLighthouse(ci: boolean): LighthouseRc {
  const exiger = createRequire(import.meta.url)
  const chemin = path.join(RACINE, 'lighthouserc.cjs')
  const ancien = process.env.CI
  if (ci) process.env.CI = 'true'
  else delete process.env.CI
  Reflect.deleteProperty(exiger.cache, chemin)
  try {
    return exiger(chemin) as LighthouseRc
  } finally {
    if (ancien === undefined) delete process.env.CI
    else process.env.CI = ancien
    Reflect.deleteProperty(exiger.cache, chemin)
  }
}

describe('lighthouserc.cjs', () => {
  const rc = chargerLighthouse(true)
  const seuil = (cle: string): number | undefined => {
    const options = rc.ci.assert.assertions[cle]?.[1]
    return options?.minScore ?? options?.maxNumericValue
  }

  it('should enforce the BUDGET_* constants of shared/seo.ts', () => {
    expect(seuil('largest-contentful-paint')).toBe(BUDGET_LCP_MS)
    expect(seuil('cumulative-layout-shift')).toBe(BUDGET_CLS)
    expect(seuil('total-blocking-time')).toBe(BUDGET_TBT_MS)
    expect(seuil('categories:seo')).toBe(BUDGET_SCORE_SEO)
    expect(seuil('categories:accessibility')).toBe(BUDGET_SCORE_A11Y)
    expect(seuil('categories:best-practices')).toBe(BUDGET_SCORE_BONNES_PRATIQUES)
    expect(seuil('categories:performance')).toBe(BUDGET_SCORE_PERF)
    expect(rc.ci.collect.numberOfRuns).toBe(LIGHTHOUSE_PASSAGES)
  })

  it('should never upload to a public storage', () => {
    expect(rc.ci.upload.target).toBe('filesystem')
    expect(lire('lighthouserc.cjs')).not.toContain("target: 'temporary-public-storage'")
  })

  it('should not start a second server in CI (the workflow owns it), but should locally', () => {
    expect(rc.ci.collect.startServerCommand).toBeUndefined()
    expect(chargerLighthouse(false).ci.collect.startServerCommand).toContain('.output/server/index.mjs')
  })

  it('should audit the landing, tarifs and the demo showcase, not the noindex lien-bio page', () => {
    const urls = rc.ci.collect.url
    expect(urls.some((url) => /localhost:\d+\/$/.test(url))).toBe(true)
    expect(urls.some((url) => url.endsWith('/tarifs'))).toBe(true)
    expect(urls.some((url) => url.endsWith('/dr-cabrel'))).toBe(true)
    expect(urls.some((url) => url.includes('/@'))).toBe(false)
  })
})

describe('.github/workflows/ci.yml : job seo-perf', () => {
  const ci = lire('.github/workflows/ci.yml')
  const job = ci.slice(ci.indexOf('  seo-perf:'))

  it('should provide what shared/env.ts requires in production, for the build and the server', () => {
    // A1 (D-A1-02) : `ADMIN_HOST` est obligatoire en production (`pnpm build` échoue sans lui).
    for (const cle of ['NODE_ENV: production', 'RESEND_API_KEY:', 'EMAIL_EXPEDITEUR:', 'NUXT_PUBLIC_SITE_URL: https://', 'NUXT_PUBLIC_SITE_ENV: production', 'ADMIN_HOST:']) {
      expect(job, cle).toContain(cle)
    }
  })

  it('should start the server once and wait for its port before the tests', () => {
    expect(job.match(/index\.mjs/g)).toHaveLength(1)
    expect(job.indexOf('--retry-connrefused')).toBeGreaterThan(job.indexOf('index.mjs'))
    expect(job.indexOf('pnpm e2e:seo')).toBeGreaterThan(job.indexOf('--retry-connrefused'))
    expect(job.indexOf('pnpm perf')).toBeGreaterThan(job.indexOf('pnpm e2e:seo'))
  })

  it('should install the Playwright browser it needs', () => {
    expect(job).toContain('playwright install')
  })
})

describe('configuration Playwright SEO', () => {
  it('should point at existing directories that contain specs', () => {
    expect(existsSync(path.join(RACINE, 'e2e/seo'))).toBe(true)
    expect(existsSync(path.join(RACINE, 'e2e/a11y'))).toBe(true)
    const config = lire('playwright.seo.config.ts')
    expect(config).toContain("testDir: './e2e'")
    expect(config).toContain('seo/**/*.spec.ts')
    expect(config).toContain('a11y/**/*.spec.ts')
  })

  it('should keep seo and a11y specs out of the dev-server e2e run', () => {
    const config = lire('playwright.config.ts')
    expect(config).toContain("'seo/**'")
    expect(config).toContain("'a11y/**'")
  })
})
