import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODE_ANOMALIE_REMPLACE_PAR_MANUEL } from '../../../shared/admin-paiements'
import { ADMIN_REVERIFICATION_VALIDITE_MIN } from '../../../shared/limites'
import { schemaMarquagePaiementReponse } from '../../../shared/schemas/admin-paiements'
import { db } from '../../../server/utils/db'
import { calculerNouvelleEcheance, choisirBase } from '../../../server/services/abonnements-regles'
import { autreCode, demanderEtLireCode, lignesReauth } from '../support/admin'
import { corpsPour, insererPaiement, jours, lireAbonnement, lireEvenements, lirePaiement, lirePaiementsDe, NOW, plus, poserAbonnement, recevoir } from '../support/abonnements'
import { createUser } from '../support/fabriques'
import { lireOutbox } from '../support/notifications'
import {
  ajouterAdmin,
  appelerAdmin,
  cleIdempotence,
  codeMarquage,
  compterOutbox,
  declarerTransaction,
  desinstallerAdmin,
  installerAdmin,
  insererPaiementManuel,
  journalDe,
  MOTIF,
  paiementsDe,
  ROUTES,
  vieillirLigneJournal,
} from '../support/admin-a3'
import type { AdminConnecte } from '../support/admin-a3'

// A3 CA03, CA04, CA05 et D-A3-03 : le marquage manuel CRÉE un nouveau paiement `source='manuel'` (jamais un `reussi` forcé sur
// l'original), prolonge l'abonnement par `confirmerPaiement`, passe l'original à `anomalie` (final) et journalise. Route
// `POST /api/admin/paiements/[id]/marquer-paye`, corps { motif, cleIdempotence }, en-tête `X-Admin-Reauth` (code lié à
// ('paiement.marquer_paye', 'paiement', id)). Base, journal, réauthentification, Redis et K-PAY (faux) : tout est réel sauf K-PAY.
//
// DÉCISIONS POSÉES PAR CES TESTS (la spec ne les tranche pas, voir le rapport) :
//   - un échec métier (409) annule la transaction : le code de réauthentification n'est PAS consommé ;
//   - un original déjà remplacé (anomalie REMPLACE_PAR_MANUEL) ne peut plus être remplacé : sinon deux marquages créditent deux fois ;
//   - les tests de réauthentification n'utilisent que des originaux ÉLIGIBLES : ils ne dépendent pas de l'ordre « règles métier / code ».

let connecte: AdminConnecte

beforeEach(async () => {
  connecte = await installerAdmin()
})

afterEach(() => {
  desinstallerAdmin()
})

interface OptionsMarquage {
  cle?: string
  motif?: string
  code?: string | null
  qui?: AdminConnecte
}

/** Demande un VRAI code lié au paiement (sauf `code` imposé, `null` = aucun en-tête) puis appelle la route. */
async function marquer(id: string, options: OptionsMarquage = {}) {
  const qui = options.qui ?? connecte
  const code = options.code === undefined ? await codeMarquage(qui.admin.id, id) : options.code
  return appelerAdmin(ROUTES.paiementMarquerPaye, qui, {
    chemin: `/api/admin/paiements/${id}/marquer-paye`,
    methode: 'POST',
    params: { id },
    corps: { motif: options.motif ?? MOTIF, cleIdempotence: options.cle ?? cleIdempotence() },
    ...(code === null ? {} : { reauth: code }),
  })
}

const reverifier = (id: string) =>
  appelerAdmin(ROUTES.paiementReverifier, connecte, {
    chemin: `/api/admin/paiements/${id}/reverifier`,
    methode: 'POST',
    params: { id },
    corps: { motif: MOTIF, cleIdempotence: cleIdempotence() },
  })

/** Prix d'un abonnement que la grille actuelle ne propose pas : le marquage doit reprendre CE prix (D-A3-03). */
const PRIX_VU_PAR_LE_CLIENT = 4321

