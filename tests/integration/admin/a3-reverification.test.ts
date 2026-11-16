import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_REVERIFICATION_LIMIT, KPAY_APPELS_MAX_PAR_MINUTE } from '../../../shared/limites'
import { calculerNouvelleEcheance, choisirBase } from '../../../server/services/abonnements-regles'
import { schemaPaiementDetailDto, schemaReverificationReponse } from '../../../shared/schemas/admin-paiements'
import { insererPaiement, lireAbonnement, lirePaiement, recevoir, corpsPour, ECHEANCE_1_MOIS_DEPUIS_NOW, saturerBudgetKpay, NOW } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { fauxKpay } from '../support/env-kpay'
import {
  ajouterAdmin,
  appelerAdmin,
  cleIdempotence,
  compterEvenements,
  compterOutbox,
  declarerTransaction,
  desinstallerAdmin,
  installerAdmin,
  journalDe,
  MOTIF,
  NUMERO_PAYEUR,
  ROUTES,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 CA01, CA02, CA12 et D-A3-04 : la revérification admin = `consulter` (faux K-PAY, adaptateur RÉEL) puis `appliquerEvenement`
// (même chemin que le webhook, source `interrogation`). Base, Redis (limiteur, budget K-PAY), journal d'administration et
// session Better Auth RÉELS. `POST /api/admin/paiements/[id]/reverifier`, corps { motif, cleIdempotence }.

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

const reverifier = (id: string, corps: Record<string, unknown> = { motif: MOTIF, cleIdempotence: cleIdempotence() }, qui: AdminConnecte = connecte) =>
  appelerAdmin(ROUTES.paiementReverifier, qui, { chemin: `/api/admin/paiements/${id}/reverifier`, methode: 'POST', params: { id }, corps })

/** Échéance attendue d'un premier paiement d'un mois appliqué à `appliqueLe` (les routes lisent l'horloge système). */
const echeanceUnMois = (appliqueLe: Date | null): number => calculerNouvelleEcheance(choisirBase(appliqueLe ?? new Date(0), null), 1, 'Africa/Douala').getTime()

async function paiementOuvertChezKpay(statutKpay: 'COMPLETED' | 'FAILED' | 'PENDING' = 'COMPLETED', seed: Parameters<typeof insererPaiement>[1] = {}) {
  const user = await createUser()
  const paiement = await insererPaiement(user.id, seed)
  declarerTransaction(paiement, statutKpay)
  return { user, paiement }
}

describe('revérification : succès chez K-PAY (CA01)', () => {
  it('should apply a pending payment confirmed by K-PAY: reussi, one extension, real fees, one receipt, source interrogation', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')

    const reponse = await reverifier(paiement.id)

    expect(reponse.status).toBe(200)
    expect(schemaReverificationReponse.parse(reponse.corps)).toEqual({ resultat: 'applique', statut: 'reussi', rejoue: false })
    const lu = await lirePaiement(paiement.id)
    expect(lu).toMatchObject({ statut: 'reussi', fraisReels: 250, netReel: 4750 })
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(lu.abonnementExpireApres)
    expect(await compterOutbox('paiement_confirme', paiement.id)).toBe(1)
    expect(await compterEvenements()).toBe(1)
    expect(fauxKpay.consultations).toHaveLength(1)
  })

  it('should move expire_le only on the first application: 3 re-verifications with 3 different keys of a paid payment all answer deja_applique', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')
    await recevoir(corpsPour(paiement), { now: NOW })
    const apres = (await lireAbonnement(user.id))?.expireLe
    expect(apres?.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())

    const reponses = [await reverifier(paiement.id), await reverifier(paiement.id), await reverifier(paiement.id)]

    for (const reponse of reponses) {
      expect(reponse.status).toBe(200)
      expect(schemaReverificationReponse.parse(reponse.corps)).toMatchObject({ resultat: 'deja_applique', statut: 'reussi', rejoue: false })
    }
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(apres)
    expect(await compterOutbox('paiement_confirme', paiement.id)).toBe(1)
    expect(await compterEvenements()).toBe(1)
  })

  it('should answer deja_applique for the 2nd and 3rd re-verification when the 1st one is the one that applied it', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')

    const premiere = await reverifier(paiement.id)
    const apres = (await lireAbonnement(user.id))?.expireLe
    const suivantes = [await reverifier(paiement.id), await reverifier(paiement.id)]

    expect(schemaReverificationReponse.parse(premiere.corps).resultat).toBe('applique')
    expect(suivantes.map((r) => schemaReverificationReponse.parse(r.corps).resultat)).toEqual(['deja_applique', 'deja_applique'])
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(apres)
    expect(await journalDe('paiement.reverifier')).toHaveLength(3)
  })
})

