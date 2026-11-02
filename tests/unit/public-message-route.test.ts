import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { H3Event } from 'h3'
import { fakeEvent } from '../support/h3'
import {
  MESSAGE_PUBLIC_LIMIT,
} from '../../shared/limites'
import { NotFoundError, TooManyRequestsError } from '../../server/exceptions/http'

// Contrat S7-bis §4.4 : la route publique des messages est fine et ORDONNÉE,
// copie de `reservations/index.post.ts` :
//   IP (fail-closed, MESSAGE_PUBLIC_LIMIT) → Zod strict → limite contact
//   (fail-closed) → service transactionnel → resource → 201.
// Toute garde qui échoue interrompt la chaîne : jamais d'écriture.

const { createMessage, enforceContactLimit, enforceLimit } = vi.hoisted(() => ({
  createMessage: vi.fn(),
  enforceContactLimit: vi.fn(),
  enforceLimit: vi.fn(),
}))

vi.mock('#server/services/messages', () => ({ createMessage }))
vi.mock('#server/services/limiteur', () => ({ enforceLimit }))
vi.mock('#server/services/contact-limiteur', () => ({ enforceContactLimit }))
vi.mock('#server/resources/message', () => ({
  toMessageCreatedResource: (item: { id: string, sujet: string }) => ({
    message: { id: item.id, sujet: item.sujet },
  }),
}))

const routeMessage = () => import('../../server/api/public/[username]/messages/index.post')

const CONTACT = {
  nom: 'Marie Ndzi',
  email: 'marie.ndzi@example.com',
  telephone: '+237699000001',
  sujet: 'question_avant_reservation',
  message: 'Bonjour, le rendez-vous peut-il être décalé ?',
  siteWeb: '',
}

interface ErreurH3 {
  statusCode: number
  code?: string
  champs?: Record<string, string[]>
}

async function erreurH3(promesse: Promise<unknown>): Promise<ErreurH3> {
  try {
    await promesse
  } catch (erreur) {
    const h3 = erreur as { statusCode?: number, data?: { code?: string, champs?: Record<string, string[]> } }
    return {
      statusCode: h3.statusCode ?? -1,
      code: h3.data?.code,
      champs: h3.data?.champs,
    }
  }
  throw new Error('La promesse devait échouer, elle a abouti.')
}

interface AppelRoute {
  event: H3Event
  promesse: Promise<unknown>
}

async function appelerRoute(corps: unknown): Promise<AppelRoute> {
  const event = fakeEvent({
    method: 'POST',
    params: { username: 'dr-cabrel' },
    body: JSON.stringify(corps),
  })
  Object.defineProperty(event.node.req.socket, 'remoteAddress', {
    configurable: true,
    value: '127.0.0.1',
  })
  const { default: handler } = await routeMessage()
  return { event, promesse: handler(event) }
}

