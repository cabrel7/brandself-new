import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import {
  abonnements,
  emailsTransactionnels,
  journalAssistant,
  oauthAccessTokens,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  users,
  vitrines,
} from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import { makePng } from '../../support/images'
import { DEBUT_CRENEAU, REFERENCE_AGENDA, creerContexteAgenda, insererDisponibilite, iso } from './agenda'
import { appelerRouteAdmin, demanderEtLireCode, MOTIF_TEST } from './admin'
import type { AppelRouteAdmin, ReponseRouteAdmin } from './admin'
import { poserAbonnement } from './abonnements'
import { insertLien, insertMediaRow, insertRealisation, insertService, insertTemoignage } from './fabriques'
import type { UserRow, VitrineRow } from './fabriques'
import type { ContexteAgenda } from './agenda'

// Aides des tests d'intégration d'A2 (docs/specs/A2-utilisateurs-vitrines.md). Mêmes règles qu'A1 : état de départ par
// insertions DIRECTES, comportement prouvé par les routes et services RÉELS sur PostgreSQL, Redis et Better Auth
// réels ; jamais de mock du journal, des droits ni de la base. Imports paresseux (phase RED lisible).

// ---------------------------------------------------------------------------------------------
// Routes d'administration d'A2. CONVENTION DE NOMMAGE DES FICHIERS (à respecter par le backend, un seul endroit à
// corriger ici sinon) : `[id].get.ts` pour une fiche, `index.get.ts` pour une liste, `[id]/<verbe>.post.ts` pour une action.
// ---------------------------------------------------------------------------------------------

export const CHARGEURS_A2 = {
  recherche: () => import('../../../server/api/admin/recherche.get'),
  utilisateursListe: () => import('../../../server/api/admin/utilisateurs/index.get'),
  utilisateurFiche: () => import('../../../server/api/admin/utilisateurs/[id].get'),
  suspendre: () => import('../../../server/api/admin/utilisateurs/[id]/suspendre.post'),
  reactiver: () => import('../../../server/api/admin/utilisateurs/[id]/reactiver.post'),
  offrirJours: () => import('../../../server/api/admin/utilisateurs/[id]/offrir-jours.post'),
  changerPlan: () => import('../../../server/api/admin/utilisateurs/[id]/changer-plan.post'),
  revoquerSessions: () => import('../../../server/api/admin/utilisateurs/[id]/revoquer-sessions.post'),
  retirerAssistants: () => import('../../../server/api/admin/utilisateurs/[id]/retirer-assistants.post'),
  supprimer: () => import('../../../server/api/admin/utilisateurs/[id]/supprimer.post'),
  vitrinesListe: () => import('../../../server/api/admin/vitrines/index.get'),
  vitrineFiche: () => import('../../../server/api/admin/vitrines/[id].get'),
  depublier: () => import('../../../server/api/admin/vitrines/[id]/depublier.post'),
  republier: () => import('../../../server/api/admin/vitrines/[id]/republier.post'),
  assistantsListe: () => import('../../../server/api/admin/assistants/index.get'),
  assistantRetirer: () => import('../../../server/api/admin/assistants/[id]/retirer.post'),
} as const

export type RouteA2 = keyof typeof CHARGEURS_A2

export interface DescriptionRoute {
  methode: 'GET' | 'POST'
  modele: string
  /** Action journalisée et type de cible de la réauthentification, `null` si la route n'exige que le motif. */
  reauth: { action: string, cibleType: string } | null
  /** Écriture : motif obligatoire. */
  ecriture: boolean
}

