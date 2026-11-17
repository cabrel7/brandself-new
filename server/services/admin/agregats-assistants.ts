// A4 : `journal_assistant` agrégé (30 jours au plus). Jamais `arguments_resume`, `resultat`, `avant` ni `apres`.
import { sql } from 'drizzle-orm'
import { ADMIN_SUPERVISION_ASSISTANTS_MAX } from '../../../shared/admin'
import { JOUR_MS } from '../../../shared/temps'
import { db } from '../../utils/db'

export interface AgregatsAssistantsVue {
  jours: number
  total: number
  comptesActifs: number
  capacitesActives: number
  parOutil: { outil: string, nombre: number }[]
  parAssistant: { assistantId: string, nombre: number }[]
  genereLe: Date
}

export async function lireAgregatsAssistants(jours: number, maintenant: Date = new Date()): Promise<AgregatsAssistantsVue> {
  const depuis = new Date(maintenant.getTime() - jours * JOUR_MS).toISOString()
  const fenetre = sql`created_at >= ${depuis}::timestamptz`
  const [totaux, outils, assistants, capacites] = await Promise.all([
    db.execute<{ total: string, comptes: string }>(sql`
      SELECT count(*) AS total, count(DISTINCT user_id) AS comptes FROM journal_assistant WHERE ${fenetre}`),
    db.execute<{ outil: string, nombre: string }>(sql`
      SELECT outil, count(*) AS nombre FROM journal_assistant WHERE ${fenetre} GROUP BY outil ORDER BY count(*) DESC, outil`),
    db.execute<{ assistant_id: string, nombre: string }>(sql`
      SELECT assistant_id, count(*) AS nombre FROM journal_assistant WHERE ${fenetre}
      GROUP BY assistant_id ORDER BY count(*) DESC, assistant_id LIMIT ${ADMIN_SUPERVISION_ASSISTANTS_MAX}`),
    db.execute<{ nombre: string }>(sql`SELECT count(*) AS nombre FROM capacites_accordees WHERE revoque_le IS NULL`),
  ])
  return {
    jours,
    total: Number(totaux.rows[0]?.total ?? 0),
    comptesActifs: Number(totaux.rows[0]?.comptes ?? 0),
    capacitesActives: Number(capacites.rows[0]?.nombre ?? 0),
    parOutil: outils.rows.map((r) => ({ outil: r.outil, nombre: Number(r.nombre) })),
    parAssistant: assistants.rows.map((r) => ({ assistantId: r.assistant_id, nombre: Number(r.nombre) })),
    genereLe: maintenant,
  }
}