async function originalEchoue(seed: Parameters<typeof insererPaiement>[1] = {}) {
  const user = await createUser()
  const original = await insererPaiement(user.id, {
    statut: 'echoue',
    idFournisseur: null,
    referenceFournisseur: null,
    codeEchec: 'PAYER_NOT_FOUND',
    montantPlan: PRIX_VU_PAR_LE_CLIENT,
    montant: PRIX_VU_PAR_LE_CLIENT,
    periodeMois: 3,
    ...seed,
  })
  return { user, original }
}

const manuels = async (userId: string) => (await paiementsDe(userId)).filter((p) => p.source === 'manuel')
const echeance = (base: Date, avant: Date | null, mois: number): number => calculerNouvelleEcheance(choisirBase(base, avant), mois, 'Africa/Douala').getTime()

describe('marquage manuel : succès (CA03)', () => {
  it('should create a manual succeeded payment, extend the subscription by one period, replace the original and journal it', async () => {
    const { user, original } = await originalEchoue()
    const cle = cleIdempotence()

    const reponse = await marquer(original.id, { cle })

    expect(reponse.status).toBe(200)
    const dto = schemaMarquagePaiementReponse.parse(reponse.corps)
    expect(dto.rejoue).toBe(false)

    const [manuel] = await manuels(user.id)
    expect(manuel).toBeDefined()
    expect(dto.paiementId).toBe(manuel?.id)
    expect(manuel).toMatchObject({
      source: 'manuel',
      fournisseur: 'manuel',
      methode: 'manuel',
      statut: 'reussi',
      idFournisseur: null,
      referenceFournisseur: `manuel-${manuel?.id}`,
      fraisTauxPb: 0,
      fraisEstimes: 0,
      codeEchec: null,
      initiationIncertaine: false,
      userId: user.id,
      // Prix vu par le client, pas la grille du moment.
      montant: PRIX_VU_PAR_LE_CLIENT,
      netEstime: PRIX_VU_PAR_LE_CLIENT,
      devise: original.devise,
      periodeMois: 3,
      plan: original.plan,
    })
    const abonnement = await lireAbonnement(user.id)
    expect(abonnement?.expireLe.getTime()).toBe(echeance(manuel?.appliqueLe ?? new Date(0), null, 3))
    expect(new Date(dto.expireLe).getTime()).toBe(abonnement?.expireLe.getTime())
    expect(manuel?.abonnementExpireApres?.getTime()).toBe(abonnement?.expireLe.getTime())
    expect(abonnement?.origine).toBe('paiement')
    expect(await lirePaiement(original.id)).toMatchObject({ statut: 'anomalie', codeEchec: CODE_ANOMALIE_REMPLACE_PAR_MANUEL })

    const lignes = await journalDe('paiement.marquer_paye')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'paiement', cible_id: original.id, motif: MOTIF, cle_idempotence: cle })
    expect(lignes[0]?.ip.length).toBeGreaterThan(0)
    const brut = JSON.stringify(lignes[0])
    for (const interdit of [user.email, '•']) expect(brut).not.toContain(interdit)
  })

  it('should extend from the current expiry when the subscription is still active', async () => {
    const { user, original } = await originalEchoue()
    const courante = plus(new Date(), jours(20))
    await poserAbonnement(user.id, courante)

    await marquer(original.id)

    const [manuel] = await manuels(user.id)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(echeance(manuel?.appliqueLe ?? new Date(0), courante, 3))
    expect(manuel?.abonnementExpireAvant?.getTime()).toBe(courante.getTime())
  })

  it.each(['echoue', 'expire', 'annule', 'anomalie'] as const)('should accept an original that is %s', async (statut) => {
    const { user, original } = await originalEchoue({ statut, codeEchec: statut === 'anomalie' ? 'MONTANT_INCOHERENT' : 'PAYER_NOT_FOUND' })

    const reponse = await marquer(original.id)

    expect(reponse.status).toBe(200)
    expect(await manuels(user.id)).toHaveLength(1)
    expect((await lirePaiement(original.id)).statut).toBe('anomalie')
  })

  it('should not send any receipt e-mail for a manual payment (D-A3-03), neither for the replaced original', async () => {
    const { user, original } = await originalEchoue()

    await marquer(original.id)

    const [manuel] = await manuels(user.id)
    expect(await compterOutbox('paiement_confirme', manuel?.id)).toBe(0)
    expect(await compterOutbox('paiement_confirme', original.id)).toBe(0)
    expect(await lireOutbox({ entiteId: manuel?.id })).toHaveLength(0)
  })

  it('should replay the same key: same answer (rejoue true), no second payment, no second extension, one journal line', async () => {
    const { user, original } = await originalEchoue()
    const cle = cleIdempotence()
    const premiere = schemaMarquagePaiementReponse.parse((await marquer(original.id, { cle })).corps)
    const expireApres = (await lireAbonnement(user.id))?.expireLe

    // Le rejeu présente un code NEUF : il ne doit être ni exigé en plus, ni provoquer de second effet.
    const rejeu = await marquer(original.id, { cle })

    expect(rejeu.status).toBe(200)
    expect(schemaMarquagePaiementReponse.parse(rejeu.corps)).toEqual({ ...premiere, rejoue: true })
    expect(await manuels(user.id)).toHaveLength(1)
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(expireApres)
    expect(await journalDe('paiement.marquer_paye')).toHaveLength(1)
  })

  it('should refuse the same key reused for ANOTHER payment: 409 IDEMPOTENCE_CONFLIT, the other payment is untouched', async () => {
    const un = await originalEchoue()
    const deux = await originalEchoue()
    const cle = cleIdempotence()
    await marquer(un.original.id, { cle })

    const reponse = await marquer(deux.original.id, { cle })

    expect(reponse).toMatchObject({ status: 409, code: 'IDEMPOTENCE_CONFLIT' })
    expect((await lirePaiement(deux.original.id)).statut).toBe('echoue')
    expect(await manuels(deux.user.id)).toHaveLength(0)
    expect(await lireAbonnement(deux.user.id)).toBeUndefined()
  })
})

