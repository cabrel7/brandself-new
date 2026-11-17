import type { JobsOptions, Queue } from 'bullmq'
import { REGLAGE_CLES } from '../../shared/reglages'
import { JOBS, SEO_IA_DEBOUNCE_MS, SEO_IA_JOB_ID_PREFIXE } from '../../shared/jobs'
import type { SeoJobData } from '../../shared/jobs'
import { Reglages } from '../services/reglages'
import { getIaFondQueue } from './queues'

// Décision #24 : file `ia-fond`. Un job = un identifiant de vitrine (rien de personnel dans Redis), différé de
// 5 minutes et unique par vitrine : chaque nouvelle modification REPART de zéro (debounce), cinq modifications
// de suite donnent une seule génération.
// Aucune relance BullMQ (`attempts: 1`) : la prochaine modification ou publication replanifie.
// `removeOnComplete` / `removeOnFail` sont indispensables : un job terminé CONSERVÉ garderait son identifiant et
// bloquerait toute planification future de cette vitrine (BullMQ ignore un `add` dont l'identifiant existe).
//
// Debounce par identifiant déterministe + retrait du job différé plutôt que par l'option `deduplication`
// (`ttl`/`extend`/`replace`) : la clé de déduplication survit à la fin du job pendant son `ttl` et refuserait la
// planification suivante.

export const seoJobOptions: JobsOptions = {
  attempts: 1,
  removeOnComplete: true,
  removeOnFail: true,
}

export function seoJobId(vitrineId: string): string {
  return `${SEO_IA_JOB_ID_PREFIXE}${vitrineId}`
}

/**
 * Planifie (ou replanifie) la régénération du SEO d'une vitrine dans 5 minutes. NE LÈVE JAMAIS : la modification
 * de la vitrine ou sa publication n'échoue pas parce que Redis est indisponible (une erreur est journalisée, sans
 * donnée personnelle). Sans effet quand `SEO_IA_REGENERATION_ACTIVE` est coupé.
 * Limite connue : si un job de cette vitrine est déjà en cours d'exécution, l'ajout est ignoré (même identifiant) ;
 * son écriture, conditionnée aux entrées lues, n'aura alors rien écrit et la prochaine modification replanifie.
 */
export async function planifierRegenerationSeo(vitrineId: string, queue: Pick<Queue, 'add' | 'getJob'> = getIaFondQueue()): Promise<void> {
  try {
    if (!(await Reglages.lire(REGLAGE_CLES.seoRegenerationActive))) return
    const jobId = seoJobId(vitrineId)
    const existant = await queue.getJob(jobId)
    // Seul un job encore différé est retiré : le délai repart. Un retrait concurrent (déjà retiré) est sans gravité.
    if (existant && (await existant.getState()) === 'delayed') await existant.remove().catch(() => undefined)
    const data: SeoJobData = { vitrineId }
    await queue.add(JOBS.regenererSeoIa, data, { ...seoJobOptions, jobId, delay: SEO_IA_DEBOUNCE_MS })
  } catch (erreur) {
    console.error({ ia: 'seo : planification impossible', vitrine: vitrineId, nom: erreur instanceof Error ? erreur.name : typeof erreur })
  }
}
