import { sql } from 'drizzle-orm'
import type { WebhookRefusMotif } from '../../shared/admin-paiements'
import { HEURE_MS, JOUR_MS } from '../../shared/temps'
import { WEBHOOKS_REFUSES_RETENTION_JOURS } from '../../shared/limites'
import { WEBHOOKS_REFUSES_PURGE_LOT } from '../../shared/jobs'
import { db } from '../utils/db'

// A3 (D-A3-05) : compteur HORAIRE des webhooks refusés. Une ligne par (heure, fournisseur, motif) : la taille reste
// bornée sous attaque. Ne reçoit NI corps, NI en-têtes, NI adresse IP : il ne peut donc rien en journaliser.

/** Heure pleine (UTC) contenant `instant`. */
export function heurePleine(instant: Date): Date {
  return new Date(Math.floor(instant.getTime() / HEURE_MS) * HEURE_MS)
}

/**
 * Compte un refus. BEST-EFFORT : une erreur de comptage est journalisée (motif seul) et JAMAIS propagée, la réponse
 * du webhook (401 ou 413) ne change pas.
 */
export async function enregistrerRefusWebhook(fournisseur: string, motif: WebhookRefusMotif, now: Date = new Date()): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO webhooks_refuses (heure, fournisseur, motif, nombre)
      VALUES (${heurePleine(now)}, ${fournisseur}, ${motif}, 1)
      ON CONFLICT (heure, fournisseur, motif) DO UPDATE SET nombre = webhooks_refuses.nombre + 1`)
  } catch {
    console.error({ webhook: 'comptage_refus_echoue', motif })
  }
}

/** Refus comptés sur l'heure courante et la précédente (alerte D-A3-13). */
export async function compterRefusDerniereHeure(now: Date): Promise<number> {
  const depuis = new Date(heurePleine(now).getTime() - HEURE_MS)
  const resultat = await db.execute<{ total: string | null }>(sql`
    SELECT COALESCE(sum(nombre), 0) AS total FROM webhooks_refuses WHERE heure >= ${depuis}`)
  const total = Number(resultat.rows[0]?.total ?? 0)
  return Number.isSafeInteger(total) ? total : 0
}

/**
 * Purge les lignes de plus de `WEBHOOKS_REFUSES_RETENTION_JOURS` jours, par lots (jamais un DELETE géant). Renvoie le
 * nombre de lignes supprimées (aucune donnée dans le journal du worker).
 */
export async function purgerWebhooksRefuses(now: Date = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - WEBHOOKS_REFUSES_RETENTION_JOURS * JOUR_MS)
  let total = 0
  for (;;) {
    const resultat = await db.execute(sql`
      DELETE FROM webhooks_refuses
      WHERE ctid IN (SELECT ctid FROM webhooks_refuses WHERE heure < ${limite} LIMIT ${WEBHOOKS_REFUSES_PURGE_LOT})`)
    const supprimees = resultat.rowCount ?? 0
    total += supprimees
    if (supprimees < WEBHOOKS_REFUSES_PURGE_LOT) return total
  }
}
