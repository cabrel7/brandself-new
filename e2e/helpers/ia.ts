import { randomUUID } from 'node:crypto'
import { expect } from '@playwright/test'
import type { Browser, BrowserContext, Page, Playwright } from '@playwright/test'
import Redis from 'ioredis'
import { makePng } from '../../tests/support/images'
import { GENERATION_STATUTS_TERMINAUX } from '../../shared/ia'
import { BASE_URL, db, lireEnv, seConnecter } from './session'
import type { Session } from './session'

// Pilotage de l'IA pour les e2e UI de l'inscription guidée et du Profil (S8).
//
// PRÉREQUIS D'EXÉCUTION : le serveur ET le worker doivent tourner (`pnpm dev` lance les deux via
// `concurrently`). Sans worker, une génération reste `en_attente` puis passe `expiree` après 45 s.
// Le fournisseur résolu est `faux` (NODE_ENV=development, aucune clé IA) : sortie déterministe.

/**
 * Clé Redis lue par le faux fournisseur (server/services/ia/fournisseurs/faux.ts, `FAUX_MODE_CLE`).
 * Recopiée ici car ce module ouvre une connexion Redis dès son import : on ne l'importe pas dans Playwright.
 */
const FAUX_MODE_CLE = 'ia:faux:mode'
/** Durée de vie du mode dans Redis : un test interrompu ne laisse pas le faux fournisseur en panne. */
const FAUX_MODE_TTL_S = 600
/** Plafond d'attente d'une génération : 25 s de budget du worker, 45 s avant expiration, marge de démarrage. */
const ATTENTE_GENERATION_MS = 70_000
const INTERVALLE_SONDAGE_MS = 1_000
const STATUT_CREE = 201
const STATUT_OK = 200

export type ModeIaFaux = 'normal' | 'panne' | 'lent' | 'invalide' | 'invente'

export const MOBILE = { width: 390, height: 844 }
export const TABLETTE = { width: 768, height: 900 }
export const DESKTOP = { width: 1280, height: 800 }
export const VIEWPORTS = [MOBILE, TABLETTE, DESKTOP] as const

/** Identité saisie par les parcours (le même jeu que le test API, pour des attentes comparables). */
export const IDENTITE_TEST = {
  titre: 'Dr',
  titreCode: 'dr',
  prenom: 'Cabrel',
  nom: 'Nguesso',
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  pays: 'CM',
} as const

let redis: Redis | undefined

function redisIa(): Redis {
  redis ??= new Redis(lireEnv('REDIS_URL'), { maxRetriesPerRequest: 2 })
  return redis
}

/** Règle le mode du faux fournisseur. `normal` supprime la clé (comportement par défaut). */
export async function definirModeIaFaux(mode: ModeIaFaux): Promise<void> {
  if (mode === 'normal') {
    await redisIa().del(FAUX_MODE_CLE)
    return
  }
  await redisIa().set(FAUX_MODE_CLE, mode, 'EX', FAUX_MODE_TTL_S)
}

/** À appeler dans `afterAll` : referme la connexion Redis propre à ce helper. */
export async function fermerIa(): Promise<void> {
  if (redis) {
    await redis.quit()
    redis = undefined
  }
}

export interface UtilisateurFrais {
  session: Session
  contexte: BrowserContext
  page: Page
  /** Referme le contexte navigateur et le contexte HTTP. */
  fermer: () => Promise<void>
}

export interface OptionsUtilisateur {
  viewport?: { width: number, height: number }
  /** Autorise la lecture et l'écriture du presse-papiers (copie de l'adresse). */
  pressePapiers?: boolean
}

/**
 * Utilisateur neuf SANS vitrine : session OTP par l'API (un seul envoi de code), puis contexte navigateur
 * qui réutilise le cookie. La progression d'inscription commence à l'étape 1.
 */
