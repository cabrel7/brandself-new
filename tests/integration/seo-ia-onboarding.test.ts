import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../server/utils/db'
import { vitrines } from '../../shared/db/schema'
import { schemaOnboardingEtape, schemaOnboardingTerminer } from '../../shared/schemas/onboarding'
import { ENTREE_ONBOARDING_DEMO, IDENTITE_DEMO } from '../unit/support/ia-fixtures'
import { signatureAttendue } from '../unit/support/seo-ia'
import { createUser, insertMediaRow } from './support/fabriques'
import {
  creerProviderScripte,
  definirModeFaux,
  iaFaux,
  iaGenerations,
  lireGeneration,
  onboardingService,
  reinitialiserIa,
} from './support/ia'
import {
  NOM_JOB_SEO,
  DELAI_DEBOUNCE_SEO_MS,
  compterJobsFond,
  fermerFileFond,
  jobIdSeo,
  jobsFond,
  verificationIa,
  viderFileFond,
} from './support/seo-ia'
import type { ModeFaux } from './support/ia'
import type { IaProvider } from '../../server/services/ia/types'

// Décision #24, groupe D : le SEO naît à l'onboarding, DANS le même appel IA que la proposition (prompt v2).
// Vrai PostgreSQL, vrai Redis, vraie file « ia-fond ». Seul le fournisseur est remplacé (FauxProvider réel
// piloté par le mode Redis `ia:faux:mode`, ou fournisseur scripté pour une sortie v1 sans bloc « seo »).

beforeEach(async () => {
  await reinitialiserIa()
  await viderFileFond()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(fermerFileFond)

const instantane = async (): Promise<void> => undefined

async function etape(userId: string, corps: Record<string, unknown>) {
  const { saveEtape } = await onboardingService()
  return saveEtape(userId, schemaOnboardingEtape.parse(corps))
}

async function lireVitrineDe(userId: string) {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.userId, userId))
  return ligne!
}

type Fournisseur = IaProvider | null

/** Identité + photo, puis génération exécutée avec `provider` (faux réel en mode Redis, ou scripté). */
async function genererAvec(provider: Fournisseur, mode: ModeFaux = 'normal') {
  const user = await createUser()
  const media = await insertMediaRow(user.id)
  await etape(user.id, { etape: 1, ...IDENTITE_DEMO })
  await etape(user.id, { etape: 2, photoMediaId: media.id })
  const { generer } = await onboardingService()
  const { executeGeneration } = await iaGenerations()
  await definirModeFaux(mode)
  const { generation } = await generer(user.id)
  await executeGeneration(generation.id, { provider, now: Date.now, sleep: instantane })
  return { user, generationId: generation.id }
}

async function fauxReel() {
  const { creerFauxProvider: creer } = await iaFaux()
  return creer()
}

async function valider(userId: string, accrocheIndex = 1) {
  await etape(userId, { etape: 3, accrocheIndex, presentation: 'Texte modifié par le professionnel.', servicesActifs: [true, false, true] })
}

async function terminer(userId: string) {
  const { terminer: finir } = await onboardingService()
  return finir(userId, schemaOnboardingTerminer.parse({ username: 'dr-cabrel-seo', palette: 'sauge' }))
}

describe('génération d\'onboarding : le bloc « seo » (D)', () => {
  it('should store a valid seo next to the proposition, from ONE provider call', async () => {
    const provider = await fauxReel()

    const { generationId } = await genererAvec(provider)

    const ligne = (await lireGeneration(generationId))!
    expect(ligne).toMatchObject({ statut: 'terminee', tentatives: 1 })
    expect(provider.appels).toBe(1)
    const sortie = ligne.sortie as { seo?: { titre: string, description: string } }
    const { validerSeo } = await verificationIa()
    expect(sortie.seo).toBeDefined()
    expect(validerSeo(sortie.seo, ENTREE_ONBOARDING_DEMO).ok).toBe(true)
    expect(sortie.seo?.titre).toContain('Douala')
    expect(sortie.seo?.description).toContain('Douala')
  })

  it('should keep the proposition WITHOUT seo when only the seo is invalid (one attempt, no retry, no fallback)', async () => {
    const provider = await fauxReel()

    const { generationId } = await genererAvec(provider, 'seo_invalide')

    const ligne = (await lireGeneration(generationId))!
    expect(ligne).toMatchObject({ statut: 'terminee', motifRepli: null, tentatives: 1 })
    expect(provider.appels).toBe(1)
    const sortie = ligne.sortie as Record<string, unknown>
    expect(sortie.seo).toBeUndefined()
    expect(sortie).toHaveProperty('accroches')
    expect(sortie).toHaveProperty('presentation')
    expect(sortie).toHaveProperty('services')
  })

  it('should retry three times when the texts lost their accents, then fall back with accents_manquants', async () => {
    const provider = await fauxReel()

    const { generationId } = await genererAvec(provider, 'sans_accents')

    const ligne = (await lireGeneration(generationId))!
    expect(provider.appels).toBe(3)
    expect(ligne).toMatchObject({ statut: 'repli', motifRepli: 'sortie_invalide', erreurCode: 'accents_manquants', tentatives: 3 })
    expect((ligne.sortie as Record<string, unknown>).seo).toBeUndefined()
  })

  it('should let the proposition of an old (v1) generation, without « seo », be validated and read back', async () => {
    const provider = creerProviderScripte(['valide'])

    const { user, generationId } = await genererAvec(provider)
    await valider(user.id)

    expect(await lireGeneration(generationId)).toMatchObject({ statut: 'terminee' })
    const { getOnboarding } = await onboardingService()
    expect(await getOnboarding(user.id)).toMatchObject({ etapeReprise: 4, proposition: { services: expect.any(Array) } })
  })

  it('should validate a proposition whose generation carries a « seo » block (the strict repli schema must accept it)', async () => {
    const { user } = await genererAvec(await fauxReel())

    await expect(valider(user.id)).resolves.toBeUndefined()
  })

  it('should never put the seo of the proposition in the onboarding view (identity, photo, proposition only)', async () => {
    const { user } = await genererAvec(await fauxReel())
    await valider(user.id)
    const { getOnboarding } = await onboardingService()

    expect(JSON.stringify(await getOnboarding(user.id))).not.toMatch(/seo/i)
  })
})

