import { createHmac, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { IncomingHttpHeaders, IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Socket } from 'node:net'

// Faux serveur Mercy Pay (P1, docs/specs/P1-mercypay.md §2) : la SEULE chose factice des tests de paiement Mercy. Il imite
// POST /payments et GET /payments/{id} sous le préfixe `/api/v1`, avec l'idempotence documentée :
//   - `Authorization: Bearer <clé>` exigé (401 sinon) ; `Idempotency-Key` exigé (400 `idempotency_key_missing`) ;
//   - même clé + même corps brut -> la réponse d'origine est REJOUÉE avec l'en-tête `Idempotent-Replayed: true` ;
//   - même clé + corps différent -> 409 `idempotency_key_reused` ; clé en cours de traitement -> 409 `idempotency_key_in_use`.
// Il fabrique aussi des webhooks SIGNÉS au format réel : `MercyPay-Signature: t=<secondes>,v1=<HMAC-SHA256 hex de "t.corps">`,
// enveloppe `{ id: 'evt_…', type, livemode, data }`.
//
// Aucune dépendance au code de production : les constantes sont recopiées ici exprès (un test échoue si le code s'écarte du
// protocole, pas si le test et le code se trompent ensemble). Valeurs factices uniquement : jamais de clé réelle.

export const MERCY_TEST_CLE_API = 'mp_sandbox_test0123456789abcdefghijklmn'
export const MERCY_TEST_CLE_LIVE = 'mp_live_test0123456789abcdefghijklmnop'
export const MERCY_TEST_SECRET_WEBHOOK = 'whsec_test0123456789abcdefghijklmnopqrstuvwxyz'
export const MERCY_TEST_AUTRE_SECRET = 'whsec_testAUTRE9876543210zyxwvutsrqponmlkjihgfedcba'

/** Préfixe des routes (le vrai : `https://mercy-pay.com/api/v1`). */
export const MERCY_PREFIXE = '/api/v1'
export const MERCY_CHEMIN_PAIEMENTS = `${MERCY_PREFIXE}/payments`
export const MERCY_ENTETE_SIGNATURE = 'mercypay-signature'
/** Secondes de tolérance de l'horodatage `t` d'une signature (documentation Mercy Pay). */
export const MERCY_TOLERANCE_SIGNATURE_S = 300
/** Points de base du taux mobile money du compte (spec D2) : sert aux frais de la réponse fabriquée. */
export const MERCY_TAUX_PB = 350

const STATUT_HTTP_CREE = 201
const STATUT_HTTP_OK = 200

export interface RequeteMercyRecue {
  methode: string
  chemin: string
  entetes: IncomingHttpHeaders
  /** Corps tel que reçu (chaîne UTF-8). */
  corpsBrut: string
  /** Corps analysé si c'est du JSON valide (objet), sinon `undefined`. */
  corps: Record<string, unknown> | undefined
}

export type StatutMercy = 'pending' | 'succeeded' | 'failed' | 'refunded'

/** Paiement connu du faux serveur : exactement les champs de `data` de la réponse 201 (spec §2). */
export interface PaiementMercyFaux {
  id: string
  livemode: boolean
  /** Date ISO 8601 avec décalage, comme dans la documentation Mercy Pay (« 2026-10-04T10:20:00+00:00 »). */
  created: string
  amount: number
  fee_amount: number
  net_amount: number
  currency: string
  mobile_money_provider: string
  status: StatutMercy
  failure_code: string | null
  failure_reason: string | null
  metadata: Record<string, unknown>
}

/** Comportement de `POST /payments` (après les contrôles d'authentification et d'idempotence). */
export type ScenarioInitiationMercy =
  /** 201 avec un paiement `pending` (défaut), `id` imposable. */
  | { type: 'succes', id?: string }
  /** Le paiement est CRÉÉ chez Mercy mais la réponse n'arrive qu'après `delaiMs` (le client abandonne avant). */
  | { type: 'lent', delaiMs: number }
  | { type: 'http', status: number, entetes?: Record<string, string>, corps?: unknown }
  /** Le serveur ne répond jamais (la connexion reste ouverte jusqu'à `fermer()`). */
  | { type: 'silence' }
  /** 201 dont le corps n'est pas du JSON. */
  | { type: 'json-invalide' }
  /** 201 dont `data` n'a pas d'`id`. */
  | { type: 'sans-id' }
  /** 201 dont le montant diffère de celui demandé (réponse incohérente). */
  | { type: 'montant-different', montant: number }
  /** 201 dont `metadata.paiement_id` diffère de celui demandé. */
  | { type: 'metadata-differente' }
  | { type: 'coupure' }

export type ScenarioConsultationMercy =
  | { type: 'selon-paiement' }
  | { type: 'http', status: number, entetes?: Record<string, string>, corps?: unknown }
  | { type: 'silence' }

export interface FauxMercyPay {
  /** `http://127.0.0.1:<port>` */
  readonly url: string
  /** Valeur de `MERCY_PAY_BASE_URL` : `http://127.0.0.1:<port>/api/v1` (sans barre finale). */
  readonly baseUrl: string
  readonly port: number
  readonly requetes: RequeteMercyRecue[]
  readonly initiations: RequeteMercyRecue[]
  readonly consultations: RequeteMercyRecue[]
  /** Appels de `GET /payments?…` (liste : recherche d'un paiement par `metadata.paiement_id`). */
  readonly listes: RequeteMercyRecue[]
  readonly paiements: Map<string, PaiementMercyFaux>
  /** Nombre de réponses rejouées (`Idempotent-Replayed: true`). */
  readonly rejeux: () => number
  definirInitiation: (scenario: ScenarioInitiationMercy | ((requete: RequeteMercyRecue, numero: number) => ScenarioInitiationMercy)) => void
  definirConsultation: (scenario: ScenarioConsultationMercy) => void
  /** Modifie un paiement connu (ex. le faire passer à `succeeded` avant un rapprochement). */
  modifierPaiement: (id: string, modifications: Partial<PaiementMercyFaux>) => PaiementMercyFaux
  dernierPaiement: () => PaiementMercyFaux
  /** Hook appelé à chaque initiation, après les contrôles et avant la réponse. */
  surInitiation: (hook: ((requete: RequeteMercyRecue) => void | Promise<void>) | undefined) => void
  /** Clé acceptée (défaut `MERCY_TEST_CLE_API`) : toute autre clé reçoit 401. */
  accepterCle: (cle: string) => void
  reinitialiser: () => void
  fermer: () => Promise<void>
}

// ---------------------------------------------------------------------------------------------
// Webhooks signés au format réel
// ---------------------------------------------------------------------------------------------

export interface OptionsSignature {
  /** Secret `whsec_…` (défaut `MERCY_TEST_SECRET_WEBHOOK`). */
  secret?: string
  /** Autres secrets : un `v1` de plus par secret (rotation de secret, 24 h). Placés AVANT le secret principal. */
  secretsSupplementaires?: string[]
  /** Horodatage en secondes (défaut : maintenant). */
  t?: number
}

/** HMAC-SHA256 hexadécimal de `"{t}.{corps}"`, calculé sur les OCTETS du corps. */
export function hmacMercy(secret: string, t: number, corps: string | Buffer): string {
  return createHmac('sha256', secret).update(`${t}.`).update(corps).digest('hex')
}

/** Valeur de l'en-tête `MercyPay-Signature` : `t=<secondes>,v1=<hex>[,v1=<hex>…]`. */
export function signerWebhookMercy(corps: string | Buffer, options: OptionsSignature = {}): string {
  const t = options.t ?? Math.floor(Date.now() / 1000)
  const secrets = [...(options.secretsSupplementaires ?? []), options.secret ?? MERCY_TEST_SECRET_WEBHOOK]
  return [`t=${t}`, ...secrets.map((secret) => `v1=${hmacMercy(secret, t, corps)}`)].join(',')
}

export interface OptionsEvenementMercy {
  /** `evt_…` (défaut : aléatoire). */
  id?: string
  type: string
  livemode?: boolean
  data: Record<string, unknown>
  /** Champs supplémentaires inconnus du contrat (doivent être ignorés par le récepteur). */
  extra?: Record<string, unknown>
}

/** Enveloppe d'événement au format de la documentation : `{ id, object: 'event', type, created (ISO 8601), livemode, data }`. */
export function corpsEvenementMercy(options: OptionsEvenementMercy): string {
  return JSON.stringify({
    id: options.id ?? `evt_${randomBytes(8).toString('hex')}`,
    object: 'event',
    type: options.type,
    created: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
    livemode: options.livemode ?? false,
    data: options.data,
    ...(options.extra ?? {}),
  })
}

export interface OptionsPaiementMercy {
  /** `payment.succeeded` (défaut), `payment.failed`, `payment.refunded`… */
  type?: string
  eventId?: string
  /** `pay_…` */
  paymentId: string
  /** Notre UUID, transmis à l'initiation dans `metadata.paiement_id`. `null` = métadonnée absente. */
  paiementId: string | null
  amount: number
  /** Défaut selon `type` : 175 sur 5000 pour un succès, absent sinon ; `null` = absent. */
  feeAmount?: number | null
  netAmount?: number | null
  currency?: string
  /** Défaut selon `type` (`succeeded`, `failed`, `refunded`). */
  status?: string
  failureCode?: string | null
  failureReason?: string | null
  livemode?: boolean
  /** Champs supplémentaires de `data` (inconnus du contrat). */
  dataExtra?: Record<string, unknown>
  extra?: Record<string, unknown>
}

const STATUT_PAR_TYPE: Record<string, string> = {
  'payment.succeeded': 'succeeded',
  'payment.failed': 'failed',
  'payment.refunded': 'refunded',
  'payment.pending': 'pending',
}

/** Événement `payment.*` : `data` est l'objet paiement (spec §2). */
export function corpsPaiementMercy(options: OptionsPaiementMercy): string {
  const type = options.type ?? 'payment.succeeded'
  const succes = type === 'payment.succeeded'
  const frais = options.feeAmount === undefined ? (succes ? Math.ceil((options.amount * MERCY_TAUX_PB) / 10_000) : null) : options.feeAmount
  const net = options.netAmount === undefined ? (frais === null ? null : options.amount - frais) : options.netAmount
  return corpsEvenementMercy({
    ...(options.eventId === undefined ? {} : { id: options.eventId }),
    type,
    livemode: options.livemode ?? false,
    data: {
      // Champs et formats de l'exemple `payment.succeeded` de la documentation (`created` en ISO 8601, `checkout_session`,
      // `mobile_money_*`, `next_action`) : un faux plus pauvre que la réalité masquerait un rejet de schéma en production.
      id: options.paymentId,
      object: 'payment',
      livemode: options.livemode ?? false,
      created: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      checkout_session: null,
      amount: options.amount,
      ...(frais === null ? {} : { fee_amount: frais }),
      ...(net === null ? {} : { net_amount: net }),
      currency: options.currency ?? 'XAF',
      payment_method: 'mobile_money',
      mobile_money_country: 'CMR',
      mobile_money_provider: 'MTN_MOMO_CMR',
      status: options.status ?? STATUT_PAR_TYPE[type] ?? 'pending',
      failure_code: options.failureCode ?? null,
      failure_reason: options.failureReason ?? null,
      metadata: options.paiementId === null ? {} : { paiement_id: options.paiementId },
      next_action: null,
      ...(options.dataExtra ?? {}),
    },
    ...(options.extra === undefined ? {} : { extra: options.extra }),
  })
}

/** Envoie un webhook (signé par défaut) en HTTP à une URL et renvoie le statut et le corps. */
export async function envoyerWebhookMercy(
  url: string,
  corps: string | Buffer,
  options: { signature?: string | null, secret?: string, t?: number } = {},
): Promise<{ status: number, corps: unknown }> {
  const signature = options.signature === undefined
    ? signerWebhookMercy(corps, { ...(options.secret === undefined ? {} : { secret: options.secret }), ...(options.t === undefined ? {} : { t: options.t }) })
    : options.signature
  const reponse = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature === null ? {} : { [MERCY_ENTETE_SIGNATURE]: signature }) },
    body: typeof corps === 'string' ? corps : new Uint8Array(corps),
  })
  const texte = await reponse.text()
  try {
    return { status: reponse.status, corps: JSON.parse(texte) as unknown }
  } catch {
    return { status: reponse.status, corps: texte }
  }
}

