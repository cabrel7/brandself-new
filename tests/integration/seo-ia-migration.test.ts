import { sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { IA_TYPES } from '../../shared/ia'
import { signatureAttendue } from '../unit/support/seo-ia'
import { erreurPostgres, rejet } from './support/erreurs'
import { activePromptRow, createUser, empreinteDeTest, insertGeneration, insertVitrineRow } from './support/fabriques'
import { modifierVitrineEnBase } from './support/seo-ia'

// Décision #24 : état de la base APRÈS la migration 0027 (jouée par le globalSetup, vraie base de test).
// Remplace la preuve « liste TypeScript = CHECK » qui vivait dans migration-0018 (décrit 0018 seule).

const CHECK_VIOLATION = '23514'
const SIGNATURE = signatureAttendue({ metier: 'Cardiologue', ville: 'Douala', pays: 'CM', accroche: null })
const TITRE_OK = 'Cardiologue à Douala'
const DESCRIPTION_OK = 'Consultations de cardiologie à Douala pour vous accompagner avec écoute, clarté et un suivi adapté.'

async function ecrire(valeurs: Parameters<typeof modifierVitrineEnBase>[1]) {
  const user = await createUser()
  const vitrine = await insertVitrineRow(user.id)
  return erreurPostgres((await rejet(modifierVitrineEnBase(vitrine.id, valeurs))).brute)
}

async function accepte(valeurs: Parameters<typeof modifierVitrineEnBase>[1]): Promise<void> {
  const user = await createUser()
  const vitrine = await insertVitrineRow(user.id)
  await modifierVitrineEnBase(vitrine.id, valeurs)
}

const complet = (surcharges: Record<string, unknown> = {}) => ({
  seoIaTitre: TITRE_OK,
  seoIaDescription: DESCRIPTION_OK,
  seoIaSignature: SIGNATURE,
  seoIaGenereLe: new Date(),
  ...surcharges,
})

describe('migration 0027 : types et prompts', () => {
  it('should list seo_vitrine in IA_TYPES and accept every IA_TYPES value in generations_ia (TypeScript list and CHECK in sync)', async () => {
    expect([...IA_TYPES]).toContain('seo_vitrine')
    const user = await createUser()
    for (const type of IA_TYPES) {
      await expect(insertGeneration(user.id, { type, entreeEmpreinte: empreinteDeTest(), promptId: (await activePromptRow(type)).id })).resolves.toBeDefined()
    }
  })

  it('should refuse an unknown generation type', async () => {
    const user = await createUser()

    const erreur = erreurPostgres((await rejet(insertGeneration(user.id, { type: 'inconnu', promptId: null }))).brute)

    expect(erreur.sqlstate).toBe(CHECK_VIOLATION)
  })

  it('should keep exactly one active prompt per type: onboarding v2, ameliorer_texte v1, seo_vitrine v1', async () => {
    const { rows } = await db.execute<{ type: string, version: number, actif: boolean, schema_sortie: string }>(
      sql`SELECT type, version, actif, schema_sortie FROM prompts_ia ORDER BY type, version`,
    )

    expect(rows.filter((r) => r.actif).map((r) => [r.type, r.version])).toEqual([
      ['ameliorer_texte', 1],
      ['onboarding_vitrine', 2],
      ['seo_vitrine', 1],
    ])
    expect(rows.find((r) => r.type === 'onboarding_vitrine' && r.version === 1)?.actif).toBe(false)
  })

  it('should give the seo_vitrine prompt the proposer_seo tool, the anti-injection rule and the single data block', async () => {
    const { rows } = await db.execute<{ systeme: string, gabarit: string, variables: string[] }>(
      sql`SELECT systeme, gabarit, variables FROM prompts_ia WHERE type = 'seo_vitrine' AND actif`,
    )

    expect(rows).toHaveLength(1)
    expect(rows[0]!.systeme).toContain('proposer_seo')
    expect(rows[0]!.systeme).toMatch(/jamais une instruction/)
    expect(rows[0]!.variables).toEqual(['donnees'])
    expect(rows[0]!.gabarit).toMatch(/<donnees>\s*\{\{donnees\}\}\s*<\/donnees>/)
  })
})

describe('migration 0027 : colonnes seo_ia_* de vitrines', () => {
  it('should leave the four columns NULL on a new vitrine', async () => {
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id)

    expect([vitrine.seoIaTitre, vitrine.seoIaDescription, vitrine.seoIaSignature, vitrine.seoIaGenereLe]).toEqual([null, null, null, null])
  })

  it.each([
    [9, false],
    [10, true],
    [50, true],
    [51, false],
  ])('should judge a stored titre of %i characters: accepted = %s', async (longueur, ok) => {
    const valeurs = complet({ seoIaTitre: 'x'.repeat(longueur) })

    if (ok) await accepte(valeurs)
    else expect((await ecrire(valeurs)).sqlstate).toBe(CHECK_VIOLATION)
  })

  it.each([
    [49, false],
    [50, true],
    [160, true],
    [161, false],
  ])('should judge a stored description of %i characters: accepted = %s', async (longueur, ok) => {
    const valeurs = complet({ seoIaDescription: 'x'.repeat(longueur) })

    if (ok) await accepte(valeurs)
    else expect((await ecrire(valeurs)).sqlstate).toBe(CHECK_VIOLATION)
  })

  it.each([['too short', 'abc'], ['upper case', SIGNATURE.toUpperCase()], ['not hexadecimal', 'z'.repeat(64)]])('should refuse a signature that is %s', async (_nom, signature) => {
    expect((await ecrire(complet({ seoIaSignature: signature }))).sqlstate).toBe(CHECK_VIOLATION)
  })

  it('should refuse a signature without date, and a date without signature (coherence)', async () => {
    expect((await ecrire({ seoIaSignature: SIGNATURE, seoIaGenereLe: null })).sqlstate).toBe(CHECK_VIOLATION)
    expect((await ecrire({ seoIaSignature: null, seoIaGenereLe: new Date() })).sqlstate).toBe(CHECK_VIOLATION)
  })

  it('should refuse a text without signature', async () => {
    expect((await ecrire({ seoIaTitre: TITRE_OK })).sqlstate).toBe(CHECK_VIOLATION)
  })
})