describe('revérification : concurrence (CA02)', () => {
  it('should extend once and send one receipt when two re-verifications of the same pending payment run in parallel', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')

    const reponses = await Promise.all([reverifier(paiement.id), reverifier(paiement.id)])

    expect(reponses.map((r) => r.status)).toEqual([200, 200])
    const resultats = reponses.map((r) => schemaReverificationReponse.parse(r.corps).resultat).sort()
    expect(resultats).toEqual(['applique', 'deja_applique'])
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(echeanceUnMois((await lirePaiement(paiement.id)).appliqueLe))
    expect(await compterOutbox('paiement_confirme', paiement.id)).toBe(1)
    expect(await compterEvenements()).toBe(1)
  })

  it('should extend once when a webhook and two re-verifications hit the same payment at the same time', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')

    const [webhook, ...reverifs] = await Promise.all([recevoir(corpsPour(paiement), { now: NOW }), reverifier(paiement.id), reverifier(paiement.id)])

    expect(webhook.status).toBe(200)
    expect(reverifs.map((r) => r.status)).toEqual([200, 200])
    const lu = await lirePaiement(paiement.id)
    expect(lu.statut).toBe('reussi')
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(echeanceUnMois(lu.appliqueLe))
    expect(lu.abonnementExpireApres?.getTime()).toBe(echeanceUnMois(lu.appliqueLe))
    expect(await compterOutbox('paiement_confirme', paiement.id)).toBe(1)
  })
})

describe('revérification : autres issues chez K-PAY', () => {
  it('should report non_reussi and fail the payment when K-PAY says FAILED, without any extension', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('FAILED')

    const reponse = await reverifier(paiement.id)

    expect(schemaReverificationReponse.parse(reponse.corps)).toEqual({ resultat: 'non_reussi', statut: 'echoue', rejoue: false })
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await compterOutbox('paiement_confirme', paiement.id)).toBe(0)
  })

  it('should leave the payment untouched and report en_attente when K-PAY has not decided yet', async () => {
    const { paiement } = await paiementOuvertChezKpay('PENDING')
    const avant = await lirePaiement(paiement.id)

    const reponse = await reverifier(paiement.id)

    expect(schemaReverificationReponse.parse(reponse.corps)).toEqual({ resultat: 'en_attente', statut: 'en_attente', rejoue: false })
    expect(await lirePaiement(paiement.id)).toEqual(avant)
  })

  it('should turn a K-PAY success carrying the NET amount into an anomaly: no extension, no receipt', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')
    declarerTransaction(paiement, 'COMPLETED', { montant: 4750 })

    const reponse = await reverifier(paiement.id)

    expect(schemaReverificationReponse.parse(reponse.corps)).toEqual({ resultat: 'refuse_anomalie', statut: 'anomalie', rejoue: false })
    expect(await lirePaiement(paiement.id)).toMatchObject({ statut: 'anomalie', codeEchec: 'MONTANT_INCOHERENT' })
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await compterOutbox('paiement_confirme', paiement.id)).toBe(0)
  })

  it('should answer 404 PAIEMENT_INTROUVABLE for an unknown payment, without calling K-PAY nor writing the journal', async () => {
    const reponse = await reverifier('3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10')

    expect(reponse).toMatchObject({ status: 404, code: 'PAIEMENT_INTROUVABLE' })
    expect(fauxKpay.consultations).toHaveLength(0)
    expect(await journalDe('paiement.reverifier')).toHaveLength(0)
  })
})

