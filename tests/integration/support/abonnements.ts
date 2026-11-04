import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createHash, randomUUID } from 'node:crypto'
import { createEvent } from 'h3'
import type { H3Event } from 'h3'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { abonnements, evenementsPaiement, paiements } from '../../../shared/db/schema'
import { KPAY_APPELS_CLE } from '../../../shared/limites'
import type { PaiementInitierInput } from '../../../shared/schemas/abonnement'
import type { InitiationDeps } from '../../../server/services/abonnements'
import type { EvenementNormalise } from '../../../server/services/paiements/types'
import { schemaPaiementInitier } from '../../../shared/schemas/abonnement'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import { corpsWebhook, KPAY_ENTETE_SIGNATURE, signerWebhook } from '../../support/faux-kpay'
import type { CorpsWebhookOptions } from '../../support/faux-kpay'
import { insertRealisation, insertService, insertTemoignage } from './fabriques'
import { appeler, creerPro } from './notifications'
import type { Pro, ProOptions, ReponseHandler } from './notifications'

// Aides communes des tests d'intégration S10 (abonnements, paiements, webhooks, quotas, masquage, rappels).
// Règles : insertions DIRECTES pour l'état de départ, services RÉELS pour le comportement prouvé, jamais de mock de
// la base ni de Redis. Seul le fournisseur est factice (faux serveur K-PAY local, tests/support/faux-kpay.ts) et
// l'horloge est injectée (`now`).
//
// ============================================================================================================
// CONTRAT DE LA COUCHE SERVICE (lu dans le code de production quand il existe, sinon dans la spec §3/§5).
//
// server/services/plans.ts (B1)            resoudrePlanEffectif(abonnement | null, now, fuseau?), getPlanEffectif(userId, now),
//                                          limiteDe(plan, ressource), assertQuota(tx, { userId, vitrineId?, fuseau? }, ressource, now),
//                                          mesurerQuotaVerrouille, getQuotas(userId, now), getIaQuota(userId, now)
// server/services/plan-visibilite.ts (B1)  getPlanPublic, sqlIdsVisibles, getLimiteStudio, marquerMasque
// server/services/abonnements.ts (B2)      initierPaiement(userId, input, now, deps?: InitiationDeps) -> ligne `paiements`,
//                                          getOwnPaiement(userId, id) -> ligne, suivrePaiement(userId, id), prolonger(tx, userId, mois, now, paiementId?),
//                                          appliquerEvenement(fournisseur, evt, source, now, options?) -> { traitement, motif, paiementId },
//                                          verifierPaiementsDus(now, deps?) (HYPOTHÈSE : renvoie un objet de comptes), getAbonnementView(userId, now)
// server/services/paiements/fournisseurs   getPaiementProvider('kpay') -> PaiementProvider | null (clés lues dans `env` À CHAQUE appel)
// ROUTE WEBHOOK (spec §4) : server/api/webhooks/[fournisseur].post.ts, export default defineApiHandler(...). Réponse 200 { recu: true }.
// ROUTE TARIFS : server/api/public/tarifs/index.get.ts.   Les routes studio exigent une session : testées en e2e/api.
// ============================================================================================================

export const modulePlans = () => import('../../../server/services/plans')
export const modulePlansRegles = () => import('../../../server/services/plans-regles')
export const modulePlanVisibilite = () => import('../../../server/services/plan-visibilite')
export const moduleAbonnements = () => import('../../../server/services/abonnements')
export const moduleAbonnementsRegles = () => import('../../../server/services/abonnements-regles')
export const moduleWebhooks = () => import('../../../server/services/webhooks-paiement')
export const moduleApplication = () => import('../../../server/services/paiements/application')
export const moduleKpay = () => import('../../../server/services/paiements/fournisseurs/kpay/adaptateur')
export const moduleFournisseurs = () => import('../../../server/services/paiements/fournisseurs')
export const moduleRappelsAbonnement = () => import('../../../server/services/notifications/abonnements')
export const moduleRessourceAbonnement = () => import('../../../server/resources/abonnement')
export const routeWebhook = () => import('../../../server/api/webhooks/[fournisseur].post')
export const routeTarifs = () => import('../../../server/api/public/tarifs/index.get')

