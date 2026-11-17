import { beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_JOURNAL_VERIFICATION_LIMIT, EXPORT_JOURNAL_COLONNES, EXPORT_JOURNAL_CONTENT_TYPE } from '../../../shared/admin'
import { schemaJournalVerificationDto, schemaListeJournalDto } from '../../../shared/schemas/admin-a4'
import { db } from '../../../server/utils/db'
import { IP_TEST, compterJournal, journaliser, lireJournal, ouvrirAdmin, preparerSuiteAdmin, sansDeclencheur } from '../support/admin'
import { MOTIF_A4, appelerA4, brut, reinitialiserA4 } from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'
import { journalDe, lireCsv } from '../support/admin-a3'

// A4 CA13, CA14 (D-A4-18) : journal d'administration. Lecture et vérification NON journalisées ; export avec motif, journalisé
// `journal.exporter`, cellules neutralisées contre l'injection de formule ; chaîne altérée détectée. Base et déclencheurs RÉELS
// (l'altération « hors application » lève le déclencheur le temps de la mise à jour, puis le rétablit).

const suite = preparerSuiteAdmin()
let connecte: AdminA4

beforeEach(async () => {
  await reinitialiserA4()
  connecte = await ouvrirAdmin(suite.auth())
})

const exporter = (corps: Record<string, unknown>) => appelerA4('journalExport', { cookie: connecte.cookie, corps })

describe('export du journal (CA13)', () => {
  it.each([
    ['sans motif', {}],
    ['avec un motif trop court', { motif: 'abc' }],
    ['avec une colonne demandée par l\'appelant', { motif: MOTIF_A4, colonnes: ['ip'] }],
  ])('should refuse an export %s (422) and leave no journal line', async (_cas, corps) => {
    await journaliser(connecte.admin.id)
    const avant = await compterJournal()

    const reponse = await exporter(corps)

    expect([400, 422]).toContain(reponse.status)
    expect(reponse.corps).toBeUndefined()
    expect(await compterJournal()).toBe(avant)
  })

  it('should export the whitelisted columns only, neutralise =cmd as \'=cmd, never give the IP address nor the idempotency key, and journal journal.exporter once', async () => {
    await journaliser(connecte.admin.id, { motif: '=cmd|calc', cleIdempotence: 'cle-secrete-export-01' })

    const reponse = await exporter({ motif: MOTIF_A4 })

    expect(reponse.status).toBe(200)
    expect(reponse.entetes['content-type']).toBe(EXPORT_JOURNAL_CONTENT_TYPE)
    expect(reponse.entetes['cache-control']).toMatch(/no-store/)
    const csv = reponse.corps as string
    const [entete, ...lignes] = lireCsv(csv)
    expect(entete).toEqual([...EXPORT_JOURNAL_COLONNES])
    expect(lignes.map((c) => c[EXPORT_JOURNAL_COLONNES.indexOf('motif')])).toContain('\'=cmd|calc')
    for (const interdit of [IP_TEST, 'cle-secrete-export-01']) expect(csv, interdit).not.toContain(interdit)
    const exports = await journalDe(ADMIN_ACTIONS.journalExporter)
    expect(exports).toHaveLength(1)
    expect(exports[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'journal', motif: MOTIF_A4 })
    expect(JSON.stringify(exports[0])).not.toContain('=cmd')
  })
})

describe('lecture et vérification de la chaîne (CA14)', () => {
  it('should list entries without IP nor idempotency key, refuse a page of more than 100, and journal neither the list nor the check', async () => {
    await journaliser(connecte.admin.id, { cleIdempotence: 'cle-secrete-liste-001' })
    const avant = await compterJournal()

    const liste = await appelerA4('journalListe', { cookie: connecte.cookie })
    const trop = await appelerA4('journalListe', { cookie: connecte.cookie, query: { limite: '101' } })
    await appelerA4('journalVerifier', { cookie: connecte.cookie })

    const dto = schemaListeJournalDto.parse(liste.corps)
    expect(dto.total).toBe(avant)
    for (const interdit of [IP_TEST, 'cle-secrete-liste-001']) expect(brut(liste), interdit).not.toContain(interdit)
    expect(trop.status).toBeGreaterThanOrEqual(400)
    expect(trop.status).toBeLessThan(500)
    expect(await compterJournal()).toBe(avant)
  })

  it('should answer { intacte: true } on a sound chain, and { intacte: false, premiereRupture } once a line was altered outside the application', async () => {
    await journaliser(connecte.admin.id)
    const { numero } = await journaliser(connecte.admin.id, { motif: 'Motif d\'origine' })
    await journaliser(connecte.admin.id)

    const saine = await appelerA4('journalVerifier', { cookie: connecte.cookie })
    await sansDeclencheur('journal_admin_sans_modif', async () => {
      await db.execute(sql`UPDATE journal_admin SET motif = 'Motif falsifié après coup' WHERE numero = ${numero}`)
    })
    const alteree = await appelerA4('journalVerifier', { cookie: connecte.cookie })

    expect(schemaJournalVerificationDto.parse(saine.corps)).toEqual({ intacte: true, premiereRupture: null })
    expect(schemaJournalVerificationDto.parse(alteree.corps)).toEqual({ intacte: false, premiereRupture: numero })
    expect((await lireJournal()).find((l) => l.numero === String(numero))?.motif).toBe('Motif falsifié après coup')
  })

  it('should limit the chain check to 5 per minute and per administrator (429), since it recomputes the whole chain', async () => {
    const statuts: number[] = []
    for (let i = 0; i < ADMIN_JOURNAL_VERIFICATION_LIMIT.limit + 1; i += 1) {
      statuts.push((await appelerA4('journalVerifier', { cookie: connecte.cookie })).status)
    }

    expect(statuts.slice(0, ADMIN_JOURNAL_VERIFICATION_LIMIT.limit)).toEqual(Array(ADMIN_JOURNAL_VERIFICATION_LIMIT.limit).fill(200))
    expect(statuts.at(-1)).toBe(429)
  })
})
