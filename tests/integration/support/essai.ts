import { randomUUID } from 'node:crypto'
import { asc, eq, sql } from 'drizzle-orm'
import { TEMP_EMAIL_DOMAIN } from '../../../shared/compte'
import { abonnements, essais, essaisEmpreintes, users } from '../../../shared/db/schema'
import { ESSAI_CLE_CONFIG } from '../../../shared/essai'
import type { ConfigEssai } from '../../../shared/essai'
import { schemaOnboardingTerminer } from '../../../shared/schemas/onboarding'
import { db } from '../../../server/utils/db'
import type { ResultatEssai } from '../../../server/services/essai'
import { insertMediaRow, insertProgression, createUser } from './fabriques'
import type { UserRow } from './fabriques'
import { onboardingService } from './ia'

// Aides communes des tests d'intégration E1 (essai gratuit à la création de la vitrine, docs/specs/E1-essai-gratuit.md).
// Règles : état de départ par insertions DIRECTES, comportement prouvé par les services RÉELS contre la VRAIE base et le VRAI
// Redis ; on ne remplace que l'horloge (argument `now`) et le transport des e-mails. Le secret d'empreinte hors production se
// dérive du secret d'authentification (repli de shared/env.ts) : aucune variable à poser.
//
// CONTRATS LUS DANS LE CODE (server/services/essai.ts, configuration/lecture.ts, onboarding.ts, vitrines.ts) :
//   accorderEssaiSiEligible(tx, userId, now)  -> { accorde: true, essai: { finLe, dureeJours } } | { accorde: false, raison }
//   lireConfigEssai({ sansCache, lecteur })   -> { actif, dureeJours, relanceServicesJour, relanceStatistiquesJour, versionId, valeurs }
//   terminer(userId, input, now)              -> { creee, essai }       createVitrine(userId, input, now) -> { vitrine, photo, essai }

export const moduleEssai = () => import('../../../server/services/essai')
export const moduleLectureConfiguration = () => import('../../../server/services/configuration/lecture')
export const modulePertinence = () => import('../../../server/services/notifications/pertinence')
export const moduleProlongation = () => import('../../../server/services/paiements/prolongation')
export const moduleOffrir = () => import('../../../server/services/abonnements-offrir')

export const JOUR_MS = 86_400_000
/** Horloge de référence : lundi 23 novembre 2026, 10 h UTC = 11 h à Douala (UTC+1). */
export const DEBUT_ESSAI = new Date('2026-11-23T10:00:00.000Z')
/** Fin d'un essai de 14 jours (v1) accordé à `DEBUT_ESSAI` : exactement 14 × 24 h plus tard (pas d'arrondi à minuit). */
export const FIN_ESSAI_V1 = new Date('2026-12-07T10:00:00.000Z')
export const ID_VERSION_ESSAI_V1 = 'e1000000-essai-inscription-1'
export const OCCURRENCE_ESSAI_V1 = `ESSAI:${FIN_ESSAI_V1.toISOString()}`

export type EssaiRow = typeof essais.$inferSelect
export type EmpreinteRow = typeof essaisEmpreintes.$inferSelect

export function plus(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms)
}

export function jours(n: number): number {
  return n * JOUR_MS
}

// ---------------------------------------------------------------------------------------------
// Comptes
// ---------------------------------------------------------------------------------------------

/** Compte avec une adresse e-mail réelle (jamais le domaine temporaire), unique par défaut. */
export function creerCompteEmail(surcharges: Partial<typeof users.$inferInsert> = {}): Promise<UserRow> {
  const id = surcharges.id ?? randomUUID()
  return createUser({ id, email: `essai-${id}@exemple.test`, ...surcharges })
}

/** Compte créé par téléphone : e-mail technique (`<numéro>@domaine temporaire`), numéro vérifié ou non. */
export function creerCompteTelephone(numero: string, options: { verifie?: boolean, id?: string } = {}): Promise<UserRow> {
  const id = options.id ?? randomUUID()
  return createUser({
    id,
    email: `${numero.replaceAll(/\D/g, '')}@${TEMP_EMAIL_DOMAIN}`,
    phoneNumber: numero,
    phoneNumberVerified: options.verifie ?? true,
  })
}

