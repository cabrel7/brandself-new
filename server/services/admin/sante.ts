// A4 (D-A4-16, D-A4-22) : santé du système pour l'administration. Base (`SELECT 1`, 2 s), Redis (`PING`), disque des
// médias, dernière sauvegarde (battement écrit par `scripts/sauvegarde-battement.ts`) et version. Une sauvegarde sans
// battement est `inconnue` : jamais présentée comme bonne. Aucun secret, aucun chemin dans la réponse.
import { statfs } from 'node:fs/promises'
import { eq, sql } from 'drizzle-orm'
import { SANTE_BASE_TIMEOUT_MS } from '../../../shared/admin'
import type { SanteEtat, SauvegardeEtat } from '../../../shared/admin'
import { battementsSysteme } from '../../../shared/db/schema'
import { env } from '../../../shared/env'
import { BATTEMENT_SAUVEGARDE, SAUVEGARDE_ALERTE_HEURES } from '../../../shared/jobs'
import { REGLAGE_CLES } from '../../../shared/reglages'
import { HEURE_MS } from '../../../shared/temps'
import { db } from '../../utils/db'
import { redis } from '../../utils/redis'
import { Reglages } from '../reglages'

export interface SanteVue {
  base: { etat: SanteEtat, latenceMs: number | null }
  redis: { etat: SanteEtat, latenceMs: number | null }
  disque: { etat: SanteEtat, libreOctets: number | null, totalOctets: number | null, libresPct: number | null }
  sauvegarde: { etat: SauvegardeEtat, derniereReussiteLe: Date | null, ageHeures: number | null }
  version: string
  genereLe: Date
}

async function mesurer(controle: () => Promise<unknown>, delaiMs: number): Promise<{ etat: SanteEtat, latenceMs: number | null }> {
  const debut = Date.now()
  let minuteur: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      controle(),
      new Promise<never>((_, rejeter) => {
        minuteur = setTimeout(() => rejeter(new Error('SANTE_DELAI')), delaiMs)
      }),
    ])
    return { etat: 'ok', latenceMs: Date.now() - debut }
  } catch {
    return { etat: 'indisponible', latenceMs: null }
  } finally {
    if (minuteur) clearTimeout(minuteur)
  }
}

async function mesurerDisque(seuilPct: number): Promise<SanteVue['disque']> {
  try {
    const stats = await statfs(env.MEDIAS_DIR)
    const total = stats.blocks * stats.bsize
    const libre = stats.bavail * stats.bsize
    const libresPct = total > 0 ? Math.round((libre / total) * 1000) / 10 : null
    return { etat: libresPct !== null && libresPct < seuilPct ? 'degrade' : 'ok', libreOctets: libre, totalOctets: total, libresPct }
  } catch {
    return { etat: 'indisponible', libreOctets: null, totalOctets: null, libresPct: null }
  }
}

/** Sans battement : `inconnue`. Au-delà de `SAUVEGARDE_ALERTE_HEURES` : `ancienne` (alerte). */
export async function lireSauvegarde(maintenant: Date): Promise<SanteVue['sauvegarde']> {
  try {
    const [ligne] = await db
      .select({ horodatage: battementsSysteme.horodatage })
      .from(battementsSysteme)
      .where(eq(battementsSysteme.cle, BATTEMENT_SAUVEGARDE))
      .limit(1)
    if (!ligne) return { etat: 'inconnue', derniereReussiteLe: null, ageHeures: null }
    const ageHeures = Math.max(0, (maintenant.getTime() - ligne.horodatage.getTime()) / HEURE_MS)
    return {
      etat: ageHeures > SAUVEGARDE_ALERTE_HEURES ? 'ancienne' : 'ok',
      derniereReussiteLe: ligne.horodatage,
      ageHeures: Math.round(ageHeures * 10) / 10,
    }
  } catch {
    return { etat: 'inconnue', derniereReussiteLe: null, ageHeures: null }
  }
}

export async function lireSante(maintenant: Date = new Date()): Promise<SanteVue> {
  const seuilDisque = await Reglages.lire(REGLAGE_CLES.supervisionDisqueAlertePct)
  const [base, redisEtat, disque, sauvegarde] = await Promise.all([
    mesurer(() => db.execute(sql`SELECT 1`), SANTE_BASE_TIMEOUT_MS),
    mesurer(() => redis.ping(), SANTE_BASE_TIMEOUT_MS),
    mesurerDisque(seuilDisque),
    lireSauvegarde(maintenant),
  ])
  return { base, redis: redisEtat, disque, sauvegarde, version: env.APP_VERSION, genereLe: maintenant }
}
