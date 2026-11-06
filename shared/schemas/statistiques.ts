import { z } from 'zod'

/** Corps de POST /api/public/[username]/vue : le navigateur envoie le chemin affiché, jamais une URL complète. */
export const schemaVuePublic = z.object({
  chemin: z.string().min(1).max(300).regex(/^\/[a-z0-9\-/]*$/),
  origine: z.string().max(500).nullish(),
})

export const schemaStatistiquesQuery = z.object({
  periode: z.enum(['7', '30', '90']),
})
