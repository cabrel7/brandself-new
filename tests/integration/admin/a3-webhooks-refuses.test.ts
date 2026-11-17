import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  JOBS,
  WEBHOOKS_REFUSES_PURGE_CRON,
  WEBHOOKS_REFUSES_PURGE_SCHEDULER_ID,
} from '../../../shared/jobs'
import { WEBHOOK_CORPS_MAX_OCTETS, WEBHOOKS_REFUSES_RETENTION_JOURS } from '../../../shared/limites'
import { db } from '../../../server/utils/db'
import { corpsWebhook, signerWebhook } from '../../support/faux-kpay'
import { appelerRouteWebhook, compter, corpsPour, insererPaiement, jours, lireAbonnement, NOW, plus, recevoir } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { espionnerJournaux } from '../support/planification'
import type { EspionJournaux } from '../support/planification'
import { debutHeure, HEURE_MS, jobWebhooksRefuses, lireRefus, webhooksRefusesService } from '../support/admin-a3'

// A3 CA09, CA12, D-A3-05 : compteur HORAIRE des webhooks refusés (`webhooks_refuses`), une ligne par (heure, fournisseur, motif).
// `SIGNATURE_INVALIDE` et `CORPS_TROP_GROS` seulement ; `FOURNISSEUR_INCONNU` n'est jamais compté. Aucun corps, aucune IP,
// aucun en-tête. Écriture BEST-EFFORT : une panne de comptage ne change jamais la réponse (401, 413). Purge à 90 jours.
// Webhook et base RÉELS ; l'horloge est injectée dans `recevoirWebhook` (`now`).

let journaux: EspionJournaux | undefined

afterEach(() => {
  journaux?.restaurer()
  journaux = undefined
})

const MARQUEUR = 'MARQUEUR-DE-CORPS-A-NE-JAMAIS-STOCKER'
const IP_DE_LA_ROUTE = '203.0.113.50'
const corpsInvalide = (): string => corpsWebhook({ paymentId: 'tx_x', amount: 5000, externalId: MARQUEUR })