export async function creerUtilisateurFrais(
  playwright: Playwright,
  browser: Browser,
  options: OptionsUtilisateur = {},
): Promise<UtilisateurFrais> {
  const session = await seConnecter(playwright)
  const contexte = await ouvrirContexte(browser, session, options)
  const page = await contexte.newPage()
  return {
    session,
    contexte,
    page,
    fermer: async () => {
      await contexte.close()
      await session.api.dispose()
    },
  }
}

/** Nouveau contexte navigateur portant la session existante (autre appareil / autre onglet privé). */
export async function ouvrirContexte(browser: Browser, session: Session, options: OptionsUtilisateur = {}): Promise<BrowserContext> {
  return browser.newContext({
    baseURL: BASE_URL,
    storageState: await session.api.storageState(),
    viewport: options.viewport ?? MOBILE,
    permissions: options.pressePapiers ? ['clipboard-read', 'clipboard-write'] : [],
  })
}

/** Identifiant d'adresse unique, au format accepté (3 à 30 caractères, minuscules, chiffres, tirets). */
export function adresseUnique(prefixe: string): string {
  return `${prefixe}-${randomUUID().slice(0, 8)}`
}

export interface GenerationLigne {
  statut: string
  motif_repli: string | null
  injection_suspectee: boolean
  type: string
}

/** Lignes `generations_ia` d'un utilisateur, de la plus ancienne à la plus récente (vérité côté base). */
export async function lireGenerations(userId: string): Promise<GenerationLigne[]> {
  const resultat = await db().query<GenerationLigne>(
    'SELECT statut, motif_repli, injection_suspectee, type FROM generations_ia WHERE user_id = $1 ORDER BY created_at ASC',
    [userId],
  )
  return resultat.rows
}

export async function lireBioVitrine(userId: string): Promise<string | null> {
  const resultat = await db().query<{ bio: string | null }>('SELECT bio FROM vitrines WHERE user_id = $1', [userId])
  return resultat.rows[0]?.bio ?? null
}

export async function lireTitresServices(userId: string): Promise<string[]> {
  const resultat = await db().query<{ titre: string }>(
    'SELECT s.titre FROM services s JOIN vitrines v ON v.id = s.vitrine_id WHERE v.user_id = $1 ORDER BY s.titre',
    [userId],
  )
  return resultat.rows.map((ligne) => ligne.titre)
}

/** Supprime les données d'IA et de brouillon d'un utilisateur de test (les deux tables cascadent sur `users`). */
export async function nettoyerUtilisateur(userId: string): Promise<void> {
  await db().query('DELETE FROM generations_ia WHERE user_id = $1', [userId])
  await db().query('DELETE FROM progressions_inscription WHERE user_id = $1', [userId])
}

interface GenerationApi {
  statut: string
}

/** Attend l'état terminal d'une génération (le worker doit tourner) ; renvoie le statut final. */
export async function attendreGeneration(session: Session, id: string): Promise<string> {
  let statut = ''
  await expect
    .poll(
      async () => {
        const reponse = await session.api.get(`/api/studio/generations/${id}`)
        expect(reponse.status()).toBe(STATUT_OK)
        statut = ((await reponse.json()) as { generation: GenerationApi }).generation.statut
        return (GENERATION_STATUTS_TERMINAUX as readonly string[]).includes(statut)
      },
      { timeout: ATTENTE_GENERATION_MS, intervals: [INTERVALLE_SONDAGE_MS], message: 'la génération doit finir (le worker tourne-t-il ?)' },
    )
    .toBe(true)
  return statut
}

export interface DonneesIdentite {
  titre: string | null
  prenom: string
  nom: string
  metier: string
  ville: string
  pays: string
}

export async function envoyerPhoto(session: Session): Promise<string> {
  const envoi = await session.api.post('/api/studio/medias', {
    multipart: { fichier: { name: 'portrait.png', mimeType: 'image/png', buffer: await makePng(800, 600) } },
  })
  expect(envoi.status()).toBe(STATUT_CREE)
  return ((await envoi.json()) as { media: { id: string } }).media.id
}

