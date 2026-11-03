import { createHmac, randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { ouvrirStudio } from './hydratation'
import { db, lireEnv } from './session'

// Helpers des e2e S10 (abonnements, plans, paiement Mobile Money).
//
// Les comptes de test sont créés par l'API (plan gratuit). Un abonnement est posé directement en base,
// comme le fait la production après un webhook `payment.completed` : une ligne `abonnements` dont
// `expire_le` pilote l'état calculé (actif, grâce, gratuit) ; rien n'est stocké d'autre (spec #119).
// Aucun appel à K-PAY : l'initiation réelle appellerait le bac à sable du développeur (voir le rapport :
// le serveur de test ne peut pas pointer sur tests/support/faux-kpay.ts sans modifier la configuration Playwright).

const MS_PAR_JOUR = 86_400_000
/** Durée d'un abonnement posé par défaut : assez long pour ne jamais expirer pendant un test. */
export const JOURS_PLAN_PAYANT = 45
/** Âge de l'échéance d'un abonnement posé en grâce (la grâce dure 7 jours). */
export const JOURS_DEPUIS_ECHEANCE_GRACE = 3
const JOURS_PERIODE_INITIALE = 30
const DELAI_ECRAN_MS = 90_000
const SECRET_WEBHOOK_MIN = 16

/** Compte de la vitrine de démonstration `dr-cabrel` (server/db/seed.ts) : GRATUIT, ses 3 plus anciens services sont publics. */
export const ID_UTILISATEUR_DEMO = 'seed-dr-cabrel'
export const ANCRE_ABONNEMENT = '#abonnement'
export const MESSAGE_BADGE = 'Créé avec Brandself'
export const BOUTON_VOIR_ABONNEMENT = 'Voir l’abonnement'
export const MENTION_SANS_RENOUVELLEMENT = 'Votre abonnement ne se renouvelle pas automatiquement.'

async function poserAbonnement(userId: string, expireLe: Date): Promise<void> {
  const premiere = new Date(expireLe.getTime() - JOURS_PERIODE_INITIALE * MS_PAR_JOUR)
  await db().query(
    `INSERT INTO abonnements (id, user_id, plan, expire_le, premiere_activation_le)
     VALUES ($1, $2, 'payant', $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET plan = 'payant', expire_le = EXCLUDED.expire_le,
       premiere_activation_le = EXCLUDED.premiere_activation_le, updated_at = now()`,
    [randomUUID(), userId, expireLe, premiere],
  )
}

/** Abonnement payant ACTIF pour `jours` jours (+45 par défaut) : plus de limite, plus de badge, rien de masqué. */
export async function donnerPlanPayant(userId: string, jours: number = JOURS_PLAN_PAYANT): Promise<void> {
  await poserAbonnement(userId, new Date(Date.now() + jours * MS_PAR_JOUR))
}

/** Abonnement échu depuis `joursDepuisEcheance` jours : période de grâce (droits du plan payant conservés). */
export async function donnerPlanGrace(userId: string, joursDepuisEcheance: number = JOURS_DEPUIS_ECHEANCE_GRACE): Promise<void> {
  await poserAbonnement(userId, new Date(Date.now() - joursDepuisEcheance * MS_PAR_JOUR))
}

/** Retour au plan gratuit : la ligne d'abonnement est retirée. */
export async function retirerPlan(userId: string): Promise<void> {
  await db().query('DELETE FROM abonnements WHERE user_id = $1', [userId])
}

// ---------------------------------------------------------------------------------------------
// Paiements et webhook signé
// ---------------------------------------------------------------------------------------------

export const MONTANT_12_MOIS = 48_000
export const TELEPHONE_MASQUE_TEST = '+237 6•• ••• •89'

/** Secret de webhook du serveur de test (variable d'environnement ou `.env`) ; échoue clairement s'il est absent. */
export function secretWebhook(): string {
  const secret = lireEnv('KPAY_WEBHOOK_SECRET')
  if (secret.length < SECRET_WEBHOOK_MIN) throw new Error('KPAY_WEBHOOK_SECRET absent ou trop court : le webhook signé ne peut pas être simulé.')
  return secret
}

export function signer(corps: string): string {
  return createHmac('sha256', secretWebhook()).update(corps).digest('hex')
}

export interface PaiementInsere {
  id: string
  idFournisseur: string
}

/**
 * Paiement `en_attente` écrit en base, tel que l'initiation le laisse (montant 12 mois, MTN MoMo, numéro masqué).
 * L'initiation réelle n'est pas jouée : elle appellerait K-PAY. Le reste du parcours (suivi, webhook, activation) est réel.
 */
export async function insererPaiementEnAttente(userId: string, options: { montant?: number, periodeMois?: number } = {}): Promise<PaiementInsere> {
  const montant = options.montant ?? MONTANT_12_MOIS
  const periode = options.periodeMois ?? 12
  const id = randomUUID()
  const idFournisseur = `tx_${id}`
  const frais = Math.ceil(montant * 0.05)
  await db().query(
    `INSERT INTO paiements (id, user_id, fournisseur, methode, operateur, environnement, id_fournisseur, statut, plan, periode_mois, devise,
       montant_plan, montant, frais_taux_pb, frais_supporteur, frais_estimes, net_estime, telephone_masque, telephone_empreinte, expire_avant,
       prochaine_verification)
     VALUES ($1,$2,'kpay','mobile_money','MTN_MOMO_CMR','test',$3,'en_attente','payant',$4,'XAF',$5,$5,500,'marchand',$6,$7,$8,$9,
       now() + interval '15 minutes', now() + interval '1 day')`,
    [id, userId, idFournisseur, periode, montant, frais, montant - frais, TELEPHONE_MASQUE_TEST, 'b'.repeat(64)],
  )
  return { id, idFournisseur }
}

export interface OptionsWebhook {
  event?: 'payment.completed' | 'payment.failed' | 'payment.cancelled'
  status?: 'COMPLETED' | 'FAILED' | 'CANCELLED'
  failureReason?: string
  /** Montant du corps ; différent de celui du paiement = anomalie (aucune activation). */
  montant?: number
}

/** Envoie au serveur RÉEL un webhook signé avec le secret de l'environnement (même chemin que K-PAY). */
export async function envoyerWebhookKpay(api: APIRequestContext, paiement: PaiementInsere, montantPaiement: number, options: OptionsWebhook = {}): Promise<void> {
  const corps = JSON.stringify({
    event: options.event ?? 'payment.completed',
    paymentId: paiement.idFournisseur,
    status: options.status ?? 'COMPLETED',
    amount: options.montant ?? montantPaiement,
    externalId: paiement.id,
    timestamp: new Date().toISOString(),
    ...(options.failureReason === undefined ? {} : { failureReason: options.failureReason }),
  })
  const reponse = await api.post('/api/webhooks/kpay', { data: corps, headers: { 'content-type': 'application/json', 'x-kpay-signature': signer(corps) } })
  expect(reponse.status(), `webhook signé : ${await reponse.text()}`).toBe(200)
}

// ---------------------------------------------------------------------------------------------
// Lectures d'API
// ---------------------------------------------------------------------------------------------

export interface OffreApi {
  paiementDisponible: boolean
  devises: Array<{ devise: string, exposant: number, prix: Array<{ periodeMois: number, montant: number }> }>
}

export async function lireOffre(api: APIRequestContext): Promise<OffreApi> {
  const reponse = await api.get('/api/studio/abonnement')
  expect(reponse.status()).toBe(200)
  return ((await reponse.json()) as { abonnement: { offre: OffreApi } }).abonnement.offre
}

/** Montant de l'API formaté comme l'interface (espace insécable fine d'Intl remplacée par une espace simple). */
export function formaterXaf(montant: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(montant)} XAF`.replace(/[\u202F\u00A0]/g, ' ')
}

// ---------------------------------------------------------------------------------------------
// Page Objects
// ---------------------------------------------------------------------------------------------

/** Carte « Abonnement » du Compte (/studio/compte#abonnement). */
export class CarteAbonnementPage {
  constructor(readonly page: Page) {}

  async ouvrir(requete = ''): Promise<void> {
    await ouvrirStudio(this.page, `/studio/compte${requete}${ANCRE_ABONNEMENT}`)
    await expect(this.titre()).toBeVisible({ timeout: DELAI_ECRAN_MS })
  }

  carte(): Locator { return this.page.getByRole('region', { name: 'Abonnement' }) }
  titre(): Locator { return this.page.getByRole('heading', { level: 2, name: 'Abonnement', exact: true }) }
  periodes(): Locator { return this.carte().getByRole('radiogroup').first() }
  radioPeriode(mois: number): Locator { return this.carte().getByRole('radio', { name: new RegExp(`^${mois} mois`) }) }
  radioMoyen(libelle: 'MTN MoMo' | 'Orange Money'): Locator { return this.carte().getByRole('radio', { name: libelle }) }
  telephone(): Locator { return this.carte().getByLabel('Numéro Mobile Money') }
  payer(nom: string | RegExp): Locator { return this.carte().getByRole('button', { name: nom }) }
  mention(): Locator { return this.carte().getByText(MENTION_SANS_RENOUVELLEMENT) }
  alertes(): Locator { return this.carte().getByRole('alert') }
  titreAttente(): Locator { return this.carte().getByText('Validez le paiement sur votre téléphone', { exact: true }) }
  titreReussi(): Locator { return this.carte().getByText(/^Votre plan payant est actif jusqu’au /) }
  titreEchec(): Locator { return this.carte().getByText('Le paiement n’a pas abouti', { exact: true }) }
  titreAnomalie(): Locator { return this.carte().getByText('Nous vérifions votre paiement', { exact: true }) }
  reessayer(): Locator { return this.carte().getByRole('button', { name: 'Réessayer', exact: true }) }
}

/** Page publique /tarifs. */
export class TarifsPage {
  constructor(readonly page: Page) {}

  async ouvrir(): Promise<void> {
    await this.page.goto('/tarifs')
    await expect(this.titre()).toBeVisible({ timeout: DELAI_ECRAN_MS })
  }

  titre(): Locator { return this.page.getByRole('heading', { level: 1, name: 'Un plan gratuit, un plan payant' }) }
  planGratuit(): Locator { return this.page.getByRole('region', { name: 'Gratuit', exact: true }) }
  planPayant(): Locator { return this.page.getByRole('region', { name: 'Payant', exact: true }) }
}
