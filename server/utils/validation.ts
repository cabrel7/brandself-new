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

/**
 * Corps déjà intégralement reçu dans le flux (petit JSON arrivé avec les en-têtes, cas
 * courant d'un formulaire) : la chaîne de gardes d'une route publique peut alors
 * s'enchaîner sans attendre le réseau. Retourne undefined si le corps est absent ou
 * partiellement arrivé — les octets lus sont alors remis en tête du flux pour la
 * lecture asynchrone de h3, qui attendra la fin.
 */
function corpsBrutComplet(event: H3Event): Buffer | undefined {
  const requete = event.node.req
  const taille = Number.parseInt(requete.headers['content-length'] ?? '', 10)
  if (!Number.isInteger(taille) || taille <= 0) return undefined
  const morceaux: Buffer[] = []
  let recu = 0
  let morceau: Buffer | null
  while ((morceau = requete.read()) !== null) {
    morceaux.push(morceau)
    recu += morceau.length
    if (recu >= taille) break
  }
  if (recu < taille) {
    for (const partiel of morceaux.reverse()) requete.unshift(partiel)
    return undefined
  }
  return Buffer.concat(morceaux, taille)
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

/**
 * Lecture et validation immédiates du corps : valeur synchronement disponible quand le
 * corps est déjà reçu, promesse (même comportement que `readBodyWith`) sinon. Les routes
 * publiques qui enchaînent des gardes ordonnées l'utilisent pour que la garde suivante
 * s'exécute dès que la précédente aboutit, sans tick réseau intermédiaire.
 */
export function readBodyImmediateWith<S extends z.ZodType>(
  event: H3Event,
  schema: S,
): z.output<S> | Promise<z.output<S>> {
  const brut = corpsBrutComplet(event)
  if (brut === undefined) return readBodyWith(event, schema)
  let body: unknown
  try {
    body = brut.length === 0 ? undefined : JSON.parse(brut.toString('utf8'))
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
