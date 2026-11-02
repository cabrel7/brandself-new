import { inspect } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { creerOpenAiProvider } from '../../server/services/ia/fournisseurs/openai'
import { createIaProvider } from '../../server/services/ia/fournisseurs'
import { IaErreur } from '../../server/services/ia/types'
import type { IaRequete } from '../../server/services/ia/types'
import { loadEnv } from '../../shared/env'
import { IA_BASE_URL_DEFAUT, IA_CLE_API_LONGUEUR_MIN } from '../../shared/ia'

// S8 §4.2 : adaptateur compatible OpenAI. Aucun appel réseau : le transport `fetch` est injecté.
// Le SDK n'est jamais mocké : on vérifie la requête HTTP réelle qu'il fabrique et la lecture de la réponse.

const CLE = `cle-secrete-${'x'.repeat(IA_CLE_API_LONGUEUR_MIN)}`
const MODELE = 'gemini-2.5-flash'
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/'
const SCHEMA = { type: 'object', properties: { texte: { type: 'string' } }, required: ['texte'] }
const MESSAGE_SECRET = 'message-brut-du-fournisseur-avec-donnees-personnelles'

interface AppelCapture {
  url: string
  methode: string
  autorisation: string | null
  corps: Record<string, unknown>
}

function requete(surcharges: Partial<IaRequete> = {}): IaRequete {
  return {
    systeme: 'Système',
    message: '<donnees>{"metier":"Cardiologue"}</donnees>',
    outil: { nom: 'proposer_texte', description: 'Enregistre le texte', schema: { ...SCHEMA } },
    parametres: { temperature: 0.4, maxTokens: 900 },
    delaiMs: 5_000,
    signal: new AbortController().signal,
    ...surcharges,
  }
}

function jsonResponse(corps: unknown, statut = 200): Response {
  return new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } })
}

function completion(message: Record<string, unknown>) {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'modele-renvoye',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', ...message } }],
    usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 },
  }
}

function appelOutil(argumentsJson: string, nom = 'proposer_texte') {
  return { id: 'call_1', type: 'function', function: { name: nom, arguments: argumentsJson } }
}

/** Transport factice : capture la requête et répond avec `repondre`. */
function transport(repondre: (init: RequestInit) => Response | Promise<Response>) {
  const appels: AppelCapture[] = []
  const fetchFactice: typeof fetch = async (input, init = {}) => {
    const entetes = new Headers(init.headers)
    appels.push({
      url: input instanceof Request ? input.url : String(input),
      methode: init.method ?? 'GET',
      autorisation: entetes.get('authorization'),
      corps: JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>,
    })
    return repondre(init)
  }
  return { fetch: fetchFactice, appels }
}

function provider(fetchFactice: typeof fetch) {
  return creerOpenAiProvider({ cleApi: CLE, modele: MODELE, baseUrl: BASE_URL, fetch: fetchFactice })
}

async function echec(promesse: Promise<unknown>): Promise<IaErreur> {
  try {
    await promesse
  } catch (erreur) {
    if (erreur instanceof IaErreur) return erreur
    throw erreur
  }
  throw new Error('une erreur était attendue')
}