export const JOUR_MS = 86_400_000
export const MINUTE_MS = 60_000
export const SECONDE_MS = 1_000
/** Horloge de référence des scénarios datés (2026-11-03 13:00Z = 14:00 à Douala). */
export const NOW = new Date('2026-11-03T13:00:00.000Z')
/** Un mois de novembre 2026 : 5000 XAF pour 1 mois à partir de NOW donnent 2026-12-04 00:00 locale = 2026-12-03T23:00Z. */
export const ECHEANCE_1_MOIS_DEPUIS_NOW = new Date('2026-12-03T23:00:00.000Z')

export const ENTREE_PAIEMENT: PaiementInitierInput = {
  periodeMois: 12,
  devise: 'XAF',
  moyen: 'kpay:MTN_MOMO_CMR',
  telephone: '653456789',
}
/** Numéro complet et nombre de chiffres du numéro de l'entrée par défaut : ne doit apparaître NULLE PART. */
export const NUMERO_NATIONAL = '653456789'
export const NUMERO_INTERNATIONAL = '237653456789'
export const MASQUE_ATTENDU = '+237 6•• ••• •89'

export type PaiementRow = typeof paiements.$inferSelect
export type AbonnementRow = typeof abonnements.$inferSelect
export type EvenementPaiementRow = typeof evenementsPaiement.$inferSelect

export function minutes(n: number): number {
  return n * MINUTE_MS
}

export function jours(n: number): number {
  return n * JOUR_MS
}

