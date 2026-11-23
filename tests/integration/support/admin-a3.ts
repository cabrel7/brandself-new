import { randomUUID } from 'node:crypto'
import type { H3Event } from 'h3'
import { sql } from 'drizzle-orm'
import { vi } from 'vitest'
import { abonnements, paiements } from '../../../shared/db/schema'
import { EXPORT_PAIEMENTS_COLONNES } from '../../../shared/admin-paiements'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import { fakeEvent } from '../../support/h3'
import type { StatutKpay } from '../../support/faux-kpay'
import { fauxKpay } from './env-kpay'
import {
  brancherGardeSurAuth,
  creerAuth,
  creerSuperadmin,
  demanderEtLireCode,
  hoteDe,
  journaliser,
  lireJournal,
  origineDe,
  ouvrirSession,
  sansDeclencheur,
  viderFileMessagesAuth,
} from './admin'
import type { LigneJournal } from './admin'
import { insererPaiement, jours, minutes, NOW, plus, poserAbonnement } from './abonnements'
import type { AbonnementRow, PaiementRow, PaiementSeed } from './abonnements'
import { createUser } from './fabriques'
import type { UserRow } from './fabriques'

// Aides des tests d'intégration d'A3 (docs/specs/A3-abonnements-paiements.md, tier critique).
// RÈGLES : base, Redis, Better Auth, journal, réauthentification et file BullMQ RÉELS ; état de départ par insertions
// directes ; seul K-PAY est factice (faux serveur HTTP local de tests/support/faux-kpay.ts, déjà branché sur `env`
// par tests/integration/support/env-kpay.ts : l'adaptateur RÉEL le consulte). Horloge : les routes lisent l'horloge
// système ; les scénarios datés passent par les services (`now` injecté) ou posent des dates relatives à l'instant réel.
//
// ============================================================================================================
// CONTRAT DE LA COUCHE SERVEUR TEL QUE CES TESTS LE SUPPOSENT (spec §4, §5, § « Routes » ; noms non fixés par la spec
// = PROPOSITIONS du tester, à confirmer par l'architect ou à renvoyer au tester si le backend en choisit d'autres).
//
//   server/services/paiements/confirmation.ts   confirmerPaiement(tx, paiementId, now, complements) -> 'applique' | 'deja_applique' | 'refuse_anomalie'
//                                               complements = { idFournisseur?, referenceFournisseur?, fraisReels?, netReel? } (tous facultatifs)
//   server/services/webhooks-refuses.ts         enregistrerRefusWebhook(fournisseur, motif, now) ; purgerWebhooksRefuses(now)
//   server/jobs/webhooks-refuses.ts             planifierPurgeWebhooksRefuses(queue: { upsertJobScheduler })   (patron de server/jobs/oauth.ts)
//   server/api/admin/ (fichiers de route, SEUL point d'entrée testé pour tout le reste, via `defineApiHandler`) :
//       abonnements/index.get.ts   abonnements/[id]/rappel.post.ts
//       paiements/index.get.ts     paiements/[id].get.ts     paiements/[id]/reverifier.post.ts     paiements/[id]/marquer-paye.post.ts
//       revenus.get.ts             alertes.get.ts            export/paiements.post.ts              vue-ensemble.get.ts
//   Corps d'entrée et de sortie : `shared/schemas/admin-paiements.ts` (figé). Erreurs : `DomainError` (code, statut) de shared/erreurs.ts.
// ============================================================================================================

export const confirmationService = () => import('../../../server/services/paiements/confirmation')
export const webhooksRefusesService = () => import('../../../server/services/webhooks-refuses')
export const jobWebhooksRefuses = () => import('../../../server/jobs/webhooks-refuses')

type Charger = () => Promise<{ default: (event: H3Event) => unknown }>

