import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { JOBS } from '../../../shared/jobs'
import {
  MEDIAS_CACHE_REFRESH_ENTETE,
  MEDIAS_CACHE_REFRESH_MAX_URLS,
} from '../../../shared/medias-cache'
import { MEDIA_WIDTHS, mediaUrl, partageUrl } from '../../../shared/medias'
import { planifierRafraichissementCacheMedias, traiterRafraichirCacheMedias } from '../../../server/jobs/rafraichir-cache-medias'
import { getMaintenanceQueue } from '../../../server/jobs/queues'
import { uploadMedia } from '../../../server/services/medias'
import { depublier, republier } from '../../../server/services/admin/vitrines'
import { reactiver, suspendre } from '../../../server/services/admin/utilisateurs'
import { makePng } from '../../support/images'
import { createUser, insertVitrineRow } from '../support/fabriques'
import { creerSuperadmin } from '../support/admin'
import { MOTIF_A2 } from '../support/admin-a2'

// Décision du 2026-11-16 : à la suspension, au blocage et à leur levée, une tâche de fond redemande à nginx chaque
// variante d'image du compte (en-tête secret) pour remplacer l'ancienne réponse en cache. Base, Redis et file RÉELS ;
// seul l'appel à nginx (fetch) est simulé.

const SECRET = 'secret-de-test-cache-images-0123456789'
const SITE = 'https://jesuis.example'
const IP = '203.0.113.7'
const REAUTH_OK = { reauth: async () => undefined }

beforeEach(async () => {
  await getMaintenanceQueue().obliterate({ force: true })
})

afterAll(async () => {
  await getMaintenanceQueue().obliterate({ force: true })
})

async function jobsDuCache() {
  const taches = await getMaintenanceQueue().getJobs(['delayed', 'waiting', 'prioritized', 'active', 'completed', 'failed'])
  return taches.filter((tache) => tache.name === JOBS.rafraichirCacheMedias)
}

async function imageDe(userId: string): Promise<string> {
  return (await uploadMedia(userId, await makePng(800, 600))).id
}

function cheminsDe(id: string): string[] {
  return [...MEDIA_WIDTHS.map((largeur) => mediaUrl(id, largeur)), partageUrl(id)]
}

interface Appel {
  url: string
  init: RequestInit
}

function faussaire(reponse: () => Promise<Response> = async () => new Response('', { status: 404 })) {
  const appels: Appel[] = []
  const faux = (async (entree: string | URL | Request, init?: RequestInit) => {
    appels.push({ url: String(entree), init: init ?? {} })
    return reponse()
  }) as typeof fetch
  return { appels, faux }
}

