// À importer EN PREMIER par tests/integration/setup.ts, AVANT tout module applicatif : `shared/env.ts` lit
// `process.env` une seule fois (au premier import de `server/utils/db`, `redis`), et `db`/`redis` créent leur
// connexion à l'import. En mode parallèle, ce module redirige ce worker vers SA base clonée, SON index Redis et
// SON dossier de médias. En mode série (nb de bases = 0), il ne change rien.
import {
  dossierMediasWorker,
  urlBaseClone,
  urlRedisWorker,
  VARIABLE_NB_BASES,
} from './bases-par-worker'

const nbBases = Number.parseInt(process.env[VARIABLE_NB_BASES] ?? '0', 10)

if (nbBases > 0) {
  // `VITEST_POOL_ID` : 1..maxWorkers, stable pour l'emplacement du worker (jamais plus grand que maxWorkers).
  const numero = Number.parseInt(process.env.VITEST_POOL_ID ?? '', 10)
  if (!Number.isInteger(numero) || numero < 1 || numero > nbBases) {
    throw new Error(
      `VITEST_POOL_ID="${process.env.VITEST_POOL_ID}" hors de 1..${nbBases} : isolation par worker impossible. `
        + 'Lancez la suite série (pnpm test:serie) ou corrigez maxWorkers dans vitest.config.ts.',
    )
  }
  // Idempotent : si le processus est réutilisé pour un autre fichier, on repart des valeurs d'ORIGINE (jamais `_w1_w1`).
  const origine = (cle: string): string | undefined => (process.env[`TESTS_ORIGINE_${cle}`] ??= process.env[cle])
  const urlBase = origine('DATABASE_URL')
  const urlRedis = origine('REDIS_URL')
  const dossier = origine('MEDIAS_DIR')
  if (!urlBase || !urlRedis || !dossier) {
    throw new Error('DATABASE_URL, REDIS_URL et MEDIAS_DIR doivent être définis pour l’isolation par worker.')
  }
  process.env.DATABASE_URL = urlBaseClone(urlBase, numero)
  process.env.REDIS_URL = urlRedisWorker(urlRedis, numero)
  process.env.MEDIAS_DIR = dossierMediasWorker(dossier, numero)
}
