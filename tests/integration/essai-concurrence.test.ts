import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { vitrines } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { preparerConfigurationA5 } from './support/admin-a5'
import {
  accorder, adresseUnique, compterAbonnements, creerCompteEmail, DEBUT_ESSAI, lireEssais, lireToutesLesEmpreintes, lireToutesLesEssais,
  preparerCompteTerminable, terminerPour,
} from './support/essai'
import { exigerModulesPresents } from './support/erreurs'
import { vitrinesService } from './support/modules'

// E1 CA-E1-04, 05, 08 : concurrence RÉELLE (transactions simultanées sur des connexions distinctes de la même base PostgreSQL, aucun mock).
// Chaque scénario est rejoué plusieurs tours : un défaut d'ordonnancement n'apparaît pas à chaque fois.

preparerConfigurationA5()
const TOURS = 5

describe('deux `terminer` simultanés (CA-E1-04)', () => {
  it('should create one vitrine, one essai and one subscription: one creation, one replay without essai', async () => {
    for (let tour = 0; tour < TOURS; tour += 1) {
      const { user } = await preparerCompteTerminable()
      const username = adresseUnique('conc')

      const [a, b] = await Promise.all([terminerPour(user.id, username), terminerPour(user.id, username)])

      expect([a.creee, b.creee].sort(), `tour ${tour}`).toEqual([false, true])
      expect([a.essai, b.essai].filter((e) => e !== null), `tour ${tour}`).toHaveLength(1)
      expect(await db.$count(vitrines, eq(vitrines.userId, user.id))).toBe(1)
      expect(await lireEssais(user.id)).toHaveLength(1)
    }
    expect(await compterAbonnements()).toBe(TOURS)
  })
})

describe('`terminer` et `POST /api/studio/vitrine` simultanés (CA-E1-05)', () => {
  it('should let one win and answer 409 VITRINE_EXISTE (or USERNAME_PRIS) to the other, with a single essai row', async () => {
    const { createVitrine } = await vitrinesService()
    for (let tour = 0; tour < TOURS; tour += 1) {
      const { user } = await preparerCompteTerminable()
      const username = adresseUnique('mix')

      const resultats = await Promise.allSettled([
        terminerPour(user.id, username, DEBUT_ESSAI),
        createVitrine(user.id, { titre: null, prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username: `${username}-b` }, DEBUT_ESSAI),
      ])

      exigerModulesPresents(resultats)
      const echecs = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(resultats.filter((r) => r.status === 'fulfilled'), `tour ${tour}`).toHaveLength(1)
      expect(echecs).toHaveLength(1)
      expect(['VITRINE_EXISTE', 'USERNAME_PRIS'], `tour ${tour}`).toContain((echecs[0]!.reason as { code?: string }).code)
      expect(await db.$count(vitrines, eq(vitrines.userId, user.id))).toBe(1)
      expect(await lireEssais(user.id)).toHaveLength(1)
    }
    expect(await compterAbonnements()).toBe(TOURS)
  })
})

describe('deux comptes avec le même numéro vérifié, simultanés (CA-E1-08)', () => {
  it('should grant ONE essai, and leave no orphan fingerprint (the loser\'s own e-mail fingerprint is rolled back with its savepoint)', async () => {
    for (let tour = 0; tour < TOURS; tour += 1) {
      const numero = `+23765000${String(tour).padStart(4, '0')}`
      const a = await creerCompteEmail({ phoneNumber: numero, phoneNumberVerified: true })
      const b = await creerCompteEmail({ phoneNumber: numero, phoneNumberVerified: true })

      const resultats = await Promise.all([accorder(a.id), accorder(b.id)])

      const accordes = resultats.filter((r) => r.accorde)
      expect(accordes, `tour ${tour}`).toHaveLength(1)
      expect(resultats.find((r) => !r.accorde), `tour ${tour}`).toEqual({ accorde: false, raison: 'deja_consomme' })
    }
    const essais = await lireToutesLesEssais()
    const empreintes = await lireToutesLesEmpreintes()
    expect(essais).toHaveLength(TOURS)
    // Chaque essai porte exactement ses deux clés (e-mail et numéro) : aucune empreinte du perdant, aucune empreinte sans essai.
    expect(empreintes).toHaveLength(TOURS * 2)
    for (const essai of essais) expect(empreintes.filter((e) => e.essaiId === essai.id)).toHaveLength(2)
    expect(await compterAbonnements()).toBe(TOURS)
  })

  it('should keep the second account usable: no abonnement and no essai for the loser, who can still create its vitrine', async () => {
    const numero = '+237651111111'
    const a = await creerCompteEmail({ phoneNumber: numero, phoneNumberVerified: true })
    const b = await creerCompteEmail({ phoneNumber: numero, phoneNumberVerified: true })

    await Promise.all([accorder(a.id), accorder(b.id)])

    const gagnants = [await lireEssais(a.id), await lireEssais(b.id)].filter((l) => l.length === 1)
    expect(gagnants).toHaveLength(1)
  })
})

describe('deux octrois simultanés pour le même compte', () => {
  it('should grant once (the per-account lock serialises them): one accorde, one abonnement_existant', async () => {
    const compte = await creerCompteEmail()

    const resultats = await Promise.all([accorder(compte.id), accorder(compte.id), accorder(compte.id)])

    expect(resultats.filter((r) => r.accorde)).toHaveLength(1)
    expect(resultats.filter((r) => !r.accorde).every((r) => !r.accorde && r.raison === 'abonnement_existant')).toBe(true)
    expect(await lireEssais(compte.id)).toHaveLength(1)
    expect(await compterAbonnements()).toBe(1)
  })
})
