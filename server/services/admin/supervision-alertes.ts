// A4 (D-A4-03) : contrôle périodique des échecs définitifs par file. Si une file dépasse le seuil (réglage
// `supervision.seuil_echecs_15_min`) sur 15 minutes, UNE alerte au plus par heure est enfilée (clé Redis
// `supervision:alerte` posée à l'envoi, `SET NX EX`). L'alerte ne porte que des noms de file et des nombres.
import { FILES_SUPERVISEES, SUPERVISION_ALERTE_CLE, SUPERVISION_ALERTE_INTERVALLE_S } from '../../../shared/jobs'
import type { FileSupervisee } from '../../../shared/jobs'
import { REGLAGE_CLES } from '../../../shared/reglages'
import { getMaintenanceQueue } from '../../jobs/queues'
import { redis } from '../../utils/redis'
import { Reglages } from '../reglages'
import { lireEchecsRecents } from '../supervision-echecs'

export interface FileEnAlerte {
  file: FileSupervisee
  echecs: number
}

/** Dernière alerte lisible par le tableau de bord (clé distincte du verrou horaire). */
export const SUPERVISION_ALERTE_DERNIERE_CLE = 'supervision:alerte:derniere'

export interface DepsAlerte {
  /** Enfile l'alerte (défaut : job `supervision-alerte-echecs` dans la file `maintenance`). */
  enfiler: (files: readonly FileEnAlerte[], maintenant: Date) => Promise<void>
}

/** Nom du job d'alerte (file `maintenance`) : nombres et noms de file seulement. */
export const JOB_ALERTE_ECHECS = 'supervision-alerte-echecs'

async function enfilerParDefaut(files: readonly FileEnAlerte[], maintenant: Date): Promise<void> {
  await getMaintenanceQueue().add(
    JOB_ALERTE_ECHECS,
    { le: maintenant.toISOString(), files },
    { attempts: 1, removeOnComplete: true, removeOnFail: true },
  )
}

/** Traitement du job d'alerte par le worker : bandeau du tableau de bord (clé Redis) et journal d'erreur, sans donnée. */
export async function traiterAlerteEchecs(maintenant: Date, files: readonly FileEnAlerte[]): Promise<void> {
  await redis.set(
    SUPERVISION_ALERTE_DERNIERE_CLE,
    JSON.stringify({ le: maintenant.toISOString(), files }),
    'EX',
    SUPERVISION_ALERTE_INTERVALLE_S * 24,
  )
  console.error(`[supervision] échecs de tâches au-delà du seuil : ${files.map((f) => `${f.file}=${f.echecs}`).join(', ')} (SUPERVISION_SEUIL_ECHECS)`)
}

/** Vrai si une alerte a été enfilée à cet appel. Fail-open côté Redis : une panne ne fait pas échouer le job de contrôle. */
export async function alerterSiSeuil(maintenant: Date = new Date(), deps: DepsAlerte = { enfiler: enfilerParDefaut }): Promise<boolean> {
  const seuil = await Reglages.lire(REGLAGE_CLES.supervisionSeuilEchecs15Min)
  const comptes = await Promise.all(FILES_SUPERVISEES.map(async (file) => ({ file, echecs: await lireEchecsRecents(file, maintenant) })))
  const enAlerte = comptes.filter((c) => c.echecs >= seuil)
  if (enAlerte.length === 0) return false
  // Une alerte par heure : la clé n'est posée que par le premier contrôle qui dépasse le seuil.
  const posee = await redis.set(SUPERVISION_ALERTE_CLE, '1', 'EX', SUPERVISION_ALERTE_INTERVALLE_S, 'NX')
  if (posee !== 'OK') return false
  await deps.enfiler(enAlerte, maintenant)
  return true
}
