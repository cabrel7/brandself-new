import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schemaListePaiementsDto, schemaPaiementDetailDto } from '../../../shared/schemas/admin-paiements'
import { corpsPour, insererPaiement, jours, lireEvenements, MASQUE_ATTENDU, NOW, plus, recevoir } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import {
  appelerAdmin,
  desinstallerAdmin,
  installerAdmin,
  insererEncaissement,
  insererEnMasse,
  insererPaiementManuel,
  NUMERO_PAYEUR,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 §5 « Sorties » : liste et détail des paiements de l'administration. Liste blanche stricte (`.strict()` en sortie), jamais
// le téléphone, le numéro, l'empreinte ni le corps brut des événements (D-A3-10) ; seul champ personnel : l'e-mail du
// titulaire (`null` si le compte est supprimé). Base et journal RÉELS.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const liste = (requete = '') => appelerAdmin(ROUTES.paiements, connecte, { chemin: `/api/admin/paiements${requete}` })
const detail = (id: string) => appelerAdmin(ROUTES.paiementDetail, connecte, { chemin: `/api/admin/paiements/${id}`, params: { id } })
const elements = (corps: unknown) => schemaListePaiementsDto.parse(corps).elements

describe('liste des paiements : contenu', () => {
  it('should list the newest payments first, with the exact whitelisted fields', async () => {
    const user = await createUser({ email: 'titulaire@exemple.test' })
    const ancien = await insererPaiement(user.id, { statut: 'echoue', createdAt: plus(NOW, -jours(3)), codeEchec: 'PAYER_NOT_FOUND', referenceFournisseur: 'KPAY-ANCIEN' })
    const recent = await insererEncaissement(user.id, plus(NOW, -jours(1)), { referenceFournisseur: 'KPAY-RECENT', fraisReels: 250, netReel: 4750, periodeMois: 3, montantPlan: 5000, montant: 5000 })

    const reponse = await liste()

    expect(reponse.status).toBe(200)
    const dto = schemaListePaiementsDto.parse(reponse.corps)
    expect(dto).toMatchObject({ total: 2, page: 1, limite: 25 })
    expect(dto.elements.map((e) => e.id)).toEqual([recent.id, ancien.id])
    expect(dto.elements[0]).toEqual({
      id: recent.id,
      reference: 'KPAY-RECENT',
      fournisseur: 'kpay',
      source: 'kpay',
      methode: 'mobile_money',
      operateur: 'MTN_MOMO_CMR',
      statut: 'reussi',
      plan: 'payant',
      periodeMois: 3,
      devise: 'XAF',
      montant: 5000,
      fraisReels: 250,
      netReel: 4750,
      codeEchec: null,
      creeLe: recent.createdAt.toISOString(),
      appliqueLe: recent.appliqueLe?.toISOString(),
      termineLe: recent.termineLe?.toISOString(),
      utilisateur: { id: user.id, email: 'titulaire@exemple.test' },
    })
    expect(dto.elements[1]).toMatchObject({ id: ancien.id, statut: 'echoue', codeEchec: 'PAYER_NOT_FOUND', appliqueLe: null, fraisReels: null, netReel: null })
  })

  it('should show a manual payment as source manuel, provider manuel, without operator and with its manuel-<id> reference', async () => {
    const user = await createUser()
    const manuel = await insererPaiementManuel(user.id)

    const [ligne] = elements((await liste()).corps)

    expect(ligne).toMatchObject({ id: manuel.id, source: 'manuel', fournisseur: 'manuel', methode: 'manuel', operateur: null, reference: `manuel-${manuel.id}`, statut: 'reussi' })
  })

  it('should answer utilisateur: null for a payment whose account was deleted (accounting record kept)', async () => {
    const paiement = await insererEncaissement(null, NOW)

    const [ligne] = elements((await liste()).corps)

    expect(ligne).toMatchObject({ id: paiement.id, utilisateur: null })
  })

  it('should NEVER expose the masked number, the fingerprint, any bullet or the payer number, in any payment state', async () => {
    const user = await createUser({ email: 'titulaire@exemple.test' })
    const paiements = [
      await insererPaiement(user.id, { telephoneMasque: MASQUE_ATTENDU, telephoneEmpreinte: 'a'.repeat(64) }),
      await insererPaiement(user.id, { statut: 'echoue', telephoneMasque: MASQUE_ATTENDU, telephoneEmpreinte: 'b'.repeat(64) }),
      await insererEncaissement(user.id, NOW, { telephoneMasque: MASQUE_ATTENDU, telephoneEmpreinte: 'c'.repeat(64) }),
    ]

    const brut = JSON.stringify((await liste()).corps) + JSON.stringify((await detail(paiements[0]?.id ?? '')).corps)

    for (const interdit of ['•', MASQUE_ATTENDU, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), NUMERO_PAYEUR, '653456789', 'telephone', 'empreinte']) {
      expect(brut, interdit).not.toContain(interdit)
    }
  })

  it('should return an empty page, not an error, when there is no payment', async () => {
    const reponse = await liste()

    expect(reponse.status).toBe(200)
    expect(schemaListePaiementsDto.parse(reponse.corps)).toMatchObject({ elements: [], total: 0, page: 1 })
  })
})

