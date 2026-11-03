import { createHash, randomUUID } from 'node:crypto'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import type { H3Event } from 'h3'
import { and, asc, eq, sql } from 'drizzle-orm'
import {
  demandes,
  emailsTransactionnels,
  messages,
  reservations,
  users,
  vitrines,
} from '../../../shared/db/schema'
import type { EmailCategorie, EmailStatut } from '../../../shared/notifications'
import type { TransactionalEmailType } from '../../../shared/jobs'
import { db } from '../../../server/utils/db'
import type { EmailMessage, EmailTransport } from '../../../server/services/emails/transport'
import { createUser, insertService, insertVitrineRow } from './fabriques'
import type { ServiceRow, UserRow, VitrineRow } from './fabriques'

// Aides des tests d'intégration S9 : insertions directes (jamais de mock de la couche prouvée) et transport
// d'enregistrement (Resend est la SEULE chose factice : hors du périmètre prouvé, spec §9).

export const HEURE_MS = 3_600_000
export const JOUR_MS = 24 * HEURE_MS
const DUREE_RDV_MS = 30 * 60_000

export function heures(n: number): number {
  return n * HEURE_MS
}

/** Date à partir d'une chaîne ISO UTC. */
export function utc(valeur: string): Date {
  return new Date(valeur)
}

/** Transport d'enregistrement : mémorise chaque envoi, peut échouer N fois, peut ralentir pour forcer le chevauchement. */
export class RecordingTransport implements EmailTransport {
  readonly sends: Array<{ message: EmailMessage, idempotencyKey: string }> = []

  private echecsRestants: number

  constructor(private readonly options: { echecs?: number, delaiMs?: number } = {}) {
    // Initialisé dans le constructeur : un initialiseur de champ s'exécute AVANT l'affectation de la propriété
    // de paramètre (`this.options` serait encore indéfini sous useDefineForClassFields).
    this.echecsRestants = options.echecs ?? 0
  }

  async send(message: EmailMessage, idempotencyKey: string): Promise<void> {
    this.sends.push({ message, idempotencyKey })
    if (this.options.delaiMs) await new Promise((resolve) => setTimeout(resolve, this.options.delaiMs))
    if (this.echecsRestants > 0) {
      this.echecsRestants -= 1
      throw new Error('Erreur fournisseur simulée')
    }
  }

  get dernier(): EmailMessage {
    const envoi = this.sends.at(-1)
    if (!envoi) throw new Error('Aucun e-mail envoyé.')
    return envoi.message
  }
}

export async function viderOutbox(): Promise<void> {
  await db.delete(emailsTransactionnels)
}

export type OutboxRow = typeof emailsTransactionnels.$inferSelect

export async function lireOutbox(filtre: { entiteId?: string, type?: TransactionalEmailType } = {}): Promise<OutboxRow[]> {
  const conditions = [
    ...(filtre.entiteId === undefined ? [] : [eq(emailsTransactionnels.entiteId, filtre.entiteId)]),
    ...(filtre.type === undefined ? [] : [eq(emailsTransactionnels.type, filtre.type)]),
  ]
  return db
    .select()
    .from(emailsTransactionnels)
    .where(conditions.length === 0 ? undefined : and(...conditions))
    .orderBy(asc(emailsTransactionnels.createdAt), asc(emailsTransactionnels.type), asc(emailsTransactionnels.id))
}

export async function lireOutboxParId(id: string): Promise<OutboxRow> {
  const [ligne] = await db.select().from(emailsTransactionnels).where(eq(emailsTransactionnels.id, id))
  if (!ligne) throw new Error(`Ligne d'outbox ${id} introuvable.`)
  return ligne
}

export interface OutboxSeed {
  id?: string
  type: TransactionalEmailType
  entiteType: 'reservation' | 'demande' | 'message' | 'utilisateur'
  entiteId: string
  occurrence?: string
  categorie?: EmailCategorie
  statut?: EmailStatut
  tentatives?: number
  prochaineTentative?: Date | null
  erreurCode?: string | null
  envoyeLe?: Date | null
  createdAt?: Date
  updatedAt?: Date
}