const A = '/api/admin'
export const DESCRIPTIONS_A2: Readonly<Record<RouteA2, DescriptionRoute>> = {
  recherche: { methode: 'GET', modele: `${A}/recherche`, reauth: null, ecriture: false },
  utilisateursListe: { methode: 'GET', modele: `${A}/utilisateurs`, reauth: null, ecriture: false },
  utilisateurFiche: { methode: 'GET', modele: `${A}/utilisateurs/:id`, reauth: null, ecriture: false },
  suspendre: { methode: 'POST', modele: `${A}/utilisateurs/:id/suspendre`, reauth: { action: ADMIN_ACTIONS.utilisateurSuspendre, cibleType: ADMIN_CIBLES.utilisateur }, ecriture: true },
  reactiver: { methode: 'POST', modele: `${A}/utilisateurs/:id/reactiver`, reauth: null, ecriture: true },
  offrirJours: { methode: 'POST', modele: `${A}/utilisateurs/:id/offrir-jours`, reauth: null, ecriture: true },
  changerPlan: { methode: 'POST', modele: `${A}/utilisateurs/:id/changer-plan`, reauth: { action: ADMIN_ACTIONS.utilisateurChangerPlan, cibleType: ADMIN_CIBLES.utilisateur }, ecriture: true },
  revoquerSessions: { methode: 'POST', modele: `${A}/utilisateurs/:id/revoquer-sessions`, reauth: null, ecriture: true },
  retirerAssistants: { methode: 'POST', modele: `${A}/utilisateurs/:id/retirer-assistants`, reauth: null, ecriture: true },
  supprimer: { methode: 'POST', modele: `${A}/utilisateurs/:id/supprimer`, reauth: { action: ADMIN_ACTIONS.utilisateurSupprimer, cibleType: ADMIN_CIBLES.utilisateur }, ecriture: true },
  vitrinesListe: { methode: 'GET', modele: `${A}/vitrines`, reauth: null, ecriture: false },
  vitrineFiche: { methode: 'GET', modele: `${A}/vitrines/:id`, reauth: null, ecriture: false },
  depublier: { methode: 'POST', modele: `${A}/vitrines/:id/depublier`, reauth: { action: ADMIN_ACTIONS.vitrineDepublier, cibleType: ADMIN_CIBLES.vitrine }, ecriture: true },
  republier: { methode: 'POST', modele: `${A}/vitrines/:id/republier`, reauth: null, ecriture: true },
  assistantsListe: { methode: 'GET', modele: `${A}/assistants`, reauth: null, ecriture: false },
  assistantRetirer: { methode: 'POST', modele: `${A}/assistants/:id/retirer`, reauth: null, ecriture: true },
}

export interface OptionsA2 {
  id?: string
  query?: Record<string, string>
  corps?: unknown
  cookie?: string
  reauth?: string
  cleIdempotence?: string
  hote?: AppelRouteAdmin['hote']
  origine?: string | null
  entetes?: Record<string, string>
}

/** Appelle une route d'A2 (handler réel). `id` remplace le segment `:id`. */
export function appelerA2(route: RouteA2, options: OptionsA2 = {}): Promise<ReponseRouteAdmin> {
  const description = DESCRIPTIONS_A2[route]
  return appelerRouteAdmin(CHARGEURS_A2[route], {
    methode: description.methode,
    chemin: options.id === undefined ? description.modele : description.modele.replace(':id', options.id),
    ...(options.id === undefined ? {} : { params: { id: options.id } }),
    ...(options.query === undefined ? {} : { query: options.query }),
    ...(options.corps === undefined ? {} : { corps: options.corps }),
    ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    ...(options.reauth === undefined ? {} : { reauth: options.reauth }),
    ...(options.cleIdempotence === undefined ? {} : { cleIdempotence: options.cleIdempotence }),
    ...(options.hote === undefined ? {} : { hote: options.hote }),
    ...(options.origine === undefined ? {} : { origine: options.origine }),
    ...(options.entetes === undefined ? {} : { entetes: options.entetes }),
  })
}

/**
 * Code de réauthentification valide pour (action de la route, cible). On présume que le triplet lié est exactement
 * (action journalisée, type de cible du journal, identifiant de la cible) : à confirmer par le backend.
 */
export async function codeReauthPour(adminId: string, route: RouteA2, cibleId: string): Promise<string> {
  const exigence = DESCRIPTIONS_A2[route].reauth
  if (exigence === null) throw new Error(`La route ${route} n'exige pas de réauthentification.`)
  return (await demanderEtLireCode(adminId, { action: exigence.action, cibleType: exigence.cibleType, cibleId })).code
}

export const CLE_A = 'cle-idempotence-0001'
export const CLE_B = 'cle-idempotence-0002'
export const MOTIF_A2 = MOTIF_TEST
export const MOTIF_SUSPENSION = 'Usurpation d’identité signalée'
export const MOTIF_DEPUBLICATION = 'Contenu contraire aux conditions'

// ---------------------------------------------------------------------------------------------
// Fixtures : un professionnel complet et ses visiteurs.
// ---------------------------------------------------------------------------------------------