export const ROUTES = {
  abonnements: (): ReturnType<Charger> => import('../../../server/api/admin/abonnements/index.get'),
  abonnementRappel: (): ReturnType<Charger> => import('../../../server/api/admin/abonnements/[id]/rappel.post'),
  paiements: (): ReturnType<Charger> => import('../../../server/api/admin/paiements/index.get'),
  paiementDetail: (): ReturnType<Charger> => import('../../../server/api/admin/paiements/[id].get'),
  paiementReverifier: (): ReturnType<Charger> => import('../../../server/api/admin/paiements/[id]/reverifier.post'),
  paiementMarquerPaye: (): ReturnType<Charger> => import('../../../server/api/admin/paiements/[id]/marquer-paye.post'),
  revenus: (): ReturnType<Charger> => import('../../../server/api/admin/revenus.get'),
  alertes: (): ReturnType<Charger> => import('../../../server/api/admin/alertes.get'),
  exportPaiements: (): ReturnType<Charger> => import('../../../server/api/admin/export/paiements.post'),
  vueEnsemble: (): ReturnType<Charger> => import('../../../server/api/admin/vue-ensemble.get'),
} as const

export const MOTIF = 'Vérification demandée par le titulaire du compte'
export const NUMERO_PAYEUR = '237653456789'
export const HEURE_MS = 3_600_000
export { NOW, jours, minutes, plus }

// ---------------------------------------------------------------------------------------------
// Administrateur connecté (instance Better Auth RÉELLE, session ouverte par le vrai parcours e-mail)
// ---------------------------------------------------------------------------------------------

export interface AdminConnecte {
  admin: UserRow
  cookie: string
}

/** À appeler dans `beforeEach` (les tables sont vidées entre les tests) ; à défaire avec `vi.unstubAllGlobals()`. */
export async function installerAdmin(surcharges: { name?: string } = {}): Promise<AdminConnecte> {
  const auth = await creerAuth()
  brancherGardeSurAuth(auth)
  await viderFileMessagesAuth()
  // Limiteurs de l'administration (réauthentification, essais, revérification) : remis à zéro à chaque test.
  for (const motif of ['*admin-reauth:*', '*admin-reauth-essai:*', '*admin-reverif:*']) {
    const cles = await redis.keys(motif)
    if (cles.length > 0) await redis.del(...cles)
  }
  const admin = await creerSuperadmin(surcharges)
  const { cookie, status } = await ouvrirSession(auth, admin.email, 'admin')
  if (cookie === '') throw new Error(`Session d'administration non ouverte (statut ${status}).`)
  return { admin, cookie }
}

/** Seconde session d'administration (autre administrateur), pour les tests d'isolation de la clé d'idempotence. */
export async function ajouterAdmin(): Promise<AdminConnecte> {
  const auth = await creerAuth()
  const admin = await creerSuperadmin()
  const { cookie } = await ouvrirSession(auth, admin.email, 'admin')
  return { admin, cookie }
}

/** Session d'un compte ORDINAIRE (ouverte sur l'hôte public, la seule où il peut se connecter). */
export async function sessionOrdinaire(): Promise<{ user: UserRow, cookie: string }> {
  const auth = await creerAuth()
  const user = await createUser({ role: 'user', email: `ordinaire-${randomUUID()}@exemple.test` })
  const { cookie } = await ouvrirSession(auth, user.email, 'public')
  return { user, cookie }
}

export function desinstallerAdmin(): void {
  vi.unstubAllGlobals()
}

// ---------------------------------------------------------------------------------------------
// Appel d'une route d'administration (handler Nitro RÉEL, événement h3 RÉEL)
// ---------------------------------------------------------------------------------------------

export interface AppelRoute {
  cookie?: string
  /** Chemin et requête (`/api/admin/paiements?statut=reussi`). */
  chemin: string
  methode?: 'GET' | 'POST'
  params?: Record<string, string>
  corps?: unknown
  /** Code de réauthentification (en-tête `X-Admin-Reauth`). */
  reauth?: string
  entetes?: Record<string, string>
}

export interface ReponseRoute {
  status: number
  corps: unknown
  code: string | undefined
  data: Record<string, unknown> | undefined
  entetes: Record<string, string | undefined>
}

const ENTETES_LUS = ['content-type', 'content-disposition', 'cache-control', 'retry-after'] as const