describe('revérification : K-PAY indisponible, budget et limite (CA12, D-A3-04)', () => {
  it('should answer 503 FOURNISSEUR_INDISPONIBLE when K-PAY fails, change nothing, journal nothing, and let the same key be retried', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')
    const avant = await lirePaiement(paiement.id)
    const corps = { motif: MOTIF, cleIdempotence: cleIdempotence() }
    fauxKpay.definirConsultation({ type: 'http', status: 500 })

    const panne = await reverifier(paiement.id, corps)

    expect(panne).toMatchObject({ status: 503, code: 'FOURNISSEUR_INDISPONIBLE' })
    expect(await lirePaiement(paiement.id)).toEqual(avant)
    expect(await lireAbonnement(user.id)).toBeUndefined()
    expect(await journalDe('paiement.reverifier')).toHaveLength(0)

    fauxKpay.definirConsultation({ type: 'selon-transaction' })
    const reprise = await reverifier(paiement.id, corps)

    expect(reprise.status).toBe(200)
    expect(schemaReverificationReponse.parse(reprise.corps)).toMatchObject({ resultat: 'applique', rejoue: false })
  })

  it('should answer 503 FOURNISSEUR_INDISPONIBLE with Retry-After and NOT call K-PAY when the shared K-PAY budget is exhausted', async () => {
    const { paiement } = await paiementOuvertChezKpay('COMPLETED')
    await saturerBudgetKpay(KPAY_APPELS_MAX_PAR_MINUTE)

    const reponse = await reverifier(paiement.id)

    expect(reponse).toMatchObject({ status: 503, code: 'FOURNISSEUR_INDISPONIBLE' })
    expect(Number(reponse.entetes['retry-after'])).toBeGreaterThan(0)
    expect(fauxKpay.consultations).toHaveLength(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
  })

  it('should spend the shared K-PAY budget: with one call left the first re-verification passes and the next one is refused', async () => {
    const { paiement } = await paiementOuvertChezKpay('PENDING')
    await saturerBudgetKpay(KPAY_APPELS_MAX_PAR_MINUTE - 1)

    const premiere = await reverifier(paiement.id)
    const seconde = await reverifier(paiement.id)

    expect(premiere.status).toBe(200)
    expect(seconde).toMatchObject({ status: 503, code: 'FOURNISSEUR_INDISPONIBLE' })
    expect(fauxKpay.consultations).toHaveLength(1)
  })

  it('should never block a webhook, even when the K-PAY budget is exhausted (R3)', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')
    await saturerBudgetKpay(KPAY_APPELS_MAX_PAR_MINUTE)

    const reponse = await recevoir(corpsPour(paiement), { now: NOW })

    expect(reponse.status).toBe(200)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(ECHEANCE_1_MOIS_DEPUIS_NOW.getTime())
  })

  it('should limit one administrator to 10 re-verifications per minute (429 + Retry-After on the 11th, K-PAY called 10 times only)', async () => {
    const { paiement } = await paiementOuvertChezKpay('COMPLETED', { statut: 'reussi' })

    const reponses = []
    for (let i = 0; i <= ADMIN_REVERIFICATION_LIMIT.limit; i += 1) reponses.push(await reverifier(paiement.id))

    expect(reponses.slice(0, ADMIN_REVERIFICATION_LIMIT.limit).map((r) => r.status)).toEqual(Array(ADMIN_REVERIFICATION_LIMIT.limit).fill(200))
    const onzieme = reponses[ADMIN_REVERIFICATION_LIMIT.limit]
    expect(onzieme).toMatchObject({ status: 429, code: 'TROP_DE_REQUETES' })
    expect(Number(onzieme?.entetes['retry-after'])).toBeGreaterThan(0)
    expect(fauxKpay.consultations).toHaveLength(ADMIN_REVERIFICATION_LIMIT.limit)
  })

  it('should count the limit per administrator: a second administrator is not blocked by the first one', async () => {
    const { paiement } = await paiementOuvertChezKpay('COMPLETED', { statut: 'reussi' })
    for (let i = 0; i < ADMIN_REVERIFICATION_LIMIT.limit; i += 1) await reverifier(paiement.id)
    const autre = await ajouterAdmin()

    const reponse = await reverifier(paiement.id, { motif: MOTIF, cleIdempotence: cleIdempotence() }, autre)

    expect(reponse.status).toBe(200)
  })
})

