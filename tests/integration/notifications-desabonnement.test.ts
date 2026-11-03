import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pipeline } from 'ioredis'
import { users } from '../../shared/db/schema'
import { DESABONNEMENT_API_CHEMIN, DESABONNEMENT_JETON_VALIDITE_JOURS } from '../../shared/notifications'
import type { PreferenceEmail } from '../../shared/notifications'
import { DESABONNEMENT_ACTION_LIMIT, DESABONNEMENT_APERCU_LIMIT } from '../../shared/limites'
import { DESABONNEMENT_CORPS_MAX_OCTETS } from '../../server/services/desabonnement'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import {
  JOUR_MS,
  appeler,
  creerPro,
  evenement,
  lireOutbox,
  lireUtilisateur,
  utc,
  viderOutbox,
} from './support/notifications'
import { espionnerJournaux, jetonDesabonnement, modulesPlanification } from './support/planification'
import type { EspionJournaux } from './support/planification'

// S9 §6, #89, CA39 à CA46, CA66 : routes publiques de désabonnement, handlers Nitro réels sur événements h3 réels,
// PostgreSQL et Redis réels (aucun mock). Les routes lisent l'horloge réelle : les jetons sont signés avec `new Date()`
// (valides) ou avec une date passée de plus de 90 jours (expirés).

const routeGet = () => import('../../server/api/public/desabonnement/index.get')
const routePost = () => import('../../server/api/public/desabonnement/index.post')

const ENTETES_ATTENDUS = { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex' } as const
const ONE_CLICK = 'List-Unsubscribe=One-Click'
const FORM = 'application/x-www-form-urlencoded'
let ipSuivante = 0

/** Une IP différente par appel, sauf si le test en fixe une : chaque test part d'un compteur vierge. */
function ip(): string {
  ipSuivante += 1
  return `198.51.100.${(ipSuivante % 250) + 1}`
}

async function get(jeton: string | undefined, adresse = ip()) {
  const { default: handler } = await routeGet()
  const requete = jeton === undefined ? DESABONNEMENT_API_CHEMIN : `${DESABONNEMENT_API_CHEMIN}?jeton=${jeton}`
  return appeler(handler, evenement({ chemin: requete, ip: adresse }))
}

async function postOneClick(jeton: string, adresse = ip()) {
  const { default: handler } = await routePost()
  return appeler(handler, evenement({ methode: 'POST', chemin: `${DESABONNEMENT_API_CHEMIN}?jeton=${jeton}`, corps: ONE_CLICK, typeContenu: FORM, ip: adresse }))
}

async function postJson(corps: unknown, adresse = ip()) {
  const { default: handler } = await routePost()
  return appeler(handler, evenement({ methode: 'POST', chemin: DESABONNEMENT_API_CHEMIN, corps: JSON.stringify(corps), ip: adresse }))
}

async function preferences(userId: string) {
  const ligne = await lireUtilisateur(userId)
  return { email_hebdo: ligne?.email_hebdo, email_rappel_jour: ligne?.email_rappel_jour }
}

function modifierSignature(jeton: string): string {
  const [v, p, s] = jeton.split('.') as [string, string, string]
  return `${v}.${p}.${s.slice(0, -1)}${s.endsWith('A') ? 'B' : 'A'}`
}

function remplacerPreference(jeton: string, preference: PreferenceEmail): string {
  const [v, p, s] = jeton.split('.') as [string, string, string]
  const charge = JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) as Record<string, unknown>
  return `${v}.${Buffer.from(JSON.stringify({ ...charge, p: preference }), 'utf8').toString('base64url')}.${s}`
}

let journaux: EspionJournaux | undefined

beforeEach(async () => {
  await viderOutbox()
})

afterEach(() => {
  vi.restoreAllMocks()
  journaux?.restaurer()
  journaux = undefined
})