export function plus(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

/** Accepte une date ou une chaîne ISO (le contrat B1/B2 peut renvoyer l'une ou l'autre) et renvoie les millisecondes. */
export function ms(valeur: Date | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null
  return valeur instanceof Date ? valeur.getTime() : new Date(valeur).getTime()
}

export function iso(valeur: Date | string | null | undefined): string | null {
  const t = ms(valeur)
  return t === null ? null : new Date(t).toISOString()
}

export function empreinteNumero(graine: string = randomUUID()): string {
  return createHash('sha256').update(graine).digest('hex')
}

// ---------------------------------------------------------------------------------------------
// Abonnements et professionnels
// ---------------------------------------------------------------------------------------------

export async function poserAbonnement(
  userId: string,
  expireLe: Date,
  options: { premiereActivationLe?: Date, plan?: string, dernierPaiementId?: string | null } = {},
): Promise<AbonnementRow> {
  const [ligne] = await db
    .insert(abonnements)
    .values({
      id: randomUUID(),
      userId,
      plan: options.plan ?? 'payant',
      expireLe,
      premiereActivationLe: options.premiereActivationLe ?? new Date(expireLe.getTime() - jours(40)),
      dernierPaiementId: options.dernierPaiementId ?? null,
    })
    .returning()
  if (!ligne) throw new Error('Insertion d’abonnement sans résultat.')
  return ligne
}

export async function lireAbonnement(userId: string): Promise<AbonnementRow | undefined> {
  const [ligne] = await db.select().from(abonnements).where(eq(abonnements.userId, userId))
  return ligne
}

export type EtatDepart = 'gratuit' | 'actif' | 'grace' | 'termine'

export interface AbonneOptions extends ProOptions {
  /** Horloge de référence pour dater l'abonnement (défaut : l'horloge réelle, car les services de création n'ont pas de `now`). */
  maintenant?: Date
}

export interface Abonne extends Pro {
  abonnement: AbonnementRow | undefined
}

/**
 * Professionnel complet (compte, vitrine publiée, un service) dans l'état d'abonnement voulu :
 * - `gratuit` : aucune ligne `abonnements` ; `actif` : échéance dans 45 jours ; `grace` : échue depuis 3 jours ;
 * - `termine` : échue depuis 8 jours (grâce de 7 jours dépassée -> retour au gratuit).
 */
export async function creerAbonne(etat: EtatDepart, options: AbonneOptions = {}): Promise<Abonne> {
  const pro = await creerPro(options)
  const maintenant = options.maintenant ?? new Date()
  const decalage: Record<Exclude<EtatDepart, 'gratuit'>, number> = { actif: jours(45), grace: -jours(3), termine: -jours(8) }
  const abonnement = etat === 'gratuit' ? undefined : await poserAbonnement(pro.user.id, plus(maintenant, decalage[etat]))
  return { ...pro, abonnement }
}

/** Instants ordonnés : le n-ième élément est créé `n` jours après `depart` (ordre « plus anciens » déterministe). */
export function dateDeCreation(index: number, depart: Date = new Date('2026-01-01T08:00:00.000Z')): Date {
  return plus(depart, jours(index))
}

/** Ajoute des services actifs (le premier du professionnel est déjà le plus ancien : il est créé à l'instant réel). */
export async function ajouterServices(vitrineId: string, nombre: number, options: { reservable?: boolean, depart?: Date } = {}) {
  const lignes = []
  for (let i = 0; i < nombre; i += 1) {
    lignes.push(await insertService(vitrineId, {
      titre: `Service ${i + 1}`,
      reservable: options.reservable ?? false,
      createdAt: dateDeCreation(i, options.depart),
      ordre: i,
    }))
  }
  return lignes
}

export async function ajouterRealisations(vitrineId: string, nombre: number, depart?: Date) {
  const lignes = []
  for (let i = 0; i < nombre; i += 1) {
    lignes.push(await insertRealisation(vitrineId, { titre: `Réalisation ${i + 1}`, createdAt: dateDeCreation(i, depart), ordre: i }))
  }
  return lignes
}

export async function ajouterTemoignages(vitrineId: string, nombre: number, depart?: Date): Promise<void> {
  for (let i = 0; i < nombre; i += 1) {
    await insertTemoignage(vitrineId, { auteur: `Auteur ${i + 1}`, createdAt: dateDeCreation(i, depart), ordre: i })
  }
}

/** Supprime les services créés par `creerPro` pour partir d'une vitrine sans contenu. */
export async function viderServices(vitrineId: string): Promise<void> {
  await db.execute(sql`DELETE FROM services WHERE vitrine_id = ${vitrineId}`)
}

export async function compter(table: 'services' | 'realisations' | 'temoignages' | 'paiements' | 'abonnements' | 'evenements_paiement', vitrineId?: string): Promise<number> {
  const filtre = vitrineId === undefined ? sql`` : sql` WHERE vitrine_id = ${vitrineId}`
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ${sql.raw(table)}${filtre}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

// ---------------------------------------------------------------------------------------------
// Paiements : état de départ inséré directement
// ---------------------------------------------------------------------------------------------

export type PaiementSeed = Partial<typeof paiements.$inferInsert>

/**
 * Paiement inséré directement, cohérent avec tous les CHECK de la migration 0021 : 1 mois, 5000 XAF, 5 % de frais
 * (250) à la charge du marchand, MTN MoMo Cameroun, clé de TEST, `en_attente` avec identifiant fournisseur,
 * numéro masqué. Le statut pilote `termine_le` et `applique_le` (CHECK `terminal` et `applique`).
 */
export async function insererPaiement(userId: string | null, seed: PaiementSeed = {}): Promise<PaiementRow> {
  const statut = seed.statut ?? 'en_attente'
  const maintenant = seed.createdAt ?? NOW
  const ouvert = statut === 'cree' || statut === 'en_attente'
  const montantPlan = seed.montantPlan ?? 5000
  const montant = seed.montant ?? montantPlan
  const fraisEstimes = seed.fraisEstimes ?? Math.ceil((montant * (seed.fraisTauxPb ?? 500)) / 10_000)
  const [ligne] = await db
    .insert(paiements)
    .values({
      id: randomUUID(),
      userId,
      fournisseur: 'kpay',
      methode: 'mobile_money',
      operateur: 'MTN_MOMO_CMR',
      environnement: 'test',
      idFournisseur: statut === 'cree' ? null : `tx_${randomUUID()}`,
      referenceFournisseur: null,
      statut,
      plan: 'payant',
      periodeMois: 1,
      devise: 'XAF',
      montantPlan,
      montant,
      fraisTauxPb: 500,
      fraisSupporteur: 'marchand',
      fraisEstimes,
      netEstime: montant - fraisEstimes,
      telephoneMasque: MASQUE_ATTENDU,
      telephoneEmpreinte: empreinteNumero(),
      initiationIncertaine: false,
      expireAvant: plus(maintenant, minutes(15)),
      prochaineVerification: ouvert ? plus(maintenant, 15 * SECONDE_MS) : null,
      verifications: 0,
      appliqueLe: statut === 'reussi' ? maintenant : null,
      termineLe: ouvert ? null : maintenant,
      createdAt: maintenant,
      updatedAt: maintenant,
      ...seed,
    })
    .returning()
  if (!ligne) throw new Error('Insertion de paiement sans résultat.')
  return ligne
}

export async function lirePaiement(id: string): Promise<PaiementRow> {
  const [ligne] = await db.select().from(paiements).where(eq(paiements.id, id))
  if (!ligne) throw new Error(`Paiement ${id} introuvable.`)
  return ligne
}

export async function lirePaiementsDe(userId: string): Promise<PaiementRow[]> {
  return db.select().from(paiements).where(eq(paiements.userId, userId)).orderBy(desc(paiements.createdAt), asc(paiements.id))
}

export async function lirePaiements(): Promise<PaiementRow[]> {
  return db.select().from(paiements).orderBy(asc(paiements.createdAt), asc(paiements.id))
}

export async function lireEvenements(): Promise<EvenementPaiementRow[]> {
  return db.select().from(evenementsPaiement).orderBy(asc(evenementsPaiement.recuLe), asc(evenementsPaiement.id))
}

/** Résumé stable d'une ligne de journal, pour les `toEqual`. */
export function resumeEvenement(e: EvenementPaiementRow) {
  return { evenement: e.evenement, source: e.source, traitement: e.traitement, motif: e.motif, paiementId: e.paiementId }
}

/**
 * Cherche le numéro de téléphone EN CLAIR dans toutes les colonnes de `paiements`, `evenements_paiement`,
 * `abonnements`, dans l'outbox et dans Redis (clés et valeurs chaîne). Renvoie les endroits où il apparaît (attendu : []).
 */
export async function ouLeNumeroApparait(...numeros: string[]): Promise<string[]> {
  const trouves: string[] = []
  const tables = ['paiements', 'evenements_paiement', 'abonnements', 'emails_transactionnels']
  for (const table of tables) {
    for (const numero of numeros) {
      const r = await db.execute<{ n: string }>(
        sql`SELECT count(*)::text AS n FROM ${sql.raw(table)} t WHERE row_to_json(t)::text LIKE ${`%${numero}%`}`,
      )
      if (Number(r.rows[0]?.n ?? 0) > 0) trouves.push(`${table}:${numero}`)
    }
  }
  for (const cle of await redis.keys('*')) {
    for (const numero of numeros) {
      if (cle.includes(numero)) trouves.push(`redis-cle:${cle}`)
    }
    const type = await redis.type(cle)
    if (type === 'string') {
      const valeur = (await redis.get(cle)) ?? ''
      for (const numero of numeros) {
        if (valeur.includes(numero)) trouves.push(`redis-valeur:${cle}`)
      }
    }
  }
  return trouves
}

// ---------------------------------------------------------------------------------------------
// Initiation d'un paiement (service réel + faux K-PAY)
// ---------------------------------------------------------------------------------------------

export type DepsInitiation = InitiationDeps

/** Appelle le vrai service avec une entrée validée par le vrai schéma Zod ; renvoie le résultat brut. */
export async function initier(
  userId: string,
  surcharges: Partial<PaiementInitierInput> = {},
  now: Date = new Date(),
  deps: DepsInitiation = {},
) {
  const { initierPaiement } = await moduleAbonnements()
  const input = schemaPaiementInitier.parse({ ...ENTREE_PAIEMENT, ...surcharges })
  return initierPaiement(userId, input, now, deps)
}

/** Fournisseur K-PAY RÉEL (adaptateur de production, construit depuis `env`) branché sur le faux serveur local. */
export async function providerKpay() {
  const { getPaiementProvider } = await moduleFournisseurs()
  const provider = getPaiementProvider('kpay')
  if (provider === null) throw new Error('K-PAY devrait être configuré dans les tests d’intégration (tests/integration/support/env-kpay.ts).')
  return provider
}

/**
 * Fournisseur K-PAY réel SANS secret de webhook : `webhookConfigure` est faux, la route répond 503 WEBHOOK_NON_CONFIGURE.
 * (L'objet `env` est un proxy en lecture seule : on injecte le fournisseur par `deps`, on ne mute jamais `env`.)
 */
export async function providerSansSecretWebhook() {
  const { creerKpayProvider } = await moduleKpay()
  return creerKpayProvider({
    baseUrl: process.env.KPAY_BASE_URL ?? '',
    cleApi: process.env.KPAY_API_KEY ?? '',
    cleSecrete: process.env.KPAY_SECRET_KEY ?? '',
    environnement: 'test',
  })
}

/** Sature le budget global d'appels K-PAY (60/min) pour les deux conventions de clé possibles (avec ou sans préfixe `limite:`). */
export async function saturerBudgetKpay(valeur = 60): Promise<void> {
  await redis.set(KPAY_APPELS_CLE, valeur, 'EX', 60)
  await redis.set(`limite:${KPAY_APPELS_CLE}`, valeur, 'EX', 60)
}

// ---------------------------------------------------------------------------------------------
// Webhooks : corps, signature, événements h3 réels
// ---------------------------------------------------------------------------------------------

export const SECRET_WEBHOOK = (): string => process.env.KPAY_WEBHOOK_SECRET ?? ''

/** Corps `payment.completed` d'un paiement existant (montant et identifiants cohérents, sauf surcharge). */
export function corpsPour(paiement: PaiementRow, surcharges: Partial<CorpsWebhookOptions> = {}): string {
  return corpsWebhook({
    paymentId: paiement.idFournisseur ?? `tx_${paiement.id}`,
    externalId: paiement.id,
    amount: paiement.montant,
    reference: paiement.referenceFournisseur ?? undefined,
    ...surcharges,
  })
}

export interface ReponseApplication {
  traitement: string
  motif: string | null
  paiementId: string | null
}

/**
 * Applique un corps de webhook comme le fait la route APRÈS la vérification de signature : interprétation par
 * l'adaptateur réel, puis `appliquerEvenement` (base réelle) avec l'horloge INJECTÉE. Sert aux scénarios datés ;
 * les contrats HTTP (signature, taille, statuts) passent par la route (`appelerRouteWebhook`).
 */
export async function appliquer(
  corps: string,
  options: { now?: Date, source?: 'webhook' | 'interrogation' } = {},
): Promise<ReponseApplication> {
  const provider = await providerKpay()
  const { appliquerEvenement } = await moduleApplication()
  const evt: EvenementNormalise | null = provider.interpreterWebhook(JSON.parse(corps))
  if (evt === null) throw new Error('Corps de webhook non interprétable par l’adaptateur.')
  return appliquerEvenement('kpay', evt, options.source ?? 'webhook', options.now ?? NOW)
}

/** Applique en parallèle N fois le même corps (connexions distinctes du pool). */
export async function appliquerEnParallele(corps: string, fois: number, now: Date = NOW): Promise<ReponseApplication[]> {
  return Promise.all(Array.from({ length: fois }, () => appliquer(corps, { now })))
}

export interface EvenementWebhookOptions {
  fournisseur?: string
  /** Un tampon, ou une liste de morceaux (corps envoyé par morceaux). */
  corps: Buffer | string | Buffer[]
  entetes?: Record<string, string>
  /** `false` : aucun en-tête Content-Length (corps envoyé par morceaux). */
  contentLength?: boolean
}

/** Événement h3 RÉEL pour la route webhook : corps brut, paramètre de route, aucune session. */
export function evenementWebhook(options: EvenementWebhookOptions): H3Event {
  const fournisseur = options.fournisseur ?? 'kpay'
  const req = new IncomingMessage(new Socket())
  req.method = 'POST'
  req.url = `/api/webhooks/${fournisseur}`
  const morceaux = Array.isArray(options.corps)
    ? options.corps
    : [typeof options.corps === 'string' ? Buffer.from(options.corps, 'utf8') : options.corps]
  const total = morceaux.reduce((somme, m) => somme + m.length, 0)
  req.headers['content-type'] = 'application/json'
  if (options.contentLength !== false) req.headers['content-length'] = String(total)
  for (const [nom, valeur] of Object.entries(options.entetes ?? {})) req.headers[nom.toLowerCase()] = valeur
  for (const morceau of morceaux) req.push(morceau)
  req.push(null)
  Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: '203.0.113.50' })
  const event = createEvent(req, new ServerResponse(req))
  event.context.params = { fournisseur }
  return event
}