describe('webhook de signature invalide : 401 et comptage (CA09, CA12)', () => {
  it('should answer 401 SIGNATURE_INVALIDE and count ONE refusal for the current hour', async () => {
    const reponse = await recevoir(corpsInvalide(), { signature: 'ab'.repeat(32), now: NOW })

    expect(reponse).toEqual({ status: 401, code: 'SIGNATURE_INVALIDE' })
    expect(await lireRefus()).toEqual([{ heure: debutHeure(NOW), fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE', nombre: 1 }])
  })

  it.each([
    ['en-tête absent', null],
    ['signature mal formée', 'pas-de-l-hexadecimal'],
    ['signature calculée avec un autre secret', 'AUTRE'],
  ])('should count a refusal when the signature is %s', async (_nom, signature) => {
    const corps = corpsInvalide()
    const reponse = await recevoir(corps, { signature: signature === 'AUTRE' ? signerWebhook(corps, 'un-autre-secret') : signature, now: NOW })

    expect(reponse.status).toBe(401)
    expect((await lireRefus())[0]).toMatchObject({ motif: 'SIGNATURE_INVALIDE', nombre: 1 })
  })

  it('should aggregate repeated refusals of the same hour in ONE row', async () => {
    for (let i = 0; i < 5; i += 1) await recevoir(corpsInvalide(), { signature: 'ab'.repeat(32), now: plus(NOW, i * 60_000) })

    expect(await lireRefus()).toEqual([{ heure: debutHeure(NOW), fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE', nombre: 5 }])
  })

  it('should not lose a refusal when 20 invalid webhooks arrive at the same time (atomic upsert)', async () => {
    const reponses = await Promise.all(Array.from({ length: 20 }, () => recevoir(corpsInvalide(), { signature: 'ab'.repeat(32), now: NOW })))

    expect(reponses.every((r) => r.status === 401)).toBe(true)
    expect(await lireRefus()).toEqual([{ heure: debutHeure(NOW), fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE', nombre: 20 }])
  })

  it('should keep the table small under attack: 200 refusals in one hour never add more than one row per reason', async () => {
    const { enregistrerRefusWebhook } = await webhooksRefusesService()

    await Promise.all(Array.from({ length: 200 }, () => enregistrerRefusWebhook('kpay', 'SIGNATURE_INVALIDE', NOW)))

    expect(await lireRefus()).toEqual([{ heure: debutHeure(NOW), fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE', nombre: 200 }])
  })

  it('should open a new row for a new hour, and one per reason', async () => {
    const { enregistrerRefusWebhook } = await webhooksRefusesService()

    await enregistrerRefusWebhook('kpay', 'SIGNATURE_INVALIDE', NOW)
    await enregistrerRefusWebhook('kpay', 'SIGNATURE_INVALIDE', plus(NOW, HEURE_MS))
    await enregistrerRefusWebhook('kpay', 'CORPS_TROP_GROS', NOW)

    const lignes = await lireRefus()
    expect(lignes).toHaveLength(3)
    expect(lignes.map((l) => `${l.heure.toISOString()}|${l.motif}|${l.nombre}`).sort()).toEqual([
      `${debutHeure(NOW).toISOString()}|CORPS_TROP_GROS|1`,
      `${debutHeure(NOW).toISOString()}|SIGNATURE_INVALIDE|1`,
      `${debutHeure(plus(NOW, HEURE_MS)).toISOString()}|SIGNATURE_INVALIDE|1`,
    ])
  })

  it('should answer 401 (and never 503) through the real route, and count it', async () => {
    const reponse = await appelerRouteWebhook({ corps: corpsInvalide(), signature: 'ab'.repeat(32) })

    expect(reponse.status).toBe(401)
    expect(reponse.code).toBe('SIGNATURE_INVALIDE')
    const lignes = await lireRefus()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE', nombre: 1 })
  })
})

describe('webhook trop gros : 413 et comptage', () => {
  const trop = (): Buffer => Buffer.alloc(WEBHOOK_CORPS_MAX_OCTETS + 1, 'x')

  it('should count a CORPS_TROP_GROS refusal when the body exceeds the ceiling, signed or not', async () => {
    const reponse = await recevoir(trop(), { now: NOW })

    expect(reponse).toEqual({ status: 413, code: 'CORPS_TROP_GROS' })
    expect(await lireRefus()).toEqual([{ heure: debutHeure(NOW), fournisseur: 'kpay', motif: 'CORPS_TROP_GROS', nombre: 1 }])
  })

  it('should count it through the real route when the announced length is too large (413, body never read)', async () => {
    const reponse = await appelerRouteWebhook({ corps: trop() })

    expect(reponse).toMatchObject({ status: 413, code: 'CORPS_TROP_GROS' })
    expect((await lireRefus())[0]).toMatchObject({ motif: 'CORPS_TROP_GROS', nombre: 1 })
  })

  it('should count it too when the body is streamed without Content-Length and exceeds the ceiling', async () => {
    const moitie = Buffer.alloc(Math.ceil(WEBHOOK_CORPS_MAX_OCTETS / 2) + 1, 'x')

    const reponse = await appelerRouteWebhook({ corps: [moitie, moitie], contentLength: false })

    expect(reponse).toMatchObject({ status: 413, code: 'CORPS_TROP_GROS' })
    expect((await lireRefus())[0]).toMatchObject({ motif: 'CORPS_TROP_GROS', nombre: 1 })
  })
})

describe('ce qui n\'est PAS compté', () => {
  it('should not count an accepted webhook, nor an unknown provider (scanner noise), nor an empty signed body', async () => {
    const user = await createUser()
    const paiement = await insererPaiement(user.id)

    expect((await recevoir(corpsPour(paiement), { now: NOW })).status).toBe(200)
    expect((await recevoir(corpsInvalide(), { fournisseur: 'inconnu', signature: 'ab'.repeat(32), now: NOW })).status).toBe(404)
    expect((await recevoir('', { now: NOW })).status).toBe(400)

    expect(await lireRefus()).toEqual([])
    expect(await lireAbonnement(user.id)).toBeDefined()
  })

  it('should count nothing for a replayed (duplicate) valid webhook', async () => {
    const user = await createUser()
    const corps = corpsPour(await insererPaiement(user.id))

    await recevoir(corps, { now: NOW })
    await recevoir(corps, { now: NOW })

    expect(await lireRefus()).toEqual([])
  })
})

describe('le compteur ne contient aucune donnée (CA09)', () => {
  it('should have exactly the columns heure, fournisseur, motif, nombre', async () => {
    const resultat = await db.execute<{ column_name: string }>(sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'webhooks_refuses' ORDER BY ordinal_position`)

    expect(resultat.rows.map((r) => r.column_name)).toEqual(['heure', 'fournisseur', 'motif', 'nombre'])
  })

  it('should store no part of the body, the signature, the headers or the client address', async () => {
    const signature = 'cd'.repeat(32)
    await appelerRouteWebhook({ corps: corpsInvalide(), signature })
    await recevoir(corpsInvalide(), { signature, now: NOW })

    const tout = await db.execute<{ ligne: string }>(sql`SELECT row_to_json(t)::text AS ligne FROM webhooks_refuses t`)
    const brut = tout.rows.map((r) => r.ligne).join('\n')

    expect(tout.rows.length).toBeGreaterThan(0)
    for (const interdit of [MARQUEUR, signature, IP_DE_LA_ROUTE, 'x-kpay-signature', 'content-type', 'tx_x']) expect(brut, interdit).not.toContain(interdit)
  })
})

describe('panne du comptage : la réponse ne change jamais (best-effort, CA12)', () => {
  async function avecComptagePanne<T>(corps: () => Promise<T>): Promise<T> {
    await db.execute(sql`CREATE OR REPLACE FUNCTION a3_refus_en_panne() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'panne de comptage simulee'; END $$`)
    await db.execute(sql`CREATE TRIGGER a3_refus_en_panne BEFORE INSERT OR UPDATE ON webhooks_refuses FOR EACH ROW EXECUTE FUNCTION a3_refus_en_panne()`)
    try {
      return await corps()
    } finally {
      await db.execute(sql`DROP TRIGGER IF EXISTS a3_refus_en_panne ON webhooks_refuses`)
      await db.execute(sql`DROP FUNCTION IF EXISTS a3_refus_en_panne()`)
    }
  }

  it('should still answer 401 SIGNATURE_INVALIDE when the counter cannot be written (not 500, not 503)', async () => {
    journaux = espionnerJournaux()

    const reponse = await avecComptagePanne(() => recevoir(corpsInvalide(), { signature: 'ab'.repeat(32), now: NOW }))

    expect(reponse).toEqual({ status: 401, code: 'SIGNATURE_INVALIDE' })
    expect(await lireRefus()).toEqual([])
    expect(journaux.contenu()).not.toContain(MARQUEUR)
  })

  it('should still answer 413 CORPS_TROP_GROS when the counter cannot be written', async () => {
    const reponse = await avecComptagePanne(() => appelerRouteWebhook({ corps: Buffer.alloc(WEBHOOK_CORPS_MAX_OCTETS + 1, 'x') }))

    expect(reponse).toMatchObject({ status: 413, code: 'CORPS_TROP_GROS' })
  })

  it('should leave the table writable once the fault is gone (the trigger of the test is removed)', async () => {
    await avecComptagePanne(() => recevoir(corpsInvalide(), { signature: 'ab'.repeat(32), now: NOW }))

    await recevoir(corpsInvalide(), { signature: 'ab'.repeat(32), now: NOW })

    expect((await lireRefus())[0]).toMatchObject({ nombre: 1 })
  })
})

describe('purge à 90 jours (D-A3-05)', () => {
  const PURGE_NOW = new Date('2026-11-14T04:30:00.000Z')
  const ilYa = (nbJours: number): Date => new Date(PURGE_NOW.getTime() - nbJours * 86_400_000)

  async function inserer(heure: Date, motif = 'SIGNATURE_INVALIDE', fournisseur = 'kpay', nombre = 3): Promise<void> {
    await db.execute(sql`INSERT INTO webhooks_refuses (heure, fournisseur, motif, nombre) VALUES (${heure}, ${fournisseur}, ${motif}, ${nombre})`)
  }

  it(`should delete the rows older than ${WEBHOOKS_REFUSES_RETENTION_JOURS} days and keep the others`, async () => {
    const { purgerWebhooksRefuses } = await webhooksRefusesService()
    await inserer(ilYa(120))
    await inserer(ilYa(91), 'CORPS_TROP_GROS')
    await inserer(ilYa(89))
    await inserer(ilYa(1), 'CORPS_TROP_GROS')
    await inserer(ilYa(0))

    await purgerWebhooksRefuses(PURGE_NOW)

    const restantes = await lireRefus()
    expect(restantes.map((l) => l.heure.getTime()).sort()).toEqual([ilYa(89), ilYa(1), ilYa(0)].map((d) => d.getTime()).sort())
  })

  it('should converge on a large backlog (more than one batch) without ever touching a recent row', async () => {
    const { purgerWebhooksRefuses } = await webhooksRefusesService()
    await db.execute(sql`
      INSERT INTO webhooks_refuses (heure, fournisseur, motif, nombre)
      SELECT ${ilYa(200)}::timestamptz - make_interval(hours => g), 'kpay', 'SIGNATURE_INVALIDE', 1 FROM generate_series(1, 1200) AS g`)
    await inserer(ilYa(2))

    for (let passage = 0; passage < 5 && (await lireRefus()).length > 1; passage += 1) await purgerWebhooksRefuses(PURGE_NOW)

    expect((await lireRefus()).map((l) => l.heure.getTime())).toEqual([ilYa(2).getTime()])
  })

  it('should be idempotent and harmless on an empty table', async () => {
    const { purgerWebhooksRefuses } = await webhooksRefusesService()

    await purgerWebhooksRefuses(PURGE_NOW)
    await purgerWebhooksRefuses(PURGE_NOW)

    expect(await lireRefus()).toEqual([])
  })

  it('should never purge payments (accounting records are kept, D-A3-11)', async () => {
    const { purgerWebhooksRefuses } = await webhooksRefusesService()
    const user = await createUser()
    await insererPaiement(user.id, { statut: 'echoue', createdAt: plus(NOW, -jours(1000)) })

    await purgerWebhooksRefuses(plus(NOW, jours(2000)))

    expect(await compter('paiements')).toBe(1)
  })
})

describe('tâche quotidienne de purge', () => {
  it('should schedule one repeated job without any data, in the maintenance queue, with the shared identifier and cron', async () => {
    const { planifierPurgeWebhooksRefuses } = await jobWebhooksRefuses()
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined)

    await planifierPurgeWebhooksRefuses({ upsertJobScheduler })

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [identifiant, repetition, modele] = upsertJobScheduler.mock.calls[0] as [string, { pattern: string }, { name: string, data: unknown }]
    expect(identifiant).toBe(WEBHOOKS_REFUSES_PURGE_SCHEDULER_ID)
    expect(repetition.pattern).toBe(WEBHOOKS_REFUSES_PURGE_CRON)
    expect(modele).toMatchObject({ name: JOBS.purgerWebhooksRefuses, data: {} })
  })

  it('should be wired in the worker: the job name is handled and scheduled on the maintenance queue', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../../worker/index.ts'), 'utf-8')

    expect(source).toContain('JOBS.purgerWebhooksRefuses')
    expect(source).toMatch(/purgerWebhooksRefuses\(/)
    expect(source).toMatch(/planifierPurgeWebhooksRefuses\(maintenanceQueue\)/)
  })
})