describe('marquage manuel : réauthentification (CA04)', () => {
  it('should answer 403 REAUTH_REQUISE without the X-Admin-Reauth header and change nothing', async () => {
    const { user, original } = await originalEchoue()

    const reponse = await marquer(original.id, { code: null })

    expect(reponse).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(await manuels(user.id)).toHaveLength(0)
    expect((await lirePaiement(original.id)).statut).toBe('echoue')
    expect(await journalDe('paiement.marquer_paye')).toHaveLength(0)
  })

  it('should answer 403 REAUTH_INVALIDE for a code already consumed by a first marking, even though the original is eligible again', async () => {
    const { user, original } = await originalEchoue()
    const code = await codeMarquage(connecte.admin.id, original.id)
    expect((await marquer(original.id, { code })).status).toBe(200)
    // L'original redevient éligible (état de départ reconstruit) : seul le code consommé peut justifier le refus.
    await db.execute(sql`UPDATE paiements SET statut = 'echoue', code_echec = NULL WHERE id = ${original.id}`)

    const rejeu = await marquer(original.id, { code })

    expect(rejeu).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect(await manuels(user.id)).toHaveLength(1)
  })

  it('should answer 403 REAUTH_INVALIDE for a wrong code, a code bound to ANOTHER payment, and a code bound to another action', async () => {
    const { user, original } = await originalEchoue()
    const autre = await originalEchoue()
    const bon = await codeMarquage(connecte.admin.id, original.id)
    const pourAutrePaiement = await codeMarquage(connecte.admin.id, autre.original.id)
    const pourAutreAction = (await demanderEtLireCode(connecte.admin.id, { action: 'utilisateur.supprimer', cibleType: 'utilisateur', cibleId: original.id })).code

    for (const code of [autreCode(bon), pourAutrePaiement, pourAutreAction]) {
      const reponse = await marquer(original.id, { code })
      expect(reponse, code).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    }

    expect(await manuels(user.id)).toHaveLength(0)
    expect((await lirePaiement(original.id)).statut).toBe('echoue')
  })

  it('should keep the code usable when the action is refused by a business rule (the failed transaction does not consume it)', async () => {
    const { original } = await originalEchoue({ statut: 'reussi' })
    const code = await codeMarquage(connecte.admin.id, original.id)

    const reponse = await marquer(original.id, { code })

    expect(reponse.status).toBe(409)
    const lignes = (await lignesReauth(connecte.admin.id)).filter((l) => l.cible_id === original.id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]?.consomme_le).toBeNull()
  })

  it.each([
    ['sans motif', { cleIdempotence: 'cle-valide-0001' }],
    ['motif trop court', { motif: 'abc', cleIdempotence: 'cle-valide-0001' }],
    ['sans clé d\'idempotence', { motif: MOTIF }],
    ['clé inconnue dans le corps', { motif: MOTIF, cleIdempotence: 'cle-valide-0001', montant: 1 }],
  ])('should refuse a body %s and write nothing', async (_titre, corps) => {
    const { user, original } = await originalEchoue()
    const code = await codeMarquage(connecte.admin.id, original.id)

    const reponse = await appelerAdmin(ROUTES.paiementMarquerPaye, connecte, {
      chemin: `/api/admin/paiements/${original.id}/marquer-paye`,
      methode: 'POST',
      params: { id: original.id },
      corps,
      reauth: code,
    })

    expect([400, 422]).toContain(reponse.status)
    expect(await manuels(user.id)).toHaveLength(0)
    expect((await lirePaiement(original.id)).statut).toBe('echoue')
  })
})

