import { getQuery, getRouterParams, readBody } from 'h3'
import type { H3Event } from 'h3'
import { z } from 'zod'
import { ValidationError } from '../exceptions/http'

function parseWith<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input)
  if (result.success) {
    return result.data
  }
  const { fieldErrors, formErrors } = z.flattenError(result.error)
  // Erreur « globale » (objet vide, clé interdite) : on affiche son message plutôt qu'un texte générique.
  if (Object.keys(fieldErrors).length === 0 && formErrors.length > 0) {
    throw new ValidationError(fieldErrors, formErrors[0])
  }
  throw new ValidationError(fieldErrors)
}

export async function readBodyWith<S extends z.ZodType>(event: H3Event, schema: S): Promise<z.output<S>> {
  let body: unknown
  try {
    body = await readBody(event)
  } catch {
    // JSON mal formé : même réponse qu'un corps invalide (400), jamais une 500.
    body = undefined
  }
  return parseWith(schema, body)
}

export function readQueryWith<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  return parseWith(schema, getQuery(event))
}

export function readParamsWith<S extends z.ZodType>(event: H3Event, schema: S): z.output<S> {
  return parseWith(schema, getRouterParams(event, { decode: true }))
}
