import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { IA_TYPES } from '../../shared/ia'
import { FILE_IA, JOBS } from '../../shared/jobs'
import * as jobs from '../../shared/jobs'

// Décision #24 : contrats partagés du SEO IA (types, file, nom de job) et câblage du worker.
// worker/index.ts est un script de démarrage non importable : le câblage se lit dans la source.

const RACINE = path.resolve(import.meta.dirname, '../..')
const lire = (fichier: string): string => readFileSync(path.join(RACINE, fichier), 'utf-8')

const NOM_FILE_FOND = 'ia-fond'
const NOM_JOB_SEO = 'seo-ia-regenerer'

/** Nom de la constante exportée de shared/jobs.ts dont la valeur est `valeur` (on ne devine pas le nom). */
function constanteValant(valeur: string): string | undefined {
  return Object.entries(jobs).find(([, v]) => v === valeur)?.[0]
}

/** Texte d'un `new Worker(` jusqu'au suivant : contient la file, le processeur et les options. */
function blocWorker(source: string, constanteFile: string): string {
  const blocs = source.split('new Worker(').slice(1)
  // La virgule évite de confondre `FILE_IA` et `FILE_IA_FOND`.
  const trouve = blocs.find((bloc) => bloc.trimStart().startsWith(`${constanteFile},`))
  if (trouve === undefined) throw new Error(`Aucun worker pour ${constanteFile}`)
  return trouve.split('\n)\n')[0] ?? trouve
}

describe('types de génération', () => {
  it('should list seo_vitrine after the two S8 types', () => {
    expect([...IA_TYPES]).toEqual(['onboarding_vitrine', 'ameliorer_texte', 'seo_vitrine'])
  })
})

describe('file et job du SEO IA', () => {
  it('should expose a dedicated « ia-fond » queue, distinct from « ia » (a background job never waits behind an onboarding)', () => {
    const constante = constanteValant(NOM_FILE_FOND)

    expect(constante, 'aucune constante de shared/jobs.ts ne vaut « ia-fond »').toBeDefined()
    expect(NOM_FILE_FOND).not.toBe(FILE_IA)
  })

  it('should register the « seo-ia-regenerer » job name in JOBS', () => {
    expect(Object.values(JOBS)).toContain(NOM_JOB_SEO)
  })

  it('should give every queue its own name, « ia-fond » included', () => {
    const noms = Object.entries(jobs).filter(([cle, valeur]) => cle.startsWith('FILE_') && typeof valeur === 'string').map(([, valeur]) => valeur)

    expect(noms).toContain(NOM_FILE_FOND)
    expect(new Set(noms).size).toBe(noms.length)
  })
})

describe('câblage du worker', () => {
  const worker = lire('worker/index.ts')

  it('should run a worker on « ia-fond » that regenerates the SEO and nothing else', () => {
    const constante = constanteValant(NOM_FILE_FOND)
    expect(constante).toBeDefined()

    const bloc = blocWorker(worker, constante ?? NOM_FILE_FOND)

    expect(bloc).toContain('regenererSeoVitrine')
    expect(bloc).not.toContain('executeGeneration')
    expect(bloc).not.toContain('purge')
  })

  it('should keep the onboarding queue « ia » free of the SEO job', () => {
    expect(blocWorker(worker, 'FILE_IA')).not.toContain('regenererSeoVitrine')
  })

  it('should close the « ia-fond » worker on shutdown', () => {
    const constante = constanteValant(NOM_FILE_FOND)
    expect(constante).toBeDefined()

    const declaration = new RegExp(`const (\\w+) = new Worker\\(\\s+${constante ?? ''},`).exec(worker)

    expect(declaration, 'le worker « ia-fond » doit être déclaré par `const x = new Worker(`').not.toBeNull()
    expect(worker).toContain(`${declaration?.[1] ?? ''}.close()`)
  })

  it('should validate the job payload with schemaSeoJobData before regenerating', () => {
    expect(worker).toContain('schemaSeoJobData')
  })
})
