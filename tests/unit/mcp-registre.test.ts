import { describe, expect, it } from 'vitest'
import { MCP_OUTILS_MAX, MCP_PORTEES } from '../../shared/mcp'
import { JOURS_SEMAINE_LIBELLES } from '../../shared/agenda'
import { OUTILS_MCP, trouverOutil } from '../../server/mcp/tools'

const INTERDITS = ['supprimer', 'publier', 'confirmer', 'annuler', 'repondre', 'envoyer']
const NOUVEAUX = ['obtenir_agenda', 'lister_creneaux_libres', 'lister_demandes']

function schemaDe(nom: string) {
  const outil = trouverOutil(nom)
  if (!outil) throw new Error(`Outil inconnu : ${nom}`)
  return outil.schema
}

describe('registre des outils MCP (CA-T1)', () => {
  it('should expose at most MCP_OUTILS_MAX tools, and exactly 12 today', () => {
    expect(OUTILS_MCP.length).toBeLessThanOrEqual(MCP_OUTILS_MAX)
    expect(OUTILS_MCP).toHaveLength(12)
  })

  it('should have unique names', () => {
    expect(new Set(OUTILS_MCP.map((o) => o.nom)).size).toBe(OUTILS_MCP.length)
  })

  it('should only require known scopes', () => {
    for (const outil of OUTILS_MCP) {
      expect(outil.scopes.length).toBeGreaterThan(0)
      for (const portee of outil.scopes) expect(MCP_PORTEES).toContain(portee)
    }
  })

  it.each(INTERDITS)('should have no tool whose name contains « %s »', (mot) => {
    expect(OUTILS_MCP.filter((o) => o.nom.includes(mot))).toEqual([])
  })

  it('should have a French description on every tool', () => {
    for (const outil of OUTILS_MCP) expect(outil.description.length).toBeGreaterThan(20)
  })

  it.each(NOUVEAUX)('should declare %s read-only without idempotency key', (nom) => {
    expect(trouverOutil(nom)).toMatchObject({ annotation: 'lecture seule', idempotence: false })
  })

  it('should give the new tools the right scopes', () => {
    expect(trouverOutil('obtenir_agenda')?.scopes).toEqual(['vitrine:lecture'])
    expect(trouverOutil('lister_creneaux_libres')?.scopes).toEqual(['vitrine:lecture'])
    expect(trouverOutil('lister_demandes')?.scopes).toEqual(['reservations:lecture'])
  })

  it('should number the weekdays 1 = lundi … 7 = dimanche', () => {
    expect(JOURS_SEMAINE_LIBELLES[1]).toBe('lundi')
    expect(JOURS_SEMAINE_LIBELLES[7]).toBe('dimanche')
    expect(Object.keys(JOURS_SEMAINE_LIBELLES)).toHaveLength(7)
  })
})

describe('schémas d’entrée des outils de lecture', () => {
  it.each(['obtenir_vitrine', 'obtenir_agenda', 'lister_services'])('should reject any argument on %s', (nom) => {
    expect(schemaDe(nom).safeParse({}).success).toBe(true)
    expect(schemaDe(nom).safeParse({ username: 'autre' }).success).toBe(false)
  })

  it('should never accept a username or vitrine id in any new tool', () => {
    const base: Record<string, Record<string, unknown>> = {
      lister_creneaux_libres: { service: 'seance', du: '2026-11-04', au: '2026-11-05' },
      lister_demandes: {},
      lister_reservations: {},
    }
    for (const [nom, entree] of Object.entries(base)) {
      expect(schemaDe(nom).safeParse(entree).success).toBe(true)
      expect(schemaDe(nom).safeParse({ ...entree, username: 'autre' }).success).toBe(false)
      expect(schemaDe(nom).safeParse({ ...entree, vitrineId: 'v' }).success).toBe(false)
    }
  })
})

describe('lister_creneaux_libres : entrée', () => {
  const schema = () => schemaDe('lister_creneaux_libres')
  const base = { service: 'seance-decouverte', du: '2026-11-04', au: '2026-11-05' }

  it('should accept a range of up to 14 days', () => {
    expect(schema().safeParse({ ...base, au: '2026-11-17' }).success).toBe(true)
  })

  it('should refuse a range of more than 14 days', () => {
    expect(schema().safeParse({ ...base, au: '2026-11-18' }).success).toBe(false)
  })

  it('should refuse an end date before the start date', () => {
    expect(schema().safeParse({ ...base, du: '2026-11-05', au: '2026-11-04' }).success).toBe(false)
  })

  it.each(['Seance Decouverte', '../etc', '', 'a--b', 'UPPER'])('should refuse the service slug %j', (service) => {
    expect(schema().safeParse({ ...base, service }).success).toBe(false)
  })

  it('should refuse an invalid date and an unknown argument', () => {
    expect(schema().safeParse({ ...base, du: '04/11/2026' }).success).toBe(false)
    expect(schema().safeParse({ ...base, extra: 1 }).success).toBe(false)
  })
})

describe('lister_reservations et lister_demandes : entrée', () => {
  it('should apply the defaults', () => {
    expect(schemaDe('lister_reservations').parse({})).toEqual({ periode: 'a_venir', limite: 20 })
    expect(schemaDe('lister_demandes').parse({})).toEqual({ limite: 20 })
  })

  it.each([0, 51, 1.5, -1])('should refuse the limit %s', (limite) => {
    expect(schemaDe('lister_reservations').safeParse({ limite }).success).toBe(false)
    expect(schemaDe('lister_demandes').safeParse({ limite }).success).toBe(false)
  })

  it('should refuse an unknown status or period', () => {
    expect(schemaDe('lister_reservations').safeParse({ statut: 'inconnu' }).success).toBe(false)
    expect(schemaDe('lister_reservations').safeParse({ periode: 'demain' }).success).toBe(false)
    expect(schemaDe('lister_demandes').safeParse({ statut: 'confirmee' }).success).toBe(false)
  })
})