export function evenementRoute(appel: AppelRoute): H3Event {
  const methode = appel.methode ?? (appel.corps === undefined ? 'GET' : 'POST')
  const entetes: Record<string, string> = { host: hoteDe('admin'), ...appel.entetes }
  if (methode !== 'GET' && entetes.origin === undefined) entetes.origin = origineDe('admin')
  if (appel.cookie) entetes.cookie = appel.cookie
  if (appel.reauth !== undefined) entetes['x-admin-reauth'] = appel.reauth
  return fakeEvent({
    method: methode,
    url: appel.chemin,
    headers: entetes,
    ...(appel.corps === undefined ? {} : { body: JSON.stringify(appel.corps) }),
    ...(appel.params === undefined ? {} : { params: appel.params }),
  })
}

export async function appelerRoute(charger: Charger, appel: AppelRoute): Promise<ReponseRoute> {
  const { default: handler } = await charger()
  const event = evenementRoute(appel)
  const entetes = (): Record<string, string | undefined> =>
    Object.fromEntries(ENTETES_LUS.map((nom) => {
      const valeur = event.node.res.getHeader(nom)
      return [nom, valeur === undefined ? undefined : String(valeur)]
    }))
  try {
    const corps = await handler(event)
    return { status: event.node.res.statusCode, corps, code: undefined, data: undefined, entetes: entetes() }
  } catch (erreur) {
    const h3 = erreur as { statusCode?: number, data?: Record<string, unknown> & { code?: string } }
    return { status: h3.statusCode ?? -1, corps: undefined, code: h3.data?.code, data: h3.data, entetes: entetes() }
  }
}

/** Appelle une route de lecture/écriture en tant que `connecte`. */
export function appelerAdmin(charger: Charger, connecte: AdminConnecte, appel: Omit<AppelRoute, 'cookie'>): Promise<ReponseRoute> {
  return appelerRoute(charger, { ...appel, cookie: connecte.cookie })
}

export const cleIdempotence = (): string => `cle-${randomUUID()}`

// ---------------------------------------------------------------------------------------------
// Faux K-PAY : une transaction par paiement (identifiant fournisseur = celui de la ligne)
// ---------------------------------------------------------------------------------------------

export interface OptionsTransactionFausse {
  montant?: number
  devise?: string
  fraisReels?: number
  netReel?: number
  raison?: string
}

/** Déclare chez le faux K-PAY la transaction d'un paiement existant, dans l'état voulu. */
export function declarerTransaction(paiement: PaiementRow, statut: StatutKpay, options: OptionsTransactionFausse = {}): void {
  if (paiement.idFournisseur === null) throw new Error('Ce paiement n’a pas d’identifiant fournisseur.')
  const montant = options.montant ?? paiement.montant
  const frais = options.fraisReels ?? Math.ceil(montant * 0.05)
  fauxKpay.transactions.set(paiement.idFournisseur, {
    id: paiement.idFournisseur,
    reference: paiement.referenceFournisseur ?? `KPAY-${paiement.idFournisseur.slice(-8).toUpperCase()}`,
    status: statut,
    amount: montant,
    currency: options.devise ?? paiement.devise,
    externalId: paiement.id,
    provider: paiement.operateur ?? 'MTN_MOMO_CMR',
    phoneNumber: NUMERO_PAYEUR,
    ...(statut === 'COMPLETED' ? { feeAmount: frais, netAmount: options.netReel ?? montant - frais } : {}),
    ...(statut === 'FAILED' ? { failureReason: options.raison ?? 'PAYER_NOT_FOUND' } : {}),
  })
}

// ---------------------------------------------------------------------------------------------
// État de départ
// ---------------------------------------------------------------------------------------------

export async function insererPaiementManuel(userId: string | null, seed: PaiementSeed = {}): Promise<PaiementRow> {
  const id = seed.id ?? randomUUID()
  const montant = seed.montant ?? 5000
  return insererPaiement(userId, {
    id,
    fournisseur: 'manuel',
    methode: 'manuel',
    operateur: null,
    source: 'manuel',
    idFournisseur: null,
    referenceFournisseur: `manuel-${id}`,
    statut: 'reussi',
    montantPlan: montant,
    montant,
    fraisTauxPb: 0,
    fraisEstimes: 0,
    netEstime: montant,
    telephoneMasque: null,
    telephoneEmpreinte: null,
    ...seed,
  })
}