describe('terminer : écrit le SEO IA de la vitrine (D)', () => {
  it.each([0, 1, 2])('should store the seo with the signature of the CHOSEN accroche (index %i)', async (index) => {
    const { user, generationId } = await genererAvec(await fauxReel())
    await valider(user.id, index)
    const sortie = (await lireGeneration(generationId))!.sortie as { accroches: string[], seo: { titre: string, description: string } }

    const resultat = await terminer(user.id)

    const vitrine = await lireVitrineDe(user.id)
    expect(resultat).toMatchObject({ creee: true })
    expect(vitrine.accroche).toBe(sortie.accroches[index])
    expect(vitrine.seoIaTitre).toBe(sortie.seo.titre)
    expect(vitrine.seoIaDescription).toBe(sortie.seo.description)
    expect(vitrine.seoIaSignature).toBe(signatureAttendue({
      metier: IDENTITE_DEMO.metier,
      ville: IDENTITE_DEMO.ville,
      pays: IDENTITE_DEMO.pays,
      accroche: sortie.accroches[index]!,
    }))
    expect(vitrine.seoIaGenereLe).toBeInstanceOf(Date)
  })

  it('should give three different signatures for three different chosen accroches', async () => {
    const signatures = new Set<string>()
    for (const index of [0, 1, 2]) {
      const { user } = await genererAvec(await fauxReel())
      await valider(user.id, index)
      await terminer(user.id)
      signatures.add((await lireVitrineDe(user.id)).seoIaSignature ?? '')
      await db.delete(vitrines).where(eq(vitrines.userId, user.id))
    }

    expect(signatures.size).toBe(3)
  })

  it('should plan NO regeneration when the seo was written fresh by the onboarding', async () => {
    const { user } = await genererAvec(await fauxReel())
    await valider(user.id)

    await terminer(user.id)

    expect(await compterJobsFond()).toBe(0)
  })

  it.each([
    ['a generation made before the seo existed (v1 output)', 'scripte', 'normal'],
    ['a seo dropped because it was invalid', 'faux', 'seo_invalide'],
    ['a provider failure (deterministic fallback)', 'faux', 'panne'],
    ['accents lost on every attempt (fallback)', 'faux', 'sans_accents'],
  ] as const)('should leave the seo_ia columns NULL and plan ONE delayed job when the generation has no seo: %s', async (_nom, genre, mode) => {
    const { user } = await genererAvec(genre === 'faux' ? await fauxReel() : creerProviderScripte(['valide']), mode)
    await valider(user.id)

    await terminer(user.id)

    const vitrine = await lireVitrineDe(user.id)
    expect([vitrine.seoIaTitre, vitrine.seoIaDescription, vitrine.seoIaSignature, vitrine.seoIaGenereLe]).toEqual([null, null, null, null])
    const taches = await jobsFond()
    expect(taches).toHaveLength(1)
    expect(taches[0]).toMatchObject({ name: NOM_JOB_SEO, id: jobIdSeo(vitrine.id), data: { vitrineId: vitrine.id } })
    expect(taches[0]!.opts.delay).toBe(DELAI_DEBOUNCE_SEO_MS)
    expect(await taches[0]!.getState()).toBe('delayed')
  })

  it('should plan no second job when terminer is replayed (double click, second device)', async () => {
    const { user } = await genererAvec(creerProviderScripte(['valide']))
    await valider(user.id)
    await terminer(user.id)
    await viderFileFond()

    const rejeu = await terminer(user.id)

    expect(rejeu).toMatchObject({ creee: false })
    expect(await compterJobsFond()).toBe(0)
  })

  it('should still create the vitrine and answer creee: true when the queue is unreachable (journal, no failure)', async () => {
    const { Queue } = await import('bullmq')
    const { user } = await genererAvec(creerProviderScripte(['valide']))
    await valider(user.id)
    vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('Connection is closed.'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const resultat = await terminer(user.id)

    expect(resultat).toMatchObject({ creee: true })
    expect((await lireVitrineDe(user.id)).publieeLe).toBeInstanceOf(Date)
  })
})
