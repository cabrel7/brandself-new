import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../../../server/utils/db'
import {
  auditService,
  compterJournal,
  journalDe,
  lireSessions,
  ouvrirAdmin,
  ouvrirSession,
  preparerSuiteAdmin,
} from '../support/admin'
import {
  MAINTENANT_A2,
  MOTIF_A2,
  MOTIF_DEPUBLICATION,
  appelerA2,
  codeReauthPour,
  compterEmailsOutbox,
  creerMondeA2,
  issue,
  lireOutboxUtilisateur,
  lireVitrineDe,
} from '../support/admin-a2'
import type { MondeA2 } from '../support/admin-a2'
import { traiter } from '../support/planification'
import { utc } from '../support/notifications'
import { ERROR_STATUS } from '../../../shared/erreurs'

// A2 CA05, D-A2-02, D-A2-13, D-A2-14 : dépublier / republier par l'administration. La dépublication pose
// `blocage_admin` + `blocage_motif` et CONSERVE `publiee_le` ; `publishVitrine` (studio) répond 409
// VITRINE_BLOQUEE_ADMIN tant que le blocage dure. Routes, base et Redis réels.

const suite = preparerSuiteAdmin()
let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string

beforeEach(async () => {
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
})

const vitrinesService = () => import('../../../server/services/vitrines')

async function depublier(m: MondeA2, surcharges: { id?: string, motif?: string, reauth?: string | null, corps?: unknown } = {}) {
  const id = surcharges.id ?? m.vitrine.id
  const reauth = surcharges.reauth === null ? undefined : (surcharges.reauth ?? await codeReauthPour(admin.id, 'depublier', id))
  return appelerA2('depublier', { id, cookie, ...(reauth === undefined ? {} : { reauth }), corps: surcharges.corps ?? { motif: surcharges.motif ?? MOTIF_DEPUBLICATION } })
}
const republier = (m: MondeA2, motif = MOTIF_A2) => appelerA2('republier', { id: m.vitrine.id, cookie, corps: { motif } })