/** Paiement `reussi` appliqué à une date donnée (revenus) : `applique_le` pilote le mois d'encaissement. */
export async function insererEncaissement(userId: string | null, appliqueLe: Date, seed: PaiementSeed = {}): Promise<PaiementRow> {
  return insererPaiement(userId, { statut: 'reussi', createdAt: appliqueLe, appliqueLe, termineLe: appliqueLe, ...seed })
}

export async function poserAbonnementOrigine(
  userId: string,
  expireLe: Date,
  // E1 : `essai` (essai gratuit accordé à la création de la vitrine) est la quatrième origine.
  options: { origine?: 'paiement' | 'offert' | 'admin' | 'essai', dernierPaiementId?: string | null } = {},
): Promise<AbonnementRow> {
  const ligne = await poserAbonnement(userId, expireLe, { dernierPaiementId: options.dernierPaiementId ?? null })
  if (options.origine !== undefined && options.origine !== 'paiement') {
    await db.update(abonnements).set({ origine: options.origine }).where(sql`${abonnements.id} = ${ligne.id}`)
  }
  return { ...ligne, origine: options.origine ?? 'paiement' }
}

/** Une série de paiements ouverts ou terminés en une requête (volumes). */
export async function insererEnMasse(nombre: number, statut: 'echoue' | 'expire' = 'echoue'): Promise<void> {
  await db.execute(sql`
    INSERT INTO paiements (id, user_id, fournisseur, methode, operateur, environnement, id_fournisseur, statut, plan, periode_mois,
      devise, montant_plan, montant, frais_taux_pb, frais_supporteur, frais_estimes, net_estime, expire_avant, termine_le, created_at, updated_at)
    SELECT gen_random_uuid()::text, NULL, 'kpay', 'mobile_money', 'MTN_MOMO_CMR', 'test', 'tx_masse_' || gen_random_uuid()::text, ${statut}, 'payant', 1,
      'XAF', 5000, 5000, 500, 'marchand', 250, 4750, now(), now(), now() - (g || ' seconds')::interval, now()
    FROM generate_series(1, ${nombre}) AS g`)
}

// ---------------------------------------------------------------------------------------------
// Journal d'administration
// ---------------------------------------------------------------------------------------------

export async function journalDe(action: string): Promise<LigneJournal[]> {
  return (await lireJournal()).filter((ligne) => ligne.action === action)
}

/** Antidate une ligne du journal (le journal est immuable : on lève le déclencheur le temps de la mise à jour). */
export async function vieillirLigneJournal(id: string, enMinutes: number): Promise<void> {
  await sansDeclencheur('journal_admin_sans_modif', async () => {
    await db.execute(sql`UPDATE journal_admin SET cree_le = cree_le - make_interval(mins => ${enMinutes}) WHERE id = ${id}`)
  })
}

/** Ligne de journal écrite par le VRAI service d'audit (chaîne de hachage comprise), pour l'état de départ des revenus. */
export async function insererLigneJournal(
  adminId: string,
  champs: { action: string, cibleType: string, cibleId?: string | null, avant?: Record<string, unknown> | null, apres?: Record<string, unknown> | null },
): Promise<string> {
  const { id } = await journaliser(adminId, {
    action: champs.action,
    cibleType: champs.cibleType,
    cibleId: champs.cibleId ?? 'cible-1',
    avant: champs.avant ?? null,
    apres: champs.apres ?? null,
  })
  return id
}

/** Demande un code de réauthentification lié à `marquer-paye` pour ce paiement et le lit dans le job mis en file. */
export async function codeMarquage(adminId: string, paiementId: string): Promise<string> {
  const { code } = await demanderEtLireCode(adminId, { action: 'paiement.marquer_paye', cibleType: 'paiement', cibleId: paiementId })
  return code
}

// ---------------------------------------------------------------------------------------------
// Lecture de la base
// ---------------------------------------------------------------------------------------------

