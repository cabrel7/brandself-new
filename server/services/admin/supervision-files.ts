// A4 (D-A4-01, D-A4-02) : supervision des files BullMQ par l'API NATIVE (aucune dépendance, aucune route de Bull
// Board) : toute action passe par nos routes, journalisée. JAMAIS `job.data` ni le message d'erreur brut d'un job : un
// échec est réduit à un CODE de la forme `^[A-Z0-9_]{1,64}$` (sinon `ERREUR_INCONNUE`).
import type { Job, Queue } from 'bullmq'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import { FILES_NON_RELANCABLES, FILES_SUPERVISEES, SUPERVISION_ECHECS_LISTES_MAX } from '../../../shared/jobs'
import type { FileSupervisee } from '../../../shared/jobs'
import { CODE_ECHEC_FORMAT } from '../../../shared/paiements'
import { REGLAGE_CLES } from '../../../shared/reglages'
import { NotFoundError, UnprocessableError } from '../../exceptions/http'
import { getQueueSupervisee } from '../../jobs/queues'
import { db } from '../../utils/db'
import { Reglages } from '../reglages'
import { lireEchecsRecents } from '../supervision-echecs'
import { rejouerSiDejaFait } from './a2-support'
import type { DepsEcritureReauth } from './a2-support'
import { enregistrer } from './audit'

export const MOTIF_ECHEC_INCONNU = 'ERREUR_INCONNUE'

export interface JobEchecVue {
  id: string
  nom: string
  echecLe: Date | null
  tentatives: number
  motif: string
}

export interface EtatFileVue {
  file: FileSupervisee
  compteurs: { attente: number, actifs: number, differes: number, echoues: number, termines: number }
  echecs15Min: number
  relancable: boolean
  echecs: JobEchecVue[]
}

export interface EtatFilesVue {
  files: EtatFileVue[]
  seuilEchecs15Min: number
  genereLe: Date
}

/** Échec réduit à un code : le message de BullMQ n'est repris que s'il a DÉJÀ la forme d'un code (jamais un texte libre). */
export function motifDe(raisonBrute: string | undefined): string {
  return raisonBrute !== undefined && CODE_ECHEC_FORMAT.test(raisonBrute) ? raisonBrute : MOTIF_ECHEC_INCONNU
}

function versEchec(job: Job): JobEchecVue | null {
  if (job.id === undefined) return null
  return {
    id: job.id,
    nom: job.name.slice(0, 64),
    echecLe: job.finishedOn === undefined ? null : new Date(job.finishedOn),
    tentatives: job.attemptsMade,
    motif: motifDe(job.failedReason),
  }
}

async function lireEtatFile(file: FileSupervisee, maintenant: Date): Promise<EtatFileVue> {
  const queue = getQueueSupervisee(file)
  const [compteurs, echoues, echecs15Min] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'prioritized'),
    queue.getFailed(0, SUPERVISION_ECHECS_LISTES_MAX - 1),
    lireEchecsRecents(file, maintenant),
  ])
  return {
    file,
    compteurs: {
      attente: (compteurs.waiting ?? 0) + (compteurs.prioritized ?? 0),
      actifs: compteurs.active ?? 0,
      differes: compteurs.delayed ?? 0,
      echoues: compteurs.failed ?? 0,
      termines: compteurs.completed ?? 0,
    },
    echecs15Min,
    relancable: !FILES_NON_RELANCABLES.includes(file),
    echecs: echoues.flatMap((job) => {
      const echec = versEchec(job)
      return echec === null ? [] : [echec]
    }),
  }
}

export async function lireEtatFiles(maintenant: Date = new Date()): Promise<EtatFilesVue> {
  const [files, seuilEchecs15Min] = await Promise.all([
    Promise.all(FILES_SUPERVISEES.map((file) => lireEtatFile(file, maintenant))),
    Reglages.lire(REGLAGE_CLES.supervisionSeuilEchecs15Min),
  ])
  return { files, seuilEchecs15Min, genereLe: maintenant }
}

export interface EntreeRelance {
  file: FileSupervisee
  id: string
  motif: string
  cleIdempotence: string
}

/**
 * Relance un job `failed` : refusée pour `messages-auth` (code de connexion dans les données) et pour tout job qui
 * n'est pas en échec. Le journal est écrit dans la transaction ; `job.retry` n'est lancé qu'APRÈS le commit.
 */
export async function relancerJob(
  adminId: string,
  entree: EntreeRelance,
  ip: string,
  queue: Pick<Queue, 'getJob'> = getQueueSupervisee(entree.file),
): Promise<{ rejoue: boolean }> {
  if (FILES_NON_RELANCABLES.includes(entree.file)) throw new UnprocessableError('JOB_NON_RELANCABLE')
  const job = await queue.getJob(entree.id)
  const etat = job ? await job.getState() : null

  const aRelancer = await db.transaction(async (tx) => {
    const rejeu = await rejouerSiDejaFait(tx, adminId, entree.cleIdempotence, {
      action: ADMIN_ACTIONS.jobRelancer,
      cibleType: ADMIN_CIBLES.job,
      cibleId: entree.id,
      motif: entree.motif,
      parametres: { file: entree.file },
    })
    if (rejeu) return null
    if (!job) throw new NotFoundError('JOB_INTROUVABLE')
    if (etat !== 'failed') throw new UnprocessableError('JOB_NON_RELANCABLE')
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.jobRelancer,
      cibleType: ADMIN_CIBLES.job,
      cibleId: entree.id,
      avant: null,
      apres: { file: entree.file },
      motif: entree.motif,
      ip,
      cleIdempotence: entree.cleIdempotence,
    })
    return job
  })
  if (aRelancer === null) return { rejoue: true }
  await aRelancer.retry('failed')
  return { rejoue: false }
}

export interface EntreePurge {
  file: FileSupervisee
  motif: string
  limite: number
}

/** Purge bornée des jobs `failed` d'une file (réauthentification obligatoire). Journal d'abord, suppression après le commit. */
export async function purgerEchecs(
  adminId: string,
  entree: EntreePurge,
  ip: string,
  deps: DepsEcritureReauth,
  queue: Pick<Queue, 'clean'> = getQueueSupervisee(entree.file),
): Promise<number> {
  await db.transaction(async (tx) => {
    await deps.reauth(tx)
    await enregistrer(tx, {
      adminId,
      action: ADMIN_ACTIONS.jobPurger,
      cibleType: ADMIN_CIBLES.job,
      cibleId: entree.file,
      avant: null,
      apres: { file: entree.file, limite: entree.limite },
      motif: entree.motif,
      ip,
    })
  })
  const supprimes = await queue.clean(0, entree.limite, 'failed')
  return supprimes.length
}
