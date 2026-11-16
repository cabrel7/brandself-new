import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { db } from '../../../server/utils/db'
import {
  auditService,
  avecJournalEnPanne,
  compterJournal,
  lireJournal,
  lireSessions,
  ouvrirAdmin,
  preparerSuiteAdmin,
  retirerPanneJournal,
} from '../support/admin'
import {
  CLE_A,
  MOTIF_A2,
  MOTIF_SUSPENSION,
  appelerA2,
  bloquerEnBase,
  codeReauthPour,
  compterEmailsOutbox,
  creerCompteSimple,
  creerMondeA2,
  etatOauth,
  lireAbonnementDe,
  lireUtilisateur,
  lireVitrineDe,
  poserAssistant,
  suspendreEnBase,
  viderClientsOauth,
} from '../support/admin-a2'
import type { RouteA2 } from '../support/admin-a2'
import { createSession } from '../support/fabriques'
import { fichiersDeLUtilisateur } from '../support/disque'

// A2 CA10 et règles communes de TOUTES les routes d'écriture : une transaction, journal atomique (échec forcé du
// journal = rollback total : aucun changement d'état, aucun e-mail, la réauthentification et la clé d'idempotence
// restent utilisables), motif obligatoire, aucun secret dans le journal. L'échec du journal est RÉEL : un déclencheur de
// test fait refuser l'insertion par PostgreSQL (aucun mock).

const suite = preparerSuiteAdmin()
let admin: Awaited<ReturnType<typeof ouvrirAdmin>>['admin']
let cookie: string

beforeEach(async () => {
  await retirerPanneJournal()
  await viderClientsOauth()
  ;({ admin, cookie } = await ouvrirAdmin(suite.auth()))
})

interface Preparation {
  id: string
  corps: Record<string, unknown>
  /** Nécessite la réauthentification (`codeReauthPour` sur cet identifiant). */
  reauth: boolean
  /** Nécessite l'en-tête Idempotency-Key. */
  cle: boolean
  /** Photographie de l'état que l'action modifie : égale avant et après un échec. */
  etat: () => Promise<unknown>
  action: string
}

interface Cas {
  nom: string
  route: RouteA2
  preparer: () => Promise<Preparation>
}

const CAS: readonly Cas[] = [
  {
    nom: 'suspendre',
    route: 'suspendre',
    preparer: async () => {
      const m = await creerMondeA2()
      await createSession(m.user.id)
      await poserAssistant(m.user.id)
      return {
        id: m.user.id,
        corps: { motif: MOTIF_SUSPENSION },
        reauth: true,
        cle: false,
        action: ADMIN_ACTIONS.utilisateurSuspendre,
        etat: async () => ({ u: (await lireUtilisateur(m.user.id))?.banned, s: (await lireSessions(m.user.id)).length, o: await etatOauth(m.user.id) }),
      }
    },
  },
  {
    nom: 'réactiver',
    route: 'reactiver',
    preparer: async () => {
      const { user } = await creerCompteSimple()
      await suspendreEnBase(user.id)
      return { id: user.id, corps: { motif: MOTIF_A2 }, reauth: false, cle: false, action: ADMIN_ACTIONS.utilisateurReactiver, etat: async () => (await lireUtilisateur(user.id))?.banned }
    },
  },
  {
    nom: 'offrir des jours',
    route: 'offrirJours',
    preparer: async () => {
      const { user } = await creerCompteSimple()
      return { id: user.id, corps: { motif: MOTIF_A2, jours: 30 }, reauth: false, cle: true, action: ADMIN_ACTIONS.utilisateurOffrirJours, etat: async () => (await lireAbonnementDe(user.id))?.expireLe.toISOString() ?? null }
    },
  },
  {
    nom: 'changer le plan',
    route: 'changerPlan',
    preparer: async () => {
      const { user } = await creerCompteSimple()
      return { id: user.id, corps: { motif: MOTIF_A2, plan: 'payant', jours: 30 }, reauth: true, cle: true, action: ADMIN_ACTIONS.utilisateurChangerPlan, etat: async () => (await lireAbonnementDe(user.id))?.expireLe.toISOString() ?? null }
    },
  },
  {
    nom: 'révoquer les sessions',
    route: 'revoquerSessions',
    preparer: async () => {
      const { user } = await creerCompteSimple()
      await createSession(user.id)
      return { id: user.id, corps: { motif: MOTIF_A2 }, reauth: false, cle: false, action: ADMIN_ACTIONS.utilisateurRevoquerSessions, etat: async () => (await lireSessions(user.id)).length }
    },
  },
  {
    nom: 'retirer les assistants',
    route: 'retirerAssistants',
    preparer: async () => {
      const { user } = await creerCompteSimple()
      await poserAssistant(user.id)
      return { id: user.id, corps: { motif: MOTIF_A2 }, reauth: false, cle: false, action: ADMIN_ACTIONS.utilisateurRetirerAssistants, etat: async () => etatOauth(user.id) }
    },
  },
  {
    nom: 'supprimer',
    route: 'supprimer',
    preparer: async () => {
      const m = await creerMondeA2()
      return {
        id: m.user.id,
        corps: { motif: MOTIF_A2, emailConfirmation: m.user.email },
        reauth: true,
        cle: false,
        action: ADMIN_ACTIONS.utilisateurSupprimer,
        etat: async () => ({ u: await lireUtilisateur(m.user.id) !== undefined, f: (await fichiersDeLUtilisateur(m.user.id)).length }),
      }
    },
  },
  {
    nom: 'dépublier',
    route: 'depublier',
    preparer: async () => {
      const m = await creerMondeA2()
      return { id: m.vitrine.id, corps: { motif: MOTIF_A2 }, reauth: true, cle: false, action: ADMIN_ACTIONS.vitrineDepublier, etat: async () => (await lireVitrineDe(m.user.id))?.blocageAdmin }
    },
  },
  {
    nom: 'republier',
    route: 'republier',
    preparer: async () => {
      const m = await creerMondeA2()
      await bloquerEnBase(m.vitrine.id)
      return { id: m.vitrine.id, corps: { motif: MOTIF_A2 }, reauth: false, cle: false, action: ADMIN_ACTIONS.vitrineRepublier, etat: async () => (await lireVitrineDe(m.user.id))?.blocageAdmin }
    },
  },
  {
    nom: 'retirer un assistant',
    route: 'assistantRetirer',
    preparer: async () => {
      const { user } = await creerCompteSimple()
      const a = await poserAssistant(user.id)
      return { id: a.consentementId, corps: { motif: MOTIF_A2 }, reauth: false, cle: false, action: ADMIN_ACTIONS.assistantRetirer, etat: async () => etatOauth(user.id) }
    },
  },
]