describe('dépublier (CA05, D-A2-02)', () => {
  it('should flag the vitrine with its motif, keep publiee_le and leave the account, its sessions and its content untouched', async () => {
    const m = await creerMondeA2()
    const session = await ouvrirSession(suite.auth(), m.user.email, 'public')
    const avant = await lireVitrineDe(m.user.id)

    const reponse = await depublier(m)

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    const apres = await lireVitrineDe(m.user.id)
    expect(apres).toMatchObject({ blocageAdmin: true, blocageMotif: MOTIF_DEPUBLICATION })
    expect(apres?.publieeLe?.toISOString()).toBe(avant?.publieeLe?.toISOString())
    expect(await lireSessions(m.user.id)).toHaveLength(1)
    expect(session.status).toBe(200)
    const { lireUtilisateur } = await import('../support/admin-a2')
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
  })

  it('should make the public page answer 404 right away (the 10 s of the proxy cache are the only delay), and keep the owner\'s studio view', async () => {
    const m = await creerMondeA2()
    const { getPublicVitrinePage, getOwnVitrine } = await vitrinesService()
    await expect(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)).resolves.toBeDefined()

    await depublier(m)

    expect(await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))).toMatchObject({ ok: false, status: 404 })
    await expect(getOwnVitrine(m.user.id)).resolves.toBeDefined()
  })

  it('should journal one chained line {blocage_admin} false -> true on the vitrine target', async () => {
    const m = await creerMondeA2()

    await depublier(m)

    const lignes = await journalDe('vitrine.depublier')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: admin.id, cible_type: 'vitrine', cible_id: m.vitrine.id, motif: MOTIF_DEPUBLICATION, avant: { blocage_admin: false }, apres: { blocage_admin: true } })
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should queue ONE utilisateur_depubliee e-mail for the OWNER, sent to its address with the motif', async () => {
    const m = await creerMondeA2()

    await depublier(m)

    const lignes = await lireOutboxUtilisateur(m.user.id, 'utilisateur_depubliee')
    const [journal] = await journalDe('vitrine.depublier')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ entiteType: 'utilisateur', entiteId: m.user.id, statut: 'en_attente', occurrence: String(journal?.numero) })
    const envoi = await traiter(lignes[0]!.id, utc('2099-01-01T00:00:00.000Z'))
    expect(envoi.resultat.statut).toBe('envoye')
    expect(envoi.transport.dernier.to).toBe(m.user.email)
    expect(`${envoi.transport.dernier.text}${envoi.transport.dernier.html ?? ''}`).toContain(MOTIF_DEPUBLICATION)
  })

  it('should send a NEW e-mail on a second dépublication (the occurrence differs: the unique outbox key must not swallow it)', async () => {
    const m = await creerMondeA2()
    await depublier(m)
    await republier(m)

    const seconde = await depublier(m, { motif: 'Un autre motif valable' })

    expect(seconde.status).toBe(200)
    expect(await lireOutboxUtilisateur(m.user.id, 'utilisateur_depubliee')).toHaveLength(2)
  })

  it('should demand the reauthentication code (REAUTH_REQUISE), a code bound to THIS vitrine, and a valid motif; nothing changes otherwise', async () => {
    const m = await creerMondeA2()
    const autre = await creerMondeA2()
    const codeAutre = await codeReauthPour(admin.id, 'depublier', autre.vitrine.id)

    const sans = await depublier(m, { reauth: null })
    const mauvaiseCible = await depublier(m, { reauth: codeAutre })
    const motifCourt = await depublier(m, { motif: 'non' })

    expect(sans).toMatchObject({ status: ERROR_STATUS.REAUTH_REQUISE, code: 'REAUTH_REQUISE' })
    expect(mauvaiseCible).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect(motifCourt.status).toBe(422)
    expect((await lireVitrineDe(m.user.id))?.blocageAdmin).toBe(false)
    expect((await lireVitrineDe(autre.user.id))?.blocageAdmin).toBe(false)
    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
  })

  it('should answer 404 for an unknown vitrine, and NOT accept a USER identifier in place of a vitrine identifier', async () => {
    const m = await creerMondeA2()

    const inconnue = await depublier(m, { id: '00000000-0000-4000-8000-000000000000' })
    const identifiantUtilisateur = await depublier(m, { id: m.user.id })

    expect(inconnue.status).toBe(404)
    expect(identifiantUtilisateur.status).toBe(404)
    expect((await lireVitrineDe(m.user.id))?.blocageAdmin).toBe(false)
  })

  it('should keep the motif out of the visitor surfaces (no motif in the 404 a visitor receives)', async () => {
    const m = await creerMondeA2()
    await depublier(m)
    const { getPublicVitrinePage } = await vitrinesService()

    const resultat = await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))

    expect(JSON.stringify(resultat)).not.toContain(MOTIF_DEPUBLICATION)
  })
})

describe('DTO du studio : le blocage est visible du professionnel (D-A2-13)', () => {
  it('should expose blocageAdmin=false and blocageMotif=null for a vitrine that is not blocked', async () => {
    const m = await creerMondeA2()
    const { getOwnVitrine } = await vitrinesService()
    const { toVitrineStudioResource } = await import('../../../server/resources/vitrine')

    const dto = toVitrineStudioResource(await getOwnVitrine(m.user.id))

    expect(dto).toMatchObject({ blocageAdmin: false, blocageMotif: null })
  })

  it('should expose the motif to the owner while blocked, and null again once republished', async () => {
    const m = await creerMondeA2()
    const { getOwnVitrine } = await vitrinesService()
    const { toVitrineStudioResource } = await import('../../../server/resources/vitrine')
    await depublier(m)

    const bloquee = toVitrineStudioResource(await getOwnVitrine(m.user.id))
    await republier(m)
    const levee = toVitrineStudioResource(await getOwnVitrine(m.user.id))

    expect(bloquee).toMatchObject({ blocageAdmin: true, blocageMotif: MOTIF_DEPUBLICATION })
    expect(levee).toMatchObject({ blocageAdmin: false, blocageMotif: null })
  })

  it('should NEVER put the block flag or the motif in the PUBLIC vitrine resource', async () => {
    const m = await creerMondeA2()
    const { getPublicVitrinePage } = await vitrinesService()
    const { toVitrinePublicResource } = await import('../../../server/resources/vitrine')
    const page = await getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)

    const brut = JSON.stringify(toVitrinePublicResource(page.vitrine, page.badgeBrandself))

    expect(brut).not.toMatch(/blocage/i)
  })
})

