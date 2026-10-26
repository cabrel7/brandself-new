const SUFFIXE_BASE_TEST = '_test'
const INDEX_REDIS_TEST = '15'

/** Lève une erreur claire si l'URL ne vise pas une base dont le nom finit par `_test`. */
export function assertBaseDeTest(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL est absente : les tests d’intégration exigent une base PostgreSQL dédiée '
        + '(nom finissant par "_test"). Copiez .env.test.example vers .env.test ou exportez la variable.',
    )
  }
  let nomBase: string
  try {
    nomBase = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''))
  } catch {
    throw new Error('DATABASE_URL n’est pas une URL valide.')
  }
  if (!nomBase.endsWith(SUFFIXE_BASE_TEST)) {
    throw new Error(
      `Refus d’exécuter les tests d’intégration : la base "${nomBase}" ne finit pas par "${SUFFIXE_BASE_TEST}". `
        + 'Ces tests vident les tables : ils ne tournent que sur une base de test.',
    )
  }
  return nomBase
}

/** Redis : on exige la base /15 pour ne jamais toucher aux clés de développement. */
export function assertRedisDeTest(redisUrl: string | undefined): void {
  if (!redisUrl) {
    throw new Error('REDIS_URL est absente : les tests d’intégration exigent un Redis de test (base /15).')
  }
  let indexBase: string
  try {
    indexBase = new URL(redisUrl).pathname.replace(/^\//, '')
  } catch {
    throw new Error('REDIS_URL n’est pas une URL valide.')
  }
  if (indexBase !== INDEX_REDIS_TEST) {
    throw new Error(
      `Refus d’exécuter les tests d’intégration : REDIS_URL vise la base "${indexBase || '0'}", `
        + `attendue "/${INDEX_REDIS_TEST}".`,
    )
  }
}
