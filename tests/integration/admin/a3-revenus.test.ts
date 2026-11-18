import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { REVENUS_MENTION_INCERTITUDE } from '../../../shared/admin-paiements'
import { schemaRevenusDto } from '../../../shared/schemas/admin-paiements'
import type { RevenuDeviseDto } from '../../../shared/schemas/admin-paiements'
import { insererPaiement, jours, plus, poserAbonnement } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import {
  appelerAdmin,
  debutMoisDouala,
  desinstallerAdmin,
  HEURE_MS,
  insererEncaissement,
  insererLigneJournal,
  insererPaiementManuel,
  installerAdmin,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 CA07, CA14, D-A3-01/02 : revenus par DEVISE, en entiers, jamais d'addition entre devises. « Encaissé K-PAY » = somme de
// `montant` des paiements `source = 'fournisseur'` et `statut = 'reussi'`, bornée par `applique_le` dans le mois local (Africa/Douala).
// Les `manuel` sont à part ; `cree`, `en_attente`, `expire`, `echoue`, `annule`, `anomalie` ne sont jamais comptés. La route lit
// l'horloge système : les paiements sont posés par rapport au mois courant réel.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const revenus = () => appelerAdmin(ROUTES.revenus, connecte, { chemin: '/api/admin/revenus' })
const lire = async () => schemaRevenusDto.parse((await revenus()).corps)
const carte = (dto: { devises: RevenuDeviseDto[] }, devise: string): RevenuDeviseDto => {
  const trouvee = dto.devises.find((d) => d.devise === devise)
  if (trouvee === undefined) throw new Error(`Aucune carte pour ${devise} : ${JSON.stringify(dto.devises.map((d) => d.devise))}`)
  return trouvee
}

const DEBUT = debutMoisDouala(new Date())
const DEBUT_PRECEDENT = debutMoisDouala(new Date(), -1)
const DEBUT_SUIVANT = debutMoisDouala(new Date(), 1)
const dansLeMois = (heures: number): Date => plus(DEBUT, heures * HEURE_MS)

const montant = (n: number) => ({ montantPlan: n, montant: n })

describe('revenus par devise (CA07)', () => {
  it('should give one separate card per currency, the K-PAY collected amount of the month, and no sum across currencies', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, dansLeMois(1), { ...montant(5000), fraisReels: 250 })
    await insererEncaissement(user.id, dansLeMois(2), { ...montant(12_000), fraisReels: 600 })
    await insererEncaissement(user.id, dansLeMois(3), { ...montant(30_000) })
    await insererEncaissement(user.id, dansLeMois(4), { devise: 'EUR', ...montant(1500) })

    const dto = await lire()

    expect(dto.devises.map((d) => d.devise).sort()).toEqual(['EUR', 'XAF'])
    expect(carte(dto, 'XAF').mois.courant.kpay).toEqual({ brut: 47_000, nombre: 3, fraisReels: 850, nombreSansFrais: 1 })
    expect(carte(dto, 'EUR').mois.courant.kpay).toEqual({ brut: 1500, nombre: 1, fraisReels: 0, nombreSansFrais: 1 })
    expect(Object.keys(dto).sort()).toEqual(['devises', 'genereLe', 'mention', 'offerts'])
    expect(JSON.stringify(dto)).not.toContain('48500')
  })

  it('should keep manual payments apart from the K-PAY collected amount', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, dansLeMois(1), montant(5000))
    await insererPaiementManuel(user.id, { ...montant(7000), createdAt: dansLeMois(2), appliqueLe: dansLeMois(2), termineLe: dansLeMois(2) })

    const xaf = carte(await lire(), 'XAF')

    expect(xaf.mois.courant.kpay).toMatchObject({ brut: 5000, nombre: 1 })
    expect(xaf.mois.courant.manuel).toMatchObject({ brut: 7000, nombre: 1, fraisReels: 0 })
  })

  it('should still give a card to a currency that only has manual payments', async () => {
    const user = await createUser()
    await insererPaiementManuel(user.id, { devise: 'EUR', ...montant(2000), createdAt: dansLeMois(2), appliqueLe: dansLeMois(2), termineLe: dansLeMois(2) })

    const eur = carte(await lire(), 'EUR')

    expect(eur.mois.courant.kpay).toMatchObject({ brut: 0, nombre: 0 })
    expect(eur.mois.courant.manuel).toMatchObject({ brut: 2000, nombre: 1 })
  })

  it.each(['cree', 'en_attente', 'expire', 'echoue', 'annule', 'anomalie'] as const)('should never count a %s payment', async (statut) => {
    const user = await createUser()
    await insererPaiement(user.id, { statut, ...montant(99_999), createdAt: dansLeMois(1) })
    await insererEncaissement(user.id, dansLeMois(2), montant(5000))

    const xaf = carte(await lire(), 'XAF')

    expect(xaf.mois.courant.kpay).toMatchObject({ brut: 5000, nombre: 1 })
    expect(xaf.mois.courant.manuel).toMatchObject({ brut: 0, nombre: 0 })
  })

  it('should include the payments of a deleted account (accounting records)', async () => {
    await insererEncaissement(null, dansLeMois(1), montant(5000))

    expect(carte(await lire(), 'XAF').mois.courant.kpay).toMatchObject({ brut: 5000, nombre: 1 })
  })

  it('should bound the month on the applied date in the local time zone: the very first instant counts for this month, the instant before for the previous one', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, DEBUT, montant(1000))
    await insererEncaissement(user.id, new Date(DEBUT.getTime() - 1), montant(2000))
    await insererEncaissement(user.id, plus(DEBUT_PRECEDENT, 1), montant(4000))
    await insererEncaissement(user.id, plus(DEBUT_PRECEDENT, -1), montant(8000))

    const dto = await lire()
    const xaf = carte(dto, 'XAF')

    expect(xaf.mois.courant.kpay).toMatchObject({ brut: 1000, nombre: 1 })
    expect(xaf.mois.precedent.kpay).toMatchObject({ brut: 6000, nombre: 2 })
    expect(xaf.mois.courant.debut).toBe(DEBUT.toISOString())
    expect(xaf.mois.courant.fin).toBe(DEBUT_SUIVANT.toISOString())
    expect(xaf.mois.precedent.debut).toBe(DEBUT_PRECEDENT.toISOString())
    expect(xaf.mois.precedent.fin).toBe(DEBUT.toISOString())
  })

  it('should count a payment by the month it was APPLIED, not the month it was created (late success)', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, dansLeMois(5), { ...montant(5000), createdAt: plus(DEBUT_PRECEDENT, 2 * HEURE_MS) })

    const xaf = carte(await lire(), 'XAF')

    expect(xaf.mois.courant.kpay).toMatchObject({ brut: 5000, nombre: 1 })
    expect(xaf.mois.precedent.kpay).toMatchObject({ brut: 0, nombre: 0 })
  })

  it('should return exact integers above 2^31 (database sums arrive as strings): three payments of 1 000 000 000 give 3 000 000 000', async () => {
    const user = await createUser()
    for (let i = 1; i <= 3; i += 1) await insererEncaissement(user.id, dansLeMois(i), { devise: 'USD', ...montant(1_000_000_000) })

    const usd = carte(await lire(), 'USD')

    expect(usd.mois.courant.kpay.brut).toBe(3_000_000_000)
    expect(Number.isSafeInteger(usd.mois.courant.kpay.brut)).toBe(true)
    expect(Number.isInteger(usd.mois.courant.kpay.fraisReels)).toBe(true)
  })

  it('should split the K-PAY collected amount of the last 12 months by period (1, 3, 12 months), excluding older payments', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, dansLeMois(1), { periodeMois: 1, ...montant(5000) })
    await insererEncaissement(user.id, dansLeMois(2), { periodeMois: 3, ...montant(12_000) })
    await insererEncaissement(user.id, plus(DEBUT_PRECEDENT, 5 * HEURE_MS), { periodeMois: 3, ...montant(13_000) })
    await insererEncaissement(user.id, plus(DEBUT, -jours(200)), { periodeMois: 12, ...montant(48_000) })
    await insererEncaissement(user.id, plus(DEBUT, -jours(500)), { periodeMois: 12, ...montant(48_000) })

    const { repartition } = carte(await lire(), 'XAF')

    const par = (mois: number) => repartition.find((r) => r.periodeMois === mois)
    expect(par(1)).toEqual({ periodeMois: 1, nombre: 1, brut: 5000 })
    expect(par(3)).toEqual({ periodeMois: 3, nombre: 2, brut: 25_000 })
    expect(par(12)).toEqual({ periodeMois: 12, nombre: 1, brut: 48_000 })
  })

  it('should count the active subscribers of each currency, from the currency of their last payment', async () => {
    const [u1, u2, u3] = [await createUser(), await createUser(), await createUser()]
    const p1 = await insererEncaissement(u1.id, dansLeMois(1), montant(5000))
    const p2 = await insererEncaissement(u2.id, dansLeMois(1), { devise: 'EUR', ...montant(1500) })
    const p3 = await insererEncaissement(u3.id, plus(DEBUT, -jours(90)), montant(5000))
    await poserAbonnement(u1.id, plus(new Date(), jours(10)), { dernierPaiementId: p1.id })
    await poserAbonnement(u2.id, plus(new Date(), jours(10)), { dernierPaiementId: p2.id })
    await poserAbonnement(u3.id, plus(new Date(), -jours(2)), { dernierPaiementId: p3.id })

    const dto = await lire()

    expect(carte(dto, 'XAF').abonnesActifs).toBe(1)
    expect(carte(dto, 'EUR').abonnesActifs).toBe(1)
  })
})

