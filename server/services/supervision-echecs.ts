// A4 (D-A4-03) : compteur d'échecs DÉFINITIFS par file, tenu dans Redis par le worker, indépendant de `removeOnFail`
// (un job supprimé à l'échec ne disparaît pas du compteur). Une clé par (file, tranche de 5 min), expirant après 1 h.
// Fail-open : une panne de Redis n'a aucun effet sur le traitement des jobs.
import {
  SUPERVISION_ECHECS_CLE_PREFIXE,
  SUPERVISION_ECHECS_TTL_S,
  SUPERVISION_FENETRE_TRANCHES,
  SUPERVISION_TRANCHE_S,
} from '../../shared/jobs'
import { redis } from '../utils/redis'

const MS_PAR_SECONDE = 1_000

function tranche(maintenant: Date): number {
  return Math.floor(maintenant.getTime() / MS_PAR_SECONDE / SUPERVISION_TRANCHE_S)
}

function cle(file: string, numeroTranche: number): string {
  return `${SUPERVISION_ECHECS_CLE_PREFIXE}${file}:${numeroTranche}`
}

/** Incrémente le compteur de la tranche courante. Ne lève jamais. */
export async function enregistrerEchecFile(file: string, maintenant: Date = new Date()): Promise<void> {
  try {
    const clef = cle(file, tranche(maintenant))
    await redis.multi().incr(clef).expire(clef, SUPERVISION_ECHECS_TTL_S).exec()
  } catch {
    console.error('[supervision] compteur d\'échecs indisponible (SUPERVISION_COMPTEUR_ECHEC)')
  }
}

/** Échecs définitifs des 15 dernières minutes (3 tranches de 5 min). `0` si Redis ne répond pas. */
export async function lireEchecsRecents(file: string, maintenant: Date = new Date()): Promise<number> {
  try {
    const courante = tranche(maintenant)
    const cles = Array.from({ length: SUPERVISION_FENETRE_TRANCHES }, (_, i) => cle(file, courante - i))
    const valeurs = await redis.mget(cles)
    return valeurs.reduce((somme, valeur) => somme + (valeur === null ? 0 : Number.parseInt(valeur, 10) || 0), 0)
  } catch {
    return 0
  }
}
