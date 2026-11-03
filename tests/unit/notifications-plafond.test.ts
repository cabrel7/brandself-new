import { describe, expect, it } from 'vitest'
import { RELATIONNEL_MAX_PAR_SEMAINE } from '../../shared/notifications'
import type { EmailCategorie, EmailStatut } from '../../shared/notifications'

// S9 §1 #88, §4.3, §9 / CA36, CA38 : « un seul e-mail relationnel par semaine ISO locale ». Règle PURE qui décide
// à partir des lignes existantes (la lecture en base et le verrou consultatif sont prouvés en intégration).
// NOM ET SIGNATURE SUPPOSÉS (la spec ne nomme que le fichier `plafond.ts`) :
//   plafondRelationnelAtteint(existantes, debutSemaine: Date, max = RELATIONNEL_MAX_PAR_SEMAINE): boolean
// où une ligne est { categorie, statut, createdAt }.

const plafond = () => import('../../server/services/notifications/plafond')

const DEBUT_SEMAINE = new Date('2026-11-01T23:00:00.000Z')
const DANS_LA_SEMAINE = new Date('2026-11-03T10:00:00.000Z')
const SEMAINE_PRECEDENTE = new Date('2026-10-30T10:00:00.000Z')

interface Ligne {
  categorie: EmailCategorie
  statut: EmailStatut
  createdAt: Date
}

function ligne(surcharge: Partial<Ligne> = {}): Ligne {
  return { categorie: 'relationnel', statut: 'envoye', createdAt: DANS_LA_SEMAINE, ...surcharge }
}

describe('plafondRelationnelAtteint', () => {
  it('should allow the first relational e-mail of the week (no line at all)', async () => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(plafondRelationnelAtteint([], DEBUT_SEMAINE)).toBe(false)
  })

  it('should refuse a second one when a relational line was created this ISO week (CA36)', async () => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(plafondRelationnelAtteint([ligne()], DEBUT_SEMAINE)).toBe(true)
  })

  it.each<EmailStatut>(['en_attente', 'en_cours', 'envoye', 'echec'])('should count a relational line in status %s', async (statut) => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(plafondRelationnelAtteint([ligne({ statut })], DEBUT_SEMAINE)).toBe(true)
  })

  it('should NOT count a cancelled line: an e-mail that never left leaves the quota free', async () => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(plafondRelationnelAtteint([ligne({ statut: 'annule' })], DEBUT_SEMAINE)).toBe(false)
  })

  it('should ignore transactional lines whatever their number (CA38)', async () => {
    const { plafondRelationnelAtteint } = await plafond()
    const transactionnelles = Array.from({ length: 10 }, () => ligne({ categorie: 'transactionnel' }))

    expect(plafondRelationnelAtteint(transactionnelles, DEBUT_SEMAINE)).toBe(false)
  })

  it('should ignore a relational line of a previous week', async () => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(plafondRelationnelAtteint([ligne({ createdAt: SEMAINE_PRECEDENTE })], DEBUT_SEMAINE)).toBe(false)
  })

  it('should count a line created exactly at the start of the week and ignore one created a millisecond before', async () => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(plafondRelationnelAtteint([ligne({ createdAt: DEBUT_SEMAINE })], DEBUT_SEMAINE)).toBe(true)
    expect(plafondRelationnelAtteint([ligne({ createdAt: new Date(DEBUT_SEMAINE.getTime() - 1) })], DEBUT_SEMAINE)).toBe(false)
  })

  it('should find the relational line among many other lines', async () => {
    const { plafondRelationnelAtteint } = await plafond()
    const lignes = [
      ligne({ categorie: 'transactionnel' }),
      ligne({ statut: 'annule' }),
      ligne({ createdAt: SEMAINE_PRECEDENTE }),
      ligne({ statut: 'en_attente' }),
    ]

    expect(plafondRelationnelAtteint(lignes, DEBUT_SEMAINE)).toBe(true)
  })

  it('should read the maximum from RELATIONNEL_MAX_PAR_SEMAINE (1) and honour an explicit maximum', async () => {
    const { plafondRelationnelAtteint } = await plafond()

    expect(RELATIONNEL_MAX_PAR_SEMAINE).toBe(1)
    expect(plafondRelationnelAtteint([ligne()], DEBUT_SEMAINE, 2)).toBe(false)
    expect(plafondRelationnelAtteint([ligne(), ligne()], DEBUT_SEMAINE, 2)).toBe(true)
  })

  it('should not mutate its input', async () => {
    const { plafondRelationnelAtteint } = await plafond()
    const lignes = [ligne(), ligne({ statut: 'annule' })]
    const copie = structuredClone(lignes)

    plafondRelationnelAtteint(lignes, DEBUT_SEMAINE)

    expect(lignes).toEqual(copie)
  })
})
