import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { REGLAGES, REGLAGES_LISTE } from '../../../shared/reglages'
import { schemaListeReglagesDto, schemaModifierReglageReponse } from '../../../shared/schemas/admin-a4'
import { db } from '../../../server/utils/db'
import { compterJournal, journalDe, ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import {
  MOTIF_A4,
  appelerA4,
  avecTableReglagesIllisible,
  cleIdempotenceA4,
  codeReglage,
  ecrireReglage,
  lignesReglages,
  poserReglage,
  reglagesModule,
  reinitialiserA4,
  viderCacheReglages,
} from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'

// A4 : registre des réglages, route d'écriture et de lecture (spec §6 CA01, CA04, CA05, CA06, CA17, CA18, CA20 et la
// sécurité : réauthentification, journal, idempotence, repli FERMÉ des drapeaux de sécurité). Base, Redis, journal,
// réauthentification et Better Auth RÉELS ; aucun mock du repository ni du journal. « Une autre instance » (le worker)
// est simulée par une écriture SQL directe SANS vidage du cache du processus.

const suite = preparerSuiteAdmin()
let connecte: AdminA4

beforeEach(async () => {
  await reinitialiserA4()
  connecte = await ouvrirAdmin(suite.auth())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const nbReglages = (): Promise<number> => lignesReglages().then((l) => l.length)

describe('écriture d\'un réglage : persistance, journal chaîné, retour au défaut', () => {
  it('should persist the value, journal ONE chained reglage.modifier line with the idempotency key, list it as overridden, and restore the default with null', async () => {
    const cle = 'ia.limite_utilisateur_heure'

    const ecriture = await ecrireReglage(connecte, cle, 20, { cleIdempotence: 'cle-ecriture-0001' })

    expect(ecriture.status).toBe(200)
    const corps = schemaModifierReglageReponse.parse(ecriture.corps)
    expect(corps).toMatchObject({ rejoue: false, reglage: { cle, valeur: 20, defaut: 10, surcharge: true, modifiePar: connecte.admin.id } })
    expect(await lignesReglages()).toMatchObject([{ cle, valeur: 20, modifie_par: connecte.admin.id }])
    const [ligne] = await journalDe(ADMIN_ACTIONS.reglageModifier)
    expect(ligne).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'reglage', cible_id: cle, motif: MOTIF_A4, cle_idempotence: 'cle-ecriture-0001', avant: { valeur: 10 }, apres: { valeur: 20 } })
    const liste = await appelerA4('reglagesListe', { cookie: connecte.cookie })
    const { elements } = schemaListeReglagesDto.parse(liste.corps)
    expect(elements).toHaveLength(REGLAGES_LISTE.length)
    expect(elements.filter((e) => e.surcharge).map((e) => e.cle)).toEqual([cle])
    expect(elements.find((e) => e.cle === cle)?.valeur).toBe(20)

    const retablissement = await ecrireReglage(connecte, cle, null)

    expect(retablissement.status).toBe(200)
    expect(schemaModifierReglageReponse.parse(retablissement.corps).reglage).toMatchObject({ valeur: 10, surcharge: false })
    expect(await nbReglages()).toBe(0)
    expect(await journalDe(ADMIN_ACTIONS.reglageModifier)).toHaveLength(2)
    const { verifierChaine } = await import('../../../server/services/admin/audit')
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should not give the list to a request on the PUBLIC host, and refuse a write there, writing nothing (hôte non-admin → 404)', async () => {
    const lecture = await appelerA4('reglagesListe', { cookie: connecte.cookie, hote: 'public' })
    const ecriture = await appelerA4('reglageModifier', {
      params: { cle: 'ia.active' },
      cookie: connecte.cookie,
      hote: 'public',
      reauth: await codeReglage(connecte.admin.id, 'ia.active'),
      corps: { valeur: false, motif: MOTIF_A4, cleIdempotence: cleIdempotenceA4() },
    })

    expect(lecture.status).toBe(404)
    expect(ecriture.status).toBe(404)
    expect(await nbReglages()).toBe(0)
    expect(await compterJournal()).toBe(0)
  })
})

describe('bornes et validation croisée (CA01)', () => {
  it.each([
    ['sous la borne basse (0)', 0],
    ['au-dessus de la borne haute (101)', 101],
    ['un décimal', 1.5],
    ['un texte au lieu d\'un nombre', 'canari-valeur-xyz'],
    ['un booléen', true],
  ] as const)('should answer 422 REGLAGE_INVALIDE for ia.limite_utilisateur_heure %s, write no row, no journal line, and never repeat the value', async (_cas, valeur) => {
    const reponse = await ecrireReglage(connecte, 'ia.limite_utilisateur_heure', valeur)

    expect(reponse).toMatchObject({ status: 422, code: 'REGLAGE_INVALIDE' })
    expect(await nbReglages()).toBe(0)
    expect(await compterJournal()).toBe(0)
    expect(JSON.stringify(reponse.data ?? null)).not.toContain('canari-valeur-xyz')
  })

  it('should refuse a per-vitrine SEO limit above the global ceiling, and a maintenance switched on without a message', async () => {
    expect((await ecrireReglage(connecte, 'ia.plafond_global_jour', 10)).status).toBe(200)

    const seo = await ecrireReglage(connecte, 'seo.limite_vitrine_jour', 20)
    const maintenance = await ecrireReglage(connecte, 'maintenance.active', true)

    expect(seo).toMatchObject({ status: 422, code: 'REGLAGE_INVALIDE' })
    expect(maintenance).toMatchObject({ status: 422, code: 'REGLAGE_INVALIDE' })
    expect((await lignesReglages()).map((l) => l.cle)).toEqual(['ia.plafond_global_jour'])
    expect(await journalDe(ADMIN_ACTIONS.reglageModifier)).toHaveLength(1)
  })
})

describe('clés hors registre, secrets et lecture seule (CA06, CA20)', () => {
  it.each(['KPAY_SECRET_KEY', 'NUXT_BETTER_AUTH_SECRET', 'ia.inconnue', 'constructor', '__proto__'])(
    'should refuse the key %s (404 or 422), never write a row nor a journal line, even without a re-authentication code',
    async (cle) => {
      const reponse = await ecrireReglage(connecte, cle, 'x', { sansCode: true })

      expect([404, 422]).toContain(reponse.status)
      if (reponse.status === 404) expect(reponse.code).toBe('REGLAGE_INCONNUE')
      expect(await nbReglages()).toBe(0)
      expect(await compterJournal()).toBe(0)
    },
  )

  it('should expose no secret in the list of settings (CA06): no key name that points to a secret, a token or an URL', async () => {
    const liste = await appelerA4('reglagesListe', { cookie: connecte.cookie })

    const cles = (liste.corps as { elements: Array<{ cle: string }> }).elements.map((e) => e.cle)
    expect(cles.sort()).toEqual(Object.keys(REGLAGES).sort())
    for (const cle of cles) expect(cle).not.toMatch(/secret|key|token|password|url|cle/i)
  })

  it('should answer 422 REGLAGE_LECTURE_SEULE for paiement.en_ligne, with no re-authentication needed to be told so, and write nothing (CA20)', async () => {
    const reponse = await ecrireReglage(connecte, 'paiement.en_ligne', true, { sansCode: true })

    expect(reponse).toMatchObject({ status: 422, code: 'REGLAGE_LECTURE_SEULE' })
    expect(await nbReglages()).toBe(0)
    expect(await compterJournal()).toBe(0)
  })
})

describe('réauthentification des écritures (D-A4-19)', () => {
  it.each([
    ['sans code', null, 'REAUTH_REQUISE'],
    ['avec un code lié à un AUTRE réglage', 'autre-cle', 'REAUTH_INVALIDE'],
  ] as const)('should refuse a write of ia.active %s, and change nothing', async (_cas, liaison, code) => {
    const reauth = liaison === null ? null : await codeReglage(connecte.admin.id, 'inscriptions.ouvertes')

    const reponse = await ecrireReglage(connecte, 'ia.active', false, { reauth })

    expect(reponse).toMatchObject({ status: 403, code })
    expect(await nbReglages()).toBe(0)
    expect(await compterJournal()).toBe(0)
  })

  it('should refuse the replay of a code that was already used for a first write (one code = one write)', async () => {
    const code = await codeReglage(connecte.admin.id, 'ia.active')
    const premiere = await ecrireReglage(connecte, 'ia.active', false, { reauth: code })

    const rejouee = await ecrireReglage(connecte, 'ia.active', true, { reauth: code })

    expect(premiere.status).toBe(200)
    expect(rejouee).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lignesReglages())[0]?.valeur).toBe(false)
    expect(await journalDe(ADMIN_ACTIONS.reglageModifier)).toHaveLength(1)
  })

  it('should NOT demand a code for the maintenance message nor for the agenda defaults, and journal a text as its length only, never its content (CA17)', async () => {
    const texte = 'M'.repeat(179) + ' secret-de-test '.repeat(1) + 'z'.repeat(5)
    expect(texte).toHaveLength(200)

    const message = await ecrireReglage(connecte, 'maintenance.message', texte, { sansCode: true })
    const preavis = await ecrireReglage(connecte, 'agenda.preavis_defaut_heures', 4, { sansCode: true })

    expect(message.status).toBe(200)
    expect(preavis.status).toBe(200)
    const [ligne] = (await journalDe(ADMIN_ACTIONS.reglageModifier)).filter((l) => l.cible_id === 'maintenance.message')
    expect(ligne?.apres).toEqual({ longueur: 200 })
    expect(ligne?.avant).toEqual({ longueur: 0 })
    expect(JSON.stringify(await journalDe(ADMIN_ACTIONS.reglageModifier))).not.toContain('secret-de-test')
  })
})

