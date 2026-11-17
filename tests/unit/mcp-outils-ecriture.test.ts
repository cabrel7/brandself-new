import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DomainError } from '../../server/exceptions/http'

// On ne mocke que la couche HORS périmètre des critères (services et base) : ce qu'on prouve ici, c'est
// le schéma d'entrée des outils et ce que les handlers transmettent aux services.
const getOwnRealisation = vi.fn()
const updateRealisation = vi.fn()
const getOwnService = vi.fn()
const updateService = vi.fn()

vi.mock('../../server/services/realisations', () => ({
  getOwnRealisation: (...a: unknown[]) => getOwnRealisation(...a),
  updateRealisation: (...a: unknown[]) => updateRealisation(...a),
  createRealisation: vi.fn(),
}))
vi.mock('../../server/services/services', () => ({
  getOwnService: (...a: unknown[]) => getOwnService(...a),
  updateService: (...a: unknown[]) => updateService(...a),
  createService: vi.fn(),
}))
vi.mock('../../server/utils/db', () => ({ db: {} }))

const { trouverOutil } = await import('../../server/mcp/tools')
const modifierRealisation = await import('../../server/mcp/tools/modifier-realisation')
const modifierService = await import('../../server/mcp/tools/modifier-service')

const ID = '11111111-1111-4111-8111-111111111111'
const IMG = '22222222-2222-4222-8222-222222222222'
const CONTEXTE = {
  userId: 'u1',
  vitrineId: 'v1',
  username: 'demo',
  fuseau: 'Africa/Douala',
  assistantId: 'a1',
  scopes: ['contenu:ecriture'],
} as const

function schemaDe(nom: string) {
  const outil = trouverOutil(nom)
  if (!outil) throw new Error(`Outil inconnu : ${nom}`)
  return outil.schema
}

function realisationExistante(actif: boolean) {
  return { item: { realisation: { id: ID, titre: 'Avant', actif, source: 'assistant' } } }
}
function serviceExistant(actif: boolean) {
  return { item: { service: { id: ID, titre: 'Avant', actif, source: 'assistant' } } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('MCP : publication interdite', () => {
  const entrees: Array<[string, Record<string, unknown>]> = [
    ['creer_service', { titre: 'T', type: 'rdv', tarif: 'gratuit', cle_idempotence: 'k' }],
    ['creer_realisation', { titre: 'T', cle_idempotence: 'k' }],
    ['modifier_service', { id: ID }],
    ['modifier_realisation', { id: ID }],
  ]

  it.each(entrees)('should reject an `actif` argument on %s', (nom, base) => {
    const resultat = schemaDe(nom).safeParse({ ...base, actif: true })
    expect(resultat.success).toBe(false)
  })

  it.each(entrees)('should accept the same input without `actif` on %s', (nom, base) => {
    expect(schemaDe(nom).safeParse(base).success).toBe(true)
  })
})

describe('modifier_realisation : un champ omis n’écrase jamais', () => {
  it('should pass galerie as undefined when it is omitted', async () => {
    getOwnRealisation.mockResolvedValue(realisationExistante(false))
    await modifierRealisation.executer({ id: ID, titre: 'Nouveau' }, CONTEXTE)

    const patch = updateRealisation.mock.calls[0]?.[2] as Record<string, unknown>
    expect(patch.galerie).toBeUndefined()
    expect(patch.imageMediaId).toBeUndefined()
    expect(patch.titre).toBe('Nouveau')
    expect('actif' in patch).toBe(false)
  })

  it('should pass the galerie as given when it is provided', async () => {
    getOwnRealisation.mockResolvedValue(realisationExistante(false))
    await modifierRealisation.executer({ id: ID, galerie: [IMG] }, CONTEXTE)

    expect((updateRealisation.mock.calls[0]?.[2] as Record<string, unknown>).galerie).toEqual([IMG])
  })
})

describe('modifier_service : un champ omis n’écrase jamais', () => {
  it('should send only the provided fields as defined values', async () => {
    getOwnService.mockResolvedValue(serviceExistant(false))
    await modifierService.executer({ id: ID, titre: 'Nouveau' }, CONTEXTE)

    const patch = updateService.mock.calls[0]?.[2] as Record<string, unknown>
    const definis = Object.entries(patch).filter(([, valeur]) => valeur !== undefined)
    expect(definis).toEqual([['titre', 'Nouveau']])
  })
})

describe('MCP : confirmation requise sur un contenu déjà visible', () => {
  it('should throw a readable DomainError for a visible realisation without confirmation', async () => {
    getOwnRealisation.mockResolvedValue(realisationExistante(true))
    const erreur = await modifierRealisation.executer({ id: ID, titre: 'X' }, CONTEXTE).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(DomainError)
    expect((erreur as DomainError).message).toContain('confirmation')
    expect(updateRealisation).not.toHaveBeenCalled()
  })

  it('should throw a readable DomainError for a visible service without confirmation', async () => {
    getOwnService.mockResolvedValue(serviceExistant(true))
    const erreur = await modifierService.executer({ id: ID, titre: 'X' }, CONTEXTE).catch((e: unknown) => e)

    expect(erreur).toBeInstanceOf(DomainError)
    expect((erreur as DomainError).message).toContain('confirmation')
    expect(updateService).not.toHaveBeenCalled()
  })

  it('should update a visible realisation once the user confirmed', async () => {
    getOwnRealisation.mockResolvedValue(realisationExistante(true))
    await modifierRealisation.executer({ id: ID, titre: 'X', confirmation_utilisateur: true }, CONTEXTE)

    expect(updateRealisation).toHaveBeenCalledTimes(1)
  })
})

describe('MCP : lien d’une réalisation', () => {
  it.each(['creer_realisation', 'modifier_realisation'])('should reject a javascript: link on %s', (nom) => {
    const base = nom === 'creer_realisation' ? { titre: 'T', cle_idempotence: 'k' } : { id: ID }
    expect(schemaDe(nom).safeParse({ ...base, lien: 'javascript:alert(1)' }).success).toBe(false)
  })

  it('should accept an https link and normalise a bare domain', () => {
    const schema = schemaDe('modifier_realisation')
    const ok = schema.safeParse({ id: ID, lien: 'https://exemple.com' })
    const nu = schema.safeParse({ id: ID, lien: 'exemple.com' })
    expect(ok.success).toBe(true)
    expect(nu.success && (nu.data as { lien: string }).lien).toBe('https://exemple.com')
  })
})
