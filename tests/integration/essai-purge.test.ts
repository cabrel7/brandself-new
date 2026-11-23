import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { essais, essaisEmpreintes } from '../../shared/db/schema'
import { ESSAI_EMPREINTES_CONSERVATION_MOIS } from '../../shared/essai'
import { db } from '../../server/utils/db'
import { espionnerJournaux } from './support/planification'
import type { EspionJournaux } from './support/planification'
import { lireToutesLesEmpreintes, lireToutesLesEssais, moduleEssai } from './support/essai'

// E1 (décision produit : conservation des empreintes 24 mois). VRAIE base : le service passe par la fonction SQL
// `essais_empreintes_purger` (SECURITY DEFINER), seul chemin de suppression. Seule l'horloge est injectée.

let journaux: EspionJournaux | undefined
afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

const MOIS_MS = 30 * 86_400_000

function ilYaMois(maintenant: Date, mois: number): Date {
  return new Date(maintenant.getTime() - mois * MOIS_MS)
}

/** Empreinte hexadécimale unique de 64 caractères (format du CHECK), sans lien avec une valeur réelle. */
function empreinteAleatoire(): string {
  return `${randomUUID().replaceAll('-', '')}${randomUUID().replaceAll('-', '')}`
}

/** Un essai détaché de tout compte (le compte a été supprimé) et son empreinte, posée à `creeLe`. */
async function poserEssaiEtEmpreinte(creeLe: Date, convertiLe: Date | null = null): Promise<{ essaiId: string, empreinte: string }> {
  const essaiId = randomUUID()
  const empreinte = empreinteAleatoire()
  await db.insert(essais).values({ id: essaiId, userId: null, debutLe: creeLe, finLe: new Date(creeLe.getTime() + 14 * 86_400_000), dureeJours: 14, versionId: 'code', convertiLe })
  await db.insert(essaisEmpreintes).values({ empreinte, nature: 'email', essaiId, creeLe })
  return { essaiId, empreinte }
}

describe('purgerEmpreintesEssai (conservation 24 mois)', () => {
  it('should keep the retention at 24 months', () => {
    expect(ESSAI_EMPREINTES_CONSERVATION_MOIS).toBe(24)
  })

  it('should delete an empreinte 25 months old and keep one 23 months old, and return the number deleted', async () => {
    const { purgerEmpreintesEssai } = await moduleEssai()
    const maintenant = new Date()
    const vieille = await poserEssaiEtEmpreinte(ilYaMois(maintenant, 25))
    const recente = await poserEssaiEtEmpreinte(ilYaMois(maintenant, 23))

    const supprimees = await purgerEmpreintesEssai(maintenant)

    expect(supprimees).toBe(1)
    expect((await lireToutesLesEmpreintes()).map((e) => e.empreinte)).toEqual([recente.empreinte])
    expect((await lireToutesLesEmpreintes()).map((e) => e.empreinte)).not.toContain(vieille.empreinte)
  })

  it('should NEVER delete an essai, nor its conversion date, even when its empreinte is purged', async () => {
    const { purgerEmpreintesEssai } = await moduleEssai()
    const maintenant = new Date()
    const convertiLe = ilYaMois(maintenant, 26)
    const vieille = await poserEssaiEtEmpreinte(ilYaMois(maintenant, 27), convertiLe)
    await poserEssaiEtEmpreinte(ilYaMois(maintenant, 1))

    await purgerEmpreintesEssai(maintenant)

    const lignes = await lireToutesLesEssais()
    expect(lignes).toHaveLength(2)
    expect(lignes.find((l) => l.id === vieille.essaiId)?.convertiLe?.toISOString()).toBe(convertiLe.toISOString())
    expect(await lireToutesLesEmpreintes()).toHaveLength(1)
  })

  it('should return 0 and change nothing when no empreinte is old enough (idempotent)', async () => {
    const { purgerEmpreintesEssai } = await moduleEssai()
    const maintenant = new Date()
    await poserEssaiEtEmpreinte(ilYaMois(maintenant, 12))

    expect(await purgerEmpreintesEssai(maintenant)).toBe(0)
    expect(await purgerEmpreintesEssai(maintenant)).toBe(0)
    expect(await lireToutesLesEmpreintes()).toHaveLength(1)
  })

  it('should delete every old empreinte of an essai (e-mail and phone) in one pass', async () => {
    const { purgerEmpreintesEssai } = await moduleEssai()
    const maintenant = new Date()
    const { essaiId } = await poserEssaiEtEmpreinte(ilYaMois(maintenant, 30))
    await db.insert(essaisEmpreintes).values({ empreinte: empreinteAleatoire(), nature: 'telephone', essaiId, creeLe: ilYaMois(maintenant, 30) })

    expect(await purgerEmpreintesEssai(maintenant)).toBe(2)
    expect(await db.select().from(essaisEmpreintes).where(eq(essaisEmpreintes.essaiId, essaiId))).toHaveLength(0)
  })

  it('should refuse a direct DELETE of an empreinte, old or not: the SQL function is the only way', async () => {
    const maintenant = new Date()
    const vieille = await poserEssaiEtEmpreinte(ilYaMois(maintenant, 40))

    await expect(db.delete(essaisEmpreintes).where(eq(essaisEmpreintes.empreinte, vieille.empreinte))).rejects.toThrow()
    expect(await lireToutesLesEmpreintes()).toHaveLength(1)
  })

  it('should refuse (and not delete anything) when the threshold is more recent than 24 months, whatever the clock given', async () => {
    const { purgerEmpreintesEssai } = await moduleEssai()
    const maintenant = new Date()
    await poserEssaiEtEmpreinte(ilYaMois(maintenant, 25))
    // Horloge en avance de 2 mois : le seuil calculé est plus récent que `now() - 24 mois` côté base.
    const enAvance = new Date(maintenant.getTime() + 2 * MOIS_MS)

    await expect(purgerEmpreintesEssai(enAvance)).rejects.toThrow()
    expect(await lireToutesLesEmpreintes()).toHaveLength(1)
  })

  it('should log nothing from the service: the worker only prints a count, never an empreinte value', async () => {
    const { purgerEmpreintesEssai } = await moduleEssai()
    journaux = espionnerJournaux()
    const maintenant = new Date()
    const vieille = await poserEssaiEtEmpreinte(ilYaMois(maintenant, 25))

    await purgerEmpreintesEssai(maintenant)

    expect(journaux.contenu()).not.toContain(vieille.empreinte)
  })
})
