// A1 (D-A1-09) : journal d'administration à chaîne de hachage.
// `numero`, `empreinte_precedente`, `empreinte` et `cree_le` sont posés par le DÉCLENCHEUR `journal_admin_chainer`
// (sous verrou consultatif, transaction en READ COMMITTED) : ce service ne les calcule ni ne les envoie jamais.
// `enregistrer` s'appelle TOUJOURS dans la transaction de l'écriture qu'il journalise : si l'une échoue, l'autre
// n'existe pas (CA14).
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  ADMIN_ACTION_FORMAT,
  ADMIN_CIBLE_ID_MAX,
  ADMIN_CIBLE_TYPE_FORMAT,
  AUDIT_CLE_FORMAT,
  AUDIT_VALEUR_TEXTE_MAX,
  CLES_AUDIT_INTERDITES,
} from '../../../shared/admin'
import { schemaMotifAdmin } from '../../../shared/schemas/admin'
import type { db } from '../../utils/db'

/** Transaction ou connexion : toute écriture d'administration passe par une transaction (`db.transaction`). */
export type TransactionAdmin = Parameters<Parameters<typeof db.transaction>[0]>[0]
export type ExecuteurSql = Pick<typeof db, 'execute'>

/** Nombre maximal de clés d'un état `avant`/`apres` : un journal d'identifiants et de champs neutres, pas un export. */
const AUDIT_ETAT_CLES_MAX = 30
/** Même borne que la contrainte CHECK de `journal_admin.ip`. */
const AUDIT_IP_MAX = 64

/** Valeur texte qui ressemble à une donnée personnelle : une adresse (`@`) ou un numéro (8 chiffres ou plus). */
const CHIFFRES_TELEPHONE_MIN = 8
const SEPARATEURS_TELEPHONE = /[\s.\-+()]/g
/** Un numéro ne contient que des chiffres et des séparateurs : un identifiant avec lettres (`v2026-11-14`) passe. */
const NUMERO_SEUL = /^[\d\s.\-+()]+$/
const valeurPersonnelle = (texte: string): boolean =>
  texte.includes('@') ||
  (NUMERO_SEUL.test(texte) && new RegExp(`\\d{${CHIFFRES_TELEPHONE_MIN},}`).test(texte.replace(SEPARATEURS_TELEPHONE, '')))

const schemaValeurAudit = z.union([
  z.string().max(AUDIT_VALEUR_TEXTE_MAX).refine((texte) => !valeurPersonnelle(texte), {
    message: 'Valeur interdite : elle ressemble à une donnée personnelle (adresse ou numéro).',
  }),
  z.number(),
  z.boolean(),
  z.null(),
])

/** Objet PLAT : clés `^[a-z_]+$` hors liste noire, valeurs `string ≤ 64 | number | boolean | null`. */
const schemaEtatAudit = z
  .record(z.string().regex(AUDIT_CLE_FORMAT), schemaValeurAudit)
  .refine((etat) => Object.keys(etat).length <= AUDIT_ETAT_CLES_MAX, { message: 'Trop de clés.' })
  .refine((etat) => Object.keys(etat).every((cle) => !CLES_AUDIT_INTERDITES.includes(cle)), {
    message: 'Clé interdite : elle porterait une donnée personnelle.',
  })

export const schemaEntreeAudit = z.strictObject({
  adminId: z.string().min(1).max(ADMIN_CIBLE_ID_MAX),
  action: z.string().regex(ADMIN_ACTION_FORMAT),
  cibleType: z.string().regex(ADMIN_CIBLE_TYPE_FORMAT),
  cibleId: z.string().min(1).max(ADMIN_CIBLE_ID_MAX).nullish(),
  avant: schemaEtatAudit.nullish(),
  apres: schemaEtatAudit.nullish(),
  motif: schemaMotifAdmin,
  ip: z.string().min(1).max(AUDIT_IP_MAX),
  cleIdempotence: z.string().min(8).max(128).nullish(),
})
export type EntreeAudit = z.input<typeof schemaEntreeAudit>

export interface LigneJournalEcrite {
  id: string
  numero: number
}

/** Chaîne d'un journal vérifiée : `premiereRupture` = `numero` de la première ligne incohérente, sinon `null`. */
export interface VerificationChaine {
  intacte: boolean
  premiereRupture: number | null
}

const jsonOuNull = (valeur: Record<string, unknown> | null | undefined): string | null =>
  valeur === null || valeur === undefined ? null : JSON.stringify(valeur)

/**
 * Journalise une écriture d'administration DANS la transaction `tx`. Lève (Zod) avant toute écriture si l'entrée
 * est invalide (clé interdite, valeur trop longue, motif absent) : rien n'est alors écrit.
 */
export async function enregistrer(tx: TransactionAdmin, entree: EntreeAudit): Promise<LigneJournalEcrite> {
  const e = schemaEntreeAudit.parse(entree)
  const id = randomUUID()
  const resultat = await tx.execute<{ id: string, numero: string }>(sql`
    INSERT INTO journal_admin (id, admin_id, action, cible_type, cible_id, avant, apres, motif, ip, cle_idempotence)
    VALUES (
      ${id}, ${e.adminId}, ${e.action}, ${e.cibleType}, ${e.cibleId ?? null},
      ${jsonOuNull(e.avant)}::jsonb, ${jsonOuNull(e.apres)}::jsonb,
      ${e.motif}, ${e.ip}, ${e.cleIdempotence ?? null}
    )
    RETURNING id, numero`)
  const ligne = resultat.rows[0]
  if (!ligne) throw new Error('AUDIT_SANS_RESULTAT')
  return { id: ligne.id, numero: Number(ligne.numero) }
}

/**
 * Recalcule la chaîne côté SQL (même fonction `journal_admin_empreinte` que le déclencheur). Une ligne est en
 * rupture si son empreinte recalculée diffère de celle stockée, si son `empreinte_precedente` n'est pas
 * l'empreinte réelle de la ligne d'avant, ou si la numérotation a un trou (ligne supprimée).
 */
export async function verifierChaine(executeur: ExecuteurSql): Promise<VerificationChaine> {
  const resultat = await executeur.execute<{ numero: string }>(sql`
    WITH calcul AS (
      SELECT
        numero, empreinte, empreinte_precedente,
        lag(empreinte) OVER (ORDER BY numero) AS empreinte_reelle_precedente,
        lag(numero) OVER (ORDER BY numero) AS numero_precedent,
        journal_admin_empreinte(
          empreinte_precedente, numero, id, admin_id, action, cible_type, cible_id,
          avant, apres, motif, ip, cle_idempotence, cree_le
        ) AS empreinte_recalculee
      FROM journal_admin
    )
    SELECT numero FROM calcul
    WHERE empreinte_recalculee <> empreinte
      OR empreinte_precedente <> COALESCE(empreinte_reelle_precedente, repeat('0', 64))
      OR numero <> COALESCE(numero_precedent, 0) + 1
    ORDER BY numero
    LIMIT 1`)
  const rupture = resultat.rows[0]
  return rupture === undefined
    ? { intacte: true, premiereRupture: null }
    : { intacte: false, premiereRupture: Number(rupture.numero) }
}