describe('GET : aperçu sans aucun effet (CA39)', () => {
  it('should answer 200 { preference } and leave the preference untouched, even when scanners open the link many times', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())

    const reponses = []
    for (let i = 0; i < 5; i += 1) reponses.push(await get(jeton))

    for (const r of reponses) {
      expect(r.status).toBe(200)
      expect(r.corps).toEqual({ preference: 'email_hebdo' })
    }
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: true })
  })

  it('should reveal neither an e-mail address, a name nor an identifier (only the preference)', async () => {
    const pro = await creerPro({ email: 'secret@exemple.test' })
    const jeton = await jetonDesabonnement(pro.user.id, 'email_rappel_jour', new Date())

    const r = await get(jeton)

    expect(Object.keys(r.corps as object)).toEqual(['preference'])
    const texte = JSON.stringify(r.corps)
    for (const interdit of ['secret@exemple.test', pro.user.id, 'Pro de test']) expect(texte).not.toContain(interdit)
  })

  it('should forbid caching, referrer relay and indexing of the response (the token is in the URL)', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())

    const succes = await get(jeton)
    const refus = await get(modifierSignature(jeton))

    expect(succes.entetes).toMatchObject(ENTETES_ATTENDUS)
    expect(refus.entetes).toMatchObject(ENTETES_ATTENDUS)
  })

  it('should answer 410 JETON_EXPIRE for a token issued 91 days ago, and still 200 for one issued 89 days ago', async () => {
    const pro = await creerPro()
    const ancien = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date(Date.now() - (DESABONNEMENT_JETON_VALIDITE_JOURS + 1) * JOUR_MS))
    const recent = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date(Date.now() - (DESABONNEMENT_JETON_VALIDITE_JOURS - 1) * JOUR_MS))

    const expire = await get(ancien)
    const valide = await get(recent)

    expect(expire).toMatchObject({ status: 410, code: 'JETON_EXPIRE' })
    expect(valide).toMatchObject({ status: 200, corps: { preference: 'email_hebdo' } })
  })
})

describe('jeton inutilisable : toujours 404 JETON_INVALIDE, jamais 400, sur GET et POST (CA41, arbitrage 6)', () => {
  it.each([
    ['une signature modifiée', (j: string) => modifierSignature(j)],
    ['un payload modifié (p remplacé par email_rappel_jour)', (j: string) => remplacerPreference(j, 'email_rappel_jour')],
    ['une version inconnue', (j: string) => j.replace(/^v1\./, 'v2.')],
    ['une chaîne trop courte', () => 'abc'],
    ['une chaîne de 600 caractères', () => `v1.${'A'.repeat(300)}.${'B'.repeat(296)}`],
    ['des caractères hors alphabet base64url', (j: string) => `${j}%00<script>`],
    ['un jeton tronqué', (j: string) => j.slice(0, j.lastIndexOf('.'))],
  ])('should answer 404 JETON_INVALIDE for %s and change nothing in the database', async (_cas, fabriquer) => {
    const pro = await creerPro()
    const valide = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const jeton = fabriquer(valide)

    const apercu = await get(jeton)
    const effectif = await postOneClick(jeton)
    const json = await postJson({ jeton })

    for (const r of [apercu, effectif, json]) expect(r).toMatchObject({ status: 404, code: 'JETON_INVALIDE' })
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: true })
  })

  it('should answer 404 JETON_INVALIDE when no token is given at all, and when the parameter is repeated', async () => {
    const pro = await creerPro()
    const valide = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())

    expect(await get(undefined)).toMatchObject({ status: 404, code: 'JETON_INVALIDE' })
    expect(await get(`${valide}&jeton=${valide}`)).toMatchObject({ status: 404, code: 'JETON_INVALIDE' })
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: true })
  })

  it('should not let a token of user A touch user B', async () => {
    const a = await creerPro()
    const b = await creerPro()

    await postOneClick(await jetonDesabonnement(a.user.id, 'email_hebdo', new Date()))

    expect(await preferences(a.user.id)).toEqual({ email_hebdo: false, email_rappel_jour: true })
    expect(await preferences(b.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: true })
  })
})

