import { z } from 'zod'

/** '' ou espaces seuls -> null ; les autres chaînes sont rognées (même règle que schemas/vitrine). */
export function blankToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

/** Champ facultatif : une chaîne vide devient `null`. */
export function nullable<T extends z.ZodType>(schema: T) {
  return z.preprocess(blankToNull, schema.nullable())
}
