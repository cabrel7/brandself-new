import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EXPORT_PAIEMENTS_COLONNES,
  EXPORT_PAIEMENTS_CONTENT_TYPE,
  EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE,
} from '../../../shared/admin-paiements'
import { ADMIN_EXPORT_LIGNES_MAX } from '../../../shared/limites'
import { insererPaiement, jours, MASQUE_ATTENDU, NOW, plus } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import {
  appelerAdmin,
  desinstallerAdmin,
  insererEncaissement,
  insererEnMasse,
  installerAdmin,
  insererPaiementManuel,
  journalDe,
  lignesExport,
  lireCsv,
  MOTIF,
  NUMERO_PAYEUR,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 CA10 et D-A3-09 : `POST /api/admin/export/paiements` { motif, filtres }. Colonnes = liste blanche ; filtres reflétés ;
// cellules commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot préfixées d'une apostrophe (injection de formule) ;
// e-mail vide pour un compte supprimé ; au plus 5 000 lignes (422 EXPORT_TROP_GRAND) ; journal `export.paiements` sans contenu.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const exporter = (corps: Record<string, unknown> = { motif: MOTIF }) =>
  appelerAdmin(ROUTES.exportPaiements, connecte, { chemin: '/api/admin/export/paiements', methode: 'POST', corps })

const csvDe = async (corps?: Record<string, unknown>) => {
  const reponse = await exporter(corps)
  expect(reponse.status).toBe(200)
  expect(typeof reponse.corps).toBe('string')
  return reponse.corps as string
}

describe('export CSV : colonnes, filtres, en-têtes (CA10)', () => {
  it('should send a CSV attachment with exactly the whitelisted columns, in order, and never a phone number', async () => {
    const user = await createUser({ email: 'titulaire@exemple.test' })
    const paiement = await insererEncaissement(user.id, plus(NOW, -jours(2)), { referenceFournisseur: 'KPAY-1', periodeMois: 3, fraisReels: 250, netReel: 4750, telephoneMasque: MASQUE_ATTENDU })

    const reponse = await exporter()

    expect(reponse.status).toBe(200)
    expect(reponse.entetes['content-type']).toBe(EXPORT_PAIEMENTS_CONTENT_TYPE)
    expect(reponse.entetes['content-disposition']).toMatch(new RegExp(`^attachment; filename="?${EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE}[A-Za-z0-9_.-]+\\.csv"?$`))
    expect(reponse.entetes['cache-control']).toMatch(/no-store/)
    const texte = reponse.corps as string
    expect(lireCsv(texte)[0]).toEqual([...EXPORT_PAIEMENTS_COLONNES])
    expect(lignesExport(texte)).toEqual([{
      id: paiement.id,
      reference: 'KPAY-1',
      statut: 'reussi',
      source: 'fournisseur',
      methode: 'mobile_money',
      operateur: 'MTN_MOMO_CMR',
      plan: 'payant',
      periodeMois: '3',
      devise: 'XAF',
      montant: '5000',
      fraisReels: '250',
      netReel: '4750',
      codeEchec: '',
      creeLe: paiement.createdAt.toISOString(),
      appliqueLe: paiement.appliqueLe?.toISOString(),
      emailTitulaire: 'titulaire@exemple.test',
    }])
    for (const interdit of [MASQUE_ATTENDU, '•', NUMERO_PAYEUR, 'telephone', 'empreinte']) expect(texte, interdit).not.toContain(interdit)
  })

  it('should export an empty file with only the header when nothing matches', async () => {
    const texte = await csvDe({ motif: MOTIF, filtres: { statut: 'anomalie' } })

    expect(lireCsv(texte)).toEqual([[...EXPORT_PAIEMENTS_COLONNES]])
  })

  it('should reflect the filters of the body: only the matching payments leave', async () => {
    const user = await createUser()
    const reussiXaf = await insererEncaissement(user.id, plus(NOW, -jours(10)))
    await insererEncaissement(user.id, plus(NOW, -jours(10)), { devise: 'EUR', montantPlan: 1500, montant: 1500 })
    await insererPaiement(user.id, { statut: 'echoue', createdAt: plus(NOW, -jours(10)) })
    await insererPaiementManuel(user.id, { createdAt: plus(NOW, -jours(10)), appliqueLe: plus(NOW, -jours(10)), termineLe: plus(NOW, -jours(10)) })
    await insererEncaissement(user.id, plus(NOW, -jours(100)))

    const texte = await csvDe({ motif: MOTIF, filtres: { statut: 'reussi', devise: 'XAF', source: 'fournisseur', du: plus(NOW, -jours(20)).toISOString().slice(0, 10), au: plus(NOW, -jours(5)).toISOString().slice(0, 10) } })

    expect(lignesExport(texte).map((l) => l.id)).toEqual([reussiXaf.id])
  })

  it('should export a manual payment with source manuel and its manuel-<id> reference', async () => {
    const user = await createUser()
    const manuel = await insererPaiementManuel(user.id)

    const [ligne] = lignesExport(await csvDe({ motif: MOTIF, filtres: { source: 'manuel' } }))

    expect(ligne).toMatchObject({ id: manuel.id, source: 'manuel', methode: 'manuel', operateur: '', reference: `manuel-${manuel.id}` })
  })

  it('should leave the holder e-mail EMPTY for a deleted account', async () => {
    await insererEncaissement(null, NOW)

    const [ligne] = lignesExport(await csvDe())

    expect(ligne?.emailTitulaire).toBe('')
  })

  it('should quote cells containing a separator, a quote or a line break (RFC 4180) without altering them', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, NOW, { referenceFournisseur: 'REF "A", B\nC' })

    const [ligne] = lignesExport(await csvDe())

    expect(ligne?.reference).toBe('REF "A", B\nC')
  })
})