describe('idempotence des écritures (CA18)', () => {
  it('should replay the recorded answer for the same key and body (one row, one journal line, same date), and answer 409 for the same key with another body', async () => {
    const cle = 'abonnement.grace_jours'
    const idem = 'cle-rejeu-0001'
    const premiere = await ecrireReglage(connecte, cle, 12, { cleIdempotence: idem })
    const avant = (await lignesReglages())[0]

    const rejeu = await ecrireReglage(connecte, cle, 12, { cleIdempotence: idem })
    const conflit = await ecrireReglage(connecte, cle, 13, { cleIdempotence: idem })

    expect(premiere.status).toBe(200)
    expect(rejeu).toMatchObject({ status: 200, corps: { rejoue: true, reglage: { valeur: 12 } } })
    expect(conflit).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
    expect(await lignesReglages()).toEqual([avant])
    expect(await journalDe(ADMIN_ACTIONS.reglageModifier)).toHaveLength(1)
  })

  it('should write ONCE when the same request (same key, same code: a double click) arrives twice at the same time', async () => {
    const cle = 'retention.ia_jours'
    const idem = 'cle-concurrente-01'
    const code = await codeReglage(connecte.admin.id, cle)

    const reponses = await Promise.all([1, 2].map(() => ecrireReglage(connecte, cle, 45, { cleIdempotence: idem, reauth: code })))

    expect(reponses.map((r) => r.status)).toContain(200)
    for (const r of reponses) expect([200, 403, 409]).toContain(r.status)
    expect(await journalDe(ADMIN_ACTIONS.reglageModifier)).toHaveLength(1)
    expect(await nbReglages()).toBe(1)
  })
})

