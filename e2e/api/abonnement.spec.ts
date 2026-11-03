import { createHmac, randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { WEBHOOK_CORPS_MAX_OCTETS } from '../../shared/limites'
import { attendreErreur, BASE_URL, db, fermerConnexions, lireEnv, requeteBrute, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// S10 §4 et §6 (CA36, CA41, CA48 à CA51, CA95 à CA99) : contrats HTTP de l'abonnement, des paiements, des tarifs publics et du webhook,
// serveur réel, session Better Auth réelle, PostgreSQL réel. AUCUNE initiation réelle ici : un POST valide appellerait K-PAY (le bac à
// sable réel avec les clés du développeur) ; les parcours d'initiation passent par le faux serveur dans e2e/abonnement.spec.ts (lot F2)
// et par les tests d'intégration. Les 401 sans session sont dans e2e/api/studio-auth.spec.ts.
// Le secret de webhook vient de l'environnement du serveur de test (comme les autres variables) : s'il est absent, le contrat est « 503 »
// (CA50) et les assertions de signature sont remplacées par celle-ci. Rien n'est sauté.

function secretWebhook(): string | undefined {
  try {
    const valeur = lireEnv('KPAY_WEBHOOK_SECRET')
    return valeur === '' ? undefined : valeur
  } catch {
    return undefined
  }
}

const SECRET = secretWebhook()
const CORPS_MAX = WEBHOOK_CORPS_MAX_OCTETS
const ASCII_SANS_SECRET = ['kpay_', 'X-Secret', 'X-API', 'telephoneEmpreinte', 'telephone_empreinte', 'idFournisseur', 'id_fournisseur', 'referenceFournisseur']

interface ErreurCorps { data?: { code?: string } }

async function insererPaiementOuvert(userId: string, montant = 5000): Promise<string> {
  const id = randomUUID()
  const frais = Math.ceil(montant * 0.05)
  await db().query(
    `INSERT INTO paiements (id, user_id, fournisseur, methode, operateur, environnement, id_fournisseur, statut, plan, periode_mois, devise,
       montant_plan, montant, frais_taux_pb, frais_supporteur, frais_estimes, net_estime, telephone_masque, telephone_empreinte, expire_avant,
       prochaine_verification)
     VALUES ($1,$2,'kpay','mobile_money','MTN_MOMO_CMR','test',$3,'en_attente','payant',1,'XAF',$4,$4,500,'marchand',$5,$6,'+237 6•• ••• •89',$7, now() + interval '15 minutes', now() + interval '1 day')`,
    [id, userId, `tx_${id}`, montant, frais, montant - frais, 'a'.repeat(64)],
  )
  return id
}

function signer(corps: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(corps).digest('hex')
}

function corpsCompleted(paiementId: string, montant: number, surcharges: Record<string, unknown> = {}): string {
  return JSON.stringify({ event: 'payment.completed', paymentId: `tx_${paiementId}`, status: 'COMPLETED', amount: montant, externalId: paiementId, timestamp: new Date().toISOString(), ...surcharges })
}

async function anonyme(playwright: Parameters<Parameters<typeof test.beforeAll>[0]>[0]['playwright']): Promise<APIRequestContext> {
  // Aucun cookie, aucun en-tête Origin : le webhook ne doit exiger ni session ni CSRF (CA99).
  return playwright.request.newContext({ baseURL: BASE_URL })
}

test.describe.serial('abonnement, paiements, tarifs et webhook', () => {
  let session: Session
  let autre: Session
  let sansSession: APIRequestContext

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
    autre = await seConnecter(playwright)
    sansSession = await anonyme(playwright)
  })

  test.afterAll(async () => {
    await session.api.dispose()
    await autre.api.dispose()
    await sansSession.dispose()
    await fermerConnexions()
  })

  test('GET /api/studio/abonnement describes a free account without any secret nor provider identifier', async () => {
    const reponse = await session.api.get('/api/studio/abonnement')

    expect(reponse.status()).toBe(200)
    const texte = await reponse.text()
    const { abonnement } = JSON.parse(texte) as { abonnement: Record<string, unknown> & { quotas: Array<{ ressource: string }>, offre: { paiementDisponible: boolean, devises: Array<{ devise: string }>, moyens: unknown[] } } }
    expect(abonnement).toMatchObject({ plan: 'gratuit', etat: 'gratuit', renouvellementAutomatique: false, paiementEnCours: null })
    expect(abonnement.quotas.map((q) => q.ressource).sort()).toEqual(['generations_ia_mois', 'realisations', 'reservations_mois', 'services', 'temoignages'])
    expect(abonnement.offre.paiementDisponible).toBe(abonnement.offre.devises.length > 0 && abonnement.offre.moyens.length > 0)
    expect(abonnement.offre.devises.map((d) => d.devise)).not.toContain('EUR')
    expect(abonnement.offre.devises.map((d) => d.devise)).not.toContain('USD')
    for (const interdit of ASCII_SANS_SECRET) expect(texte).not.toContain(interdit)
  })

  test('POST /api/studio/abonnement/paiements refuses invalid bodies with 400 VALIDATION and creates nothing', async () => {
    const avant = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM paiements WHERE user_id = $1', [session.userId])
    const valide = { periodeMois: 1, devise: 'XAF', moyen: 'kpay:MTN_MOMO_CMR', telephone: '653456789' }
    const invalides: Array<[string, Record<string, unknown>]> = [
      ['an unsupported duration', { ...valide, periodeMois: 6 }],
      ['a mass-assigned amount', { ...valide, montant: 1 }],
      ['a mass-assigned user id', { ...valide, userId: autre.userId }],
      ['letters in the number', { ...valide, telephone: '65345678a' }],
      ['a lowercase currency', { ...valide, devise: 'xaf' }],
      ['a malformed wallet', { ...valide, moyen: 'MTN' }],
      ['an empty body', {}],
    ]

    for (const [, corps] of invalides) {
      await attendreErreur(await session.api.post('/api/studio/abonnement/paiements', { data: corps }), 400, 'VALIDATION')
    }

    const apres = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM paiements WHERE user_id = $1', [session.userId])
    expect(apres.rows[0].n).toBe(avant.rows[0].n)
    expect(invalides.length).toBeGreaterThan(5)
  })

  test('CA36 GET /api/studio/abonnement/paiements/:id answers 400 for a malformed id and 404 PAIEMENT_INTROUVABLE for an unknown one', async () => {
    await attendreErreur(await session.api.get('/api/studio/abonnement/paiements/pas-un-uuid'), 400, 'VALIDATION')
    await attendreErreur(await session.api.get(`/api/studio/abonnement/paiements/${randomUUID()}`), 404, 'PAIEMENT_INTROUVABLE')
  })

  test('CA36 a payment is readable by its owner only : the other account gets the same 404 as for an unknown payment', async () => {
    const id = await insererPaiementOuvert(session.userId)

    const sien = await session.api.get(`/api/studio/abonnement/paiements/${id}`)
    const intrus = await autre.api.get(`/api/studio/abonnement/paiements/${id}`)

    expect(sien.status()).toBe(200)
    const texte = await sien.text()
    expect((JSON.parse(texte) as { paiement: Record<string, unknown> }).paiement).toMatchObject({ id, statut: 'en_attente', montant: 5000, devise: 'XAF', telephoneMasque: '+237 6•• ••• •89', messageEchec: null })
    for (const interdit of [...ASCII_SANS_SECRET, '653456789', 'tx_']) expect(texte).not.toContain(interdit)
    const corps = await attendreErreur(intrus, 404, 'PAIEMENT_INTROUVABLE')
    expect(JSON.stringify(corps)).not.toContain(id)
  })

  test('the ongoing payment is part of GET /api/studio/abonnement (a reload resumes the waiting screen)', async () => {
    const { abonnement } = (await (await session.api.get('/api/studio/abonnement')).json()) as { abonnement: { paiementEnCours: { statut: string } | null } }

    expect(abonnement.paiementEnCours?.statut).toBe('en_attente')
  })

  test('GET /api/public/tarifs is public, cacheable, shows both plans and never offers EUR or USD', async () => {
    const reponse = await sansSession.get('/api/public/tarifs')

    expect(reponse.status()).toBe(200)
    expect(reponse.headers()['cache-control']).toContain('max-age=300')
    const texte = await reponse.text()
    const dto = JSON.parse(texte) as { plans: Array<{ id: string, badge: boolean, limites: Record<string, number | null> }>, offre: { paiementDisponible: boolean, devises: Array<{ devise: string, prix: unknown[] }>, moyens: unknown[], deviseParDefaut: string | null }, renouvellementAutomatique: boolean, graceJours: number }
    expect(dto.plans.map((p) => p.id)).toEqual(['gratuit', 'payant'])
    expect(dto.plans[0]?.badge).toBe(true)
    expect(dto.plans[1]?.limites.services).toBeNull()
    expect(dto.renouvellementAutomatique).toBe(false)
    expect(dto.graceJours).toBe(7)
    expect(dto.offre.paiementDisponible).toBe(dto.offre.devises.length > 0 && dto.offre.moyens.length > 0)
    for (const devise of dto.offre.devises) {
      expect(devise.devise).toBe('XAF')
      expect(devise.prix).toHaveLength(3)
    }
    for (const interdit of ASCII_SANS_SECRET) expect(texte).not.toContain(interdit)
    await attendreErreur(await sansSession.get('/api/public/tarifs?devise=eur'), 400, 'VALIDATION')
  })

  test('CA51 a provider outside the registry answers 404, whatever the body', async () => {
    const reponse = await sansSession.post('/api/webhooks/stripe', { data: '{}', headers: { 'content-type': 'application/json' } })

    await attendreErreur(reponse, 404, 'FOURNISSEUR_INCONNU')
  })

  test('CA48 an announced body over the limit is refused with 413 before being read', async () => {
    const url = new URL(BASE_URL)
    const reponse = await requeteBrute({ method: 'POST', path: '/api/webhooks/kpay', headers: { host: url.host, 'content-type': 'application/json', 'content-length': String(CORPS_MAX + 1) }, corps: null })

    expect(reponse.status).toBe(413)
    expect(JSON.parse(reponse.corps) as ErreurCorps).toMatchObject({ data: { code: 'CORPS_TROP_GROS' } })
  })

  test('CA48 a body over the limit sent without Content-Length (chunked) is refused with 413', async () => {
    const url = new URL(BASE_URL)
    const reponse = await requeteBrute({ method: 'POST', path: '/api/webhooks/kpay', headers: { host: url.host, 'content-type': 'application/json', 'transfer-encoding': 'chunked' }, corps: Buffer.alloc(CORPS_MAX + 100, 'a') })

    expect(reponse.status).toBe(413)
  })

  test('CA41 an absent or invalid signature is a 401 SIGNATURE_INVALIDE (or 503 when the secret is not configured, CA50) and writes nothing', async () => {
    const id = await insererPaiementOuvert(session.userId, 5000)
    const corps = corpsCompleted(id, 5000)
    const attenduStatut = SECRET === undefined ? 503 : 401
    const attenduCode = SECRET === undefined ? 'WEBHOOK_NON_CONFIGURE' : 'SIGNATURE_INVALIDE'

    const sansEntete = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json' } })
    const fausse = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json', 'x-kpay-signature': 'a'.repeat(64) } })
    const autreSecret = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json', 'x-kpay-signature': signer(corps, 'un-autre-secret-de-test-assez-long') } })

    for (const reponse of [sansEntete, fausse, autreSecret]) await attendreErreur(reponse, attenduStatut, attenduCode)
    const ligne = await db().query<{ statut: string }>('SELECT statut FROM paiements WHERE id = $1', [id])
    expect(ligne.rows[0].statut).toBe('en_attente')
    const journal = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM evenements_paiement WHERE paiement_id = $1', [id])
    expect(journal.rows[0].n).toBe('0')
  })

  test('CA38 to CA40 a correctly signed completed webhook activates the plan once, answers the same 200 on replay, and needs no session nor Origin', async () => {
    const id = await insererPaiementOuvert(autre.userId, 5000)
    const corps = corpsCompleted(id, 5000)
    const entetes = { 'content-type': 'application/json', ...(SECRET === undefined ? {} : { 'x-kpay-signature': signer(corps, SECRET) }) }

    const premier = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: entetes })
    const rejeu = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: entetes })

    if (SECRET === undefined) {
      await attendreErreur(premier, 503, 'WEBHOOK_NON_CONFIGURE')
      await attendreErreur(rejeu, 503, 'WEBHOOK_NON_CONFIGURE')
      return
    }
    expect(premier.status()).toBe(200)
    expect(await premier.json()).toEqual({ recu: true })
    expect(rejeu.status()).toBe(200)
    expect(await rejeu.json()).toEqual({ recu: true })
    const abonnement = await db().query<{ plan: string }>('SELECT plan FROM abonnements WHERE user_id = $1', [autre.userId])
    expect(abonnement.rows).toHaveLength(1)
    const evenements = await db().query<{ n: string }>('SELECT count(*)::text AS n FROM evenements_paiement WHERE paiement_id = $1', [id])
    expect(evenements.rows[0].n).toBe('1')
    const vue = (await (await autre.api.get('/api/studio/abonnement')).json()) as { abonnement: { plan: string, etat: string, joursRestants: number | null } }
    expect(vue.abonnement).toMatchObject({ plan: 'payant', etat: 'actif' })
    expect(vue.abonnement.joursRestants).toBeGreaterThanOrEqual(28)
  })

  test('CA42 a signed completed webhook with the wrong amount activates nothing and still answers 200 { recu: true }', async () => {
    const id = await insererPaiementOuvert(session.userId, 5000)
    const corps = corpsCompleted(id, 4000)
    if (SECRET === undefined) {
      await attendreErreur(await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json' } }), 503, 'WEBHOOK_NON_CONFIGURE')
      return
    }

    const reponse = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json', 'x-kpay-signature': signer(corps, SECRET) } })

    expect(reponse.status()).toBe(200)
    expect(await reponse.json()).toEqual({ recu: true })
    const ligne = await db().query<{ statut: string, code_echec: string }>('SELECT statut, code_echec FROM paiements WHERE id = $1', [id])
    expect(ligne.rows[0]).toMatchObject({ statut: 'anomalie', code_echec: 'MONTANT_INCOHERENT' })
    const abonnement = await db().query('SELECT 1 FROM abonnements WHERE user_id = $1', [session.userId])
    expect(abonnement.rows).toHaveLength(0)
  })

  test('CA49 a signed but unreadable JSON is a 400 CORPS_ILLISIBLE', async () => {
    const corps = '{"event": "payment.completed", '
    if (SECRET === undefined) {
      await attendreErreur(await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json' } }), 503, 'WEBHOOK_NON_CONFIGURE')
      return
    }

    const reponse = await sansSession.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json', 'x-kpay-signature': signer(corps, SECRET) } })

    await attendreErreur(reponse, 400, 'CORPS_ILLISIBLE')
  })

  test('CA99 a session cookie or a foreign Origin has no effect on the webhook : the signature is the only authorization', async () => {
    const corps = '{}'

    const reponse = await sansSession.post('/api/webhooks/kpay', {
      data: corps,
      headers: { 'content-type': 'application/json', origin: 'https://evil.example', cookie: session.cookie, 'x-kpay-signature': 'a'.repeat(64) },
    })

    expect([401, 503]).toContain(reponse.status())
  })
})