beforeEach(() => {
  createMessage.mockResolvedValue({
    item: { id: 'message-1', sujet: 'question_avant_reservation', createdAt: new Date() },
  })
  enforceLimit.mockResolvedValue(undefined)
  enforceContactLimit.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST public messages : ordre des gardes', () => {
  it('peut écrire : IP → Zod → limite contact → service → resource 201', async () => {
    const { event, promesse } = await appelerRoute(CONTACT)

    const corps = await promesse

    expect(corps).toEqual({ message: { id: 'message-1', sujet: 'question_avant_reservation' } })
    expect(event.node.res.statusCode).toBe(201)
    expect(createMessage).toHaveBeenCalledTimes(1)
    expect(enforceLimit).toHaveBeenCalledTimes(1)
    expect(enforceContactLimit).toHaveBeenCalledTimes(1)
    expect(createMessage.mock.invocationCallOrder[0]).toBeGreaterThan(
      enforceContactLimit.mock.invocationCallOrder[0] ?? 0,
    )
    expect(enforceContactLimit.mock.invocationCallOrder[0]).toBeGreaterThan(
      enforceLimit.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('key la limite IP avec l’adresse résolue par l’aide anti-spoofing et passe les options fail-closed', async () => {
    const ipTransmise = '2001:db8::42'
    const event = fakeEvent({
      method: 'POST',
      headers: { 'x-forwarded-for': ipTransmise },
      params: { username: 'dr-cabrel' },
      body: JSON.stringify(CONTACT),
    })
    Object.defineProperty(event.node.req.socket, 'remoteAddress', {
      configurable: true,
      value: '127.0.0.1',
    })
    const { default: handler } = await routeMessage()
    await handler(event)

    expect(enforceLimit).toHaveBeenCalledOnce()
    const [cle, limite, fenetre, options] = enforceLimit.mock.calls[0] as unknown[] as [
      string, number, number, Record<string, unknown>,
    ]
    expect(cle).toContain('message')
    expect(cle.endsWith(`:${ipTransmise}`)).toBe(true)
    expect(limite).toBe(MESSAGE_PUBLIC_LIMIT.limit)
    expect(fenetre).toBe(MESSAGE_PUBLIC_LIMIT.windowS)
    expect(options).toEqual({ failClosed: true })
  })

  it('interroge la limite contact après Zod, avec l’espace et le téléphone absent normalisé à null', async () => {
    const { telephone: _omis, ...sansTelephone } = CONTACT
    await appelerRoute(sansTelephone)

    expect(enforceContactLimit).toHaveBeenCalledOnce()
    expect(enforceContactLimit).toHaveBeenCalledWith(
      'message-contact',
      'dr-cabrel',
      CONTACT.email,
      null,
    )
  })

  it('transmet le téléphone du visiteur à la limite contact quand il est fourni', async () => {
    await appelerRoute(CONTACT)

    expect(enforceContactLimit).toHaveBeenCalledWith(
      'message-contact',
      'dr-cabrel',
      CONTACT.email,
      CONTACT.telephone,
    )
  })

  it('transmet un corps nettoyé (nom trimé, téléphone absent) au service', async () => {
    // La chaîne fail-closed (limite IP → Zod → limite contact → service) exige deux
    // suspensions : la promesse du handler doit être attendue avant d'observer l'appel.
    const { promesse } = await appelerRoute({ ...CONTACT, nom: `  ${CONTACT.nom}  ` })
    await promesse

    expect(createMessage).toHaveBeenCalledWith('dr-cabrel', {
      nom: CONTACT.nom,
      email: CONTACT.email,
      telephone: CONTACT.telephone,
      sujet: 'question_avant_reservation',
      message: CONTACT.message,
    })
  })
})

describe('POST public messages : limites fail-closed', () => {
  it('ne passe rien au service quand la limite IP refuse (429 + Retry-After)', async () => {
    enforceLimit.mockRejectedValue(new TooManyRequestsError(120))

    const { event, promesse } = await appelerRoute(CONTACT)
    const erreur = await erreurH3(promesse)

    expect(erreur.statusCode).toBe(429)
    expect(erreur.code).toBe('TROP_DE_REQUETES')
    expect(event.node.res.getHeader('retry-after')).toBe('120')
    expect(enforceContactLimit).not.toHaveBeenCalled()
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('ne passe rien au service quand la limite contact est indisponible (503 LIMITEUR_INDISPONIBLE)', async () => {
    const indisponible = new (await import('../../server/exceptions/http')).ServiceUnavailableError('LIMITEUR_INDISPONIBLE')
    enforceContactLimit.mockRejectedValue(indisponible)

    const erreur = await erreurH3((await appelerRoute(CONTACT)).promesse)

    expect(erreur.statusCode).toBe(503)
    expect(erreur.code).toBe('LIMITEUR_INDISPONIBLE')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('ne crée rien quand la limite contact refuse (429, aucune écriture)', async () => {
    enforceContactLimit.mockRejectedValue(new TooManyRequestsError(86_400))

    const erreur = await erreurH3((await appelerRoute(CONTACT)).promesse)

    expect(erreur.statusCode).toBe(429)
    expect(erreur.code).toBe('TROP_DE_REQUETES')
    expect(createMessage).not.toHaveBeenCalled()
  })
})

describe('POST public messages : validation et erreurs métier', () => {
  it('répond 400 VALIDATION sur le honeypot rempli (réponse générique, jamais d’écriture)', async () => {
    const { promesse } = await appelerRoute({ ...CONTACT, siteWeb: 'https://robot.example' })

    const erreur = await erreurH3(promesse)

    expect(erreur.statusCode).toBe(400)
    expect(erreur.code).toBe('VALIDATION')
    expect(erreur.champs).toBeDefined()
    expect(createMessage).not.toHaveBeenCalled()
  })

  it.each([
    { nom: '' },
    { email: 'pas-un-email' },
    { sujet: 'facturation' },
    { message: '' },
  ])('répond 400 VALIDATION avec champs pour %j, sans appeler le service', async (surchage) => {
    const { promesse } = await appelerRoute({ ...CONTACT, ...surchage })

    const erreur = await erreurH3(promesse)

    expect(erreur.statusCode).toBe(400)
    expect(erreur.code).toBe('VALIDATION')
    expect(createMessage).not.toHaveBeenCalled()
  })

  it('relai 404 VITRINE_INTROUVABLE du service sans fuite interne', async () => {
    createMessage.mockRejectedValue(new NotFoundError('VITRINE_INTROUVABLE'))

    const erreur = await erreurH3((await appelerRoute(CONTACT)).promesse)

    expect(erreur.statusCode).toBe(404)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })
})