/** Ligne d'outbox insérée directement (état de départ). Les surcharges peuvent violer une contrainte. */
export async function insererOutbox(seed: OutboxSeed): Promise<OutboxRow> {
  const statut = seed.statut ?? 'en_attente'
  const [ligne] = await db
    .insert(emailsTransactionnels)
    .values({
      id: seed.id ?? randomUUID(),
      type: seed.type,
      entiteType: seed.entiteType,
      entiteId: seed.entiteId,
      occurrence: seed.occurrence ?? '',
      categorie: seed.categorie ?? (seed.type === 'utilisateur_resume_hebdo' ? 'relationnel' : 'transactionnel'),
      statut,
      tentatives: seed.tentatives ?? 0,
      prochaineTentative: seed.prochaineTentative === undefined ? (seed.createdAt ?? new Date()) : seed.prochaineTentative,
      erreurCode: seed.erreurCode ?? null,
      envoyeLe: seed.envoyeLe === undefined ? (statut === 'envoye' ? new Date() : null) : seed.envoyeLe,
      ...(seed.createdAt ? { createdAt: seed.createdAt } : {}),
      ...(seed.updatedAt ? { updatedAt: seed.updatedAt } : {}),
    })
    .returning()
  if (!ligne) throw new Error("Insertion d'outbox sans résultat.")
  return ligne
}

export interface ProOptions {
  username?: string
  fuseau?: string
  emailHebdo?: boolean
  emailRappelJour?: boolean
  publiee?: boolean
  email?: string
  /** Compte créé par téléphone : e-mail technique, aucun e-mail réel. */
  emailTemporaire?: boolean
  emailContact?: string | null
  prenom?: string
  nom?: string
  titre?: string | null
  metier?: string
}

export interface Pro {
  user: UserRow
  vitrine: VitrineRow
  service: ServiceRow
}

const DOMAINE_TEMPORAIRE = 'telephone.brandself.local'

/** Professionnel complet : compte, vitrine (publiée par défaut), un service actif réservable. */
export async function creerPro(options: ProOptions = {}): Promise<Pro> {
  const id = randomUUID()
  const fuseau = options.fuseau ?? 'Africa/Douala'
  const email = options.emailTemporaire
    ? `+237600${id.slice(0, 6).replaceAll(/\D/g, '0')}@${DOMAINE_TEMPORAIRE}`
    : (options.email ?? `pro-${id}@exemple.test`)
  const user = await createUser({
    id,
    email,
    fuseau,
    name: 'Pro de test',
    email_hebdo: options.emailHebdo ?? true,
    email_rappel_jour: options.emailRappelJour ?? true,
  })
  const vitrine = await insertVitrineRow(user.id, {
    username: options.username ?? `pro-${id.slice(0, 8)}`,
    publiee: options.publiee ?? true,
    prenom: options.prenom ?? 'Cabrel',
    nom: options.nom ?? 'Nguesso',
    titre: options.titre === undefined ? 'dr' : options.titre,
    metier: options.metier ?? 'Cardiologue',
  })
  await db.update(vitrines).set({ fuseau, emailContact: options.emailContact ?? null }).where(eq(vitrines.id, vitrine.id))
  const service = await insertService(vitrine.id, { titre: 'Consultation de cardiologie', dureeMin: 45 })
  return { user, vitrine: { ...vitrine, fuseau, emailContact: options.emailContact ?? null }, service }
}

export interface ReservationSeed {
  id?: string
  debut: Date
  fin?: Date
  statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee' | 'refusee'
  rappelEmail?: boolean
  createdAt?: Date
  nom?: string
  email?: string
  telephone?: string
  note?: string | null
}

export const VISITEUR_DEFAUT = {
  nom: 'Marie Ndzi',
  email: 'marie.ndzi@exemple.test',
  telephone: '+237699000011',
  note: 'MOTIF MEDICAL STRICTEMENT PRIVE',
} as const