async function lancer(cas: Cas, p: Preparation, surcharges: { corps?: unknown, code?: string | null } = {}) {
  const code = surcharges.code === null || !p.reauth ? undefined : (surcharges.code ?? await codeReauthPour(admin.id, cas.route, p.id))
  return {
    code,
    appel: () => appelerA2(cas.route, {
      id: p.id,
      cookie,
      ...(code === undefined ? {} : { reauth: code }),
      ...(p.cle ? { cleIdempotence: CLE_A } : {}),
      corps: surcharges.corps ?? p.corps,
    }),
  }
}

describe.each(CAS)('écriture « $nom » : atomicité du journal (CA10)', (cas) => {
  it('should roll back EVERYTHING when the journal write fails: same state, no e-mail, no journal line, no internal detail leaked', async () => {
    const p = await cas.preparer()
    const avant = await p.etat()
    const { appel } = await lancer(cas, p)

    const reponse = await avecJournalEnPanne(appel)

    expect(reponse.status).toBe(500)
    expect(reponse.code).toBe('ERREUR_INTERNE')
    expect(JSON.stringify(reponse)).not.toMatch(/panne de journal|journal_admin|trigger|plpgsql/i)
    expect(await p.etat()).toEqual(avant)
    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
  })

  it('should let the SAME request succeed afterwards (reauthentication code and idempotency key are not burnt by the failure)', async () => {
    const p = await cas.preparer()
    const avant = await p.etat()
    const { appel } = await lancer(cas, p)
    expect((await avecJournalEnPanne(appel)).status).toBe(500)

    const reprise = await appel()

    expect(reprise.status).toBe(200)
    expect(JSON.stringify(reprise.corps)).not.toContain('"rejoue":true')
    expect(await p.etat()).not.toEqual(avant)
    expect((await lireJournal()).map((l) => l.action)).toEqual([p.action])
  })
})