// ---------------------------------------------------------------------------------------------
// Surcharge de `env` pour les tests de ROUTE (voir tests/integration/paiements-mercypay-webhook.test.ts)
// ---------------------------------------------------------------------------------------------

/**
 * `shared/env.ts` lit `process.env` UNE fois, au premier accès (déclenché par `server/utils/db` dans le setup, avant ce
 * fichier). Les variables `MERCY_PAY_*` ne peuvent donc plus y être posées. Les tests de route remplacent le module `env`
 * (via `vi.mock('../../shared/env', …)`) par ce proxy : toute clé présente dans `surchargeEnvMercy` (y compris avec la valeur
 * `undefined`) l'emporte sur l'environnement réel. Les variables du poste du développeur ne peuvent ainsi jamais fuiter.
 */
export const surchargeEnvMercy: Record<string, string | boolean | undefined> = {}

export function envAvecSurcharge<T extends object>(reel: T): T {
  return new Proxy(reel, {
    get: (cible, cle, receveur) => (typeof cle === 'string' && Object.hasOwn(surchargeEnvMercy, cle) ? surchargeEnvMercy[cle] : Reflect.get(cible, cle, receveur)),
  })
}

// ---------------------------------------------------------------------------------------------
// Serveur
// ---------------------------------------------------------------------------------------------

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