describe('marquage manuel : éligibilité (CA04, D-A3-03)', () => {
  it('should answer 409 DEJA_PAYE for a succeeded K-PAY payment and write nothing', async () => {
    const { user, original } = await originalEchoue({ statut: 'reussi' })

    const reponse = await marquer(original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'DEJA_PAYE' })
    expect(await manuels(user.id)).toHaveLength(0)
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it('should answer 409 for a payment that is itself manual (DEJA_PAYE or PAIEMENT_NON_ELIGIBLE) and create nothing', async () => {
    const user = await createUser()
    const manuel = await insererPaiementManuel(user.id)

    const reponse = await marquer(manuel.id)

    expect(reponse.status).toBe(409)
    expect(['DEJA_PAYE', 'PAIEMENT_NON_ELIGIBLE']).toContain(reponse.code)
    expect(await manuels(user.id)).toHaveLength(1)
    expect(await lireAbonnement(user.id)).toBeUndefined()
  })

  it.each(['cree', 'en_attente'] as const)('should answer 409 when the target itself is still open (%s): PAIEMENT_OUVERT or PAIEMENT_NON_ELIGIBLE', async (statut) => {
    const { user, original } = await originalEchoue({ statut, idFournisseur: statut === 'en_attente' ? 'tx_ouvert' : null })

    const reponse = await marquer(original.id)

    expect(reponse.status).toBe(409)
    expect(['PAIEMENT_OUVERT', 'PAIEMENT_NON_ELIGIBLE']).toContain(reponse.code)
    expect(await manuels(user.id)).toHaveLength(0)
  })

  it.each(['cree', 'en_attente'] as const)('should answer 409 PAIEMENT_OUVERT when the same user has ANOTHER %s payment', async (statut) => {
    const { user, original } = await originalEchoue()
    await insererPaiement(user.id, { statut, ...(statut === 'cree' ? {} : { idFournisseur: 'tx_ouvert_ailleurs' }) })

    const reponse = await marquer(original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'PAIEMENT_OUVERT' })
    expect(await manuels(user.id)).toHaveLength(0)
    expect((await lirePaiement(original.id)).statut).toBe('echoue')
  })

  it('should not be blocked by an open payment of ANOTHER user', async () => {
    const { user, original } = await originalEchoue()
    const autre = await createUser()
    await insererPaiement(autre.id, { statut: 'en_attente' })

    expect((await marquer(original.id)).status).toBe(200)
    expect(await manuels(user.id)).toHaveLength(1)
  })

  it('should answer 409 PAIEMENT_NON_ELIGIBLE for a payment whose account was deleted (nobody to credit)', async () => {
    const original = await insererPaiement(null, { statut: 'echoue', idFournisseur: null })

    const reponse = await marquer(original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'PAIEMENT_NON_ELIGIBLE' })
  })

  it('should answer 404 PAIEMENT_INTROUVABLE for an unknown payment', async () => {
    const reponse = await marquer('3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10')

    expect(reponse).toMatchObject({ status: 404, code: 'PAIEMENT_INTROUVABLE' })
  })

  it('should refuse to replace the SAME original twice (anomaly already replaced): one manual payment, one extension', async () => {
    const { user, original } = await originalEchoue()
    await marquer(original.id)
    const expireApres = (await lireAbonnement(user.id))?.expireLe

    const seconde = await marquer(original.id)

    expect(seconde.status).toBe(409)
    expect(['DEJA_PAYE', 'PAIEMENT_NON_ELIGIBLE']).toContain(seconde.code)
    expect(await manuels(user.id)).toHaveLength(1)
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(expireApres)
  })

  it('should create only ONE manual payment when two administrators mark the same original at the same time', async () => {
    const { user, original } = await originalEchoue()
    const [a, b] = [connecte, await ajouterAdmin()]
    const [ca, cb] = [await codeMarquage(a.admin.id, original.id), await codeMarquage(b.admin.id, original.id)]

    const reponses = await Promise.all([marquer(original.id, { qui: a, code: ca }), marquer(original.id, { qui: b, code: cb })])

    expect(reponses.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await manuels(user.id)).toHaveLength(1)
    const [manuel] = await manuels(user.id)
    expect((await lireAbonnement(user.id))?.expireLe.getTime()).toBe(echeance(manuel?.appliqueLe ?? new Date(0), null, 3))
  })

  it('should never answer 500 nor double-credit when the SAME key is sent twice at the same time', async () => {
    const { user, original } = await originalEchoue()
    const cle = cleIdempotence()
    const [c1, c2] = [await codeMarquage(connecte.admin.id, original.id), await codeMarquage(connecte.admin.id, original.id)]

    const reponses = await Promise.all([marquer(original.id, { cle, code: c1 }), marquer(original.id, { cle, code: c2 })])

    for (const reponse of reponses) expect([200, 403, 409]).toContain(reponse.status)
    expect(reponses.some((r) => r.status === 200)).toBe(true)
    expect(await manuels(user.id)).toHaveLength(1)
    expect(await journalDe('paiement.marquer_paye')).toHaveLength(1)
  })
})

