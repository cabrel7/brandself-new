import { createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

// Faux serveur K-PAY (S10 §6 : « faux serveur HTTP local, node:http sur 127.0.0.1 »). C'est la SEULE chose factice des
// tests de paiement : tout le reste (base, Redis, services, signature) est réel. Il parle le protocole documenté
// dans kpay_doc.md et dans l'OpenAPI K-PAY :
//   POST /api/v1/payments/init      -> 201 { id, reference, status, amount, currency, externalId, ... }
//   GET  /api/v1/payments/:id       -> 200 { id, reference, status, amount, netAmount, feeAmount, currency, externalId,
//                                            failureReason, phoneNumber, ... } | 404
// Il enregistre chaque requête reçue (en-têtes d'authentification et corps bruts compris) pour les assertions, et
// signe des webhooks avec HMAC-SHA256 hexadécimal du corps BRUT (en-tête `X-KPAY-Signature`).
//
// Aucune dépendance au code de production : les constantes sont recopiées ici exprès, pour qu'un test échoue si le
// code s'écarte du protocole K-PAY (et non si un test et le code se trompent ensemble).

/** Valeurs de test partagées : jamais de clé réelle dans le dépôt. */
export const KPAY_TEST_CLE_API = 'kpay_test_0123456789abcdefghijklmn'
export const KPAY_TEST_CLE_SECRETE = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export const KPAY_TEST_SECRET_WEBHOOK = 'secret-de-webhook-de-test-0123456789'

export const KPAY_CHEMIN_INIT = '/api/v1/payments/init'
export const KPAY_CHEMIN_TRANSACTION = '/api/v1/payments/'
export const KPAY_ENTETE_SIGNATURE = 'x-kpay-signature'

/** Numéros du bac à sable K-PAY (kpay_doc.md « Sandbox numbers », Cameroun, collecte). */
export const NUMEROS_SANDBOX = {
  succes: '237653456789',
  echecPlafond: '237653456019',
  echecIntrouvable: '237653456029',
  echecNonApprouve: '237653456039',
  echecNonSpecifie: '237653456069',
  nonTerminal: '237653456129',
} as const

const STATUT_HTTP_CREE = 201
const STATUT_HTTP_OK = 200

export interface RequeteRecue {
  methode: string
  chemin: string
  entetes: IncomingHttpHeaders
  /** Corps tel que reçu (chaîne UTF-8). */
  corpsBrut: string
  /** Corps analysé si c'est du JSON valide, sinon `undefined`. */
  corps: Record<string, unknown> | undefined
}

export type StatutKpay = 'PENDING' | 'PROCESSING' | 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'REFUNDED'

/** Transaction connue du faux serveur (créée à l'initiation, modifiable par le test). */
export interface TransactionFausse {
  id: string
  reference: string
  status: StatutKpay
  amount: number
  currency: string
  externalId: string
  provider: string
  phoneNumber: string
  feeAmount?: number
  netAmount?: number
  failureReason?: string | null
}

/** Comportement de `POST /init`. */
export type ScenarioInitiation =
  /** 201 avec une transaction dont l'issue suit `statutInitial` (défaut `PENDING`). */
  | { type: 'succes', statutInitial?: StatutKpay, id?: string, reference?: string, champsSupplementaires?: Record<string, unknown> }
  /** Issue choisie d'après le numéro, comme le bac à sable réel (`NUMEROS_SANDBOX`). */
  | { type: 'selon-numero' }
  | { type: 'http', status: number, entetes?: Record<string, string>, corps?: unknown }
  /** Le serveur ne répond jamais (la connexion reste ouverte jusqu'à `fermer()`). */
  | { type: 'silence' }
  /** 201 avec un corps qui n'est pas du JSON. */
  | { type: 'json-invalide' }
  /** 201 dont le JSON n'a pas d'`id`. */
  | { type: 'sans-id' }
  /** Coupe la connexion sans répondre (erreur réseau). */
  | { type: 'coupure' }

/** Comportement de `GET /:id` quand l'identifiant est inconnu ou que le test veut forcer une réponse. */
export type ScenarioConsultation =
  | { type: 'selon-transaction' }
  | { type: 'http', status: number, entetes?: Record<string, string>, corps?: unknown }
  | { type: 'silence' }

export interface CorpsWebhookOptions {
  event?: string
  paymentId: string
  status?: string
  amount: number
  externalId?: string
  reference?: string
  timestamp?: string
  currency?: string
  failureReason?: string
  /** Champs supplémentaires inconnus du contrat (doivent être ignorés par le récepteur). */
  extra?: Record<string, unknown>
}

export interface FauxKpay {
  readonly url: string
  readonly port: number
  /** Requêtes reçues, dans l'ordre. */
  readonly requetes: RequeteRecue[]
  readonly initiations: RequeteRecue[]
  readonly consultations: RequeteRecue[]
  readonly transactions: Map<string, TransactionFausse>
  definirInitiation: (scenario: ScenarioInitiation | ((requete: RequeteRecue, numero: number) => ScenarioInitiation)) => void
  definirConsultation: (scenario: ScenarioConsultation) => void
  /** Modifie une transaction connue (ex. la faire passer à COMPLETED avant un rapprochement). */
  modifierTransaction: (id: string, modifications: Partial<TransactionFausse>) => TransactionFausse
  derniereTransaction: () => TransactionFausse
  /** Hook appelé à chaque initiation, avant la réponse (ex. lire la base pour prouver l'ordre des écritures). */
  surInitiation: (hook: ((requete: RequeteRecue) => void | Promise<void>) | undefined) => void
  reinitialiser: () => void
  fermer: () => Promise<void>
}

export function corpsWebhook(options: CorpsWebhookOptions): string {
  return JSON.stringify({
    event: options.event ?? 'payment.completed',
    paymentId: options.paymentId,
    ...(options.reference === undefined ? {} : { reference: options.reference }),
    status: options.status ?? 'COMPLETED',
    amount: options.amount,
    ...(options.externalId === undefined ? {} : { externalId: options.externalId }),
    timestamp: options.timestamp ?? '2026-11-03T13:00:00.000Z',
    ...(options.currency === undefined ? {} : { currency: options.currency }),
    ...(options.failureReason === undefined ? {} : { failureReason: options.failureReason }),
    ...(options.extra ?? {}),
  })
}

/** HMAC-SHA256 hexadécimal du corps BRUT (octets), comme K-PAY. */
export function signerWebhook(corps: string | Buffer, secret: string = KPAY_TEST_SECRET_WEBHOOK): string {
  return createHmac('sha256', secret).update(corps).digest('hex')
}

/** Envoie un webhook signé à une URL (le serveur testé) et renvoie le statut et le corps JSON. */
export async function envoyerWebhook(
  url: string,
  corps: string | Buffer,
  options: { signature?: string | null, secret?: string } = {},
): Promise<{ status: number, corps: unknown }> {
  const signature = options.signature === undefined ? signerWebhook(corps, options.secret) : options.signature
  const reponse = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature === null ? {} : { 'x-kpay-signature': signature }),
    },
    body: typeof corps === 'string' ? corps : new Uint8Array(corps),
  })
  const texte = await reponse.text()
  try {
    return { status: reponse.status, corps: JSON.parse(texte) as unknown }
  } catch {
    return { status: reponse.status, corps: texte }
  }
}