/** Supprime le compte (les abonnements partent en cascade, `essais.user_id` passe à NULL, les empreintes restent). */
export async function supprimerCompte(userId: string): Promise<void> {
  await db.delete(users).where(eq(users.id, userId))
}

// ---------------------------------------------------------------------------------------------
// Octroi
// ---------------------------------------------------------------------------------------------

/** Appelle le service réel dans SA propre transaction, comme `terminer` et `createVitrine` le font dans la leur. */
export async function accorder(userId: string, now: Date = DEBUT_ESSAI): Promise<ResultatEssai> {
  const { accorderEssaiSiEligible } = await moduleEssai()
  return db.transaction((tx) => accorderEssaiSiEligible(tx, userId, now))
}

// ---------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------

export async function lireEssais(userId: string): Promise<EssaiRow[]> {
  return db.select().from(essais).where(eq(essais.userId, userId))
}

export async function lireToutesLesEssais(): Promise<EssaiRow[]> {
  return db.select().from(essais).orderBy(asc(essais.debutLe), asc(essais.id))
}

export async function lireToutesLesEmpreintes(): Promise<EmpreinteRow[]> {
  return db.select().from(essaisEmpreintes).orderBy(asc(essaisEmpreintes.empreinte))
}

export async function lireAbonnementDe(userId: string) {
  const [ligne] = await db.select().from(abonnements).where(eq(abonnements.userId, userId))
  return ligne
}

export async function compterAbonnements(): Promise<number> {
  return db.$count(abonnements)
}

/** Rien n'a été consommé : aucune ligne `essais`, aucune empreinte (la raison d'un refus n'écrit rien). */
export async function etatConsomme(): Promise<{ essais: number, empreintes: number, abonnements: number }> {
  return { essais: await db.$count(essais), empreintes: await db.$count(essaisEmpreintes), abonnements: await db.$count(abonnements) }
}

// ---------------------------------------------------------------------------------------------
// Configuration : version `essai` posée directement (état de départ). Les lignes créées ici portent `cree_par = 'test-e1'` :
// `restaurerConfiguration()` (support/admin-a5.ts, via `preparerConfigurationA5()` au niveau du module du fichier de test) les
// supprime et remet la v1 seedée à `active`.
// ---------------------------------------------------------------------------------------------

let numeroVersion = 1