describe('lecture à chaud et repli (CA04, CA05, D-A4-06)', () => {
  it('should show a value written by the API at once in this process, and to a process holding a cached copy within 10 seconds (the worker)', async () => {
    const { Reglages } = await reglagesModule()
    expect(await Reglages.lire('ia.plafond_global_jour')).toBe(2000)
    expect((await ecrireReglage(connecte, 'ia.plafond_global_jour', 500)).status).toBe(200)

    expect(await Reglages.lire('ia.plafond_global_jour')).toBe(500)

    // Une autre instance (le worker) écrit sans que ce processus vide son cache : au plus 10 secondes plus tard, il la voit.
    expect(await Reglages.lire('abonnement.grace_jours')).toBe(7)
    await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES ('abonnement.grace_jours', '3'::jsonb, ${connecte.admin.id})`)
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 9_900)
    expect(await Reglages.lire('abonnement.grace_jours')).toBe(3)
  })

  it('should never throw when the table cannot be read: security flags FALL BACK CLOSED (not to the code), other settings to the code value', async () => {
    const { Reglages } = await reglagesModule()

    const lues = await avecTableReglagesIllisible(async () => ({
      mcp: await Reglages.lire('mcp.actif'),
      inscriptions: await Reglages.lire('inscriptions.ouvertes'),
      ia: await Reglages.lire('ia.active'),
      paiement: await Reglages.lire('paiement.en_ligne'),
      limite: await Reglages.lire('ia.limite_utilisateur_heure'),
      maintenance: await Reglages.lire('maintenance.active'),
    }))

    expect(lues).toEqual({ mcp: false, inscriptions: false, ia: false, paiement: false, limite: 10, maintenance: false })
  })

  it('should fall back (closed for a flag, code value otherwise) on an invalid stored value, and log the key but never the value', async () => {
    const { Reglages } = await reglagesModule()
    const journaux = [vi.spyOn(console, 'error'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'info'), vi.spyOn(console, 'log')]
    await db.execute(sql`INSERT INTO reglages (cle, valeur, modifie_par) VALUES
      ('inscriptions.ouvertes', '"oui-canari-brut"'::jsonb, ${connecte.admin.id}),
      ('ia.limite_utilisateur_heure', '"canari-valeur-brute"'::jsonb, ${connecte.admin.id})`)
    await viderCacheReglages()

    expect(await Reglages.lire('inscriptions.ouvertes')).toBe(false)
    expect(await Reglages.lire('ia.limite_utilisateur_heure')).toBe(10)

    const sortie = JSON.stringify(journaux.flatMap((espion) => espion.mock.calls))
    expect(sortie).not.toContain('canari')
  })

  it('should read a stored value before the code value, and close the MCP OAuth routes (404) when the table is unreadable', async () => {
    const { default: mcpInactif } = await import('../../../server/middleware/mcp-inactif')
    const { fakeEvent } = await import('../../support/h3')
    const passer = async (): Promise<number | undefined> => {
      try {
        await (mcpInactif as (e: ReturnType<typeof fakeEvent>) => unknown)(fakeEvent({ method: 'POST', url: '/api/auth/oauth2/register', headers: { host: 'localhost:3000' } }))
        return undefined
      } catch (erreur) {
        return (erreur as { statusCode?: number }).statusCode
      }
    }
    expect(await passer()).toBe(404)

    await poserReglage('mcp.actif', true, connecte.admin.id)
    expect(await passer()).toBeUndefined()

    expect(await avecTableReglagesIllisible(passer)).toBe(404)
  })
})
