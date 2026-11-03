import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import { schemaPropositionRepli } from '../../shared/schemas/ia'
import { empreinte } from '../../server/services/ia/nettoyage'
import {
  GENERATION_EXPIRATION_MS,
  IA_RETENTION_JOURS,
  MOTIFS_REPLI_TRANSITOIRES,
} from '../../shared/ia'
import { IA_GLOBAL_LIMIT, IA_LIMITE_CLE_GLOBALE, IA_LIMITE_CLE_UTILISATEUR_PREFIXE, IA_UTILISATEUR_LIMIT } from '../../shared/limites'
import { IA_JOB_ID_PREFIXE } from '../../shared/jobs'
import { ENTREE_ONBOARDING_DEMO, propositionValide } from '../unit/support/ia-fixtures'
import { rejet } from './support/erreurs'
import { activePromptRow, createUser, insertGeneration } from './support/fabriques'
import {
  CLES_INTERNES,
  avecPromptModifie,
  creerProviderScripte,
  creerGeneration,
  iaGenerations,
  iaRepli,
  isoIlYA,
  lireGeneration,
  lireGenerationsDe,
  plansService,
  queuesJobs,
  reinitialiserIa,
  ressourceGeneration,
  toutesLesCles,
} from './support/ia'

// S8 §4.8 / CA16, CA19, CA28 à CA32, CA35, CA53 : cycle de vie des générations contre le VRAI PostgreSQL, le
// VRAI Redis (limiteur) et la VRAIE file BullMQ. Aucun mock de la base, des services ni de la file ; seul le
// fournisseur (API tierce) est remplacé.

const cleUtilisateur = (userId: string) => `limite:${IA_LIMITE_CLE_UTILISATEUR_PREFIXE}${userId}`
const cleGlobale = `limite:${IA_LIMITE_CLE_GLOBALE}`

beforeEach(reinitialiserIa)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('createGeneration : création nominale (CA16)', () => {
  it('should insert a pending generation with the active prompt, a fingerprint and the minimised input', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    const prompt = await activePromptRow('onboarding_vitrine')

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    const enBase = await lireGeneration(ligne.id)
    expect(enBase).toMatchObject({
      userId: user.id, type: 'onboarding_vitrine', statut: 'en_attente', promptId: prompt.id, tentatives: 0,
      injectionSuspectee: false, entree: ENTREE_ONBOARDING_DEMO, sortie: null, motifRepli: null, termineeLe: null,
    })
    expect(enBase?.entreeEmpreinte).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should enqueue one ia-generer job named after the generation, carrying nothing but its id', async () => {
    const createGeneration = await creerGeneration()
    const { getIaQueue } = await queuesJobs()
    const user = await createUser()

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    const job = await getIaQueue().getJob(`${IA_JOB_ID_PREFIXE}${ligne.id}`)
    expect(job?.name).toBe('ia-generer')
    expect(job?.data).toEqual({ generationId: ligne.id })
    expect(job?.opts.attempts).toBe(1)
  })

  it('should count the request on the user counter (generer and ameliorer share one key)', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()

    await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })
    await createGeneration(user.id, 'ameliorer_texte', { champ: 'bio', objectif: 'reformuler', texte: 'Un texte', contexte: {} }, { injection: false })

    expect(await redis.get(cleUtilisateur(user.id))).toBe('2')
    expect(await redis.ttl(cleUtilisateur(user.id))).toBeGreaterThan(0)
  })

  it('should record the suspected injection flag', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: true })

    expect((await lireGeneration(ligne.id))?.injectionSuspectee).toBe(true)
  })
})