describe('traiterRafraichirCacheMedias : appels à nginx', () => {
  it('should request every variant of every image of the account, with the secret header, and nothing of another account', async () => {
    const user = await createUser()
    const autre = await createUser()
    const a = await imageDe(user.id)
    const b = await imageDe(user.id)
    const idAutre = await imageDe(autre.id)
    const { appels, faux } = faussaire()

    const bilan = await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: faux, secret: SECRET, siteUrl: `${SITE}/` })

    const attendues = [...cheminsDe(a), ...cheminsDe(b)].map((chemin) => `${SITE}${chemin}`).sort()
    expect(appels.map((appel) => appel.url).sort()).toEqual(attendues)
    expect(appels.some((appel) => appel.url.includes(idAutre))).toBe(false)
    for (const appel of appels) {
      expect(appel.init.method).toBe('GET')
      expect(appel.init.headers).toEqual({ [MEDIAS_CACHE_REFRESH_ENTETE]: SECRET })
      expect(appel.init.redirect).toBe('manual')
      expect(appel.init.signal).toBeInstanceOf(AbortSignal)
    }
    expect(bilan).toEqual({ saute: false, demandees: 8, reussies: 8, erreurs: 0, tronque: false })
  })

  it('should be idempotent: running twice requests the same URLs and never fails', async () => {
    const user = await createUser()
    await imageDe(user.id)
    const premier = faussaire()
    const second = faussaire()

    await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: premier.faux, secret: SECRET, siteUrl: SITE })
    await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: second.faux, secret: SECRET, siteUrl: SITE })

    expect(second.appels.map((a) => a.url).sort()).toEqual(premier.appels.map((a) => a.url).sort())
  })

  it('should be skipped with an information log, and send nothing, when the secret is absent', async () => {
    const user = await createUser()
    await imageDe(user.id)
    const { appels, faux } = faussaire()
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

    const bilan = await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: faux, secret: undefined, siteUrl: SITE })

    expect(bilan.saute).toBe(true)
    expect(appels).toHaveLength(0)
    expect(info).toHaveBeenCalledWith(expect.stringContaining('MEDIAS_CACHE_SANS_SECRET'))
    info.mockRestore()
  })

  it('should not fail on a network error or a timeout, and log error NAMES only (no URL, id or secret)', async () => {
    const user = await createUser()
    const id = await imageDe(user.id)
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { faux } = faussaire(async () => {
      throw new TypeError(`fetch failed ${SECRET} ${id}`)
    })

    const bilan = await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: faux, secret: SECRET, siteUrl: SITE })

    expect(bilan).toMatchObject({ saute: false, demandees: 4, reussies: 0, erreurs: 4 })
    const journal = JSON.stringify(erreur.mock.calls)
    expect(journal).toContain('TypeError')
    expect(journal).not.toContain(SECRET)
    expect(journal).not.toContain(id)
    expect(journal).not.toContain(user.id)
    expect(journal).not.toContain(SITE)
    erreur.mockRestore()
  })

  it('should bound the number of URLs per job and report the truncation', async () => {
    const user = await createUser()
    await imageDe(user.id)
    await imageDe(user.id)
    await imageDe(user.id)
    const { appels, faux } = faussaire()
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const bilan = await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: faux, secret: SECRET, siteUrl: SITE, maxUrls: 8 })

    expect(appels).toHaveLength(8)
    expect(bilan).toMatchObject({ demandees: 8, tronque: true })
    expect(JSON.stringify(erreur.mock.calls)).toContain('MEDIAS_CACHE_TRONQUE')
    erreur.mockRestore()
    expect(MEDIAS_CACHE_REFRESH_MAX_URLS).toBeGreaterThan(0)
  })

  it('should keep the number of simultaneous requests bounded', async () => {
    const user = await createUser()
    for (let i = 0; i < 4; i += 1) await imageDe(user.id)
    let enCours = 0
    let maximum = 0
    const { faux } = faussaire(async () => {
      enCours += 1
      maximum = Math.max(maximum, enCours)
      await new Promise((resolve) => setTimeout(resolve, 5))
      enCours -= 1
      return new Response('', { status: 404 })
    })

    await traiterRafraichirCacheMedias({ userId: user.id }, { fetch: faux, secret: SECRET, siteUrl: SITE })

    expect(maximum).toBeGreaterThan(1)
    expect(maximum).toBeLessThanOrEqual(4)
  })

  it('should refuse a payload other than { userId } (strict)', async () => {
    await expect(traiterRafraichirCacheMedias({ userId: 'u', secret: SECRET }, { secret: SECRET })).rejects.toThrow()
    await expect(traiterRafraichirCacheMedias({}, { secret: SECRET })).rejects.toThrow()
  })
})