describe('liste des paiements : filtres et pagination', () => {
  async function jeu() {
    const user = await createUser()
    return {
      reussiXaf: await insererEncaissement(user.id, plus(NOW, -jours(20)), { referenceFournisseur: 'R1' }),
      reussiEur: await insererEncaissement(user.id, plus(NOW, -jours(10)), { devise: 'EUR', montantPlan: 1500, montant: 1500 }),
      echoueXaf: await insererPaiement(user.id, { statut: 'echoue', createdAt: plus(NOW, -jours(5)) }),
      manuelXaf: await insererPaiementManuel(user.id, { createdAt: plus(NOW, -jours(1)), appliqueLe: plus(NOW, -jours(1)), termineLe: plus(NOW, -jours(1)) }),
    }
  }

  it.each([
    ['statut=reussi', ['reussiXaf', 'reussiEur', 'manuelXaf']],
    ['statut=echoue', ['echoueXaf']],
    ['source=manuel', ['manuelXaf']],
    ['source=kpay', ['reussiXaf', 'reussiEur', 'echoueXaf']],
    ['devise=EUR', ['reussiEur']],
    ['devise=XAF', ['reussiXaf', 'echoueXaf', 'manuelXaf']],
    ['statut=reussi&devise=XAF&source=kpay', ['reussiXaf']],
  ] as const)('should filter by %s', async (requete, attendus) => {
    const lignes = await jeu()

    const dto = schemaListePaiementsDto.parse((await liste(`?${requete}`)).corps)

    expect(dto.elements.map((e) => e.id).sort()).toEqual(attendus.map((cle) => lignes[cle].id).sort())
    expect(dto.total).toBe(attendus.length)
  })

  it('should filter by date range (du and au, both inclusive days, on the creation date)', async () => {
    const lignes = await jeu()
    const jour = (d: Date) => d.toISOString().slice(0, 10)

    const dto = schemaListePaiementsDto.parse((await liste(`?du=${jour(plus(NOW, -jours(11)))}&au=${jour(plus(NOW, -jours(4)))}`)).corps)

    expect(dto.elements.map((e) => e.id).sort()).toEqual([lignes.reussiEur.id, lignes.echoueXaf.id].sort())
  })

  it('should answer an empty page (not an error) for a filter that matches nothing', async () => {
    await jeu()

    expect(schemaListePaiementsDto.parse((await liste('?statut=anomalie')).corps)).toMatchObject({ elements: [], total: 0 })
  })

  it.each(['statut=paye', 'source=carte', 'devise=xaf', 'devise=XAFF', 'du=01/11/2026', 'au=demain', 'page=0', 'page=abc', 'limite=0', 'limite=101', 'inconnu=1', 'statut=reussi&statut=echoue'])(
    'should refuse the query parameter %s (400 or 422), never ignore it',
    async (requete) => {
      const reponse = await liste(`?${requete}`)

      expect([400, 422]).toContain(reponse.status)
    },
  )

  it('should paginate 30 payments into 25 and 5, with a stable total and no duplicate', async () => {
    await insererEnMasse(30)

    const page1 = schemaListePaiementsDto.parse((await liste()).corps)
    const page2 = schemaListePaiementsDto.parse((await liste('?page=2')).corps)
    const petite = schemaListePaiementsDto.parse((await liste('?limite=10&page=3')).corps)

    expect(page1).toMatchObject({ total: 30, page: 1, limite: 25 })
    expect(page1.elements).toHaveLength(25)
    expect(page2.elements).toHaveLength(5)
    expect(new Set([...page1.elements, ...page2.elements].map((e) => e.id)).size).toBe(30)
    expect(petite).toMatchObject({ page: 3, limite: 10 })
    expect(petite.elements).toHaveLength(10)
  })

  it('should answer an empty page beyond the last page', async () => {
    await insererEnMasse(3)

    expect(schemaListePaiementsDto.parse((await liste('?page=9')).corps)).toMatchObject({ elements: [], total: 3, page: 9 })
  })
})