describe('jours offerts et mention d\'incertitude (D-A3-02, CA14)', () => {
  it('should report the days offered by the administration apart from any amount, read from the audit journal', async () => {
    await insererLigneJournal(connecte.admin.id, { action: ADMIN_ACTIONS.utilisateurOffrirJours, cibleType: 'utilisateur', avant: { expire_le: '2026-11-01T00:00:00.000Z' }, apres: { jours: 30, expire_le: '2026-12-01T00:00:00.000Z', origine: 'offert' } })
    await insererLigneJournal(connecte.admin.id, { action: ADMIN_ACTIONS.utilisateurOffrirJours, cibleType: 'utilisateur', avant: null, apres: { jours: 15, expire_le: '2026-12-16T00:00:00.000Z', origine: 'offert' } })
    await insererLigneJournal(connecte.admin.id, { action: ADMIN_ACTIONS.utilisateurSuspendre, cibleType: 'utilisateur', avant: { suspendu: false }, apres: { suspendu: true } })

    const dto = await lire()

    expect(dto.offerts).toEqual({ jours: 45, nombre: 2 })
    expect(dto.devises).toEqual([])
  })

  it('should answer empty cards and zero offered days on an empty database, with the notice', async () => {
    const dto = await lire()

    expect(dto).toMatchObject({ devises: [], offerts: { jours: 0, nombre: 0 }, mention: REVENUS_MENTION_INCERTITUDE })
  })

  it('should carry the exact uncertainty notice in every answer, even with data (CA14)', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, dansLeMois(1), montant(5000))

    const dto = await lire()

    expect(dto.mention).toBe('Montant brut présumé, non confirmé par K-PAY')
    expect(new Date(dto.genereLe).getTime()).toBeGreaterThan(Date.now() - 60_000)
  })

  it('should not use the real net amount to compute the collected amount (gross as applied, D-A3-02)', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, dansLeMois(1), { ...montant(5000), netReel: 4750, fraisReels: 250 })

    const xaf = carte(await lire(), 'XAF')

    expect(xaf.mois.courant.kpay.brut).toBe(5000)
  })
})

describe('revenus : bornes des deux mois', () => {
  it('should ignore a payment applied after the end of the month and one older than the previous month in the two monthly buckets', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, DEBUT_SUIVANT, montant(9000))
    await insererEncaissement(user.id, plus(DEBUT_PRECEDENT, -jours(40)), montant(7000))

    const dto = await lire()

    for (const d of dto.devises) {
      expect(d.mois.courant.kpay.brut).toBe(0)
      expect(d.mois.precedent.kpay.brut).toBe(0)
    }
  })
})