function erreurMercy(code: string, message: string): { error: { code: string, message: string } } {
  return { error: { code, message } }
}

/** Objet `data` de la réponse de `POST /payments` et de `GET /payments/{id}` (spec §2, champs exacts). */
function vuePaiement(p: PaiementMercyFaux, surcharges: Partial<{ amount: number, metadata: Record<string, unknown> }> = {}): Record<string, unknown> {
  return {
    id: p.id,
    object: 'payment',
    livemode: p.livemode,
    created: p.created,
    checkout_session: null,
    amount: surcharges.amount ?? p.amount,
    fee_amount: p.fee_amount,
    net_amount: p.net_amount,
    currency: p.currency,
    payment_method: 'mobile_money',
    mobile_money_country: 'CMR',
    mobile_money_provider: p.mobile_money_provider,
    status: p.status,
    failure_code: p.failure_code,
    failure_reason: p.failure_reason,
    metadata: surcharges.metadata ?? p.metadata,
    next_action: null,
  }
}

interface ReponseStockee {
  status: number
  corps: string
}

interface EntreeIdempotence {
  corpsBrut: string
  /** `null` tant que la première requête n'a pas fini d'être traitée (-> 409 `idempotency_key_in_use`). */
  reponse: ReponseStockee | null
}

/** Démarre le faux serveur sur 127.0.0.1 (port éphémère). */
export async function demarrerFauxMercyPay(): Promise<FauxMercyPay> {
  const requetes: RequeteMercyRecue[] = []
  const initiations: RequeteMercyRecue[] = []
  const consultations: RequeteMercyRecue[] = []
  const listes: RequeteMercyRecue[] = []
  const paiements = new Map<string, PaiementMercyFaux>()
  const idempotence = new Map<string, EntreeIdempotence>()
  const sockets = new Set<Socket>()
  const minuteurs = new Set<NodeJS.Timeout>()
  let cleAcceptee = MERCY_TEST_CLE_API
  let scenarioInit: ScenarioInitiationMercy | ((requete: RequeteMercyRecue, numero: number) => ScenarioInitiationMercy) = { type: 'succes' }
  let scenarioConsultation: ScenarioConsultationMercy = { type: 'selon-paiement' }
  let hookInitiation: ((requete: RequeteMercyRecue) => void | Promise<void>) | undefined
  let compteur = 0
  let rejeux = 0

  const serveur: Server = createServer((req, res) => {
    void (async () => {
      const corpsBrut = await lireCorps(req)
      const chemin = req.url ?? ''
      const requete: RequeteMercyRecue = { methode: req.method ?? '', chemin, entetes: req.headers, corpsBrut, corps: analyserJson(corpsBrut) }
      requetes.push(requete)

      if (req.headers.authorization !== `Bearer ${cleAcceptee}`) {
        repondre(res, 401, erreurMercy('invalid_api_key', 'Clé d’API invalide.'))
        return
      }
      if (req.method === 'POST' && chemin === MERCY_CHEMIN_PAIEMENTS) {
        initiations.push(requete)
        await traiterInitiation(requete, res)
        return
      }
      // Liste (« Lister les paiements ») : du plus récent au plus ancien, `has_more` / `next_cursor` ; le filtre `created[gte]` est
      // enregistré mais pas appliqué (tous les paiements du faux sont récents).
      if (req.method === 'GET' && chemin.split('?')[0] === MERCY_CHEMIN_PAIEMENTS) {
        listes.push(requete)
        repondre(res, STATUT_HTTP_OK, {
          object: 'list',
          data: [...paiements.values()].reverse().map((p) => vuePaiement(p)),
          has_more: false,
          next_cursor: null,
        })
        return
      }
      if (req.method === 'GET' && chemin.startsWith(`${MERCY_CHEMIN_PAIEMENTS}/`)) {
        consultations.push(requete)
        traiterConsultation(decodeURIComponent(chemin.slice(MERCY_CHEMIN_PAIEMENTS.length + 1)), res)
        return
      }
      repondre(res, 404, erreurMercy('route_not_found', 'Route inconnue du faux Mercy Pay'))
    })().catch(() => {
      if (!res.headersSent) repondre(res, 500, erreurMercy('internal_error', 'Erreur du faux Mercy Pay'))
    })
  })

  function creerPaiement(requete: RequeteMercyRecue, id: string): PaiementMercyFaux {
    const corps = requete.corps ?? {}
    const montant = Number(corps.amount ?? 0)
    const frais = Math.ceil((montant * MERCY_TAUX_PB) / 10_000)
    const metadata = typeof corps.metadata === 'object' && corps.metadata !== null ? (corps.metadata as Record<string, unknown>) : {}
    const paiement: PaiementMercyFaux = {
      id,
      livemode: cleAcceptee.startsWith('mp_live_'),
      // Format de la documentation (et non un entier Unix) : un contrat inexact ici masquerait un échec réel en production.
      created: new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00'),
      amount: montant,
      fee_amount: frais,
      net_amount: montant - frais,
      currency: String(corps.currency ?? 'XAF'),
      mobile_money_provider: String(corps.provider ?? ''),
      status: 'pending',
      failure_code: null,
      failure_reason: null,
      metadata,
    }
    paiements.set(id, paiement)
    return paiement
  }

  async function traiterInitiation(requete: RequeteMercyRecue, res: ServerResponse): Promise<void> {
    const cle = requete.entetes['idempotency-key']
    if (typeof cle !== 'string' || cle.length === 0) {
      repondre(res, 400, erreurMercy('idempotency_key_missing', 'L’en-tête Idempotency-Key est obligatoire.'))
      return
    }
    const existante = idempotence.get(cle)
    if (existante) {
      if (existante.corpsBrut !== requete.corpsBrut) {
        repondre(res, 409, erreurMercy('idempotency_key_reused', 'Cette clé a déjà servi avec un autre corps.'))
        return
      }
      if (existante.reponse === null) {
        repondre(res, 409, erreurMercy('idempotency_key_in_use', 'Une requête avec cette clé est en cours.'))
        return
      }
      rejeux += 1
      repondre(res, existante.reponse.status, existante.reponse.corps, { 'Idempotent-Replayed': 'true' })
      return
    }
    const entree: EntreeIdempotence = { corpsBrut: requete.corpsBrut, reponse: null }
    idempotence.set(cle, entree)

    compteur += 1
    if (hookInitiation) await hookInitiation(requete)
    const scenario = typeof scenarioInit === 'function' ? scenarioInit(requete, compteur) : scenarioInit

    const finir = (status: number, corps: unknown, entetes: Record<string, string> = {}): void => {
      const texte = typeof corps === 'string' ? corps : JSON.stringify(corps)
      entree.reponse = { status, corps: texte }
      repondre(res, status, texte, entetes)
    }
    const id = scenario.type === 'succes' && scenario.id ? scenario.id : `pay_${randomBytes(10).toString('hex')}`

    switch (scenario.type) {
      case 'silence':
        return
      case 'coupure':
        idempotence.delete(cle)
        res.socket?.destroy()
        return
      case 'http':
        // Une erreur n'est pas mémorisée : la clé redevient libre (le vrai serveur ne fige pas une réponse 5xx).
        idempotence.delete(cle)
        repondre(res, scenario.status, scenario.corps ?? erreurMercy('erreur', `Erreur ${scenario.status}`), scenario.entetes)
        return
      case 'json-invalide':
        finir(STATUT_HTTP_CREE, '{"data": {"id": "pay_')
        return
      case 'sans-id': {
        const paiement = creerPaiement(requete, id)
        const { id: _omis, ...sansId } = vuePaiement(paiement)
        finir(STATUT_HTTP_CREE, { data: sansId })
        return
      }
      case 'montant-different':
        finir(STATUT_HTTP_CREE, { data: vuePaiement(creerPaiement(requete, id), { amount: scenario.montant }) })
        return
      case 'metadata-differente':
        finir(STATUT_HTTP_CREE, { data: vuePaiement(creerPaiement(requete, id), { metadata: { paiement_id: '00000000-0000-4000-8000-000000000000' } }) })
        return
      case 'lent': {
        const paiement = creerPaiement(requete, id)
        // La réponse est figée tout de suite (le paiement existe) ; seul son envoi est retardé.
        entree.reponse = { status: STATUT_HTTP_CREE, corps: JSON.stringify({ data: vuePaiement(paiement) }) }
        const minuteur = setTimeout(() => {
          minuteurs.delete(minuteur)
          if (!res.writableEnded && !res.destroyed && entree.reponse) repondre(res, entree.reponse.status, entree.reponse.corps)
        }, scenario.delaiMs)
        minuteur.unref()
        minuteurs.add(minuteur)
        return
      }
      case 'succes':
        finir(STATUT_HTTP_CREE, { data: vuePaiement(creerPaiement(requete, id)) })
        return
    }
  }

  function traiterConsultation(identifiant: string, res: ServerResponse): void {
    const scenario = scenarioConsultation
    if (scenario.type === 'silence') return
    if (scenario.type === 'http') {
      repondre(res, scenario.status, scenario.corps ?? erreurMercy('erreur', `Erreur ${scenario.status}`), scenario.entetes)
      return
    }
    const trouve = paiements.get(identifiant)
    if (!trouve) {
      repondre(res, 404, erreurMercy('resource_not_found', 'Paiement introuvable'))
      return
    }
    repondre(res, STATUT_HTTP_OK, { data: vuePaiement(trouve) })
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
  if (adresse === null || typeof adresse === 'string') throw new Error('Le faux Mercy Pay n’a pas de port.')

  return {
    url: `http://127.0.0.1:${adresse.port}`,
    baseUrl: `http://127.0.0.1:${adresse.port}${MERCY_PREFIXE}`,
    port: adresse.port,
    requetes,
    initiations,
    consultations,
    listes,
    paiements,
    rejeux: () => rejeux,
    definirInitiation: (scenario) => {
      scenarioInit = scenario
    },
    definirConsultation: (scenario) => {
      scenarioConsultation = scenario
    },
    modifierPaiement: (id, modifications) => {
      const courant = paiements.get(id)
      if (!courant) throw new Error(`Paiement faux ${id} inconnu.`)
      const mis = { ...courant, ...modifications }
      paiements.set(id, mis)
      return mis
    },
    dernierPaiement: () => {
      const dernier = [...paiements.values()].at(-1)
      if (!dernier) throw new Error('Aucun paiement dans le faux Mercy Pay.')
      return dernier
    },
    surInitiation: (hook) => {
      hookInitiation = hook
    },
    accepterCle: (cle) => {
      cleAcceptee = cle
    },
    reinitialiser: () => {
      requetes.length = 0
      initiations.length = 0
      consultations.length = 0
      listes.length = 0
      paiements.clear()
      idempotence.clear()
      for (const minuteur of minuteurs) clearTimeout(minuteur)
      minuteurs.clear()
      scenarioInit = { type: 'succes' }
      scenarioConsultation = { type: 'selon-paiement' }
      hookInitiation = undefined
      cleAcceptee = MERCY_TEST_CLE_API
      compteur = 0
      rejeux = 0
    },
    fermer: () =>
      new Promise<void>((resolve) => {
        for (const minuteur of minuteurs) clearTimeout(minuteur)
        minuteurs.clear()
        for (const socket of sockets) socket.destroy()
        serveur.close(() => resolve())
      }),
  }
}