/** Remplace la version `essai` active par une nouvelle version active portant ces valeurs ; renvoie son identifiant. */
export async function poserVersionEssai(valeurs: ConfigEssai): Promise<string> {
  numeroVersion += 1
  const id = `e1-test-essai-${randomUUID().slice(0, 12)}`
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE categorie = 'essai' AND cle = ${ESSAI_CLE_CONFIG} AND statut = 'active'`)
    await tx.execute(sql`
      INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
      VALUES (${id}, 'essai', ${ESSAI_CLE_CONFIG}, ${numeroVersion + 100}, ${JSON.stringify(valeurs)}::jsonb, 'active', ${'2026-01-01T00:00:00Z'}::timestamptz, ${'Version de test E1'}, ${'test-e1'})`)
  })
  const { viderCacheConfiguration } = await moduleLectureConfiguration()
  viderCacheConfiguration()
  return id
}

/** Pose une version active dont `valeurs` n'est PAS valide pour le schéma strict (la base ne contrôle que « objet JSON »). */
export async function poserVersionEssaiBrute(valeurs: unknown): Promise<string> {
  numeroVersion += 1
  const id = `e1-test-brute-${randomUUID().slice(0, 12)}`
  await db.transaction(async (tx) => {
    await tx.execute(sql`UPDATE configuration_versions SET statut = 'remplacee' WHERE categorie = 'essai' AND cle = ${ESSAI_CLE_CONFIG} AND statut = 'active'`)
    await tx.execute(sql`
      INSERT INTO configuration_versions (id, categorie, cle, numero, valeurs, statut, effective_a, motif, cree_par)
      VALUES (${id}, 'essai', ${ESSAI_CLE_CONFIG}, ${numeroVersion + 100}, ${JSON.stringify(valeurs)}::jsonb, 'active', ${'2026-01-01T00:00:00Z'}::timestamptz, ${'Version de test E1'}, ${'test-e1'})`)
  })
  const { viderCacheConfiguration } = await moduleLectureConfiguration()
  viderCacheConfiguration()
  return id
}

/** Rend la table des versions illisible (renommée) le temps de `corps`, puis la rétablit dans un `finally`. Aucun mock : PostgreSQL lève. */
export async function avecConfigurationIllisible<T>(corps: () => Promise<T>): Promise<T> {
  await db.execute(sql`ALTER TABLE configuration_versions RENAME TO configuration_versions_hors_service`)
  try {
    return await corps()
  } finally {
    await db.execute(sql`ALTER TABLE configuration_versions_hors_service RENAME TO configuration_versions`)
  }
}

// ---------------------------------------------------------------------------------------------
// Panne simulée DANS le savepoint de l'essai : un déclencheur réel refuse tout INSERT dans `essais`. Aucun mock : PostgreSQL lève
// une vraie erreur au milieu de l'octroi, après l'écriture de l'abonnement. Retiré dans un `finally`.
// ---------------------------------------------------------------------------------------------

export async function avecPanneSurEssais<T>(corps: () => Promise<T>): Promise<T> {
  await db.execute(sql.raw(`CREATE OR REPLACE FUNCTION essai_panne_de_test() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'panne simulee de l essai' USING ERRCODE = 'XX000'; END $$`))
  await db.execute(sql.raw('CREATE TRIGGER essai_panne_de_test BEFORE INSERT ON essais FOR EACH ROW EXECUTE FUNCTION essai_panne_de_test()'))
  try {
    return await corps()
  } finally {
    await db.execute(sql.raw('DROP TRIGGER IF EXISTS essai_panne_de_test ON essais'))
    await db.execute(sql.raw('DROP FUNCTION IF EXISTS essai_panne_de_test()'))
  }
}

// ---------------------------------------------------------------------------------------------
// Inscription : état de départ de `terminer` (identité, photo, proposition validée) inséré directement, puis `terminer` RÉEL.
// ---------------------------------------------------------------------------------------------

export interface CompteTerminable {
  user: UserRow
  mediaId: string
}

/** Compte dont l'inscription guidée est prête à être terminée (étape 4) avec `nbServices` services proposés (3 au plus, CHECK de la base). */
export async function preparerCompteTerminable(
  surcharges: Partial<typeof users.$inferInsert> = {},
  nbServices = 3,
): Promise<CompteTerminable> {
  const user = await creerCompteEmail(surcharges)
  const media = await insertMediaRow(user.id)
  await insertProgression(user.id, {
    photoMediaId: media.id,
    accroche: 'Un cardiologue à Douala, à votre écoute.',
    presentation: 'Une présentation claire et chaleureuse de mon activité auprès de mes patients.',
    servicesProposes: Array.from({ length: nbServices }, (_, i) => ({
      titre: `Consultation numéro ${i + 1}`,
      description: `Description de la consultation numéro ${i + 1}.`,
      type: 'rdv',
      dureeMin: 30,
      nbSeances: null,
      actif: true,
    })),
    propositionValideeLe: new Date(),
  })
  return { user, mediaId: media.id }
}

export function adresseUnique(prefixe = 'essai'): string {
  return `${prefixe}-${randomUUID().slice(0, 8)}`
}

/** `terminer` réel (horloge injectée). */
export async function terminerPour(userId: string, username: string = adresseUnique(), now: Date = DEBUT_ESSAI) {
  const { terminer } = await onboardingService()
  return terminer(userId, schemaOnboardingTerminer.parse({ username, palette: 'sauge' }), now)
}
