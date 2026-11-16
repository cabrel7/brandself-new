// A5 : briques d'écriture communes aux versions et aux catalogues (D-A5-14, D-A5-16, D-A5-17). Aucun événement H3 ici.
//  - identifiants DÉTERMINISTES dérivés de (administrateur, clé d'idempotence) : un rejeu retrouve la même cible ;
//  - empreinte SHA-256 des valeurs (le journal est plat : jamais le contenu) ;
//  - verrou consultatif par (catégorie, clé) ; relecture d'une écriture déjà journalisée.
import { createHash } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { H3Error } from 'h3'
import { introuvableAdmin } from '../../utils/introuvable'
import { rejouerSiDejaFait } from '../admin/a2-support'
import type { DemandeAttendue, ExigerReauth, JournalRejoue } from '../admin/a2-support'
import type { TransactionAdmin } from '../admin/audit'

/** Qui écrit : l'administrateur, son adresse, la clé d'idempotence (obligatoire) et le crochet de réauthentification. */
export interface AuteurEcriture {
  adminId: string
  ip: string
  cleIdempotence: string
  reauth?: ExigerReauth
  /** Horloge injectée (tests) ; défaut : maintenant. */
  maintenant?: Date
}

/** Écriture qui EXIGE la réauthentification (fail closed : l'oubli ne compile pas). */
export interface AuteurEcritureReauth extends AuteurEcriture {
  reauth: ExigerReauth
}

const LONGUEUR_ID_DERIVE = 32

export function horlogeDe(auteur: AuteurEcriture): Date {
  return auteur.maintenant ?? new Date()
}

function sha256Hex(texte: string): string {
  return createHash('sha256').update(texte).digest('hex')
}

/** Sérialisation canonique (clés triées) : deux objets égaux ont la même empreinte. */
export function jsonCanonique(valeur: unknown): string {
  if (Array.isArray(valeur)) return `[${valeur.map(jsonCanonique).join(',')}]`
  if (valeur !== null && typeof valeur === 'object') {
    const entrees = Object.entries(valeur as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entrees.map(([k, v]) => `${JSON.stringify(k)}:${jsonCanonique(v)}`).join(',')}}`
  }
  return JSON.stringify(valeur) ?? 'null'
}

/** Empreinte SHA-256 (hexadécimal, 64 caractères) des valeurs d'une version : c'est tout ce que le journal en garde. */
export function empreinteValeurs(valeurs: unknown): string {
  return sha256Hex(jsonCanonique(valeurs))
}

/** Identifiant d'une ligne créée par une demande idempotente : même (administrateur, clé) = même identifiant. */
export function idDerive(prefixe: string, adminId: string, cleIdempotence: string): string {
  return `${prefixe}${sha256Hex(`${adminId}:${cleIdempotence}`).slice(0, LONGUEUR_ID_DERIVE)}`
}

/** D-A5-17 : sérialise les écritures d'une même (catégorie, clé). */
export async function verrouillerConfiguration(tx: TransactionAdmin, categorie: string, cle: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`config:${categorie}:${cle}`}, 0))`)
}

/** Relit l'écriture déjà journalisée sous cette clé (409 `IDEMPOTENCE_CONFLIT` si la demande diffère). */
export function rejouer(tx: TransactionAdmin, auteur: AuteurEcriture, attendue: DemandeAttendue): Promise<JournalRejoue | null> {
  return rejouerSiDejaFait(tx, auteur.adminId, auteur.cleIdempotence, attendue)
}

/**
 * 404 sans corps parlant : le contrat figé (`shared/erreurs.ts`) n'a pas de code `…_INTROUVABLE` pour les entrées de
 * catalogue ni les versions ; on répond comme l'administration à toute anomalie (A1), sans rien révéler.
 */
export function entreeIntrouvable(): H3Error {
  return introuvableAdmin()
}
