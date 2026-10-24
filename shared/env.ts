import { z } from 'zod'

const schemaEnv = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url('doit être une URL PostgreSQL valide'),
  REDIS_URL: z.url('doit être une URL Redis valide'),
})

export type Env = z.infer<typeof schemaEnv>

export function chargerEnv(source: Record<string, string | undefined>): Env {
  const resultat = schemaEnv.safeParse(source)
  if (!resultat.success) {
    const problemes = resultat.error.issues
      .map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`)
      .join('\n  - ')
    throw new Error(
      `Configuration invalide — corrige les variables d'environnement :\n  - ${problemes}`,
    )
  }
  return resultat.data
}

export const env = chargerEnv(process.env)
