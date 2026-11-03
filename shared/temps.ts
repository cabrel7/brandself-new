// Constantes de durée partagées (serveur et worker). Une seule source : aucun service ne redéfinit ces valeurs.

export const MS_PAR_SECONDE = 1_000
export const MS_PAR_MINUTE = 60 * MS_PAR_SECONDE
export const HEURE_MS = 3_600_000
export const JOUR_MS = 24 * HEURE_MS
export const SECONDES_PAR_JOUR = JOUR_MS / MS_PAR_SECONDE
