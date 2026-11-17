// A4 : événements d'installation du studio sur 30 jours au plus. Aucune donnée personnelle : type, origine, appareil.
import { sql } from 'drizzle-orm'
import { JOUR_MS } from '../../../shared/temps'
import type { z } from 'zod'
import type { schemaPwaInstallEvent } from '../../../shared/schemas/pwa'
import { db } from '../../utils/db'

type PwaInstallEvent = z.infer<typeof schemaPwaInstallEvent>

export interface AgregatsPwaVue {
  jours: number
  total: number
  lignes: { type: PwaInstallEvent['type'], origine: PwaInstallEvent['origine'], deviceType: PwaInstallEvent['deviceType'], nombre: number }[]
  genereLe: Date
}

export async function lireAgregatsPwa(jours: number, maintenant: Date = new Date()): Promise<AgregatsPwaVue> {
  const depuis = new Date(maintenant.getTime() - jours * JOUR_MS).toISOString()
  const resultat = await db.execute<{
    type: PwaInstallEvent['type']
    origine: PwaInstallEvent['origine']
    device_type: PwaInstallEvent['deviceType']
    nombre: string
  }>(sql`
    SELECT type, origine, device_type, count(*) AS nombre FROM pwa_install_events
    WHERE created_at >= ${depuis}::timestamptz
    GROUP BY type, origine, device_type ORDER BY type, origine, device_type`)
  const lignes = resultat.rows.map((r) => ({ type: r.type, origine: r.origine, deviceType: r.device_type, nombre: Number(r.nombre) }))
  return { jours, total: lignes.reduce((somme, ligne) => somme + ligne.nombre, 0), lignes, genereLe: maintenant }
}