describe('createGeneration : replis immédiats, jamais d’appel au fournisseur', () => {
  async function attendreRepli(motif: string, preparer: (userId: string) => Promise<void> | void = () => undefined) {
    const { executeGeneration } = await iaGenerations()
    const createGeneration = await creerGeneration()
    const { repliOnboarding } = await iaRepli()
    const user = await createUser()
    await preparer(user.id)

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    const enBase = await lireGeneration(ligne.id)
    expect(enBase).toMatchObject({ statut: 'repli', motifRepli: motif })
    expect(enBase?.termineeLe).toBeInstanceOf(Date)
    expect(enBase?.sortie).toEqual(repliOnboarding(ENTREE_ONBOARDING_DEMO))
    const provider = creerProviderScripte(['valide'])
    await executeGeneration(ligne.id, { provider, now: Date.now, sleep: async () => undefined })
    expect(provider.appels).toHaveLength(0)
    expect(await lireGeneration(ligne.id)).toMatchObject({ statut: 'repli', motifRepli: motif })
    return ligne
  }

  it('should fall back with plafond_global when the global counter is exhausted (CA31)', async () => {
    await redis.set(cleGlobale, String(IA_GLOBAL_LIMIT.limit), 'EX', 3600)

    await attendreRepli('plafond_global')
  })

  it('should still call the provider when the global counter is one below the cap (boundary)', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    await redis.set(cleGlobale, String(IA_GLOBAL_LIMIT.limit - 1), 'EX', 3600)

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    expect((await lireGeneration(ligne.id))?.statut).toBe('en_attente')
  })

  it('should fall back with limiteur_indisponible when the user counter cannot be read (CA30, real Redis command error)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await attendreRepli('limiteur_indisponible', async (userId) => {
      await redis.set(cleUtilisateur(userId), 'abc')
    })
  })

  it('should fall back with limiteur_indisponible when the global counter cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await redis.set(cleGlobale, 'abc')

    await attendreRepli('limiteur_indisponible')
  })

  it('should fall back with sans_prompt when no version of the prompt is active', async () => {
    await avecPromptModifie('onboarding_vitrine', { actif: false }, async () => {
      await attendreRepli('sans_prompt')
    })
  })

  it('should fall back with sans_prompt when the declared variables do not match the template (CA27)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await avecPromptModifie('onboarding_vitrine', { variables: ['donnees', 'autre'] }, async () => {
      await attendreRepli('sans_prompt')
    })
  })

  it('should fall back with sans_prompt when the template uses a variable that is not declared', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const prompt = await activePromptRow('onboarding_vitrine')
    await avecPromptModifie('onboarding_vitrine', { gabarit: `${prompt.gabarit}\n{{secret}}` }, async () => {
      await attendreRepli('sans_prompt')
    })
  })

  it('should fall back with sans_prompt when the stored settings are invalid (temperature out of range)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await avecPromptModifie('onboarding_vitrine', { parametres: { temperature: 7, maxTokens: 1500 } }, async () => {
      await attendreRepli('sans_prompt')
    })
  })

  it('should fall back with file_indisponible when the queue refuses the job (CA29)', async () => {
    const { getIaQueue } = await queuesJobs()
    vi.spyOn(getIaQueue(), 'add').mockRejectedValue(new Error('Connection is closed.'))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await attendreRepli('file_indisponible')
  })
})