/** Donnée de visiteur « canari » : si une de ces chaînes apparaît dans une réponse d'administration, c'est une fuite. */
export const CANARIS_VISITEUR = {
  nom: 'Canari-Visiteur-Zorglub',
  email: 'canari.visiteur.zorglub@exemple.test',
  telephone: '+237699424242',
  motif: 'canari-motif-de-reservation-xyzzy',
  message: 'canari-message-de-contact-plugh',
  sujet: 'autre',
} as const

export const VISITEUR_RESERVATION = {
  nom: CANARIS_VISITEUR.nom,
  email: CANARIS_VISITEUR.email,
  telephone: CANARIS_VISITEUR.telephone,
  note: CANARIS_VISITEUR.motif,
  paiementChoisi: 'sur_place' as const,
  rappelEmail: true,
}

const DEMI_HEURE_MS = 1_800_000
/** Créneau n° `rang` du lundi 2026-11-02 (9 h locale à Douala + `rang` × 30 min). */
export const creneau = (rang: number): string => iso(new Date(DEBUT_CRENEAU.getTime() + rang * DEMI_HEURE_MS))
/** Horloge de référence de l'agenda (lundi 2026-11-02, 7 h à Douala). */
export const MAINTENANT_A2 = REFERENCE_AGENDA

export interface MondeA2 {
  user: UserRow
  vitrine: { id: string, username: string }
  vitrineRow: VitrineRow
  /** Service réservable de type `rdv` (créneaux, réservation). */
  service: ContexteAgenda['service']
  /** Service de type `devis` (demande). */
  serviceDevis: ContexteAgenda['service']
  realisationSlug: string
  lienSlug: string
  mediaId: string
  /** Jeton de confirmation d'une réservation faite AVANT toute suspension (créneau n° 6). */
  confirmationToken: string
  reservationId: string
}

export interface OptionsMonde {
  username?: string
  /** Pose un abonnement payant qui expire dans `payantJours` jours (défaut : compte gratuit, aucune ligne). */
  payantJours?: number
}

export async function creerMondeA2(options: OptionsMonde = {}): Promise<MondeA2> {
  const contexte = await creerContexteAgenda({ ...(options.username === undefined ? {} : { username: options.username }) })
  await insererDisponibilite(contexte.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '14:00' })
  const serviceDevis = await insertService(contexte.vitrine.id, {
    slug: `devis-${randomUUID().slice(0, 8)}`,
    type: 'devis',
    dureeMin: null,
    tarif: 'devis',
    reservable: true,
    actif: true,
  })
  const realisation = await insertRealisation(contexte.vitrine.id, { titre: 'Une réalisation publique' })
  await insertTemoignage(contexte.vitrine.id, { auteur: 'Un client', texte: 'Un témoignage public.' })
  const lien = await insertLien(contexte.vitrine.id, { libelle: 'Mon site' })
  const media = await uploadPhoto(contexte.user.id, contexte.vitrine.id)
  if (options.payantJours !== undefined) {
    await poserAbonnement(contexte.user.id, new Date(Date.now() + options.payantJours * 86_400_000))
  }
  const { createReservation } = await import('../../../server/services/reservations')
  const creee = await createReservation(contexte.vitrine.username, { serviceSlug: contexte.service.slug, debut: creneau(6), ...VISITEUR_RESERVATION }, MAINTENANT_A2)
  const [vitrineRow] = await db.select().from(vitrines).where(eq(vitrines.id, contexte.vitrine.id))
  if (!vitrineRow) throw new Error('Vitrine du monde de test introuvable.')
  return {
    user: contexte.user,
    vitrine: contexte.vitrine,
    vitrineRow,
    service: contexte.service,
    serviceDevis,
    realisationSlug: realisation.slug,
    lienSlug: lien.slug,
    mediaId: media,
    confirmationToken: creee.confirmation.token,
    reservationId: creee.reservation.id,
  }
}

async function uploadPhoto(userId: string, vitrineId: string): Promise<string> {
  const { uploadMedia } = await import('../../../server/services/medias')
  const media = await uploadMedia(userId, await makePng(2000, 1500))
  await db.update(vitrines).set({ photoMediaId: media.id }).where(eq(vitrines.id, vitrineId))
  return media.id
}