describe('planifierRafraichissementCacheMedias : enfilage', () => {
  it('should add ONE job on « maintenance » carrying only the user id (no secret in Redis)', async () => {
    await planifierRafraichissementCacheMedias('utilisateur-1')

    const taches = await jobsDuCache()
    expect(taches).toHaveLength(1)
    expect(getMaintenanceQueue().name).toBe('maintenance')
    expect(taches[0]!.data).toEqual({ userId: 'utilisateur-1' })
    expect(JSON.stringify(taches[0])).not.toContain(SECRET)
  })

  it('should never throw when the queue is unavailable, and log the error NAME only', async () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const file = { add: async () => { throw new Error(`ECONNREFUSED ${SECRET}`) } }

    await expect(planifierRafraichissementCacheMedias('utilisateur-1', file as never)).resolves.toBeUndefined()

    const journal = JSON.stringify(erreur.mock.calls)
    expect(journal).toContain('MEDIAS_CACHE_ENFILAGE_ECHEC')
    expect(journal).toContain('Error')
    expect(journal).not.toContain(SECRET)
    expect(journal).not.toContain('utilisateur-1')
    erreur.mockRestore()
  })
})

describe('déclencheurs : un job par action, après le commit', () => {
  async function monde() {
    const admin = await creerSuperadmin()
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { publiee: true })
    return { admin, user, vitrine }
  }

  it('should enqueue one job for the account on suspension, then one on reactivation', async () => {
    const { admin, user } = await monde()

    await suspendre(admin.id, user.id, MOTIF_A2, IP, REAUTH_OK)
    let taches = await jobsDuCache()
    expect(taches).toHaveLength(1)
    expect(taches[0]!.data).toEqual({ userId: user.id })

    await reactiver(admin.id, user.id, MOTIF_A2, IP)
    taches = await jobsDuCache()
    expect(taches).toHaveLength(2)
    expect(taches.every((tache) => tache.data.userId === user.id)).toBe(true)
  })

  it('should enqueue one job for the holder on vitrine depublication, then one on republication', async () => {
    const { admin, user, vitrine } = await monde()

    await depublier(admin.id, vitrine.id, MOTIF_A2, IP, REAUTH_OK)
    expect(await jobsDuCache()).toHaveLength(1)

    await republier(admin.id, vitrine.id, MOTIF_A2, IP)
    const taches = await jobsDuCache()
    expect(taches).toHaveLength(2)
    expect(taches.every((tache) => tache.data.userId === user.id)).toBe(true)
  })

  it('should enqueue nothing when the write does not commit (already in that state, reauthentication refused, unknown target)', async () => {
    const { admin, user, vitrine } = await monde()

    await expect(reactiver(admin.id, user.id, MOTIF_A2, IP)).rejects.toMatchObject({ code: 'ETAT_DEJA_APPLIQUE' })
    await expect(republier(admin.id, vitrine.id, MOTIF_A2, IP)).rejects.toMatchObject({ code: 'ETAT_DEJA_APPLIQUE' })
    await expect(suspendre(admin.id, user.id, MOTIF_A2, IP, { reauth: async () => { throw new Error('REAUTH_REFUSEE') } })).rejects.toThrow('REAUTH_REFUSEE')
    await expect(depublier(admin.id, vitrine.id, MOTIF_A2, IP, { reauth: async () => { throw new Error('REAUTH_REFUSEE') } })).rejects.toThrow('REAUTH_REFUSEE')
    await expect(suspendre(admin.id, 'inconnu', MOTIF_A2, IP, REAUTH_OK)).rejects.toMatchObject({ code: 'UTILISATEUR_INTROUVABLE' })

    expect(await jobsDuCache()).toHaveLength(0)
  })

  it('should still succeed (and the account stays suspended) when the queue is unavailable', async () => {
    const { admin, user } = await monde()
    const file = getMaintenanceQueue()
    const ajout = vi.spyOn(file, 'add').mockRejectedValue(new Error('REDIS_INDISPONIBLE'))
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await expect(suspendre(admin.id, user.id, MOTIF_A2, IP, REAUTH_OK)).resolves.toBeUndefined()

    expect(JSON.stringify(erreur.mock.calls)).toContain('MEDIAS_CACHE_ENFILAGE_ECHEC')
    ajout.mockRestore()
    erreur.mockRestore()
    await expect(reactiver(admin.id, user.id, MOTIF_A2, IP)).resolves.toBeUndefined()
  })
})