describe('marquage manuel : revérification préalable (D-A3-03)', () => {
  async function originalChezKpay(seed: Parameters<typeof insererPaiement>[1] = {}, statutKpay: 'FAILED' | 'PENDING' | 'COMPLETED' = 'FAILED') {
    const { user, original } = await originalEchoue({ idFournisseur: `tx_${crypto.randomUUID()}`, ...seed })
    declarerTransaction(original, statutKpay)
    return { user, original }
  }

  it('should answer 409 REVERIFICATION_REQUISE when the payment has a provider identifier and was never re-verified', async () => {
    const { user, original } = await originalChezKpay()

    const reponse = await marquer(original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'REVERIFICATION_REQUISE' })
    expect(await manuels(user.id)).toHaveLength(0)
  })

  it('should accept the marking right after a re-verification that concluded non_reussi, and replace the original', async () => {
    const { user, original } = await originalChezKpay()
    expect((await reverifier(original.id)).status).toBe(200)

    const reponse = await marquer(original.id)

    expect(reponse.status).toBe(200)
    expect(await manuels(user.id)).toHaveLength(1)
    expect((await lirePaiement(original.id))).toMatchObject({ statut: 'anomalie', codeEchec: CODE_ANOMALIE_REMPLACE_PAR_MANUEL })
  })

  it(`should still accept it ${ADMIN_REVERIFICATION_VALIDITE_MIN - 1} minutes after the re-verification, and refuse it ${ADMIN_REVERIFICATION_VALIDITE_MIN + 1} minutes after`, async () => {
    const recente = await originalChezKpay()
    const ancienne = await originalChezKpay()
    await reverifier(recente.original.id)
    await reverifier(ancienne.original.id)
    const lignes = await journalDe('paiement.reverifier')
    const ligneDe = (id: string) => lignes.find((l) => l.cible_id === id)?.id ?? ''
    await vieillirLigneJournal(ligneDe(recente.original.id), ADMIN_REVERIFICATION_VALIDITE_MIN - 1)
    await vieillirLigneJournal(ligneDe(ancienne.original.id), ADMIN_REVERIFICATION_VALIDITE_MIN + 1)

    expect((await marquer(recente.original.id)).status).toBe(200)
    expect(await marquer(ancienne.original.id)).toMatchObject({ status: 409, code: 'REVERIFICATION_REQUISE' })
  })

  it('should refuse the marking when the re-verification did not conclude non_reussi (K-PAY still pending)', async () => {
    const { user, original } = await originalChezKpay({ statut: 'expire' }, 'PENDING')
    await reverifier(original.id)

    const reponse = await marquer(original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'REVERIFICATION_REQUISE' })
    expect(await manuels(user.id)).toHaveLength(0)
  })

  it('should not accept the re-verification of ANOTHER payment as a proof', async () => {
    const proche = await originalChezKpay()
    const cible = await originalChezKpay()
    await reverifier(proche.original.id)

    const reponse = await marquer(cible.original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'REVERIFICATION_REQUISE' })
  })

  it('should answer DEJA_PAYE, not mark anything, when the re-verification discovers that K-PAY DID collect the money', async () => {
    const { user, original } = await originalChezKpay({ statut: 'expire' }, 'COMPLETED')
    const verif = await reverifier(original.id)
    expect(verif.status).toBe(200)

    const reponse = await marquer(original.id)

    expect(reponse).toMatchObject({ status: 409, code: 'DEJA_PAYE' })
    expect(await manuels(user.id)).toHaveLength(0)
    expect((await lireAbonnement(user.id))?.expireLe).toBeInstanceOf(Date)
    expect((await lirePaiementsDe(user.id)).filter((p) => p.statut === 'reussi')).toHaveLength(1)
  })

  it('should require the re-verification when the initiation was uncertain, even for a payment that K-PAY knows', async () => {
    const { original } = await originalChezKpay({ initiationIncertaine: true })

    expect(await marquer(original.id)).toMatchObject({ status: 409, code: 'REVERIFICATION_REQUISE' })
  })
})

describe('marquage manuel : encaissement tardif de K-PAY sur l\'original (CA05)', () => {
  it('should ignore a late payment.completed on the replaced original as STATUT_FINAL: no second extension, no receipt', async () => {
    const { user, original } = await originalEchoue()
    await marquer(original.id)
    const expireApres = (await lireAbonnement(user.id))?.expireLe

    const reponse = await recevoir(corpsPour(original), { now: plus(NOW, jours(1)) })

    expect(reponse.status).toBe(200)
    const tardif = (await lireEvenements()).filter((e) => e.evenement === 'payment.completed')
    expect(tardif).toHaveLength(1)
    expect(tardif[0]).toMatchObject({ traitement: 'ignore', motif: 'STATUT_FINAL', paiementId: original.id })
    expect((await lireAbonnement(user.id))?.expireLe).toEqual(expireApres)
    expect(await compterOutbox('paiement_confirme', original.id)).toBe(0)
    expect((await lirePaiement(original.id)).statut).toBe('anomalie')
    expect((await lirePaiementsDe(user.id)).filter((p) => p.statut === 'reussi')).toHaveLength(1)
  })
})
