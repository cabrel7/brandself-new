import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { schemaMoiUpdate } from '../../shared/schemas/moi'
import { schemaUsernameQuery } from '../../shared/schemas/username'
import { fakeEvent } from '../support/h3'

// server/utils/validation.ts — readBodyWith / readQueryWith / readParamsWith (safeParse -> ValidationError 400).
// L'ordre des arguments (event, schéma) suit l'usage naturel ; la spec ne le fixe pas explicitement.
const validation = () => import('../../server/utils/validation')

// Ces utilitaires lèvent une erreur métier (DomainError : `code` + `data.champs`) ; c'est
// defineApiHandler qui la traduit ensuite en H3Error (`data.code`). On accepte donc les deux formes.
async function rejet(promesse: Promise<unknown>): Promise<{ status: number | undefined, code: string | undefined, data: Record<string, unknown> | undefined, message: string }> {
  try {
    await promesse
  } catch (erreur) {
    const e = erreur as { status?: number, statusCode?: number, code?: string, data?: Record<string, unknown>, message?: string }
    const code = typeof e.code === 'string' ? e.code : (e.data?.code as string | undefined)
    return { status: e.status ?? e.statusCode, code, data: e.data, message: e.message ?? '' }
  }
  throw new Error('La promesse devait être rejetée mais elle a abouti.')
}

describe('readQueryWith', () => {
  it('should return the parsed query when it is valid', async () => {
    const { readQueryWith } = await validation()

    const requete = await readQueryWith(fakeEvent({ url: '/api/studio/username-disponible?username=dr-test' }), schemaUsernameQuery)

    expect(requete).toEqual({ username: 'dr-test' })
  })

  it('should throw a 400 VALIDATION error listing the invalid fields', async () => {
    const { readQueryWith } = await validation()
    const longue = 'a'.repeat(65)

    const erreur = await rejet(Promise.resolve().then(() => readQueryWith(fakeEvent({ url: `/x?username=${longue}` }), schemaUsernameQuery)))

    expect(erreur.status).toBe(400)
    expect(erreur.code).toBe('VALIDATION')
    expect(Object.keys((erreur.data?.champs as Record<string, unknown>) ?? {})).toEqual(['username'])
  })

  it('should throw a 400 when the parameter is missing', async () => {
    const { readQueryWith } = await validation()

    const erreur = await rejet(Promise.resolve().then(() => readQueryWith(fakeEvent({ url: '/x' }), schemaUsernameQuery)))

    expect(erreur.status).toBe(400)
    expect(erreur.code).toBe('VALIDATION')
  })

  it('should throw a 400 when the parameter is repeated (array instead of string)', async () => {
    const { readQueryWith } = await validation()

    const erreur = await rejet(Promise.resolve().then(() => readQueryWith(fakeEvent({ url: '/x?username=a&username=b' }), schemaUsernameQuery)))

    expect(erreur.status).toBe(400)
  })
})

describe('readParamsWith', () => {
  const schemaId = z.object({ id: z.uuid() })

  it('should return the route params when they are valid', async () => {
    const { readParamsWith } = await validation()
    const id = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'

    const params = await readParamsWith(fakeEvent({ params: { id } }), schemaId)

    expect(params).toEqual({ id })
  })

  it.each(['pas-un-uuid', '../../etc/passwd', '123'])('should throw a 400 VALIDATION error for the param %j', async (id) => {
    const { readParamsWith } = await validation()

    const erreur = await rejet(Promise.resolve().then(() => readParamsWith(fakeEvent({ params: { id } }), schemaId)))

    expect(erreur.status).toBe(400)
    expect(erreur.code).toBe('VALIDATION')
  })

  it('should throw a 400 when the param is absent', async () => {
    const { readParamsWith } = await validation()

    const erreur = await rejet(Promise.resolve().then(() => readParamsWith(fakeEvent(), schemaId)))

    expect(erreur.status).toBe(400)
  })
})

describe('readBodyWith', () => {
  it('should return the parsed body when it is valid', async () => {
    const { readBodyWith } = await validation()

    const corps = await readBodyWith(fakeEvent({ method: 'PUT', body: JSON.stringify({ devise: 'EUR' }) }), schemaMoiUpdate)

    expect(corps).toEqual({ devise: 'EUR' })
  })

  it('should throw a 400 VALIDATION error with per-field messages when the body is invalid', async () => {
    const { readBodyWith } = await validation()

    const erreur = await rejet(readBodyWith(fakeEvent({ method: 'PUT', body: JSON.stringify({ devise: 'GBP' }) }), schemaMoiUpdate))

    expect(erreur.status).toBe(400)
    expect(erreur.code).toBe('VALIDATION')
    expect(Object.keys((erreur.data?.champs as Record<string, unknown>) ?? {})).toContain('devise')
  })

  it('should throw a 400 (not a 500) for a malformed JSON body', async () => {
    const { readBodyWith } = await validation()

    const erreur = await rejet(readBodyWith(fakeEvent({ method: 'PUT', body: '{"devise": ' }), schemaMoiUpdate))

    expect(erreur.status).toBe(400)
  })

  it('should throw a 400 when there is no body at all', async () => {
    const { readBodyWith } = await validation()

    const erreur = await rejet(readBodyWith(fakeEvent({ method: 'PUT' }), schemaMoiUpdate))

    expect(erreur.status).toBe(400)
  })

  it('should throw a 400 for a body with a forbidden extra key (strict schema)', async () => {
    const { readBodyWith } = await validation()

    const erreur = await rejet(readBodyWith(fakeEvent({ method: 'PUT', body: JSON.stringify({ devise: 'EUR', userId: 'autre' }) }), schemaMoiUpdate))

    expect(erreur.status).toBe(400)
  })
})