export async function paiementsDe(userId: string): Promise<PaiementRow[]> {
  const resultat = await db.select().from(paiements).where(sql`${paiements.userId} = ${userId}`).orderBy(paiements.createdAt, paiements.id)
  return resultat
}

export async function compterOutbox(type: string, entiteId?: string): Promise<number> {
  const filtre = entiteId === undefined ? sql`` : sql` AND entite_id = ${entiteId}`
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM emails_transactionnels WHERE type = ${type}${filtre}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export async function compterEvenements(motif?: string): Promise<number> {
  const filtre = motif === undefined ? sql`` : sql` WHERE motif = ${motif}`
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM evenements_paiement${filtre}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export interface LigneRefus {
  heure: Date
  fournisseur: string
  motif: string
  nombre: number
}

export async function lireRefus(): Promise<LigneRefus[]> {
  const resultat = await db.execute<{ heure: Date | string, fournisseur: string, motif: string, nombre: number }>(
    sql`SELECT heure, fournisseur, motif, nombre FROM webhooks_refuses ORDER BY heure, fournisseur, motif`,
  )
  return resultat.rows.map((r) => ({ ...r, heure: r.heure instanceof Date ? r.heure : new Date(r.heure) }))
}

export const debutHeure = (date: Date): Date => new Date(Math.floor(date.getTime() / HEURE_MS) * HEURE_MS)

// ---------------------------------------------------------------------------------------------
// Fuseau d'affichage des revenus : Africa/Douala = UTC+1 sans heure d'été
// ---------------------------------------------------------------------------------------------

const DECALAGE_DOUALA_MS = HEURE_MS

/** Premier instant (UTC) du mois local de `date` décalé de `decalage` mois, en Africa/Douala. */
export function debutMoisDouala(date: Date, decalage = 0): Date {
  const local = new Date(date.getTime() + DECALAGE_DOUALA_MS)
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + decalage, 1) - DECALAGE_DOUALA_MS)
}

// ---------------------------------------------------------------------------------------------
// CSV (RFC 4180) : le séparateur est lu sur l'en-tête (`,` ou `;`), tout le reste est strict
// ---------------------------------------------------------------------------------------------

export function lireCsv(texte: string): string[][] {
  const contenu = texte.startsWith('﻿') ? texte.slice(1) : texte
  const premiereLigne = contenu.split(/\r?\n/, 1)[0] ?? ''
  const separateur = premiereLigne.includes(',') || !premiereLigne.includes(';') ? ',' : ';'
  const lignes: string[][] = []
  let ligne: string[] = []
  let cellule = ''
  let entreGuillemets = false
  for (let i = 0; i < contenu.length; i += 1) {
    const c = contenu[i]
    if (entreGuillemets) {
      if (c === '"' && contenu[i + 1] === '"') { cellule += '"'; i += 1 }
      else if (c === '"') entreGuillemets = false
      else cellule += c
    } else if (c === '"') entreGuillemets = true
    else if (c === separateur) { ligne.push(cellule); cellule = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && contenu[i + 1] === '\n') i += 1
      ligne.push(cellule)
      lignes.push(ligne)
      ligne = []
      cellule = ''
    } else cellule += c
  }
  if (cellule !== '' || ligne.length > 0) { ligne.push(cellule); lignes.push(ligne) }
  return lignes
}

/** Lignes du CSV d'export sous forme d'objets (clé = colonne). Échoue si l'en-tête n'est pas exactement la liste blanche. */
export function lignesExport(texte: string): Array<Record<(typeof EXPORT_PAIEMENTS_COLONNES)[number], string>> {
  const [entete, ...donnees] = lireCsv(texte)
  if (JSON.stringify(entete) !== JSON.stringify([...EXPORT_PAIEMENTS_COLONNES])) {
    throw new Error(`En-tête de l'export inattendu : ${JSON.stringify(entete)}`)
  }
  return donnees
    .filter((cellules) => !(cellules.length === 1 && cellules[0] === ''))
    .map((cellules) => Object.fromEntries(EXPORT_PAIEMENTS_COLONNES.map((colonne, i) => [colonne, cellules[i] ?? ''])) as Record<(typeof EXPORT_PAIEMENTS_COLONNES)[number], string>)
}
