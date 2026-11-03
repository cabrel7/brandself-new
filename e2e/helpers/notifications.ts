import { createHmac, hkdfSync, randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { makePng } from '../../tests/support/images'
import {
  DESABONNEMENT_HKDF_INFO,
  DESABONNEMENT_JETON_VALIDITE_JOURS,
  DESABONNEMENT_JETON_VERSION,
} from '../../shared/notifications'
import type { PreferenceEmail } from '../../shared/notifications'
import { PROCHAINES_ETAPES } from '../../shared/prochaine-etape'
import type { NextStep } from '../../shared/vitrine'
import { attendreHydration, ouvrirStudio } from './hydratation'
import { IDENTITE_TEST } from './ia'
import { BASE_URL, db, lireEnv } from './session'
import type { Session } from './session'

// Helpers des e2e d'interface S9 (notifications, prochaine étape, partage). Aucun parcours ne dépend de
// l'IA : les vitrines sont créées par l'API, l'écran « C'est en ligne » par une progression écrite en base.
// Aucun parcours ne dépend du worker non plus : on vérifie l'interface et la base, jamais l'envoi d'e-mails.

/** Hôte public des vitrines (recopié de app/utils/onboarding.ts, non importable hors Nuxt). */
export const HOTE_VITRINES = 'brandself.io'
export const USERNAME_DEMO = 'dr-cabrel'
export const ANNONCE_PREFERENCES = 'Préférences enregistrées.'
export const ERREUR_ENREGISTREMENT = 'Nous n’avons pas pu enregistrer. Réessayez dans un instant.'
export const ORDRE_ETAPES: readonly NextStep[] = ['photo', 'service', 'disponibilites', 'realisation', 'partager']

const MS_PAR_JOUR = 86_400_000
const MS_PAR_SECONDE = 1_000
const SECONDES_PAR_JOUR = 86_400
const LONGUEUR_CLE_OCTETS = 32
const JOURS_JETON_EXPIRE = DESABONNEMENT_JETON_VALIDITE_JOURS + 10
const JOURS_RECHERCHE_CRENEAU = 60
const MARGE_CRENEAU_MS = 4 * 60 * 60 * 1000
const DELAI_ECRAN_MS = 90_000
const DELAI_RECHAUFFE_MS = 240_000
const SEPARATEUR = '.'

export { DELAI_ECRAN_MS }

// ---------------------------------------------------------------------------------------------
// Jetons de désabonnement
// ---------------------------------------------------------------------------------------------

/**
 * Reproduit `signUnsubscribeToken` (server/services/desabonnement.ts : HKDF-SHA256 du secret
 * d'authentification, HMAC-SHA256). Le service n'est pas importé : il ouvre la base et valide tout
 * l'environnement au chargement. Le test « jeton valide » prouve que la copie reste compatible.
 */
export function signerJeton(userId: string, preference: PreferenceEmail, maintenant: Date): string {
  const cle = Buffer.from(
    hkdfSync('sha256', lireEnv('NUXT_BETTER_AUTH_SECRET'), Buffer.alloc(0), DESABONNEMENT_HKDF_INFO, LONGUEUR_CLE_OCTETS),
  )
  const expiration = Math.floor(maintenant.getTime() / MS_PAR_SECONDE) + DESABONNEMENT_JETON_VALIDITE_JOURS * SECONDES_PAR_JOUR
  const charge = Buffer.from(JSON.stringify({ u: userId, p: preference, e: expiration }), 'utf8').toString('base64url')
  const entree = `${DESABONNEMENT_JETON_VERSION}${SEPARATEUR}${charge}`
  const signature = createHmac('sha256', cle).update(entree).digest('base64url')
  return `${entree}${SEPARATEUR}${signature}`
}

export function jetonValide(userId: string, preference: PreferenceEmail): string {
  return signerJeton(userId, preference, new Date())
}

/** Jeton signé correctement mais émis il y a plus de 90 jours. */
export function jetonExpire(userId: string, preference: PreferenceEmail): string {
  return signerJeton(userId, preference, new Date(Date.now() - JOURS_JETON_EXPIRE * MS_PAR_JOUR))
}

// ---------------------------------------------------------------------------------------------
// Base de données
// ---------------------------------------------------------------------------------------------

export interface PreferencesBase {
  emailHebdo: boolean
  emailRappelJour: boolean
}

export async function lirePreferences(userId: string): Promise<PreferencesBase> {
  const r = await db().query<{ email_hebdo: boolean, email_rappel_jour: boolean }>(
    'SELECT email_hebdo, email_rappel_jour FROM users WHERE id = $1',
    [userId],
  )
  return { emailHebdo: r.rows[0].email_hebdo, emailRappelJour: r.rows[0].email_rappel_jour }
}

export async function fixerPreferences(userId: string, valeurs: PreferencesBase): Promise<void> {
  await db().query('UPDATE users SET email_hebdo = $2, email_rappel_jour = $3 WHERE id = $1', [
    userId,
    valeurs.emailHebdo,
    valeurs.emailRappelJour,
  ])
}

/** Remet la prochaine étape à zéro : aucune étape ignorée, aucun partage enregistré. */
export async function reinitialiserEtapes(userId: string): Promise<void> {
  await db().query("UPDATE vitrines SET etapes_ignorees = '{}', partagee_le = NULL WHERE user_id = $1", [userId])
}

export async function lireEtapesIgnorees(userId: string): Promise<string[]> {
  const r = await db().query<{ etapes_ignorees: string[] }>('SELECT etapes_ignorees FROM vitrines WHERE user_id = $1', [userId])
  return r.rows[0]?.etapes_ignorees ?? []
}

export async function lirePartageeLe(userId: string): Promise<Date | null> {
  const r = await db().query<{ partagee_le: Date | null }>('SELECT partagee_le FROM vitrines WHERE user_id = $1', [userId])
  return r.rows[0]?.partagee_le ?? null
}

export async function lireRappelReservation(email: string): Promise<boolean | null> {
  const r = await db().query<{ rappel_email: boolean }>('SELECT rappel_email FROM reservations WHERE email = $1', [email])
  return r.rows[0]?.rappel_email ?? null
}

/** Supprime les réservations de test (et leurs e-mails en file) créées avec ces adresses. */
export async function nettoyerReservations(emails: Iterable<string>): Promise<void> {
  const valeurs = [...emails]
  if (valeurs.length === 0) return
  const r = await db().query<{ id: string }>('SELECT id FROM reservations WHERE email = ANY($1::text[])', [valeurs])
  const ids = r.rows.map((ligne) => ligne.id)
  if (ids.length === 0) return
  await db().query("DELETE FROM emails_transactionnels WHERE entite_type = 'reservation' AND entite_id = ANY($1::text[])", [ids])
  await db().query('DELETE FROM reservations WHERE id = ANY($1::text[])', [ids])
}

/**
 * Progression d'inscription COMPLÈTE (identité, photo, proposition validée) écrite directement en base :
 * le navigateur reprend à l'étape 4, sans aucune génération d'IA.
 */
export async function preparerProgressionSansIa(session: Session): Promise<void> {
  const envoi = await session.api.post('/api/studio/medias', {
    multipart: { fichier: { name: 'portrait.png', mimeType: 'image/png', buffer: await makePng(800, 600) } },
  })
  expect(envoi.status(), 'envoi de la photo').toBe(201)
  const photoId = ((await envoi.json()) as { media: { id: string } }).media.id
  const services = [{ titre: 'Consultation', description: 'Un premier échange.', type: 'rdv', dureeMin: 30, nbSeances: null, actif: true }]
  await db().query(
    `INSERT INTO progressions_inscription
       (user_id, titre, prenom, nom, metier, ville, pays, photo_media_id, accroche, presentation, services_proposes, proposition_validee_le)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, now())`,
    [
      session.userId, IDENTITE_TEST.titreCode, IDENTITE_TEST.prenom, IDENTITE_TEST.nom, IDENTITE_TEST.metier,
      IDENTITE_TEST.ville, IDENTITE_TEST.pays, photoId, 'Votre cardiologue à Douala.',
      'Je vous accompagne avec attention.', JSON.stringify(services),
    ],
  )
}

export async function supprimerDonneesUtilisateur(userId: string): Promise<void> {
  await db().query('DELETE FROM progressions_inscription WHERE user_id = $1', [userId])
}

// ---------------------------------------------------------------------------------------------
// Créneau de la vitrine de démonstration (réservation)
// ---------------------------------------------------------------------------------------------

export interface CreneauReservable {
  serviceSlug: string
  debut: string
}

function dateLocale(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Premier créneau réservable de la vitrine de démonstration, assez loin pour rester stable pendant le test. */
export async function trouverCreneau(api: APIRequestContext): Promise<CreneauReservable> {
  const [vitrine, liste] = await Promise.all([
    api.get(`/api/public/${USERNAME_DEMO}`),
    api.get(`/api/public/${USERNAME_DEMO}/services`),
  ])
  expect(vitrine.status(), 'lecture de la vitrine de démonstration (pnpm db:seed ?)').toBe(200)
  const { vitrine: v } = (await vitrine.json()) as { vitrine: { fuseau: string } }
  const { services } = (await liste.json()) as { services: Array<{ slug: string, reservable: boolean, dureeMin: number | null }> }
  const du = dateLocale(new Date(), v.fuseau)
  const au = dateLocale(new Date(Date.now() + JOURS_RECHERCHE_CRENEAU * MS_PAR_JOUR), v.fuseau)
  for (const service of services.filter((s) => s.reservable && s.dureeMin !== null)) {
    const r = await api.get(`/api/public/${USERNAME_DEMO}/creneaux`, { params: { service: service.slug, du, au } })
    expect(r.status()).toBe(200)
    const { creneaux } = (await r.json()) as { creneaux: Array<{ debut: string }> }
    const limite = Date.now() + MARGE_CRENEAU_MS
    const stable = creneaux.find((c) => Date.parse(c.debut) > limite)
    if (stable) return { serviceSlug: service.slug, debut: stable.debut }
  }
  throw new Error('Aucun créneau réservable sur la vitrine de démonstration.')
}

export interface Contact {
  nom: string
  email: string
  telephone: string
}

export function contactUnique(): Contact {
  const id = randomUUID().replaceAll('-', '')
  const chiffres = (BigInt(`0x${id.slice(0, 12)}`) % 100_000_000n).toString().padStart(8, '0')
  return { nom: `Visiteur S9 ${id.slice(0, 8)}`, email: `e2e-s9-${id}@example.com`, telephone: `+2376${chiffres}` }
}

// ---------------------------------------------------------------------------------------------
// Page Objects
// ---------------------------------------------------------------------------------------------

/** Compte (/studio/compte) : partie « E-mails ». */
export class ComptePage {
  constructor(readonly page: Page) {}

  async ouvrir(): Promise<void> {
    await ouvrirStudio(this.page, '/studio/compte')
    await expect(this.page.getByRole('heading', { level: 2, name: 'E-mails' })).toBeVisible({ timeout: DELAI_ECRAN_MS })
  }

  partie(): Locator { return this.page.getByRole('region', { name: 'E-mails' }) }
  interrupteur(nom: 'Résumé de la semaine' | 'Rendez-vous du jour'): Locator { return this.page.getByRole('switch', { name: nom }) }
  annonce(): Locator { return this.partie().getByRole('status') }
  alertes(): Locator { return this.page.getByRole('alert') }
}

/** Page publique /desabonnement. */
export class DesabonnementPage {
  constructor(readonly page: Page) {}

  async ouvrir(jeton: string): Promise<void> {
    await this.page.goto(`/desabonnement?jeton=${encodeURIComponent(jeton)}`)
    await attendreHydration(this.page)
  }

  titre(nom: string): Locator { return this.page.getByRole('heading', { level: 1, name: nom }) }
  action(): Locator { return this.page.getByRole('button', { name: 'Me désabonner' }) }
}

/** Accueil du studio : carte « Prochaine étape » et panneau de partage. */
export class AccueilStudioPage {
  constructor(readonly page: Page) {}

  async ouvrir(): Promise<void> {
    await ouvrirStudio(this.page, '/studio')
    await expect(this.page.getByRole('heading', { level: 1, name: /^Bonjour / })).toBeVisible({ timeout: DELAI_ECRAN_MS })
  }

  cartes(): Locator { return this.page.getByText('Prochaine étape', { exact: true }) }
  titreEtape(etape: NextStep): Locator {
    return this.page.getByRole('heading', { level: 2, name: PROCHAINES_ETAPES[etape].titre, exact: true })
  }
  ignorer(): Locator { return this.page.getByRole('button', { name: 'Ne plus proposer cette étape' }) }
  titreListe(): Locator { return this.page.getByRole('heading', { level: 2, name: 'Votre vitrine', exact: true }) }
  partager(): Locator { return this.page.getByRole('button', { name: 'Partager ma vitrine' }) }
}

/** Panneau « Partager votre vitrine » (accueil du studio et écran « C'est en ligne »). */
export class PartagePanneau {
  constructor(readonly page: Page) {}

  dialogue(): Locator { return this.page.getByRole('dialog', { name: 'Partager votre vitrine' }) }
  whatsapp(): Locator { return this.dialogue().getByRole('link', { name: 'Envoyer sur WhatsApp' }) }
  linkedin(): Locator { return this.dialogue().getByRole('link', { name: 'Partager sur LinkedIn' }) }
  copier(): Locator { return this.dialogue().getByRole('button', { name: 'Copier le message' }) }
  telecharger(): Locator { return this.dialogue().getByRole('button', { name: 'Télécharger le QR code' }) }
  qr(): Locator { return this.dialogue().getByRole('img', { name: 'QR code de votre vitrine' }) }
  annonce(): Locator { return this.dialogue().getByRole('status') }
}

/** Page d'un formulaire de réservation publique. */
export class ReservationPage {
  constructor(readonly page: Page) {}

  async ouvrir(creneau: CreneauReservable): Promise<void> {
    const params = new URLSearchParams({ service: creneau.serviceSlug, debut: creneau.debut })
    const chemin = `/${USERNAME_DEMO}/reserver?${params.toString()}`
    // Réchauffe la page : le premier rendu après le démarrage de `nuxt dev` compile à froid (plus de 90 s mesurés).
    await this.page.request.get(chemin, { timeout: DELAI_RECHAUFFE_MS })
    await this.page.goto(chemin)
    await attendreHydration(this.page)
    await expect(this.page.getByRole('button', { name: 'Envoyer ma demande' })).toBeVisible({ timeout: DELAI_ECRAN_MS })
  }

  rappel(): Locator { return this.page.getByRole('switch', { name: 'Recevoir un rappel par e-mail' }) }

  async remplir(contact: Contact): Promise<void> {
    await this.page.getByLabel('Nom complet', { exact: true }).fill(contact.nom)
    await this.page.getByLabel('Email', { exact: true }).fill(contact.email)
    await this.page.getByLabel('Téléphone ou WhatsApp', { exact: true }).fill(contact.telephone)
  }

  envoyer(): Locator { return this.page.getByRole('button', { name: 'Envoyer ma demande' }) }
}

export { BASE_URL }