export interface ProgressionPreparee {
  photoId: string | null
  generationId: string | null
}

/**
 * Avance la progression par l'API (aucun écran) jusqu'à l'étape de REPRISE voulue, en saisissant la même
 * identité que les parcours : 2 = identité enregistrée, 3 = + photo + génération lancée et terminée,
 * 4 = + proposition validée (accroche 0, tous les services). Sert aux tests qui ne portent pas sur ces étapes.
 */
export async function preparerProgression(
  session: Session,
  etapeReprise: 2 | 3 | 4,
  identite: Partial<DonneesIdentite> = {},
): Promise<ProgressionPreparee> {
  const donnees: DonneesIdentite = {
    titre: IDENTITE_TEST.titreCode,
    prenom: IDENTITE_TEST.prenom,
    nom: IDENTITE_TEST.nom,
    metier: IDENTITE_TEST.metier,
    ville: IDENTITE_TEST.ville,
    pays: IDENTITE_TEST.pays,
    ...identite,
  }
  const etape1 = await session.api.put('/api/studio/onboarding', { data: { etape: 1, ...donnees } })
  expect(etape1.status(), 'enregistrement de l’identité').toBe(STATUT_OK)
  if (etapeReprise === 2) return { photoId: null, generationId: null }

  const photoId = await envoyerPhoto(session)
  const etape2 = await session.api.put('/api/studio/onboarding', { data: { etape: 2, photoMediaId: photoId } })
  expect(etape2.status(), 'enregistrement de la photo').toBe(STATUT_OK)

  const lancement = await session.api.post('/api/studio/onboarding/generer', { data: {} })
  expect([202, STATUT_OK]).toContain(lancement.status())
  const generationId = ((await lancement.json()) as { generation: { id: string } }).generation.id
  await attendreGeneration(session, generationId)
  if (etapeReprise === 3) return { photoId, generationId }

  const lecture = await session.api.get(`/api/studio/generations/${generationId}`)
  const { generation } = (await lecture.json()) as { generation: { resultat: { presentation: string, services: unknown[] } } }
  const etape3 = await session.api.put('/api/studio/onboarding', {
    data: {
      etape: 3,
      accrocheIndex: 0,
      presentation: generation.resultat.presentation,
      servicesActifs: generation.resultat.services.map(() => true),
    },
  })
  expect(etape3.status(), 'validation de la proposition').toBe(STATUT_OK)
  return { photoId, generationId }
}

/** Crée une vitrine (donc réserve son adresse) pour un autre utilisateur, par l'API. */
export async function reserverAdresse(session: Session, username: string): Promise<void> {
  const reponse = await session.api.post('/api/studio/vitrine', {
    data: { titre: null, prenom: 'Autre', nom: 'Personne', metier: 'Avocat', username },
  })
  expect(reponse.status(), `création de la vitrine ${username}`).toBe(STATUT_CREE)
}

/** Crée puis publie une vitrine complète par l'API (utilisateur déjà inscrit). */
export async function creerVitrinePubliee(session: Session, username: string, bio?: string): Promise<void> {
  await reserverAdresse(session, username)
  const maj = await session.api.put('/api/studio/vitrine', {
    data: { ville: IDENTITE_TEST.ville, pays: IDENTITE_TEST.pays, ...(bio === undefined ? {} : { bio }) },
  })
  expect(maj.status(), 'complétion de la vitrine').toBe(STATUT_OK)
  const publication = await session.api.post('/api/studio/vitrine/publier')
  expect(publication.status(), 'publication de la vitrine').toBe(STATUT_OK)
}

/** Aucun débordement horizontal de la page à la largeur courante. */
export async function sansDebordementHorizontal(page: Page, largeur: number): Promise<void> {
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(debordement, `aucun débordement horizontal à ${largeur} px`).toBeLessThanOrEqual(0)
}
