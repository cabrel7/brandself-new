import { Queue, Worker } from 'bullmq'
import Redis from 'ioredis'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { schemaVitrineUpdate } from '../../shared/schemas/vitrine'
import { reinitialiserIa } from './support/ia'
import { vitrinesService } from './support/modules'
import {
  DELAI_DEBOUNCE_SEO_MS,
  NOM_FILE_FOND,
  NOM_JOB_SEO,
  compterJobsFond,
  creerVitrineSeo,
  espionnerConsole,
  fermerFileFond,
  getFileFond,
  jobIdSeo,
  jobsFond,
  lireVitrineSeo,
  seoJobs,
  seoRegles,
  viderFileFond,
} from './support/seo-ia'

// Décision #24, groupe E : QUAND le SEO IA est-il (re)planifié ? Par le service `updateVitrine` / `publishVitrine`
// (la route n'a aucune logique), APRÈS le commit, sur la vraie file « ia-fond », en job différé unique par vitrine.
// Un déclencheur = la signature des entrées (métier, ville, pays, accroche) a changé ET il reste du texte à générer.

beforeEach(async () => {
  await reinitialiserIa()
  await viderFileFond()
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(fermerFileFond)

const maj = async (userId: string, corps: Record<string, unknown>) => {
  const { updateVitrine } = await vitrinesService()
  return updateVitrine(userId, schemaVitrineUpdate.parse(corps))
}

const TITRE_SAISI = 'Cardiologue interventionnel à Douala, rendez-vous en ligne'
const DESCRIPTION_SAISIE = 'Prenez rendez-vous en ligne avec un cardiologue à Douala et retrouvez toutes les informations utiles avant votre venue.'

describe('planifierRegenerationSeo : le job différé (E)', () => {
  it('should add ONE delayed « seo-ia-regenerer » job on « ia-fond », delayed by 5 minutes, carrying only the vitrine id', async () => {
    const { planifierRegenerationSeo } = await seoJobs()
    const { vitrine } = await creerVitrineSeo({ ia: 'aucun' })

    await planifierRegenerationSeo(vitrine.id)

    const taches = await jobsFond()
    expect(getFileFond().name).toBe(NOM_FILE_FOND)
    expect(taches).toHaveLength(1)
    expect(taches[0]).toMatchObject({ name: NOM_JOB_SEO, id: jobIdSeo(vitrine.id), data: { vitrineId: vitrine.id } })
    expect(taches[0]!.opts.delay).toBe(DELAI_DEBOUNCE_SEO_MS)
    expect(await taches[0]!.getState()).toBe('delayed')
    expect(Object.keys(taches[0]!.data)).toEqual(['vitrineId'])
  })

  it('should keep a single job when planned many times for the same vitrine (deduplicated by id)', async () => {
    const { planifierRegenerationSeo } = await seoJobs()
    const { vitrine } = await creerVitrineSeo({ ia: 'aucun' })

    await Promise.all([planifierRegenerationSeo(vitrine.id), planifierRegenerationSeo(vitrine.id), planifierRegenerationSeo(vitrine.id)])
    await planifierRegenerationSeo(vitrine.id)

    expect(await compterJobsFond()).toBe(1)
  })

  it('should keep one job per vitrine for two different vitrines', async () => {
    const { planifierRegenerationSeo } = await seoJobs()
    const a = await creerVitrineSeo({ ia: 'aucun' })
    const b = await creerVitrineSeo({ ia: 'aucun' })

    await planifierRegenerationSeo(a.vitrine.id)
    await planifierRegenerationSeo(b.vitrine.id)

    expect((await jobsFond()).map((t) => t.id).sort()).toEqual([jobIdSeo(a.vitrine.id), jobIdSeo(b.vitrine.id)].sort())
  })

  describe('avec un vrai worker sur « ia-fond »', () => {
    let connexion: Redis
    let worker: Worker | undefined

    beforeAll(() => {
      connexion = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: null })
    })

    afterEach(async () => {
      await worker?.close()
      worker = undefined
    })

    afterAll(() => {
      connexion.disconnect()
    })

    async function attendreSansJob(): Promise<void> {
      const fin = Date.now() + 10_000
      while ((await compterJobsFond()) > 0) {
        if (Date.now() > fin) throw new Error('Le job terminé est resté dans la file (removeOnComplete manquant).')
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }

    it.each([
      ['completed', async () => undefined],
      ['failed', async () => { throw new Error('échec simulé') }],
    ] as const)('should plan a NEW job after the previous one ended « %s » (a retained job id would block every future regeneration)', async (_etat, traitement) => {
      const { planifierRegenerationSeo } = await seoJobs()
      const { vitrine } = await creerVitrineSeo({ ia: 'aucun' })
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await planifierRegenerationSeo(vitrine.id)
      worker = new Worker(NOM_FILE_FOND, traitement, { connection: connexion })
      await worker.waitUntilReady()
      await (await jobsFond())[0]!.promote()
      await attendreSansJob()

      await planifierRegenerationSeo(vitrine.id)

      const taches = await jobsFond()
      expect(taches).toHaveLength(1)
      expect(await taches[0]!.getState()).toBe('delayed')
    }, 30_000)
  })
})

describe('updateVitrine : ce qui déclenche une régénération (E)', () => {
  it.each([
    ['métier', { metier: 'Pédiatre' }],
    ['ville', { ville: 'Yaoundé' }],
    ['pays', { pays: 'SN' }],
    ['accroche', { accroche: 'Une accroche toute neuve pour la vitrine' }],
    ['accroche retirée', { accroche: null }],
  ])('should plan ONE delayed job when the %s of a published vitrine changes', async (_nom, changement) => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais' })

    await maj(user.id, changement)

    const taches = await jobsFond()
    expect(taches).toHaveLength(1)
    expect(taches[0]).toMatchObject({ name: NOM_JOB_SEO, id: jobIdSeo(vitrine.id), data: { vitrineId: vitrine.id } })
    expect(taches[0]!.opts.delay).toBe(DELAI_DEBOUNCE_SEO_MS)
    const { seoIaFraiche } = await seoRegles()
    expect(seoIaFraiche((await lireVitrineSeo(vitrine.id))!)).toBeNull()
  })

  it('should keep ONE job after several successive edits of the inputs (debounce by deduplication)', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais' })

    await maj(user.id, { metier: 'Pédiatre' })
    await maj(user.id, { ville: 'Yaoundé' })
    await maj(user.id, { accroche: 'Encore une autre accroche' })

    expect(await compterJobsFond()).toBe(1)
  })

  it('should plan the job once and write the change in the SAME save (several inputs at once)', async () => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais' })

    await maj(user.id, { metier: 'Pédiatre', ville: 'Yaoundé', pays: 'SN', accroche: 'Une accroche' })

    expect(await compterJobsFond()).toBe(1)
    expect(await lireVitrineSeo(vitrine.id)).toMatchObject({ metier: 'Pédiatre', ville: 'Yaoundé', pays: 'SN', accroche: 'Une accroche' })
  })

  it.each([
    ['bio', { bio: 'Une toute autre présentation de la vitrine.' }],
    ['prénom', { prenom: 'Autre' }],
    ['nom', { nom: 'Autrement' }],
    ['titre de civilité', { titre: 'pr' }],
    ['palette', { palette: 'sauge' }],
    ['email de contact', { emailContact: 'autre@cabinet.cm' }],
    ['titre Google saisi', { seoTitre: TITRE_SAISI }],
    ['description Google saisie', { seoDescription: DESCRIPTION_SAISIE }],
    ['métier : casse seulement', { metier: 'CARDIOLOGUE INTERVENTIONNEL' }],
    ['ville : espaces et casse seulement', { ville: '  douala ' }],
    ['accroche : espaces multiples seulement', { accroche: 'Votre   cœur entre de bonnes   mains' }],
  ])('should plan NO job when only the %s changes (the proposal stays fresh)', async (_nom, changement) => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais' })

    await maj(user.id, changement)

    expect(await compterJobsFond()).toBe(0)
    const { seoIaFraiche } = await seoRegles()
    expect(seoIaFraiche((await lireVitrineSeo(vitrine.id))!)).not.toBeNull()
  })

  it('should plan NO job when the same values are saved again (the Profil form sends every field on each save)', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais' })

    await maj(user.id, { metier: 'Cardiologue interventionnel', ville: 'Douala', pays: 'CM', accroche: 'Votre cœur entre de bonnes mains', bio: 'Nouvelle bio' })

    expect(await compterJobsFond()).toBe(0)
  })

  it('should plan NO job when the vitrine is not published (nothing to show on Google yet)', async () => {
    const { user } = await creerVitrineSeo({ publiee: false, ia: 'frais' })

    await maj(user.id, { metier: 'Pédiatre' })

    expect(await compterJobsFond()).toBe(0)
  })

  it('should plan NO job when BOTH Google texts are typed (nothing left for the IA to write)', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    await maj(user.id, { metier: 'Pédiatre' })

    expect(await compterJobsFond()).toBe(0)
  })

  it('should still plan a job when only ONE of the two Google texts is typed', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais', seoTitre: TITRE_SAISI })

    await maj(user.id, { metier: 'Pédiatre' })

    expect(await compterJobsFond()).toBe(1)
  })

  it.each([
    ['titre', { seoTitre: null }],
    ['description', { seoDescription: null }],
    ['titre vidé (espaces)', { seoTitre: '   ' }],
  ])('should plan a job when the typed %s is reset to automatic and no fresh proposal exists', async (_nom, remise) => {
    const { user } = await creerVitrineSeo({ ia: 'aucun', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    await maj(user.id, remise)

    expect(await compterJobsFond()).toBe(1)
  })

  it('should plan NO job when a typed text is reset to automatic but the proposal is still fresh', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    await maj(user.id, { seoTitre: null, seoDescription: null })

    expect(await compterJobsFond()).toBe(0)
  })

  it('should answer successfully, write the change and journal when Redis (the queue) is down', async () => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais' })
    vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('Connection is closed.'))
    const console_ = espionnerConsole()

    const resultat = await maj(user.id, { metier: 'Pédiatre' })

    expect(resultat.vitrine.metier).toBe('Pédiatre')
    expect((await lireVitrineSeo(vitrine.id))?.metier).toBe('Pédiatre')
    expect(console_.erreurs()).not.toBe('')
    expect(console_.texte()).not.toContain('Pédiatre')
  })
})