describe('revérification : clé d\'idempotence et validation', () => {
  it('should replay the recorded answer for the same key (rejoue: true) without calling K-PAY again nor writing a second journal line', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')
    const corps = { motif: MOTIF, cleIdempotence: cleIdempotence() }

    const premiere = await reverifier(paiement.id, corps)
    const rejeu = await reverifier(paiement.id, corps)

    expect(schemaReverificationReponse.parse(premiere.corps)).toEqual({ resultat: 'applique', statut: 'reussi', rejoue: false })
    expect(rejeu.status).toBe(200)
    expect(schemaReverificationReponse.parse(rejeu.corps)).toEqual({ resultat: 'applique', statut: 'reussi', rejoue: true })
    expect(fauxKpay.consultations).toHaveLength(1)
    expect(await journalDe('paiement.reverifier')).toHaveLength(1)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(echeanceUnMois((await lirePaiement(paiement.id)).appliqueLe))
  })

  it('should refuse the same key reused for ANOTHER payment (409 IDEMPOTENCE_CONFLIT), without calling K-PAY for it', async () => {
    const un = await paiementOuvertChezKpay('PENDING')
    const deux = await paiementOuvertChezKpay('COMPLETED')
    const corps = { motif: MOTIF, cleIdempotence: cleIdempotence() }
    await reverifier(un.paiement.id, corps)

    const reponse = await reverifier(deux.paiement.id, corps)

    expect(reponse).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
    expect(fauxKpay.consultations).toHaveLength(1)
    expect((await lirePaiement(deux.paiement.id)).statut).toBe('en_attente')
  })

  it('should treat the same key of ANOTHER administrator as a different request', async () => {
    const { paiement } = await paiementOuvertChezKpay('PENDING')
    const corps = { motif: MOTIF, cleIdempotence: cleIdempotence() }
    await reverifier(paiement.id, corps)
    const autre = await ajouterAdmin()

    const reponse = await reverifier(paiement.id, corps, autre)

    expect(reponse.status).toBe(200)
    expect(schemaReverificationReponse.parse(reponse.corps).rejoue).toBe(false)
    expect(fauxKpay.consultations).toHaveLength(2)
  })

  it.each([
    ['sans motif', { cleIdempotence: 'cle-valide-0001' }],
    ['motif trop court', { motif: 'abc', cleIdempotence: 'cle-valide-0001' }],
    ['sans clé d\'idempotence', { motif: MOTIF }],
    ['clé trop courte', { motif: MOTIF, cleIdempotence: 'court' }],
    ['clé aux caractères interdits', { motif: MOTIF, cleIdempotence: 'cle avec des espaces !' }],
    ['clé inconnue dans le corps', { motif: MOTIF, cleIdempotence: 'cle-valide-0001', telephone: NUMERO_PAYEUR }],
  ])('should refuse a body %s before any call to K-PAY', async (_titre, corps) => {
    const { paiement } = await paiementOuvertChezKpay('COMPLETED')

    const reponse = await reverifier(paiement.id, corps)

    expect([400, 422]).toContain(reponse.status)
    expect(fauxKpay.consultations).toHaveLength(0)
    expect((await lirePaiement(paiement.id)).statut).toBe('en_attente')
    expect(await journalDe('paiement.reverifier')).toHaveLength(0)
  })
})

describe('revérification : journal et confidentialité', () => {
  it('should journal one paiement.reverifier line (admin, target, motive, key, ip) with no personal data', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')
    const cle = cleIdempotence()

    await reverifier(paiement.id, { motif: MOTIF, cleIdempotence: cle })

    const lignes = await journalDe('paiement.reverifier')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'paiement', cible_id: paiement.id, motif: MOTIF, cle_idempotence: cle })
    expect(lignes[0]?.ip.length).toBeGreaterThan(0)
    const brut = JSON.stringify(lignes[0])
    for (const interdit of [user.email, NUMERO_PAYEUR, '•']) expect(brut).not.toContain(interdit)
  })

  it('should never expose the payer number, the e-mail or the fingerprint in the answer, even though K-PAY returns the number', async () => {
    const { user, paiement } = await paiementOuvertChezKpay('COMPLETED')

    const reponse = await reverifier(paiement.id)

    const brut = JSON.stringify(reponse.corps)
    for (const interdit of [NUMERO_PAYEUR, user.email, paiement.telephoneEmpreinte ?? 'jamais', '•']) expect(brut).not.toContain(interdit)
  })

  it('should record the conclusion so that the payment detail shows reverifieNonReussiLe only after a non_reussi answer', async () => {
    const echoue = await paiementOuvertChezKpay('FAILED', { statut: 'echoue' })
    const reussi = await paiementOuvertChezKpay('COMPLETED')
    await reverifier(echoue.paiement.id)
    await reverifier(reussi.paiement.id)

    const detail = async (id: string) => schemaPaiementDetailDto.parse((await appelerAdmin(ROUTES.paiementDetail, connecte, { chemin: `/api/admin/paiements/${id}`, params: { id } })).corps)

    const apresEchec = await detail(echoue.paiement.id)
    const apresSucces = await detail(reussi.paiement.id)
    expect(apresEchec.reverifieNonReussiLe).not.toBeNull()
    expect(Date.now() - new Date(apresEchec.reverifieNonReussiLe ?? 0).getTime()).toBeLessThan(60_000)
    expect(apresSucces.reverifieNonReussiLe).toBeNull()
  })
})