function lireCorps(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const morceaux: Buffer[] = []
    req.on('data', (m: Buffer) => morceaux.push(m))
    req.on('end', () => resolve(Buffer.concat(morceaux).toString('utf8')))
    req.on('error', reject)
  })
}

function analyserJson(texte: string): Record<string, unknown> | undefined {
  try {
    const valeur: unknown = JSON.parse(texte)
    return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

function repondre(res: ServerResponse, status: number, corps: unknown, entetes: Record<string, string> = {}): void {
  const texte = typeof corps === 'string' ? corps : JSON.stringify(corps)
  res.writeHead(status, { 'content-type': 'application/json', ...entetes })
  res.end(texte)
}

/** Issue d'un paiement d'après le numéro (bac à sable K-PAY). */
function issueSelonNumero(numero: string): { status: StatutKpay, failureReason: string | null } {
  switch (numero) {
    case NUMEROS_SANDBOX.succes: return { status: 'COMPLETED', failureReason: null }
    case NUMEROS_SANDBOX.echecPlafond: return { status: 'FAILED', failureReason: 'PAYER_LIMIT_REACHED' }
    case NUMEROS_SANDBOX.echecIntrouvable: return { status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' }
    case NUMEROS_SANDBOX.echecNonApprouve: return { status: 'FAILED', failureReason: 'PAYMENT_NOT_APPROVED' }
    case NUMEROS_SANDBOX.echecNonSpecifie: return { status: 'FAILED', failureReason: 'UNSPECIFIED_FAILURE' }
    default: return { status: 'SUBMITTED', failureReason: null }
  }
}

function vueTransaction(t: TransactionFausse): Record<string, unknown> {
  return {
    id: t.id,
    reference: t.reference,
    providerReference: `ref_${t.id}`,
    status: t.status,
    amount: t.amount,
    ...(t.netAmount === undefined ? {} : { netAmount: t.netAmount }),
    ...(t.feeAmount === undefined ? {} : { feeAmount: t.feeAmount }),
    currency: t.currency,
    externalId: t.externalId,
    provider: t.provider,
    country: 'CMR',
    // Le vrai K-PAY renvoie le numéro : le code testé ne doit ni le lire ni le journaliser.
    phoneNumber: t.phoneNumber,
    ...(t.failureReason === undefined ? {} : { failureReason: t.failureReason }),
  }
}

/** Démarre le faux serveur sur 127.0.0.1 (port éphémère). */
export async function demarrerFauxKpay(): Promise<FauxKpay> {
  const requetes: RequeteRecue[] = []
  const initiations: RequeteRecue[] = []
  const consultations: RequeteRecue[] = []
  const transactions = new Map<string, TransactionFausse>()
  const sockets = new Set<Socket>()
  let scenarioInit: ScenarioInitiation | ((requete: RequeteRecue, numero: number) => ScenarioInitiation) = { type: 'succes' }
  let scenarioConsultation: ScenarioConsultation = { type: 'selon-transaction' }
  let hookInitiation: ((requete: RequeteRecue) => void | Promise<void>) | undefined
  let compteur = 0

  const serveur: Server = createServer((req, res) => {
    void (async () => {
      const corpsBrut = await lireCorps(req)
      const chemin = req.url ?? ''
      const requete: RequeteRecue = {
        methode: req.method ?? '',
        chemin,
        entetes: req.headers,
        corpsBrut,
        corps: analyserJson(corpsBrut),
      }
      requetes.push(requete)

      if (req.method === 'POST' && chemin === KPAY_CHEMIN_INIT) {
        initiations.push(requete)
        compteur += 1
        if (hookInitiation) await hookInitiation(requete)
        const scenario = typeof scenarioInit === 'function' ? scenarioInit(requete, compteur) : scenarioInit
        traiterInitiation(requete, scenario, res)
        return
      }
      if (req.method === 'GET' && chemin.startsWith(KPAY_CHEMIN_TRANSACTION)) {
        consultations.push(requete)
        traiterConsultation(decodeURIComponent(chemin.slice(KPAY_CHEMIN_TRANSACTION.length)), res)
        return
      }
      repondre(res, 404, { message: 'Route inconnue du faux K-PAY' })
    })().catch(() => {
      if (!res.headersSent) repondre(res, 500, { message: 'Erreur du faux K-PAY' })
    })
  })

  function traiterInitiation(requete: RequeteRecue, scenario: ScenarioInitiation, res: ServerResponse): void {
    switch (scenario.type) {
      case 'silence':
        return
      case 'coupure':
        res.socket?.destroy()
        return
      case 'http':
        repondre(res, scenario.status, scenario.corps ?? { message: `Erreur ${scenario.status}` }, scenario.entetes)
        return
      case 'json-invalide':
        repondre(res, STATUT_HTTP_CREE, '{"id": "tx_', {})
        return
      case 'sans-id':
        repondre(res, STATUT_HTTP_CREE, { reference: 'KPAY-SANS-ID', status: 'PENDING', amount: 5000, externalId: 'x' })
        return
      case 'succes':
      case 'selon-numero': {
        const corps = requete.corps ?? {}
        const numero = String(corps.phoneNumber ?? '')
        const externalId = String(corps.externalId ?? '')
        // Le vrai serveur renvoie 409 pour un `externalId` déjà utilisé.
        if ([...transactions.values()].some((t) => t.externalId === externalId)) {
          repondre(res, 409, { message: 'externalId déjà utilisé' })
          return
        }
        const issue = scenario.type === 'selon-numero'
          ? issueSelonNumero(numero)
          : { status: scenario.statutInitial ?? 'PENDING', failureReason: null }
        const id = scenario.type === 'succes' && scenario.id ? scenario.id : `tx_${randomUUID()}`
        const transaction: TransactionFausse = {
          id,
          reference: scenario.type === 'succes' && scenario.reference ? scenario.reference : `KPAY-${id.slice(-8).toUpperCase()}`,
          status: issue.status,
          amount: Number(corps.amount ?? 0),
          currency: String(corps.currency ?? 'XAF'),
          externalId,
          provider: String(corps.provider ?? ''),
          phoneNumber: numero,
          failureReason: issue.failureReason,
          ...(issue.status === 'COMPLETED'
            ? { feeAmount: Math.ceil(Number(corps.amount ?? 0) * 0.05), netAmount: Number(corps.amount ?? 0) - Math.ceil(Number(corps.amount ?? 0) * 0.05) }
            : {}),
        }
        transactions.set(id, transaction)
        repondre(res, STATUT_HTTP_CREE, {
          id: transaction.id,
          reference: transaction.reference,
          providerReference: `ref_${transaction.id}`,
          // L'initiation ne confirme jamais le succès : le statut initial reste non terminal.
          status: issue.status === 'COMPLETED' || issue.status === 'FAILED' ? 'PENDING' : issue.status,
          amount: transaction.amount,
          currency: transaction.currency,
          externalId: transaction.externalId,
          message: 'Paiement initié avec succès.',
          phoneNumber: numero,
          ...(scenario.type === 'succes' ? (scenario.champsSupplementaires ?? {}) : {}),
        })
        return
      }
    }
  }

  function traiterConsultation(identifiant: string, res: ServerResponse): void {
    const scenario = scenarioConsultation
    if (scenario.type === 'silence') return
    if (scenario.type === 'http') {
      repondre(res, scenario.status, scenario.corps ?? { message: `Erreur ${scenario.status}` }, scenario.entetes)
      return
    }
    const trouvee = transactions.get(identifiant) ?? [...transactions.values()].find((t) => t.reference === identifiant)
    if (!trouvee) {
      repondre(res, 404, { message: 'Transaction introuvable' })
      return
    }
    repondre(res, STATUT_HTTP_OK, vueTransaction(trouvee))
  }

  serveur.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })

  await new Promise<void>((resolve, reject) => {
    serveur.once('error', reject)
    serveur.listen(0, '127.0.0.1', () => resolve())
  })
  const adresse = serveur.address()
  if (adresse === null || typeof adresse === 'string') throw new Error('Le faux K-PAY n’a pas de port.')

  return {
    url: `http://127.0.0.1:${adresse.port}`,
    port: adresse.port,
    requetes,
    initiations,
    consultations,
    transactions,
    definirInitiation: (scenario) => {
      scenarioInit = scenario
    },
    definirConsultation: (scenario) => {
      scenarioConsultation = scenario
    },
    modifierTransaction: (id, modifications) => {
      const courante = transactions.get(id)
      if (!courante) throw new Error(`Transaction fausse ${id} inconnue.`)
      const mise = { ...courante, ...modifications }
      transactions.set(id, mise)
      return mise
    },
    derniereTransaction: () => {
      const derniere = [...transactions.values()].at(-1)
      if (!derniere) throw new Error('Aucune transaction dans le faux K-PAY.')
      return derniere
    },
    surInitiation: (hook) => {
      hookInitiation = hook
    },
    reinitialiser: () => {
      requetes.length = 0
      initiations.length = 0
      consultations.length = 0
      transactions.clear()
      scenarioInit = { type: 'succes' }
      scenarioConsultation = { type: 'selon-transaction' }
      hookInitiation = undefined
      compteur = 0
    },
    fermer: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy()
        serveur.close(() => resolve())
      }),
  }
}
