import { describe, expect, it, vi } from 'vitest'
import { codeHttpSante, type EtatSante } from '../server/services/health'

vi.mock('../server/utils/db', () => ({ db: { execute: vi.fn() } }))
vi.mock('../server/utils/redis', () => ({ redis: { ping: vi.fn() } }))


const etat = (statut: EtatSante['statut']): EtatSante => ({ statut, base: true, redis: true, version: '0.0.0' })

describe('codeHttpSante', () => {
  it('renvoie 200 quand tout est ok', () => {
    expect(codeHttpSante(etat('ok'))).toBe(200)
  })
  it('renvoie 503 quand le service est dégradé', () => {
    expect(codeHttpSante(etat('degrade'))).toBe(503)
  })
})
