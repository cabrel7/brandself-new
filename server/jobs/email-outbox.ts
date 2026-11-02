import type { JobsOptions, Queue } from 'bullmq'
import {
  JOBS,
  TRANSACTIONAL_EMAIL_BACKOFF_MS,
  TRANSACTIONAL_EMAIL_MAX_ATTEMPTS,
} from '../../shared/jobs'
import type { TransactionalEmailJobData } from '../../shared/jobs'
import { listDispatchableTransactionalEmailIds } from '../services/email-outbox'

const JOB_ID_PREFIX = 'email-outbox-'

export const transactionalEmailJobOptions: JobsOptions = {
  attempts: TRANSACTIONAL_EMAIL_MAX_ATTEMPTS,
  backoff: {
    type: 'exponential',
    delay: TRANSACTIONAL_EMAIL_BACKOFF_MS,
  },
  removeOnComplete: true,
  removeOnFail: true,
}

export function transactionalEmailJobId(outboxId: string): string {
  return `${JOB_ID_PREFIX}${outboxId}`
}

export async function enqueueTransactionalEmail(
  queue: Queue,
  outboxId: string,
): Promise<void> {
  const data: TransactionalEmailJobData = { outboxId }
  await queue.add(JOBS.sendTransactionalEmail, data, {
    ...transactionalEmailJobOptions,
    jobId: transactionalEmailJobId(outboxId),
  })
}

export async function dispatchPendingTransactionalEmails(
  queue: Queue,
  now: Date = new Date(),
): Promise<number> {
  const ids = await listDispatchableTransactionalEmailIds(now)
  await Promise.all(ids.map((id) => enqueueTransactionalEmail(queue, id)))
  return ids.length
}
