// Forme d'un username : doit rester identique à la contrainte `vitrines_username_format_check`
// (migration 0009) et à `schemaUsername` (shared/schemas/username.ts). Les mots réservés ne sont
// PAS vérifiés ici : un mot réservé après coup ne retire pas une vitrine existante (spec S2 §10).
export const USERNAME_MIN_LENGTH = 3
export const USERNAME_MAX_LENGTH = 30
const USERNAME_FORMAT_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Vrai si la valeur (déjà normalisée) respecte longueur et alphabet. */
export function hasValidUsernameFormat(username: string): boolean {
  return (
    username.length >= USERNAME_MIN_LENGTH
    && username.length <= USERNAME_MAX_LENGTH
    && USERNAME_FORMAT_RE.test(username)
  )
}