/** Compte ordinaire avec vitrine publiée, sans le reste (listes, recherche, fiches). */
export async function creerCompteSimple(surcharges: Partial<typeof users.$inferInsert> = {}, vitrine: { username?: string, publiee?: boolean, nom?: string, metier?: string } | null = {}): Promise<{ user: UserRow, vitrine: VitrineRow | null }> {
  const { createUser, insertVitrineRow } = await import('./fabriques')
  const user = await createUser(surcharges)
  if (vitrine === null) return { user, vitrine: null }
  const ligne = await insertVitrineRow(user.id, {
    ...(vitrine.username === undefined ? {} : { username: vitrine.username }),
    publiee: vitrine.publiee ?? true,
    ...(vitrine.nom === undefined ? {} : { nom: vitrine.nom }),
    ...(vitrine.metier === undefined ? {} : { metier: vitrine.metier }),
  })
  return { user, vitrine: ligne }
}

// ---------------------------------------------------------------------------------------------
// États posés DIRECTEMENT en base (prouvent le prédicat de visibilité sans passer par les actions d'administration).
// ---------------------------------------------------------------------------------------------

export async function suspendreEnBase(userId: string, motif: string = MOTIF_SUSPENSION): Promise<void> {
  await db.update(users).set({ banned: true, banReason: motif, banExpires: null }).where(eq(users.id, userId))
}
export async function reactiverEnBase(userId: string): Promise<void> {
  await db.update(users).set({ banned: false, banReason: null, banExpires: null }).where(eq(users.id, userId))
}
export async function bloquerEnBase(vitrineId: string, motif: string = MOTIF_DEPUBLICATION): Promise<void> {
  await db.update(vitrines).set({ blocageAdmin: true, blocageMotif: motif }).where(eq(vitrines.id, vitrineId))
}
export async function debloquerEnBase(vitrineId: string): Promise<void> {
  await db.update(vitrines).set({ blocageAdmin: false, blocageMotif: null }).where(eq(vitrines.id, vitrineId))
}
export async function depublierParLePro(vitrineId: string): Promise<void> {
  await db.update(vitrines).set({ publieeLe: null }).where(eq(vitrines.id, vitrineId))
}

// ---------------------------------------------------------------------------------------------
// Lectures.
// ---------------------------------------------------------------------------------------------

export async function lireUtilisateur(userId: string): Promise<UserRow | undefined> {
  const [ligne] = await db.select().from(users).where(eq(users.id, userId))
  return ligne
}

export async function lireVitrineDe(userId: string): Promise<VitrineRow | undefined> {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.userId, userId))
  return ligne
}

export async function lireAbonnementDe(userId: string): Promise<typeof abonnements.$inferSelect | undefined> {
  const [ligne] = await db.select().from(abonnements).where(eq(abonnements.userId, userId))
  return ligne
}

export async function lireOutboxUtilisateur(userId: string, type?: string): Promise<Array<typeof emailsTransactionnels.$inferSelect>> {
  const lignes = await db.select().from(emailsTransactionnels).where(eq(emailsTransactionnels.entiteId, userId))
  return type === undefined ? lignes : lignes.filter((ligne) => ligne.type === type)
}

/**
 * E-mails d'ADMINISTRATION en file (les 4 types d'A2). On ne compte PAS toute l'outbox : un monde de test contient une
 * réservation, dont les e-mails (nouvelle réservation, etc.) sont sans rapport avec l'action d'administration prouvée.
 */
export async function compterEmailsOutbox(): Promise<number> {
  const resultat = await db.execute<{ n: string }>(sql`
    SELECT count(*)::text AS n FROM emails_transactionnels
    WHERE type IN ('utilisateur_suspendu', 'utilisateur_reactive', 'utilisateur_jours_offerts', 'utilisateur_depubliee')`)
  return Number(resultat.rows[0]?.n ?? 0)
}

export interface Ecritures {
  reservations: number
  demandes: number
  messages: number
  vues: number
  clics: number
}