describe('publishVitrine : publication avec un SEO IA périmé (E)', () => {
  it.each([
    ['absent', 'aucun'],
    ['périmé', 'perime'],
  ] as const)('should plan a job when the vitrine is published while the proposal is %s', async (_nom, ia) => {
    const { publishVitrine } = await vitrinesService()
    const { user, vitrine } = await creerVitrineSeo({ publiee: false, ia })

    await publishVitrine(user.id)

    const taches = await jobsFond()
    expect(taches).toHaveLength(1)
    expect(taches[0]).toMatchObject({ name: NOM_JOB_SEO, id: jobIdSeo(vitrine.id) })
  })

  it('should plan NO job when the vitrine is published with a fresh proposal', async () => {
    const { publishVitrine } = await vitrinesService()
    const { user } = await creerVitrineSeo({ publiee: false, ia: 'frais' })

    await publishVitrine(user.id)

    expect(await compterJobsFond()).toBe(0)
  })

  it('should plan NO job when the vitrine is published with both Google texts typed', async () => {
    const { publishVitrine } = await vitrinesService()
    const { user } = await creerVitrineSeo({ publiee: false, ia: 'aucun', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    await publishVitrine(user.id)

    expect(await compterJobsFond()).toBe(0)
  })

  it('should publish and journal when the queue is down (publication never fails because of the SEO)', async () => {
    const { publishVitrine } = await vitrinesService()
    const { user, vitrine } = await creerVitrineSeo({ publiee: false, ia: 'aucun' })
    vi.spyOn(Queue.prototype, 'add').mockRejectedValue(new Error('Connection is closed.'))
    const console_ = espionnerConsole()

    await expect(publishVitrine(user.id)).resolves.toBeDefined()

    expect((await lireVitrineSeo(vitrine.id))?.publieeLe).toBeInstanceOf(Date)
    expect(console_.erreurs()).not.toBe('')
  })
})