describe('export CSV : neutralisation des formules (CA10, D-A3-09)', () => {
  it('should prefix a leading apostrophe to a =HYPERLINK cell, the way a spreadsheet will show it as text', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, NOW, { referenceFournisseur: '=HYPERLINK("http://evil.example","clic")' })

    const [ligne] = lignesExport(await csvDe())

    expect(ligne?.reference).toBe('\'=HYPERLINK("http://evil.example","clic")')
  })

  it.each([
    ['=', '=1+1'],
    ['+', '+33123456789'],
    ['-', '-2+3'],
    ['@', '@SUM(1+1)'],
    ['tabulation', '\t=cmd'],
    ['retour chariot', '\r=cmd'],
  ])('should neutralise a cell starting with %s', async (_nom, valeur) => {
    const user = await createUser()
    await insererEncaissement(user.id, NOW, { referenceFournisseur: valeur })

    const [ligne] = lignesExport(await csvDe())

    expect(ligne?.reference).toBe(`'${valeur}`)
  })

  it('should neutralise the holder e-mail too (it is chosen by the user)', async () => {
    const user = await createUser({ email: '=cmd|\' /C calc\'!A0@exemple.test' })
    await insererEncaissement(user.id, NOW)

    const [ligne] = lignesExport(await csvDe())

    expect(ligne?.emailTitulaire.startsWith('\'=')).toBe(true)
  })

  it('should leave a harmless cell untouched, including one with a dash or a plus inside', async () => {
    const user = await createUser({ email: 'a-b+c@exemple.test' })
    await insererEncaissement(user.id, NOW, { referenceFournisseur: 'KPAY-12+3' })

    const [ligne] = lignesExport(await csvDe())

    expect(ligne).toMatchObject({ reference: 'KPAY-12+3', emailTitulaire: 'a-b+c@exemple.test' })
  })

  it('should never turn a number into a formula guard: amounts and dates are exported as they are', async () => {
    const user = await createUser()
    await insererEncaissement(user.id, NOW, { fraisReels: 0 })

    const [ligne] = lignesExport(await csvDe())

    expect(ligne).toMatchObject({ montant: '5000', fraisReels: '0', periodeMois: '1' })
  })
})

describe('export CSV : plafond, motif et journal (CA10, D-A3-09)', () => {
  it(`should export exactly ${ADMIN_EXPORT_LIGNES_MAX} lines but refuse ${ADMIN_EXPORT_LIGNES_MAX + 1} with 422 EXPORT_TROP_GRAND`, async () => {
    await insererEnMasse(ADMIN_EXPORT_LIGNES_MAX)

    const limite = await exporter()
    expect(limite.status).toBe(200)
    expect(lireCsv(limite.corps as string)).toHaveLength(ADMIN_EXPORT_LIGNES_MAX + 1)

    await insererEnMasse(1, 'expire')
    const trop = await exporter()
    expect(trop).toMatchObject({ status: 422, code: 'EXPORT_TROP_GRAND' })
    expect(trop.corps).toBeUndefined()
  })

  it('should accept the oversize export once the filters bring it back under the ceiling', async () => {
    await insererEnMasse(ADMIN_EXPORT_LIGNES_MAX, 'echoue')
    await insererEnMasse(10, 'expire')

    expect((await exporter({ motif: MOTIF })).code).toBe('EXPORT_TROP_GRAND')
    const filtre = await exporter({ motif: MOTIF, filtres: { statut: 'expire' } })

    expect(filtre.status).toBe(200)
    expect(lireCsv(filtre.corps as string)).toHaveLength(11)
  })

  it('should journal one export.paiements line (admin, motive, ip) with NO content: no e-mail, no reference, no payment identifier', async () => {
    const user = await createUser({ email: 'titulaire@exemple.test' })
    const paiement = await insererEncaissement(user.id, NOW, { referenceFournisseur: 'KPAY-SECRET-REF' })

    await exporter({ motif: MOTIF, filtres: { statut: 'reussi' } })

    const lignes = await journalDe('export.paiements')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'export', motif: MOTIF })
    expect(lignes[0]?.ip.length).toBeGreaterThan(0)
    const brut = JSON.stringify(lignes[0])
    for (const interdit of ['titulaire@exemple.test', 'KPAY-SECRET-REF', paiement.id, user.id, '@']) expect(brut, interdit).not.toContain(interdit)
  })

  it('should write no journal line for a refused body (nothing left the system)', async () => {
    await insererEncaissement(null, NOW)

    await exporter({ motif: 'abc' })
    await exporter({ filtres: {} })
    await exporter({ motif: MOTIF, colonnes: ['telephone'] })

    expect(await journalDe('export.paiements')).toHaveLength(0)
  })

  it.each([
    ['sans motif', {}],
    ['motif trop court', { motif: 'abc' }],
    ['filtre inconnu', { motif: MOTIF, filtres: { telephone: NUMERO_PAYEUR } }],
    ['colonnes demandées par l\'appelant', { motif: MOTIF, colonnes: ['telephone'] }],
    ['statut inconnu', { motif: MOTIF, filtres: { statut: 'paye' } }],
    ['date mal formée', { motif: MOTIF, filtres: { du: '01/11/2026' } }],
  ])('should refuse a body %s (400 or 422) and export nothing', async (_titre, corps) => {
    await insererEncaissement(null, NOW)

    const reponse = await exporter(corps)

    expect([400, 422]).toContain(reponse.status)
    expect(reponse.corps).toBeUndefined()
  })
})
