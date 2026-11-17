// S16 : purge des données OAuth périmées. L'enregistrement dynamique de clients est ouvert à tous (RFC 7591,
// sans compte) : sans nettoyage, la table `oauth_clients` grossit sans limite.
// Chaque suppression est BORNÉE (OAUTH_PURGE_LOT lignes par passage), idempotente (rejouable sans effet) et
// ne renvoie que des nombres : aucun identifiant de client, aucune donnée personnelle dans les journaux.
import { and, eq, inArray, isNull, lt, gt, notExists, type SQL } from 'drizzle-orm'
import {
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
} from '../../shared/db/schema'
import { OAUTH_JETON_EXPIRE_MARGE_JOURS, OAUTH_PURGE_LOT } from '../../shared/mcp'
import { REGLAGE_CLES } from '../../shared/reglages'
import { JOUR_MS } from '../../shared/temps'
import { db } from '../utils/db'
import { Reglages } from './reglages'

export interface BilanPurgeOauth {
  clients: number
  assertions: number
  jetonsAcces: number
  jetonsRenouvellement: number
}

/**
 * Client orphelin : enregistré depuis plus de N jours, sans aucun consentement et sans jeton encore valable.
 * Utilisée dans la sous-requête de sélection ET dans la suppression : si un consentement arrive entre les deux,
 * la ligne n'est plus supprimée. Supprimer un client emporte (ON DELETE CASCADE) ses jetons expirés ou révoqués.
 */
function conditionOrphelin(now: Date, joursOrphelin: number): SQL | undefined {
  const limite = new Date(now.getTime() - joursOrphelin * JOUR_MS)
  return and(
    lt(oauthClients.createdAt, limite),
    notExists(db.select({ un: oauthConsents.id }).from(oauthConsents).where(eq(oauthConsents.clientId, oauthClients.clientId))),
    notExists(
      db
        .select({ un: oauthAccessTokens.id })
        .from(oauthAccessTokens)
        .where(
          and(
            eq(oauthAccessTokens.clientId, oauthClients.clientId),
            gt(oauthAccessTokens.expiresAt, now),
            isNull(oauthAccessTokens.revoked),
          ),
        ),
    ),
    notExists(
      db
        .select({ un: oauthRefreshTokens.id })
        .from(oauthRefreshTokens)
        .where(
          and(
            eq(oauthRefreshTokens.clientId, oauthClients.clientId),
            gt(oauthRefreshTokens.expiresAt, now),
            isNull(oauthRefreshTokens.revoked),
          ),
        ),
    ),
  )
}

export async function purgerClientsOauthOrphelins(now: Date = new Date()): Promise<number> {
  // A4 : délai pilotable (`retention.oauth_orphelins_jours`).
  const joursOrphelin = await Reglages.lire(REGLAGE_CLES.retentionOauthOrphelinsJours)
  const supprimes = await db
    .delete(oauthClients)
    .where(
      and(
        inArray(oauthClients.id, db.select({ id: oauthClients.id }).from(oauthClients).where(conditionOrphelin(now, joursOrphelin)).limit(OAUTH_PURGE_LOT)),
        conditionOrphelin(now, joursOrphelin),
      ),
    )
    .returning({ id: oauthClients.id })
  return supprimes.length
}

export async function purgerAssertionsOauthExpirees(now: Date = new Date()): Promise<number> {
  const supprimees = await db
    .delete(oauthClientAssertions)
    .where(
      inArray(
        oauthClientAssertions.id,
        db.select({ id: oauthClientAssertions.id }).from(oauthClientAssertions).where(lt(oauthClientAssertions.expiresAt, now)).limit(OAUTH_PURGE_LOT),
      ),
    )
    .returning({ id: oauthClientAssertions.id })
  return supprimees.length
}

/** Jetons expirés depuis plus de la marge. Les consentements ne sont jamais touchés : l'autorisation survit au jeton. */
export async function purgerJetonsOauthExpires(now: Date = new Date()): Promise<{ acces: number; renouvellement: number }> {
  const limite = new Date(now.getTime() - OAUTH_JETON_EXPIRE_MARGE_JOURS * JOUR_MS)
  // Accès d'abord : ceux rattachés à un jeton de renouvellement expiré partiraient de toute façon en cascade.
  const acces = await db
    .delete(oauthAccessTokens)
    .where(
      inArray(
        oauthAccessTokens.id,
        db.select({ id: oauthAccessTokens.id }).from(oauthAccessTokens).where(lt(oauthAccessTokens.expiresAt, limite)).limit(OAUTH_PURGE_LOT),
      ),
    )
    .returning({ id: oauthAccessTokens.id })
  const renouvellement = await db
    .delete(oauthRefreshTokens)
    .where(
      inArray(
        oauthRefreshTokens.id,
        db.select({ id: oauthRefreshTokens.id }).from(oauthRefreshTokens).where(lt(oauthRefreshTokens.expiresAt, limite)).limit(OAUTH_PURGE_LOT),
      ),
    )
    .returning({ id: oauthRefreshTokens.id })
  return { acces: acces.length, renouvellement: renouvellement.length }
}

/** Un passage complet. Jetons avant clients : un client dont les jetons ont expiré devient alors purgeable au même passage. */
export async function purgerOauth(now: Date = new Date()): Promise<BilanPurgeOauth> {
  const jetons = await purgerJetonsOauthExpires(now)
  const assertions = await purgerAssertionsOauthExpirees(now)
  const clients = await purgerClientsOauthOrphelins(now)
  return { clients, assertions, jetonsAcces: jetons.acces, jetonsRenouvellement: jetons.renouvellement }
}