describe('publishVitrine pendant un blocage (D-A2-02, D-A2-13)', () => {
  it('should answer 409 VITRINE_BLOQUEE_ADMIN with the motif for the owner while blocked, and change nothing', async () => {
    const m = await creerMondeA2()
    await depublier(m)
    const { publishVitrine } = await vitrinesService()
    const avant = await lireVitrineDe(m.user.id)

    const resultat = await publishVitrine(m.user.id).then(() => null, (erreur: unknown) => erreur as { status?: number, code?: string, data?: Record<string, unknown>, message?: string })

    expect(resultat).toMatchObject({ status: 409, code: 'VITRINE_BLOQUEE_ADMIN' })
    expect(JSON.stringify({ data: resultat?.data, message: resultat?.message })).toContain(MOTIF_DEPUBLICATION)
    expect(await lireVitrineDe(m.user.id)).toEqual(avant)
  })

  it('should answer 409 even when the owner had unpublished the vitrine herself before the block (the block is not a flavour of publiee_le)', async () => {
    const m = await creerMondeA2()
    const { unpublishVitrine, publishVitrine } = await vitrinesService()
    await unpublishVitrine(m.user.id)
    await depublier(m)

    expect(await issue(publishVitrine(m.user.id))).toMatchObject({ ok: false, status: 409, code: 'VITRINE_BLOQUEE_ADMIN' })
  })
})

describe('republier (D-A2-02, motif seul)', () => {
  it('should lift the block without re-onboarding: public page and sitemap come back, publiee_le unchanged', async () => {
    const m = await creerMondeA2()
    await depublier(m)
    const bloquee = await lireVitrineDe(m.user.id)
    const { getPublicVitrinePage } = await vitrinesService()

    const reponse = await republier(m)

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    const apres = await lireVitrineDe(m.user.id)
    expect(apres).toMatchObject({ blocageAdmin: false, blocageMotif: null })
    expect(apres?.publieeLe?.toISOString()).toBe(bloquee?.publieeLe?.toISOString())
    await expect(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)).resolves.toBeDefined()
    const { listerUrlsSitemap } = await import('../../../server/services/seo-sitemap')
    expect((await listerUrlsSitemap(MAINTENANT_A2)).map((u) => u.loc)).toContain(`/${m.vitrine.username}`)
  })

  it('should journal {blocage_admin} true -> false, need no reauthentication, and demand a valid motif', async () => {
    const m = await creerMondeA2()
    await depublier(m)

    expect((await appelerA2('republier', { id: m.vitrine.id, cookie, corps: { motif: 'x' } })).status).toBe(422)
    expect((await lireVitrineDe(m.user.id))?.blocageAdmin).toBe(true)
    expect((await republier(m)).status).toBe(200)

    const [ligne] = await journalDe('vitrine.republier')
    expect(ligne).toMatchObject({ cible_type: 'vitrine', cible_id: m.vitrine.id, avant: { blocage_admin: true }, apres: { blocage_admin: false }, motif: MOTIF_A2 })
  })

  it('should let the owner publish again from the studio after the republication (CA05, last clause)', async () => {
    const m = await creerMondeA2()
    const { unpublishVitrine, publishVitrine, getPublicVitrinePage } = await vitrinesService()
    await depublier(m)
    await republier(m)
    await unpublishVitrine(m.user.id)
    await expect(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)).rejects.toMatchObject({ status: 404 })

    await publishVitrine(m.user.id)

    await expect(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2)).resolves.toBeDefined()
  })

  it('should answer 404 for an unknown vitrine and write nothing', async () => {
    const reponse = await appelerA2('republier', { id: '00000000-0000-4000-8000-000000000000', cookie, corps: { motif: MOTIF_A2 } })

    expect(reponse.status).toBe(404)
    expect(await compterJournal()).toBe(0)
  })
})

describe('dépublication et suspension se cumulent sans s\'annuler', () => {
  it('should keep the vitrine hidden when only ONE of the two flags is lifted', async () => {
    const m = await creerMondeA2()
    const { suspendreEnBase, reactiverEnBase } = await import('../support/admin-a2')
    const { getPublicVitrinePage } = await vitrinesService()
    await depublier(m)
    await suspendreEnBase(m.user.id)

    await republier(m)
    expect((await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))).ok, 'suspendu mais republié').toBe(false)
    await reactiverEnBase(m.user.id)
    expect((await issue(getPublicVitrinePage(m.vitrine.username, MAINTENANT_A2))).ok, 'les deux levés').toBe(true)
  })
})