describe('POST : désabonnement effectif et idempotent (CA40, CA43)', () => {
  it('should unsubscribe with the RFC 8058 one-click form (no session, no Origin) and answer the same 200 the second time (CA40)', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())

    const premier = await postOneClick(jeton)
    const second = await postOneClick(jeton)

    expect(premier).toMatchObject({ status: 200, corps: { preference: 'email_hebdo', desabonne: true } })
    expect(second).toMatchObject({ status: 200, corps: { preference: 'email_hebdo', desabonne: true } })
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: false, email_rappel_jour: true })
    expect(premier.entetes).toMatchObject(ENTETES_ATTENDUS)
  })

  it('should also accept the JSON body { jeton } used by the page', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_rappel_jour', new Date())

    const r = await postJson({ jeton })

    expect(r).toMatchObject({ status: 200, corps: { preference: 'email_rappel_jour', desabonne: true } })
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: false })
  })

  it('should touch ONLY the preference named by the signed token', async () => {
    const pro = await creerPro()

    await postOneClick(await jetonDesabonnement(pro.user.id, 'email_rappel_jour', new Date()))
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: false })

    await postOneClick(await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date()))
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: false, email_rappel_jour: false })
  })

  it('should never re-enable a preference: an already switched-off preference stays off and the answer is still 200', async () => {
    const pro = await creerPro({ emailHebdo: false })

    const r = await postOneClick(await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date()))

    expect(r.status).toBe(200)
    expect((await preferences(pro.user.id)).email_hebdo).toBe(false)
  })

  it('should answer 200 for a valid token of a deleted account: no existence oracle (CA43)', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    await db.delete(users).where(eq(users.id, pro.user.id))

    const r = await postOneClick(jeton)

    expect(r).toMatchObject({ status: 200, corps: { preference: 'email_hebdo', desabonne: true } })
  })

  it('should answer 410 JETON_EXPIRE for an expired token and change nothing (CA42)', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date(Date.now() - (DESABONNEMENT_JETON_VALIDITE_JOURS + 1) * JOUR_MS))

    const r = await postOneClick(jeton)

    expect(r).toMatchObject({ status: 410, code: 'JETON_EXPIRE' })
    expect((await preferences(pro.user.id)).email_hebdo).toBe(true)
  })

  it.each([
    ['sans aucun corps (ni content-length)', undefined, undefined, {}],
    ['en morceaux (transfer-encoding: chunked, sans content-length)', undefined, undefined, { 'transfer-encoding': 'chunked' }],
    ['avec une valeur One-Click inconnue', 'List-Unsubscribe=Autre', FORM, {}],
    ['avec un corps vide', '', FORM, {}],
    ['avec un JSON illisible', '{pas du json', 'application/json', {}],
    ['avec un JSON de forme inattendue', JSON.stringify({ autre: 1 }), 'application/json', {}],
    ['avec un corps de plus de DESABONNEMENT_CORPS_MAX_OCTETS', JSON.stringify({ rempli: 'x'.repeat(DESABONNEMENT_CORPS_MAX_OCTETS) }), 'application/json', {}],
  ])('should fall back on the signed token of the query on a POST %s (the signed token is the authorization)', async (_cas, corps, type, entetes) => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const { default: handler } = await routePost()

    const r = await appeler(handler, evenement({ methode: 'POST', chemin: `${DESABONNEMENT_API_CHEMIN}?jeton=${jeton}`, corps, typeContenu: type, entetes, ip: ip() }))

    expect(r).toMatchObject({ status: 200, corps: { preference: 'email_hebdo', desabonne: true } })
    expect((await preferences(pro.user.id)).email_hebdo).toBe(false)
  })

  it.each([
    ['sans corps ni jeton', undefined, undefined],
    ['avec un corps illisible et sans jeton', '{pas du json', 'application/json'],
    ['avec un corps One-Click mais sans jeton en query', ONE_CLICK, FORM],
  ])('should answer 404 JETON_INVALIDE on a POST %s and change nothing', async (_cas, corps, type) => {
    const pro = await creerPro()
    const { default: handler } = await routePost()

    const r = await appeler(handler, evenement({ methode: 'POST', chemin: DESABONNEMENT_API_CHEMIN, corps, typeContenu: type, ip: ip() }))

    expect(r).toMatchObject({ status: 404, code: 'JETON_INVALIDE' })
    expect(await preferences(pro.user.id)).toEqual({ email_hebdo: true, email_rappel_jour: true })
  })

  it('should answer 404 (not the query token) when the JSON body carries an invalid token: the body wins when it is well-formed', async () => {
    const pro = await creerPro()
    const valide = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const { default: handler } = await routePost()

    const r = await appeler(handler, evenement({
      methode: 'POST',
      chemin: `${DESABONNEMENT_API_CHEMIN}?jeton=${valide}`,
      corps: JSON.stringify({ jeton: modifierSignature(valide) }),
      ip: ip(),
    }))

    expect(r).toMatchObject({ status: 404, code: 'JETON_INVALIDE' })
    expect((await preferences(pro.user.id)).email_hebdo).toBe(true)
  })

  it('should stop the weekly summary from being planned the next Monday (CA66)', async () => {
    const { planifierNotifications } = await modulesPlanification()
    const desabonne = await creerPro()
    const reste = await creerPro()
    await postOneClick(await jetonDesabonnement(desabonne.user.id, 'email_hebdo', new Date()))

    await planifierNotifications(utc('2026-11-09T07:00:00.000Z'))

    expect(await lireOutbox({ entiteId: desabonne.user.id })).toHaveLength(0)
    expect(await lireOutbox({ entiteId: reste.user.id })).toHaveLength(1)
  })
})