let journal: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  journal = vi.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('adaptateur OpenAI : forme de la requête', () => {
  it('should post to chat/completions on the configured base URL with the bearer key', async () => {
    const t = transport(() => jsonResponse(completion({ content: null, tool_calls: [appelOutil('{"texte":"ok"}')] })))

    await provider(t.fetch).generer(requete())

    expect(t.appels).toHaveLength(1)
    expect(t.appels[0]?.url).toBe(`${BASE_URL}chat/completions`)
    expect(t.appels[0]?.methode.toUpperCase()).toBe('POST')
    expect(t.appels[0]?.autorisation).toBe(`Bearer ${CLE}`)
  })

  it('should use the public OpenAI endpoint when no base URL is given', async () => {
    const t = transport(() => jsonResponse(completion({ tool_calls: [appelOutil('{"texte":"ok"}')] })))

    await creerOpenAiProvider({ cleApi: CLE, modele: MODELE, fetch: t.fetch }).generer(requete())

    expect(t.appels[0]?.url).toBe(`${IA_BASE_URL_DEFAUT}/chat/completions`)
  })

  it('should send the model, both messages, the tool, a forced tool_choice, temperature and max_tokens', async () => {
    const t = transport(() => jsonResponse(completion({ tool_calls: [appelOutil('{"texte":"ok"}')] })))

    await provider(t.fetch).generer(requete())

    expect(t.appels[0]?.corps).toEqual({
      model: MODELE,
      messages: [
        { role: 'system', content: 'Système' },
        { role: 'user', content: '<donnees>{"metier":"Cardiologue"}</donnees>' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'proposer_texte',
            description: 'Enregistre le texte',
            parameters: SCHEMA,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: 'proposer_texte' } },
      temperature: 0.4,
      max_tokens: 900,
    })
  })

  it('should force type object on the tool parameters even if the schema omits it', async () => {
    const t = transport(() => jsonResponse(completion({ tool_calls: [appelOutil('{"texte":"ok"}')] })))
    const outil = { nom: 'proposer_texte', description: 'd', schema: { properties: {} } }

    await provider(t.fetch).generer(requete({ outil }))

    const outils = t.appels[0]?.corps.tools as { function: { parameters: Record<string, unknown> } }[]
    expect(outils[0]?.function.parameters.type).toBe('object')
  })

  it('should not retry on failure (the executor owns the retries)', async () => {
    const t = transport(() => jsonResponse({ error: { message: MESSAGE_SECRET } }, 500))

    await echec(provider(t.fetch).generer(requete()))

    expect(t.appels).toHaveLength(1)
  })
})

describe('adaptateur OpenAI : lecture de la réponse', () => {
  it('should read tool_calls[0].function.arguments as JSON with tokens and model', async () => {
    const t = transport(() => jsonResponse(completion({ content: null, tool_calls: [appelOutil('{"texte":"Bonjour"}')] })))

    const reponse = await provider(t.fetch).generer(requete())

    expect(reponse).toEqual({ donnees: { texte: 'Bonjour' }, tokensEntree: 12, tokensSortie: 34, modele: 'modele-renvoye' })
  })

  it('should fall back to a JSON object in the text when the provider ignores tool_choice', async () => {
    const t = transport(() => jsonResponse(completion({ content: 'Voici :\n```json\n{"texte":"Depuis le texte"}\n```' })))

    const reponse = await provider(t.fetch).generer(requete())

    expect(reponse.donnees).toEqual({ texte: 'Depuis le texte' })
  })

  it('should parse a bare JSON object in the text', async () => {
    const t = transport(() => jsonResponse(completion({ content: '{"texte":"brut"}' })))

    await expect(provider(t.fetch).generer(requete())).resolves.toMatchObject({ donnees: { texte: 'brut' } })
  })

  it('should fall back to the text when the tool arguments are not valid JSON', async () => {
    const t = transport(() => jsonResponse(completion({ content: '{"texte":"secours"}', tool_calls: [appelOutil('{pas du json')] })))

    await expect(provider(t.fetch).generer(requete())).resolves.toMatchObject({ donnees: { texte: 'secours' } })
  })

  it('should prefer the tool call named after the requested tool', async () => {
    const t = transport(() =>
      jsonResponse(completion({ tool_calls: [appelOutil('{"autre":1}', 'autre_outil'), appelOutil('{"texte":"bon"}')] })),
    )

    await expect(provider(t.fetch).generer(requete())).resolves.toMatchObject({ donnees: { texte: 'bon' } })
  })

  it('should never execute anything found in the text: a non-object payload is an empty answer', async () => {
    const t = transport(() => jsonResponse(completion({ content: 'process.exit(1); [1,2,3]' })))

    const erreur = await echec(provider(t.fetch).generer(requete()))

    expect(erreur.code).toBe('reponse_vide')
  })

  it.each([
    ['a plain text without JSON', { content: 'Je ne peux pas répondre.' }],
    ['a null content and no tool call', { content: null }],
    ['unparsable arguments and no text', { content: null, tool_calls: [appelOutil('{pas du json')] }],
  ])('should answer reponse_vide for %s', async (_nom, message) => {
    const t = transport(() => jsonResponse(completion(message)))

    const erreur = await echec(provider(t.fetch).generer(requete()))

    expect(erreur.code).toBe('reponse_vide')
  })

  it('should answer reponse_vide when there is no choice at all', async () => {
    const t = transport(() => jsonResponse({ ...completion({}), choices: [] }))

    expect((await echec(provider(t.fetch).generer(requete()))).code).toBe('reponse_vide')
  })

  it('should default missing usage to zero tokens and missing model to the configured one', async () => {
    const t = transport(() => jsonResponse({ ...completion({ tool_calls: [appelOutil('{"texte":"x"}')] }), usage: undefined, model: '' }))

    const reponse = await provider(t.fetch).generer(requete())

    expect(reponse).toMatchObject({ tokensEntree: 0, tokensSortie: 0, modele: MODELE })
  })
})