/** Réservation insérée directement (dates, statut et drapeau de rappel maîtrisés). */
export async function insererReservation(vitrineId: string, serviceId: string, seed: ReservationSeed) {
  const id = seed.id ?? randomUUID()
  const [ligne] = await db
    .insert(reservations)
    .values({
      id,
      vitrineId,
      serviceId,
      nom: seed.nom ?? VISITEUR_DEFAUT.nom,
      email: seed.email ?? VISITEUR_DEFAUT.email,
      telephone: seed.telephone ?? VISITEUR_DEFAUT.telephone,
      note: seed.note === undefined ? VISITEUR_DEFAUT.note : seed.note,
      debut: seed.debut,
      fin: seed.fin ?? new Date(seed.debut.getTime() + DUREE_RDV_MS),
      statut: seed.statut ?? 'en_attente',
      rappelEmail: seed.rappelEmail ?? false,
      confirmationTokenHash: createHash('sha256').update(`confirmation-${id}`).digest('hex'),
      confirmationExpireLe: new Date(Date.UTC(2099, 0, 1)),
      ...(seed.createdAt ? { createdAt: seed.createdAt, updatedAt: seed.createdAt } : {}),
    })
    .returning()
  if (!ligne) throw new Error('Insertion de réservation sans résultat.')
  return ligne
}

export async function insererMessage(vitrineId: string, createdAt: Date): Promise<string> {
  const id = randomUUID()
  await db.insert(messages).values({
    id,
    vitrineId,
    nom: 'Paul Ewane',
    email: 'paul.ewane@exemple.test',
    sujet: 'autre',
    message: 'Bonjour.',
    createdAt,
    updatedAt: createdAt,
  })
  return id
}

export async function insererDemande(vitrineId: string, serviceId: string, createdAt: Date): Promise<string> {
  const id = randomUUID()
  await db.insert(demandes).values({
    id,
    vitrineId,
    serviceId,
    nom: 'Paul Ewane',
    email: 'paul.ewane@exemple.test',
    telephone: '+237699000012',
    createdAt,
    updatedAt: createdAt,
  })
  return id
}

export async function lireUtilisateur(id: string): Promise<UserRow | undefined> {
  const [ligne] = await db.select().from(users).where(eq(users.id, id))
  return ligne
}

export async function changerFuseau(userId: string, fuseau: string): Promise<void> {
  await db.update(users).set({ fuseau }).where(eq(users.id, userId))
  await db.update(vitrines).set({ fuseau }).where(eq(vitrines.userId, userId))
}

export async function compterLignes(type: TransactionalEmailType): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM emails_transactionnels WHERE type = ${type}`)
  return Number(resultat.rows[0]?.n ?? 0)
}

// ---------------------------------------------------------------------------------------------
// Événements h3 réels (aucun mock de h3) pour les routes publiques de désabonnement.
// ---------------------------------------------------------------------------------------------

export interface EvenementOptions {
  methode?: string
  chemin: string
  corps?: string
  typeContenu?: string
  entetes?: Record<string, string>
  ip?: string
}

/** Événement h3 avec corps brut quelconque (form-urlencoded notamment) ; l'IP passe par le proxy de confiance. */
export function evenement(options: EvenementOptions): H3Event {
  const req = new IncomingMessage(new Socket())
  req.method = options.methode ?? 'GET'
  req.url = options.chemin
  for (const [nom, valeur] of Object.entries(options.entetes ?? {})) req.headers[nom.toLowerCase()] = valeur
  if (options.ip) req.headers['x-forwarded-for'] = options.ip
  if (options.corps !== undefined) {
    req.headers['content-type'] = options.typeContenu ?? 'application/json'
    req.headers['content-length'] = String(Buffer.byteLength(options.corps))
    req.push(options.corps)
    req.push(null)
  }
  Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: '127.0.0.1' })
  const res = new ServerResponse(req)
  return createEvent(req, res)
}

export interface ReponseHandler {
  status: number
  corps: unknown
  code: string | undefined
  entetes: Record<string, string | undefined>
}

const ENTETES_LUS = ['cache-control', 'referrer-policy', 'x-robots-tag', 'retry-after'] as const

/** Exécute un handler et décrit sa réponse : corps de succès ou erreur H3 (statut + code métier). */
export async function appeler(handler: (event: H3Event) => unknown, event: H3Event): Promise<ReponseHandler> {
  const entetes = (): Record<string, string | undefined> =>
    Object.fromEntries(ENTETES_LUS.map((nom) => {
      const valeur = event.node.res.getHeader(nom)
      return [nom, valeur === undefined ? undefined : String(valeur)]
    }))
  try {
    const corps = await handler(event)
    return { status: event.node.res.statusCode, corps, code: undefined, entetes: entetes() }
  } catch (erreur) {
    const h3 = erreur as { statusCode?: number, data?: { code?: string } }
    return { status: h3.statusCode ?? -1, corps: undefined, code: h3.data?.code, entetes: entetes() }
  }
}