describe('createGeneration : abus (CA30)', () => {
  it('should answer 429 with Retry-After on the 11th request of the hour and create nothing', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    for (let i = 0; i < IA_UTILISATEUR_LIMIT.limit; i += 1) {
      await createGeneration(user.id, 'onboarding_vitrine', { ...ENTREE_ONBOARDING_DEMO, metier: `Métier ${i}` }, { injection: false })
    }

    const erreur = await rejet(createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false }))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'TROP_DE_REQUETES', status: 429 })
    expect(erreur.retryAfter).toBeGreaterThan(0)
    expect(erreur.retryAfter).toBeLessThanOrEqual(IA_UTILISATEUR_LIMIT.windowS)
    const lignes = await db.execute<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM generations_ia WHERE user_id = ${user.id}`)
    expect(lignes.rows[0]!.n).toBe(IA_UTILISATEUR_LIMIT.limit)
  })

  it('should not let the abuse of A slow B down', async () => {
    const createGeneration = await creerGeneration()
    const [a, b] = [await createUser(), await createUser()]
    for (let i = 0; i < IA_UTILISATEUR_LIMIT.limit; i += 1) {
      await createGeneration(a.id, 'onboarding_vitrine', { ...ENTREE_ONBOARDING_DEMO, metier: `M${i}` }, { injection: false })
    }

    const ligne = await createGeneration(b.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false })

    expect(ligne.statut).toBe('en_attente')
  })

  it('should never exceed the cap under concurrency: 15 simultaneous requests, exactly 10 accepted', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()

    const resultats = await Promise.allSettled(
      Array.from({ length: 15 }, (_, i) => createGeneration(user.id, 'onboarding_vitrine', { ...ENTREE_ONBOARDING_DEMO, metier: `Métier ${i}` }, { injection: false })),
    )

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(IA_UTILISATEUR_LIMIT.limit)
    const refus = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    expect(refus).toHaveLength(5)
    expect(refus.every((r) => (r.reason as { code?: string }).code === 'TROP_DE_REQUETES')).toBe(true)
  })
})

describe('createGeneration : dédoublonnage et replis transitoires (revue sécurité)', () => {
  const ENTREE = ENTREE_ONBOARDING_DEMO

  async function existante(userId: string, surcharges: Parameters<typeof insertGeneration>[1]) {
    const prompt = await activePromptRow('onboarding_vitrine')
    return insertGeneration(userId, { promptId: prompt.id, entree: ENTREE, entreeEmpreinte: empreinte(ENTREE, prompt.id), ...surcharges })
  }

  it('should list the transient fallbacks in the shared constant (provider failure and timeout included)', () => {
    expect([...MOTIFS_REPLI_TRANSITOIRES].sort()).toEqual(
      ['delai_depasse', 'echec_fournisseur', 'file_indisponible', 'limiteur_indisponible', 'plafond_global', 'quota_atteint'],
    )
  })

  it.each(MOTIFS_REPLI_TRANSITOIRES)('should NOT reuse a generation that fell back with the transient reason %s: a new one is created', async (motif) => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    const ancienne = await existante(user.id, { statut: 'repli', motifRepli: motif, sortie: propositionValide(), termineeLe: new Date() })

    const nouvelle = await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })

    expect(nouvelle.id).not.toBe(ancienne.id)
    expect(nouvelle.statut).toBe('en_attente')
  })

  it.each(['sortie_invalide', 'injection', 'sans_fournisseur', 'sans_prompt'] as const)('should still reuse a generation that fell back with the deterministic reason %s', async (motif) => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    const ancienne = await existante(user.id, { statut: 'repli', motifRepli: motif, sortie: propositionValide(), termineeLe: new Date() })

    const reprise = await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })

    expect(reprise.id).toBe(ancienne.id)
    expect(await lireGenerationsDe(user.id)).toHaveLength(1)
  })

  it('should reuse a finished generation and an active one younger than 45 s, but not a lost one older than 45 s', async () => {
    const createGeneration = await creerGeneration()
    const [a, b, c] = [await createUser(), await createUser(), await createUser()]
    const terminee = await existante(a.id, { statut: 'terminee', sortie: propositionValide(), termineeLe: new Date() })
    const active = await existante(b.id, { statut: 'en_cours', createdAt: isoIlYA(10_000) })
    const perdue = await existante(c.id, { statut: 'en_attente', createdAt: isoIlYA(GENERATION_EXPIRATION_MS + 5_000) })

    expect((await createGeneration(a.id, 'onboarding_vitrine', ENTREE, { injection: false })).id).toBe(terminee.id)
    expect((await createGeneration(b.id, 'onboarding_vitrine', ENTREE, { injection: false })).id).toBe(active.id)
    expect((await createGeneration(c.id, 'onboarding_vitrine', ENTREE, { injection: false })).id).not.toBe(perdue.id)
  })

  it('should let « Réessayer » start a fresh generation after a real provider outage (echec_fournisseur), then reuse the success', async () => {
    const { executeGeneration } = await iaGenerations()
    const createGeneration = await creerGeneration()
    const user = await createUser()
    const premiere = await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })
    await executeGeneration(premiere.id, { provider: creerProviderScripte(['panne', 'panne', 'panne']), now: Date.now, sleep: async () => undefined })
    expect(await lireGeneration(premiere.id)).toMatchObject({ statut: 'repli', motifRepli: 'echec_fournisseur' })

    const seconde = await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })
    await executeGeneration(seconde.id, { provider: creerProviderScripte(['valide']), now: Date.now, sleep: async () => undefined })
    const troisieme = await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })

    expect(seconde.id).not.toBe(premiere.id)
    expect(await lireGeneration(seconde.id)).toMatchObject({ statut: 'terminee' })
    expect(troisieme.id).toBe(seconde.id)
  })

  it('should not touch the counters when the request is deduplicated by the plain read (no limiter, no lock)', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })
    const global = await redis.get(cleGlobale)

    await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })
    await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })

    expect(await redis.get(cleUtilisateur(user.id))).toBe('1')
    expect(await redis.get(cleGlobale)).toBe(global)
  })

  it('should create one row and one job under 8 simultaneous identical requests, and give the losers\' counts back (CA17)', async () => {
    const { createGeneration } = await iaGenerations()
    const { getIaQueue } = await queuesJobs()
    const user = await createUser()

    const resultats = await Promise.all(
      Array.from({ length: 8 }, () => createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })),
    )

    expect(new Set(resultats.map((r) => r.generation.id)).size).toBe(1)
    expect(resultats.filter((r) => !r.dedoublonnee)).toHaveLength(1)
    expect(await lireGenerationsDe(user.id)).toHaveLength(1)
    expect(await getIaQueue().getJobCounts('waiting', 'active', 'delayed')).toMatchObject({ waiting: 1 })
    expect(await redis.get(cleUtilisateur(user.id))).toBe('1')
  })

  it('should give a count back without ever dropping a counter below 1 or creating a missing one', async () => {
    const { releaseLimit } = await import('../../server/services/limiteur')
    const cle = `test-rendre:${randomUUID()}`
    await redis.set(`limite:${cle}`, '3', 'EX', 60)

    await releaseLimit(cle)
    await releaseLimit(cle)
    await releaseLimit(cle)
    await releaseLimit(`${cle}:absent`)

    expect(await redis.get(`limite:${cle}`)).toBe('1')
    expect(await redis.get(`limite:${cle}:absent`)).toBeNull()
    await redis.del(`limite:${cle}`)
  })

  it('should not hold a pool connection in a transaction while the limiter talks to Redis', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    const observations: number[] = []
    const vraiExpire = redis.expire.bind(redis)
    // `expire` est appelé (et attendu) par le limiteur au premier appel d'une fenêtre : on regarde alors la base.
    vi.spyOn(redis, 'expire').mockImplementation((async (...args: Parameters<typeof redis.expire>) => {
      const lignes = await db.execute<{ n: number }>(sql`
        SELECT COUNT(*)::int AS n FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'
          AND (query ILIKE '%pg_advisory_xact_lock%' OR query ILIKE '%"generations_ia"%')`)
      observations.push(lignes.rows[0]!.n)
      return vraiExpire(...args)
    }) as never)

    await createGeneration(user.id, 'onboarding_vitrine', ENTREE, { injection: false })

    expect(observations.length).toBeGreaterThan(0)
    expect(observations.every((n) => n === 0)).toBe(true)
  })
})

describe('getOwnGeneration : propriété et expiration (CA19, CA28)', () => {
  it('should return the own generation', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const ligne = await insertGeneration(user.id)

    expect((await getOwnGeneration(user.id, ligne.id, new Date())).id).toBe(ligne.id)
  })

  it.each([
    ['an unknown uuid', () => randomUUID()],
    ['a malformed id', () => 'abc'],
    ['an empty-looking id', () => '0'],
    ['an SQL-looking id', () => "' OR 1=1 --"],
  ])('should answer 404 GENERATION_INTROUVABLE for %s', async (_nom, fabriquerId) => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()

    const erreur = await rejet(getOwnGeneration(user.id, fabriquerId(), new Date()))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'GENERATION_INTROUVABLE', status: 404 })
  })

  it('should answer the SAME 404 for the generation of another user (no information on its existence)', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const [a, b] = [await createUser(), await createUser()]
    const deB = await insertGeneration(b.id)

    const etranger = await rejet(getOwnGeneration(a.id, deB.id, new Date()))
    const inconnu = await rejet(getOwnGeneration(a.id, randomUUID(), new Date()))

    expect(etranger).toMatchObject({ code: 'GENERATION_INTROUVABLE', status: 404, message: inconnu.message })
    expect((await lireGeneration(deB.id))?.statut).toBe('en_attente')
  })

  it('should not expire a pending generation at exactly 45 s, but expire it at 45 s + 1 ms', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const creee = new Date('2026-11-02T10:00:00.000Z')
    const ligne = await insertGeneration(user.id, { createdAt: creee })

    const pile = await getOwnGeneration(user.id, ligne.id, new Date(creee.getTime() + GENERATION_EXPIRATION_MS))
    expect(pile.statut).toBe('en_attente')

    const apres = await getOwnGeneration(user.id, ligne.id, new Date(creee.getTime() + GENERATION_EXPIRATION_MS + 1))
    expect(apres.statut).toBe('expiree')
  })

  it('should expire a lost job after 46 s: statut expiree, fallback content, end date set (CA28)', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const { repliOnboarding } = await iaRepli()
    const user = await createUser()
    const ligne = await insertGeneration(user.id, { createdAt: isoIlYA(46_000) })

    const lue = await getOwnGeneration(user.id, ligne.id, new Date())

    expect(lue.statut).toBe('expiree')
    expect(lue.sortie).toEqual(repliOnboarding(ENTREE_ONBOARDING_DEMO))
    expect(schemaPropositionRepli.safeParse(lue.sortie).success).toBe(true)
    expect(lue.termineeLe).toBeInstanceOf(Date)
  })

  it('should also expire a generation stuck « en_cours » (worker crashed mid-call)', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const ligne = await insertGeneration(user.id, { statut: 'en_cours', createdAt: isoIlYA(60_000), demarreeLe: isoIlYA(59_000) })

    expect((await getOwnGeneration(user.id, ligne.id, new Date())).statut).toBe('expiree')
  })

  it('should keep a pending generation created 44 s ago pending', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const ligne = await insertGeneration(user.id, { createdAt: isoIlYA(44_000) })

    expect((await getOwnGeneration(user.id, ligne.id, new Date())).statut).toBe('en_attente')
  })

  it.each(['terminee', 'repli'] as const)('should never touch an already %s generation, however old', async (statut) => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const sortie = propositionValide()
    const ligne = await insertGeneration(user.id, {
      statut, motifRepli: statut === 'repli' ? 'echec_fournisseur' : null, termineeLe: isoIlYA(3_600_000), createdAt: isoIlYA(3_700_000), sortie,
    })

    const lue = await getOwnGeneration(user.id, ligne.id, new Date())

    expect(lue.statut).toBe(statut)
    expect(lue.sortie).toEqual(sortie)
  })

  it('should let a late executeGeneration change nothing once the generation expired (CA28)', async () => {
    const { getOwnGeneration, executeGeneration } = await iaGenerations()
    const user = await createUser()
    const ligne = await insertGeneration(user.id, { createdAt: isoIlYA(46_000) })
    await getOwnGeneration(user.id, ligne.id, new Date())
    const avant = await lireGeneration(ligne.id)
    const provider = creerProviderScripte(['valide'])

    await executeGeneration(ligne.id, { provider, now: Date.now, sleep: async () => undefined })

    expect(provider.appels).toHaveLength(0)
    expect(await lireGeneration(ligne.id)).toEqual(avant)
  })

  it('should compute the fallback of an expired « ameliorer_texte » as an unchanged text', async () => {
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const entree = { champ: 'bio', objectif: 'reformuler', texte: 'Mon texte de départ.', contexte: { titre: null, metier: 'Avocat', ville: null, pays: null } }
    const ligne = await insertGeneration(user.id, { type: 'ameliorer_texte', entree, createdAt: isoIlYA(50_000) })

    const lue = await getOwnGeneration(user.id, ligne.id, new Date())

    expect(lue.statut).toBe('expiree')
    expect(lue.sortie).toEqual({ champ: 'bio', avant: 'Mon texte de départ.', apres: 'Mon texte de départ.', modifie: false })
  })
})

describe('purgeGenerations : rétention de 30 jours (CA35)', () => {
  const JOUR_MS = 86_400_000
  const MAINTENANT = new Date('2026-11-02T12:00:00.000Z')

  function terminee(userId: string, ageJours: number) {
    const cree = new Date(MAINTENANT.getTime() - ageJours * JOUR_MS)
    return insertGeneration(userId, {
      statut: 'terminee', createdAt: cree, termineeLe: cree, sortie: propositionValide(), tokensEntree: 100, tokensSortie: 300, fournisseur: 'faux', tentatives: 1,
    })
  }

  it('should null entree and sortie after 30 days and keep the metadata (quota, cost)', async () => {
    const { purgeGenerations } = await iaGenerations()
    const user = await createUser()
    const vieille = await terminee(user.id, IA_RETENTION_JOURS + 1)
    const recente = await terminee(user.id, IA_RETENTION_JOURS - 1)

    const purgees = await purgeGenerations(MAINTENANT)

    expect(purgees).toBe(1)
    const p = await lireGeneration(vieille.id)
    expect(p).toMatchObject({ entree: null, sortie: null, statut: 'terminee', tokensEntree: 100, tokensSortie: 300, fournisseur: 'faux', tentatives: 1 })
    expect(p?.createdAt.getTime()).toBe(vieille.createdAt.getTime())
    expect(await lireGeneration(recente.id)).toMatchObject({ entree: expect.anything(), sortie: expect.anything() })
  })

  it('should replace the dictionary-guessable fingerprint by a random hash of the same shape on purge, and keep a recent one', async () => {
    const { purgeGenerations } = await iaGenerations()
    const user = await createUser()
    const vieille = await terminee(user.id, IA_RETENTION_JOURS + 1)
    const recente = await terminee(user.id, IA_RETENTION_JOURS - 1)
    const empreinteAvant = (await lireGeneration(vieille.id))!.entreeEmpreinte

    await purgeGenerations(MAINTENANT)

    const apres = (await lireGeneration(vieille.id))!.entreeEmpreinte
    expect(apres).toMatch(/^[0-9a-f]{64}$/)
    expect(apres).not.toBe(empreinteAvant)
    expect((await lireGeneration(recente.id))!.entreeEmpreinte).toBe(recente.entreeEmpreinte)
    await purgeGenerations(MAINTENANT)
    expect((await lireGeneration(vieille.id))!.entreeEmpreinte).toBe(apres)
  })

  it('should keep a generation of exactly 30 days (strictly older only)', async () => {
    const { purgeGenerations } = await iaGenerations()
    const user = await createUser()
    const pile = await terminee(user.id, IA_RETENTION_JOURS)

    expect(await purgeGenerations(MAINTENANT)).toBe(0)
    expect((await lireGeneration(pile.id))?.sortie).not.toBeNull()
  })

  it('should return 0 on the second pass (idempotent), and purge a row that kept only one of the two columns', async () => {
    const { purgeGenerations } = await iaGenerations()
    const user = await createUser()
    await terminee(user.id, 40)
    const moitie = await insertGeneration(user.id, {
      statut: 'repli', motifRepli: 'injection', createdAt: new Date(MAINTENANT.getTime() - 40 * JOUR_MS), termineeLe: MAINTENANT, entree: null, sortie: { a: 1 },
    })

    expect(await purgeGenerations(MAINTENANT)).toBe(2)
    expect(await purgeGenerations(MAINTENANT)).toBe(0)
    expect((await lireGeneration(moitie.id))?.sortie).toBeNull()
  })

  it('should purge the generations of every user, not just one', async () => {
    const { purgeGenerations } = await iaGenerations()
    const [a, b] = [await createUser(), await createUser()]
    await terminee(a.id, 45)
    await terminee(b.id, 45)

    expect(await purgeGenerations(MAINTENANT)).toBe(2)
  })

  it('should also purge a never-finished old generation (no personal data kept forever)', async () => {
    const { purgeGenerations } = await iaGenerations()
    const user = await createUser()
    const bloquee = await insertGeneration(user.id, { statut: 'en_attente', createdAt: new Date(MAINTENANT.getTime() - 60 * JOUR_MS) })

    expect(await purgeGenerations(MAINTENANT)).toBe(1)
    expect((await lireGeneration(bloquee.id))?.entree).toBeNull()
  })
})

describe('getIaQuota : 3 générations « terminee » par mois civil, au fuseau de l’utilisateur (CA32)', () => {
  const MAINTENANT = new Date('2026-11-15T12:00:00.000Z')

  function genererTerminee(userId: string, creeLe: string, statut: 'terminee' | 'repli' = 'terminee') {
    const date = new Date(creeLe)
    return insertGeneration(userId, {
      statut, motifRepli: statut === 'repli' ? 'echec_fournisseur' : null, createdAt: date, termineeLe: date,
    })
  }

  it('should count 3 terminee of the month, ignore the repli and the previous month', async () => {
    const { getIaQuota } = await plansService()
    const user = await createUser({ fuseau: 'Africa/Douala' })
    for (const jour of ['03', '09', '12']) await genererTerminee(user.id, `2026-11-${jour}T09:00:00.000Z`)
    await genererTerminee(user.id, '2026-11-05T09:00:00.000Z', 'repli')
    await genererTerminee(user.id, '2026-10-20T09:00:00.000Z')

    expect(await getIaQuota(user.id, MAINTENANT)).toEqual({ plan: 'gratuit', limite: 3, utilisees: 3, restantes: 0, depasse: true })
  })

  it('should report the remaining count under the limit', async () => {
    const { getIaQuota } = await plansService()
    const user = await createUser()
    await genererTerminee(user.id, '2026-11-03T09:00:00.000Z')

    expect(await getIaQuota(user.id, MAINTENANT)).toEqual({ plan: 'gratuit', limite: 3, utilisees: 1, restantes: 2, depasse: false })
  })

  it('should report zero for a user without any generation', async () => {
    const { getIaQuota } = await plansService()
    const user = await createUser()

    expect(await getIaQuota(user.id, MAINTENANT)).toMatchObject({ utilisees: 0, restantes: 3, depasse: false })
  })

  it('should count a generation made at 23:30 Douala on the last day of the month in THAT month (22:30 UTC)', async () => {
    const { getIaQuota } = await plansService()
    const user = await createUser({ fuseau: 'Africa/Douala' })
    await genererTerminee(user.id, '2026-10-31T22:30:00.000Z')

    expect((await getIaQuota(user.id, new Date('2026-10-31T22:45:00.000Z'))).utilisees).toBe(1)
    expect((await getIaQuota(user.id, MAINTENANT)).utilisees).toBe(0)
  })

  it('should put a generation made at 00:30 Douala on the 1st in the NEW month (23:30 UTC the day before)', async () => {
    const { getIaQuota } = await plansService()
    const user = await createUser({ fuseau: 'Africa/Douala' })
    await genererTerminee(user.id, '2026-10-31T23:30:00.000Z')

    expect((await getIaQuota(user.id, MAINTENANT)).utilisees).toBe(1)
  })

  it('should follow the user timezone, not UTC (Los Angeles: 03:00 UTC on the 1st is still October)', async () => {
    const { getIaQuota } = await plansService()
    const user = await createUser({ fuseau: 'America/Los_Angeles' })
    await genererTerminee(user.id, '2026-11-01T03:00:00.000Z')

    expect((await getIaQuota(user.id, new Date('2026-10-31T20:00:00.000Z'))).utilisees).toBe(1)
    expect((await getIaQuota(user.id, MAINTENANT)).utilisees).toBe(0)
  })

  it('should never count the generations of another user', async () => {
    const { getIaQuota } = await plansService()
    const [a, b] = [await createUser(), await createUser()]
    await genererTerminee(b.id, '2026-11-03T09:00:00.000Z')

    expect((await getIaQuota(a.id, MAINTENANT)).utilisees).toBe(0)
  })

  it('should answer an immediate `quota_atteint` fallback for the onboarding once the quota is reached : never a blocked sign-up (S10 #126, replaces S8 "reads only")', async () => {
    const createGeneration = await creerGeneration()
    const user = await createUser()
    for (const jour of ['03', '04', '05']) await genererTerminee(user.id, `2026-11-${jour}T09:00:00.000Z`)

    const ligne = await createGeneration(user.id, 'onboarding_vitrine', ENTREE_ONBOARDING_DEMO, { injection: false }, MAINTENANT)

    expect(ligne).toMatchObject({ statut: 'repli', motifRepli: 'quota_atteint' })
  })
})

describe('toGenerationResource : le DTO ne fuit rien d’interne (CA53)', () => {
  async function dto(surcharges: Parameters<typeof insertGeneration>[1]) {
    const { toGenerationResource } = await ressourceGeneration()
    const user = await createUser()
    const ligne = await insertGeneration(user.id, surcharges)
    return toGenerationResource((await lireGeneration(ligne.id))!)
  }

  const terminal = { termineeLe: new Date(), tokensEntree: 100, tokensSortie: 300, fournisseur: 'faux' as const, modele: 'secret-modele', erreurCode: 'fournisseur' }

  it.each([
    ['en_attente', { statut: 'en_attente' as const }, 10, false],
    ['en_cours', { statut: 'en_cours' as const }, 50, false],
    ['terminee', { statut: 'terminee' as const, sortie: propositionValide(), ...terminal }, 100, false],
    ['repli', { statut: 'repli' as const, motifRepli: 'injection' as const, sortie: propositionValide(), ...terminal }, 100, true],
    ['expiree', { statut: 'expiree' as const, sortie: propositionValide(), ...terminal }, 100, true],
  ])('should map a %s generation to the expected progression and repli flag, without any internal key', async (statut, surcharges, progression, repli) => {
    const resultat = await dto(surcharges)

    expect(resultat).toMatchObject({ statut, progression, repli, type: 'onboarding_vitrine' })
    const cles = toutesLesCles(resultat)
    for (const interne of CLES_INTERNES) expect(cles.has(interne), interne).toBe(false)
    expect(JSON.stringify(resultat)).not.toMatch(/secret-modele|Cabrel|Nguesso|injection/)
  })

  it('should expose no result while the generation is not finished', async () => {
    expect((await dto({ statut: 'en_attente' })).resultat).toBeNull()
    expect((await dto({ statut: 'en_cours' })).resultat).toBeNull()
  })

  it('should expose 3 accroches, a presentation and 3 services WITHOUT the « actif » switch', async () => {
    const resultat = await dto({ statut: 'terminee', sortie: propositionValide(), ...terminal })

    const proposition = resultat.resultat as { accroches: string[], presentation: string, services: Array<Record<string, unknown>> }
    expect(proposition.accroches).toEqual(propositionValide().accroches)
    expect(proposition.presentation).toBe(propositionValide().presentation)
    expect(proposition.services.map((s) => Object.keys(s).sort())).toEqual(Array(3).fill(['dureeMin', 'description', 'nbSeances', 'titre', 'type'].sort()))
  })

  it('should map an improvement to { champ, avant, apres, modifie } from the entry and the output', async () => {
    const entree = { champ: 'bio', objectif: 'reformuler', texte: 'Texte avant.', contexte: { titre: null, metier: 'Avocat', ville: null, pays: null } }

    const resultat = await dto({ type: 'ameliorer_texte', statut: 'terminee', entree, sortie: { texte: 'Texte après.' }, ...terminal })

    expect(resultat).toMatchObject({ type: 'ameliorer_texte', resultat: { champ: 'bio', avant: 'Texte avant.', apres: 'Texte après.', modifie: true } })
    expect(JSON.stringify(resultat)).not.toContain('Avocat')
  })

  it('should not crash on a finished generation whose data was purged (answers no result, or not found)', async () => {
    const { toGenerationResource } = await ressourceGeneration()
    const { getOwnGeneration } = await iaGenerations()
    const user = await createUser()
    const ligne = await insertGeneration(user.id, { statut: 'terminee', termineeLe: new Date(), entree: null, sortie: null, createdAt: isoIlYA(40 * 86_400_000) })

    const lue = await getOwnGeneration(user.id, ligne.id, new Date()).then(toGenerationResource, (e: unknown) => e)

    if (lue instanceof Error) expect(lue).toMatchObject({ code: 'GENERATION_INTROUVABLE' })
    else expect((lue as { resultat: unknown }).resultat).toBeNull()
  })
})