describe('adaptateur OpenAI : erreurs', () => {
  it.each([
    [400, 'fournisseur'],
    [401, 'fournisseur'],
    [403, 'fournisseur'],
    [404, 'fournisseur'],
    [408, 'delai'],
    [429, 'fournisseur'],
    [500, 'fournisseur'],
    [502, 'fournisseur'],
    [503, 'fournisseur'],
  ] as const)('should map HTTP %i to the code %s, with no raw message nor key anywhere', async (statut, code) => {
    const t = transport(() => jsonResponse({ error: { message: `${MESSAGE_SECRET} ${CLE}`, code: 'x' } }, statut))

    const erreur = await echec(provider(t.fetch).generer(requete()))

    expect(erreur).toBeInstanceOf(IaErreur)
    expect(erreur.code).toBe(code)
    expect(erreur.message).toBe(code)
    for (const trace of [erreur.message, erreur.stack ?? '', inspect(erreur, { depth: 6 }), JSON.stringify(journal.mock.calls)]) {
      expect(trace).not.toContain(CLE)
      expect(trace).not.toContain(MESSAGE_SECRET)
    }
    expect(journal).toHaveBeenCalledWith({ ia: 'fournisseur', fournisseur: 'openai', code, statut })
  })

  it('should map a network failure to the provider code, without leaking its message', async () => {
    const t = transport(() => {
      throw new TypeError(`fetch failed ${MESSAGE_SECRET} ${CLE}`)
    })

    const erreur = await echec(provider(t.fetch).generer(requete()))

    expect(erreur.code).toBe('fournisseur')
    expect(JSON.stringify(journal.mock.calls)).not.toContain(MESSAGE_SECRET)
    expect(JSON.stringify(journal.mock.calls)).not.toContain(CLE)
    expect(inspect(erreur, { depth: 6 })).not.toContain(MESSAGE_SECRET)
  })

  it('should map the attempt timeout to the delay code', async () => {
    const t = transport(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        }),
    )

    const erreur = await echec(provider(t.fetch).generer(requete({ delaiMs: 30 })))

    expect(erreur.code).toBe('delai')
  })

  it('should map an abort requested by the caller (global deadline) to the delay code', async () => {
    const controleur = new AbortController()
    const t = transport(
      (init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true })
        }),
    )

    const promesse = provider(t.fetch).generer(requete({ signal: controleur.signal }))
    setTimeout(() => controleur.abort(), 10)

    expect((await echec(promesse)).code).toBe('delai')
  })

  it('should keep the provider code for a 200 answer that is not a completion', async () => {
    const t = transport(() => new Response(`<html>${MESSAGE_SECRET}</html>`, { status: 200, headers: { 'content-type': 'text/html' } }))

    const erreur = await echec(provider(t.fetch).generer(requete()))

    expect(['fournisseur', 'reponse_vide']).toContain(erreur.code)
    expect(JSON.stringify(journal.mock.calls)).not.toContain(MESSAGE_SECRET)
  })
})

describe('createIaProvider avec openai', () => {
  const BASE = {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
  }

  it('should build the openai provider and never expose the key when printed or serialised', () => {
    const fournisseur = createIaProvider(
      loadEnv({ ...BASE, IA_FOURNISSEUR: 'openai', IA_CLE_API: CLE, IA_MODELE: MODELE, IA_BASE_URL: BASE_URL }),
    )

    expect(fournisseur?.nom).toBe('openai')
    expect(JSON.stringify(fournisseur)).not.toContain(CLE)
    expect(inspect(fournisseur, { depth: 6, showHidden: false })).not.toContain(CLE)
  })

  it('should build no provider for openai without a key (never an exception)', () => {
    expect(createIaProvider(loadEnv({ ...BASE, IA_FOURNISSEUR: 'openai', IA_MODELE: MODELE }))).toBeNull()
  })
})