describe.each(CAS)('écriture « $nom » : motif et journal', (cas) => {
  it.each([
    ['missing', undefined],
    ['4 characters', 'abcd'],
    ['only spaces', '          '],
    ['501 characters', 'z'.repeat(501)],
  ])('should answer 422 and change nothing when the motif is %s, without burning the reauthentication code', async (_cas, motif) => {
    const p = await cas.preparer()
    const avant = await p.etat()
    const { code } = await lancer(cas, p)
    const mauvais = { ...p.corps, ...(motif === undefined ? {} : { motif }) }
    if (motif === undefined) delete (mauvais as Record<string, unknown>).motif

    const reponse = await appelerA2(cas.route, { id: p.id, cookie, ...(code === undefined ? {} : { reauth: code }), ...(p.cle ? { cleIdempotence: CLE_A } : {}), corps: mauvais })

    expect(reponse.status).toBe(422)
    expect(await p.etat()).toEqual(avant)
    expect(await compterJournal()).toBe(0)
    expect(await compterEmailsOutbox()).toBe(0)
    const bonne = await appelerA2(cas.route, { id: p.id, cookie, ...(code === undefined ? {} : { reauth: code }), ...(p.cle ? { cleIdempotence: CLE_A } : {}), corps: p.corps })
    expect(bonne.status, 'le même code sert encore après un 422').toBe(200)
  })

  it('should answer 422 for an unknown key in the body (strict schemas, no mass assignment)', async () => {
    const p = await cas.preparer()
    const avant = await p.etat()
    const { appel } = await lancer(cas, p, { corps: { ...p.corps, role: 'superadmin', suspendu: false } })

    const reponse = await appel()

    expect(reponse.status).toBe(422)
    expect(await p.etat()).toEqual(avant)
    expect(await compterJournal()).toBe(0)
  })

  it('should write ONE journal line with the right action, the admin, the target type and the motif, and never a secret', async () => {
    const p = await cas.preparer()
    const { appel, code } = await lancer(cas, p)

    const reponse = await appel()

    expect(reponse.status).toBe(200)
    const lignes = await lireJournal()
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ action: p.action, admin_id: admin.id, motif: p.corps.motif })
    expect(lignes[0]?.ip.length).toBeGreaterThan(0)
    const brut = JSON.stringify([lignes[0]?.avant, lignes[0]?.apres, lignes[0]?.cible_id, lignes[0]?.motif])
    if (code !== undefined) expect(brut).not.toContain(code)
    expect(brut).not.toContain(cookie)
    const { verifierChaine } = await auditService()
    expect(await verifierChaine(db)).toEqual({ intacte: true, premiereRupture: null })
  })

  it('should refuse a body that names another target (the target comes from the URL only), and leave that other target untouched', async () => {
    const p = await cas.preparer()
    const autre = await cas.preparer()
    const avantAutre = await autre.etat()
    const { appel } = await lancer(cas, p, { corps: { ...p.corps, id: autre.id, cibleId: autre.id, utilisateurId: autre.id } })

    const reponse = await appel()

    expect(reponse.status).toBe(422)
    expect(await autre.etat()).toEqual(avantAutre)
  })
})

describe('réauthentification : les routes qui l\'exigent, et celles qui ne l\'exigent pas (D-A2-07)', () => {
  it.each(CAS.filter((c) => c.nom !== 'retirer un assistant'))('should treat the x-admin-reauth header of « $nom » as required only where D-A2-07 says so', async (cas) => {
    const p = await cas.preparer()
    const avant = await p.etat()
    const { appel } = await lancer(cas, p, { code: null })

    const sans = await appel()

    if (p.reauth) {
      expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
      expect(await p.etat()).toEqual(avant)
      expect(await compterJournal()).toBe(0)
    } else {
      expect(sans.status).toBe(200)
    }
  })

  it('should refuse a reauthentication code issued by ANOTHER administrator', async () => {
    const { admin: autreAdmin } = await ouvrirAdmin(suite.auth())
    const m = await creerMondeA2()
    const codeAutreAdmin = await codeReauthPour(autreAdmin.id, 'suspendre', m.user.id)

    const reponse = await appelerA2('suspendre', { id: m.user.id, cookie, reauth: codeAutreAdmin, corps: { motif: MOTIF_SUSPENSION } })

    expect(reponse).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
  })

  it('should refuse an expired reauthentication code', async () => {
    const m = await creerMondeA2()
    const code = await codeReauthPour(admin.id, 'suspendre', m.user.id)
    await db.execute(sql`UPDATE admin_reauth SET expire_le = now() - interval '1 minute' WHERE admin_id = ${admin.id}`)

    const reponse = await appelerA2('suspendre', { id: m.user.id, cookie, reauth: code, corps: { motif: MOTIF_SUSPENSION } })

    expect(reponse).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
  })

  it('should lock a code after 3 wrong attempts: even the right code is then refused', async () => {
    const m = await creerMondeA2()
    const code = await codeReauthPour(admin.id, 'suspendre', m.user.id)
    const faux = code === '123456' ? '654321' : '123456'
    for (let i = 0; i < 3; i += 1) {
      expect((await appelerA2('suspendre', { id: m.user.id, cookie, reauth: faux, corps: { motif: MOTIF_SUSPENSION } })).status).toBe(403)
    }

    const bon = await appelerA2('suspendre', { id: m.user.id, cookie, reauth: code, corps: { motif: MOTIF_SUSPENSION } })

    expect(bon).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect((await lireUtilisateur(m.user.id))?.banned).toBe(false)
  })
})

describe('identifiants de cible', () => {
  it.each(CAS)('should answer 404 or 422 (never 500) for a malformed or unknown id on « $nom »', async (cas) => {
    const p = await cas.preparer()
    for (const id of [randomUUID(), 'x'.repeat(65), '\' OR 1=1 --', '../../etc/passwd']) {
      const code = p.reauth ? await codeReauthPour(admin.id, cas.route, id.length > 64 ? p.id : id) : undefined
      const reponse = await appelerA2(cas.route, { id, cookie, ...(code === undefined ? {} : { reauth: code }), ...(p.cle ? { cleIdempotence: CLE_A } : {}), corps: p.corps })
      expect([403, 404, 422], `${cas.nom} / ${id}`).toContain(reponse.status)
    }
    expect(await compterJournal()).toBe(0)
  })
})
