import type { PreferenceEmail } from '../notifications'
import type { NextStep } from '../vitrine'

/** `GET /api/studio/prochaine-etape` et `POST …/ignorer` (la suivante). */
export interface ProchaineEtapeDTO {
  etape: NextStep | null
}

/** `GET /api/public/desabonnement` : aperçu sans effet, ne révèle ni e-mail ni nom. */
export interface DesabonnementApercuDTO {
  preference: PreferenceEmail
}

/** `POST /api/public/desabonnement`. */
export interface DesabonnementDTO {
  preference: PreferenceEmail
  desabonne: true
}

/** `POST /api/studio/vitrine/partage` : date ISO du premier partage. */
export interface PartageDTO {
  partageeLe: string
}