describe('détail d\'un paiement', () => {
  it('should return the payment and ONLY the five whitelisted fields of its provider events', async () => {
    const user = await createUser({ email: 'titulaire@exemple.test' })
    const paiement = await insererPaiement(user.id, { referenceFournisseur: 'KPAY-DETAIL' })
    await recevoir(corpsPour(paiement, { amount: 4750 }), { now: NOW })
    const [evenementBrut] = await lireEvenements()

    const reponse = await detail(paiement.id)

    expect(reponse.status).toBe(200)
    const dto = schemaPaiementDetailDto.parse(reponse.corps)
    expect(dto.paiement).toMatchObject({ id: paiement.id, statut: 'anomalie', codeEchec: 'MONTANT_INCOHERENT', utilisateur: { id: user.id, email: 'titulaire@exemple.test' } })
    expect(dto.evenements).toEqual([{
      evenement: 'payment.completed',
      source: 'webhook',
      traitement: 'anomalie',
      motif: 'MONTANT_INCOHERENT',
      recuLe: evenementBrut?.recuLe.toISOString(),
    }])
    expect(dto.reverifieNonReussiLe).toBeNull()
    const brut = JSON.stringify(reponse.corps)
    for (const interdit of [paiement.idFournisseur ?? 'jamais', 'idTransaction', 'externalId', 'statutFournisseur', 'horodatage', '4750']) expect(brut, interdit).not.toContain(interdit)
  })

  it('should list only the events of THAT payment', async () => {
    const user = await createUser()
    const un = await insererPaiement(user.id)
    const deux = await insererPaiement(user.id)
    await recevoir(corpsPour(un), { now: NOW })
    await recevoir(corpsPour(deux, { event: 'payment.failed', status: 'FAILED', failureReason: 'PAYER_NOT_FOUND' }), { now: NOW })

    const dto = schemaPaiementDetailDto.parse((await detail(deux.id)).corps)

    expect(dto.evenements).toHaveLength(1)
    expect(dto.evenements[0]).toMatchObject({ evenement: 'payment.failed', traitement: 'applique' })
  })

  it('should return an empty events list for a payment that never received any', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    expect(schemaPaiementDetailDto.parse((await detail(paiement.id)).corps).evenements).toEqual([])
  })

  it('should show a manual payment with its reference and no provider identifier', async () => {
    const user = await createUser()
    const manuel = await insererPaiementManuel(user.id)

    const dto = schemaPaiementDetailDto.parse((await detail(manuel.id)).corps)

    expect(dto.paiement).toMatchObject({ source: 'manuel', fournisseur: 'manuel', reference: `manuel-${manuel.id}`, operateur: null })
  })

  it('should answer 404 PAIEMENT_INTROUVABLE for an unknown identifier (any text of 64 characters at most)', async () => {
    for (const id of [randomUUID(), 'pas-un-uuid']) {
      const reponse = await detail(id)
      expect(reponse.status, id).toBe(404)
      expect(reponse.code, id).toBe('PAIEMENT_INTROUVABLE')
    }
  })

  it('should refuse an identifier of the wrong form (path traversal, over 64 characters) with a client error, never a 500', async () => {
    for (const id of ['../../etc/passwd', 'x'.repeat(65)]) {
      const reponse = await detail(id)
      expect([400, 404], id).toContain(reponse.status)
    }
  })
})
