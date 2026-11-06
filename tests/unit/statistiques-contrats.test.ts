// S11 : contrats partagés (unitaires, aucune base).
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { schemaVuePublic, schemaStatistiquesQuery } from '../../shared/schemas/statistiques'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import { ERROR_MESSAGES } from '../../server/exceptions/http'

describe('schemaVuePublic (POST /vue)', () => {
  it('accepte un chemin valide et une origine absente', () => {
    expect(schemaVuePublic.parse({ chemin: '/dr-cabrel/services' })).toEqual({ chemin: '/dr-cabrel/services', origine: undefined })
  })
  it('accepte origine null', () => {
    expect(schemaVuePublic.parse({ chemin: '/', origine: null })).toEqual({ chemin: '/', origine: null })
  })
  it('refuse un chemin ne commençant pas par /', () => {
    expect(() => schemaVuePublic.parse({ chemin: 'dr-cabrel' })).toThrow(z.ZodError)
  })
  it('refuse un chemin avec majuscules', () => {
    expect(() => schemaVuePublic.parse({ chemin: '/dr-Cabrel' })).toThrow(z.ZodError)
  })
  it('refuse un chemin trop long (>300)', () => {
    expect(() => schemaVuePublic.parse({ chemin: '/'.padEnd(301, 'a') })).toThrow(z.ZodError)
  })
})

describe('schemaStatistiquesQuery (GET /statistiques)', () => {
  it.each([['7'], ['30'], ['90']] as const)('accepte période %s', (periode) => {
    expect(schemaStatistiquesQuery.parse({ periode })).toEqual({ periode })
  })
  it('refuse 14', () => {
    expect(() => schemaStatistiquesQuery.parse({ periode: '14' })).toThrow(z.ZodError)
  })
  it('refuse absence', () => {
    expect(() => schemaStatistiquesQuery.parse({})).toThrow(z.ZodError)
  })
})

describe('contrat d’erreur STATISTIQUES_PERIODE_INTERDITE', () => {
  it('est présent dans ERROR_CODES et ERROR_STATUS (403)', () => {
    expect(ERROR_CODES).toContain('STATISTIQUES_PERIODE_INTERDITE')
    expect(ERROR_STATUS.STATISTIQUES_PERIODE_INTERDITE).toBe(403)
  })
  it('a un message dans ERROR_MESSAGES (non vide, pas d’oracle)', () => {
    const msg = ERROR_MESSAGES.STATISTIQUES_PERIODE_INTERDITE
    expect(typeof msg).toBe('string')
    expect(msg.length).toBeGreaterThan(5)
    expect(msg).not.toMatch(/gratuit|payant|XAF|sel|hmac/i)
  })
})