describe('limiteur par IP, fail-open (CA44)', () => {
  it('should answer 429 TROP_DE_REQUETES with Retry-After on the first POST above the action budget within a minute', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const adresse = '203.0.113.50'

    for (let i = 1; i <= DESABONNEMENT_ACTION_LIMIT.limit; i += 1) expect((await postOneClick(jeton, adresse)).status, `appel ${i}`).toBe(200)
    const refus = await postOneClick(jeton, adresse)

    expect(refus).toMatchObject({ status: 429, code: 'TROP_DE_REQUETES' })
    expect(Number(refus.entetes['retry-after'])).toBeGreaterThan(0)
    expect(Number(refus.entetes['retry-after'])).toBeLessThanOrEqual(DESABONNEMENT_ACTION_LIMIT.windowS)
  })

  it('should give the preview (GET) its own wider budget: link scanners do not exhaust the POST budget of the same IP', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const adresse = '203.0.113.51'

    for (let i = 1; i <= DESABONNEMENT_APERCU_LIMIT.limit; i += 1) expect((await get(jeton, adresse)).status, `aperçu ${i}`).toBe(200)

    const refusApercu = await get(jeton, adresse)
    expect(refusApercu).toMatchObject({ status: 429, code: 'TROP_DE_REQUETES' })
    expect(Number(refusApercu.entetes['retry-after'])).toBeLessThanOrEqual(DESABONNEMENT_APERCU_LIMIT.windowS)
    // L'action de la même IP reste possible : compteurs distincts, et l'aperçu est plus large que l'action.
    expect(DESABONNEMENT_APERCU_LIMIT.limit).toBeGreaterThan(DESABONNEMENT_ACTION_LIMIT.limit)
    expect((await postOneClick(jeton, adresse)).status).toBe(200)
  })

  it('should not let POSTs consume the preview budget, and leave other IPs free', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const adresse = '203.0.113.53'

    for (let i = 0; i < DESABONNEMENT_ACTION_LIMIT.limit; i += 1) await postOneClick(jeton, adresse)

    expect((await postOneClick(jeton, adresse)).status).toBe(429)
    expect((await get(jeton, adresse)).status).toBe(200)
    expect((await postOneClick(jeton, '203.0.113.52')).status).toBe(200)
  })

  it('should not store the client address in clear text in Redis', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())

    await get(jeton, '203.0.113.60')

    const cles = await redis.keys('limite:desabonnement:*')
    expect(cles.length).toBeGreaterThan(0)
    expect(cles.join(' ')).not.toContain('203.0.113.60')
  })

  it('should still unsubscribe when Redis is down: the right to object must stay effective (fail-open)', async () => {
    const pro = await creerPro()
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    const multiReel = redis.multi.bind(redis) as unknown as () => Pipeline
    vi.spyOn(redis, 'multi').mockImplementation((() => {
      const pipeline = multiReel()
      const incrReel = pipeline.incr.bind(pipeline)
      pipeline.incr = ((cle: string) => {
        if (cle.includes('desabonnement:')) throw new Error('Redis indisponible (panne simulée)')
        return incrReel(cle)
      }) as typeof pipeline.incr
      return pipeline
    }) as unknown as typeof redis.multi)
    journaux = espionnerJournaux()

    const r = await postOneClick(jeton)

    expect(r).toMatchObject({ status: 200, corps: { desabonne: true } })
    expect((await preferences(pro.user.id)).email_hebdo).toBe(false)
  })
})

describe('journaux : aucune donnée personnelle (CA46)', () => {
  it('should write no token, no e-mail address and no name on the console during a successful and a failed unsubscription', async () => {
    const pro = await creerPro({ email: 'marie.confidentielle@exemple.test' })
    const jeton = await jetonDesabonnement(pro.user.id, 'email_hebdo', new Date())
    journaux = espionnerJournaux()

    await get(jeton)
    await postOneClick(jeton)
    await postOneClick(modifierSignature(jeton))
    await get(`${jeton}XX`)

    const sortie = journaux.contenu()
    const [version, charge, signature] = jeton.split('.') as [string, string, string]
    for (const interdit of [jeton, charge, signature, 'marie.confidentielle@exemple.test', 'Pro de test', pro.user.id]) {
      expect(sortie, `journal contenant « ${interdit.slice(0, 12)}… »`).not.toContain(interdit)
    }
    expect(version).toBe('v1')
  })
})