/** Appelle la ROUTE webhook (handler Nitro réel). L'horloge est celle du système : les dates ne sont pas assertées ici. */
export async function appelerRouteWebhook(options: EvenementWebhookOptions & { signature?: string | null }): Promise<ReponseHandler> {
  const { default: handler } = await routeWebhook()
  const octets = Array.isArray(options.corps) ? Buffer.concat(options.corps) : (typeof options.corps === 'string' ? Buffer.from(options.corps) : options.corps)
  const signature = options.signature === undefined ? signerWebhook(octets, SECRET_WEBHOOK()) : options.signature
  const entetes = { ...(signature === null ? {} : { [KPAY_ENTETE_SIGNATURE]: signature }), ...(options.entetes ?? {}) }
  return appeler(handler, evenementWebhook({ ...options, entetes }))
}

export interface ReponseWebhook {
  status: number
  code: string | undefined
}

/**
 * Reçoit un webhook par `recevoirWebhook(fournisseur, corpsBrut, entetes, now)` (signature VÉRIFIÉE par l'adaptateur réel,
 * base réelle, horloge injectée). Succès -> 200 ; DomainError -> son statut et son code.
 */
export async function recevoir(
  corps: string | Buffer,
  options: { signature?: string | null, secret?: string, now?: Date, fournisseur?: string } = {},
): Promise<ReponseWebhook> {
  const { recevoirWebhook } = await moduleWebhooks()
  const tampon = typeof corps === 'string' ? Buffer.from(corps, 'utf8') : corps
  const signature = options.signature === undefined ? signerWebhook(tampon, options.secret ?? SECRET_WEBHOOK()) : options.signature
  const entetes = signature === null ? {} : { [KPAY_ENTETE_SIGNATURE]: signature }
  try {
    await recevoirWebhook(options.fournisseur ?? 'kpay', tampon, entetes, options.now ?? NOW)
    return { status: 200, code: undefined }
  } catch (erreur) {
    if (erreur instanceof Error && /Cannot find module|Failed to load url|Failed to resolve import|ERR_MODULE_NOT_FOUND/.test(erreur.message)) throw erreur
    const objet = erreur as { status?: number, code?: string }
    return { status: typeof objet.status === 'number' ? objet.status : -1, code: objet.code }
  }
}

/** Reçoit en parallèle N fois le même webhook (connexions distinctes du pool). */
export async function recevoirEnParallele(corps: string | Buffer, fois: number, now: Date = NOW): Promise<ReponseWebhook[]> {
  return Promise.all(Array.from({ length: fois }, () => recevoir(corps, { now })))
}