/** Toutes les lignes qu'un visiteur peut écrire sur une vitrine (comptées en base). */
export async function compterEcritures(vitrineId: string): Promise<Ecritures> {
  const resultat = await db.execute<Record<keyof Ecritures, string>>(sql`
    SELECT
      (SELECT count(*) FROM reservations WHERE vitrine_id = ${vitrineId})::text AS reservations,
      (SELECT count(*) FROM demandes WHERE vitrine_id = ${vitrineId})::text AS demandes,
      (SELECT count(*) FROM messages WHERE vitrine_id = ${vitrineId})::text AS messages,
      (SELECT count(*) FROM vues WHERE vitrine_id = ${vitrineId})::text AS vues,
      (SELECT COALESCE(sum(clics), 0) FROM liens WHERE vitrine_id = ${vitrineId})::text AS clics`)
  const ligne = resultat.rows[0]
  if (!ligne) throw new Error('Comptage des écritures sans résultat.')
  return {
    reservations: Number(ligne.reservations),
    demandes: Number(ligne.demandes),
    messages: Number(ligne.messages),
    vues: Number(ligne.vues),
    clics: Number(ligne.clics),
  }
}

export type Issue = { ok: true } | { ok: false, status: number | undefined, code: string | undefined }

const MODULE_ABSENT = /Cannot find module|Failed to load url|Failed to resolve import|ERR_MODULE_NOT_FOUND/

/** Résultat observable d'un appel de service : succès, ou (statut, code) de l'erreur métier. Module absent : relancé. */
export async function issue(promesse: Promise<unknown>): Promise<Issue> {
  try {
    await promesse
    return { ok: true }
  } catch (erreur) {
    if (erreur instanceof Error && MODULE_ABSENT.test(erreur.message)) throw erreur
    const e = erreur as { status?: unknown, statusCode?: unknown, code?: unknown }
    const statut = e.status ?? e.statusCode
    return { ok: false, status: typeof statut === 'number' ? statut : undefined, code: typeof e.code === 'string' ? e.code : undefined }
  }
}

// ---------------------------------------------------------------------------------------------
// Sessions, assistants (OAuth) : état de départ inséré directement.
// ---------------------------------------------------------------------------------------------

export interface AssistantPose {
  clientId: string
  consentementId: string
  jetonAccesId: string
  jetonRenouvellementId: string
}

export async function poserAssistant(userId: string, options: { nom?: string, scopes?: string[], clientId?: string, clientExistant?: boolean } = {}): Promise<AssistantPose> {
  const clientId = options.clientId ?? randomUUID()
  const scopes = options.scopes ?? ['vitrine:lecture']
  if (options.clientExistant !== true) await db.insert(oauthClients).values({ id: randomUUID(), clientId, name: options.nom ?? 'Assistant de test', redirectUris: ['https://exemple.com/cb'] })
  const consentementId = randomUUID()
  await db.insert(oauthConsents).values({ id: consentementId, clientId, userId, scopes })
  const jetonRenouvellementId = randomUUID()
  await db.insert(oauthRefreshTokens).values({ id: jetonRenouvellementId, token: `refresh-${randomUUID()}`, clientId, userId, scopes, expiresAt: new Date(Date.now() + 86_400_000) })
  const jetonAccesId = randomUUID()
  await db.insert(oauthAccessTokens).values({ id: jetonAccesId, token: `acces-${randomUUID()}`, clientId, userId, scopes, refreshId: jetonRenouvellementId, expiresAt: new Date(Date.now() + 3_600_000) })
  return { clientId, consentementId, jetonAccesId, jetonRenouvellementId }
}

export interface EtatOauth {
  consentements: number
  jetonsAcces: number
  jetonsRenouvellement: number
}

export async function etatOauth(userId: string): Promise<EtatOauth> {
  const compter = async (table: 'oauth_consents' | 'oauth_access_tokens' | 'oauth_refresh_tokens'): Promise<number> => {
    const resultat = await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM ${sql.raw(table)} WHERE user_id = ${userId}`)
    return Number(resultat.rows[0]?.n ?? 0)
  }
  return { consentements: await compter('oauth_consents'), jetonsAcces: await compter('oauth_access_tokens'), jetonsRenouvellement: await compter('oauth_refresh_tokens') }
}

/** Les clients OAuth n'ont pas toujours de `user_id` : le TRUNCATE de `users` ne les atteint pas, on les retire. */
export async function viderClientsOauth(): Promise<void> {
  await db.delete(oauthClients)
}

export async function creerMediaSansFichier(userId: string): Promise<string> {
  return (await insertMediaRow(userId)).id
}

/** Une ligne du journal de l'assistant (dernier usage visible dans la fiche). */
export async function journalAssistantPourTest(userId: string, clientId: string): Promise<void> {
  await db.insert(journalAssistant).values({ id: randomUUID(), userId, assistantId: clientId, outil: 'obtenir_vitrine', argumentsResume: {} })
}
