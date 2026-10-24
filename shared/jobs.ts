export const FILE_SYSTEME = 'systeme'

export const JOBS = {
  ping: 'ping',
} as const

export type NomJob = (typeof JOBS)[keyof typeof JOBS]
