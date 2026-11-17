import { Queue } from 'bullmq'
import { eq } from 'drizzle-orm'
import { vi } from 'vitest'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import { generationsIa, vitrines } from '../../../shared/db/schema'
import { signatureAttendue } from '../../unit/support/seo-ia'
import type { SeoIaFixture } from '../../unit/support/seo-ia'
import { createUser, insertVitrineRow } from './fabriques'
import type { UserRow, VitrineRow } from './fabriques'
import { creerHorloge, creerProviderScripte } from './ia'
import type { EtapeFournisseur, RequeteVue } from './ia'

// Décision #24 : outillage commun des tests d'intégration du SEO IA. Rien n'est simulé sauf le fournisseur
// (FauxProvider / fournisseur scripté) et l'horloge : base, Redis et files sont les vrais.
//
// CONTRAT ATTENDU (phase RED, imports PARESSEUX : un module absent ne fait échouer que le test qui en a besoin)
//   server/services/ia/seo-regles.ts   SEO_SIGNATURE_VERSION, signatureEntreesSeo, seoIaFraiche
//   server/services/ia/seo.ts          regenererSeoVitrine(vitrineId, { provider, now, sleep })
//   server/jobs/seo.ts                 planifierRegenerationSeo(vitrineId)  (file « ia-fond », job « seo-ia-regenerer »)
//   server/services/ia/verification.ts validerSeo, contientFormulationInterdite, accentsManquants

export const seoRegles = () => import('../../../server/services/ia/seo-regles')
export const seoService = () => import('../../../server/services/ia/seo')
export const seoJobs = () => import('../../../server/jobs/seo')
export const verificationIa = () => import('../../../server/services/ia/verification')

export const NOM_FILE_FOND = 'ia-fond'
export const NOM_JOB_SEO = 'seo-ia-regenerer'
export const PREFIXE_JOB_ID_SEO = 'seo-ia-'
export const DELAI_DEBOUNCE_SEO_MS = 300_000
export const TYPE_SEO = 'seo_vitrine'

export const jobIdSeo = (vitrineId: string): string => `${PREFIXE_JOB_ID_SEO}${vitrineId}`

// ---------------------------------------------------------------------------------------------
// File « ia-fond » (vraie file BullMQ sur le Redis de test)
// ---------------------------------------------------------------------------------------------

let fileFond: Queue | undefined

export function getFileFond(): Queue {
  fileFond ??= new Queue(NOM_FILE_FOND, { connection: redis })
  return fileFond
}

export async function viderFileFond(): Promise<void> {
  await getFileFond().obliterate({ force: true })
}

/** Tous les jobs de la file, quel que soit leur état. */
export async function jobsFond() {
  return getFileFond().getJobs(['delayed', 'waiting', 'prioritized', 'active', 'completed', 'failed'])
}

export async function compterJobsFond(): Promise<number> {
  return (await jobsFond()).length
}

export async function fermerFileFond(): Promise<void> {
  if (!fileFond) return
  await fileFond.obliterate({ force: true })
  await fileFond.close()
  fileFond = undefined
}

// ---------------------------------------------------------------------------------------------
// Vitrines de test
// ---------------------------------------------------------------------------------------------

export const ENTREES_VITRINE = {
  metier: 'Cardiologue interventionnel',
  ville: 'Douala',
  pays: 'CM',
  accroche: 'Votre cœur entre de bonnes mains',
}

export type EtatSeoIa = 'frais' | 'perime' | 'aucun'

export interface OptionsVitrineSeo {
  publiee?: boolean
  ia?: EtatSeoIa
  metier?: string
  ville?: string | null
  pays?: string | null
  accroche?: string | null
  seoTitre?: string | null
  seoDescription?: string | null
  utilisateur?: UserRow
}

const SEO_IA_STOCKE: SeoIaFixture = {
  titre: 'Cardiologue à Douala',
  description: 'Consultations de cardiologie à Douala pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.',
}

/** Vitrine (publiée par défaut) dont le SEO IA est « frais », « perime » (signature d'autres valeurs) ou absent. */
export async function creerVitrineSeo(options: OptionsVitrineSeo = {}): Promise<{ user: UserRow, vitrine: VitrineRow }> {
  const user = options.utilisateur ?? (await createUser())
  const base = await insertVitrineRow(user.id, {
    metier: options.metier ?? ENTREES_VITRINE.metier,
    ville: options.ville === undefined ? ENTREES_VITRINE.ville : options.ville,
    pays: options.pays === undefined ? ENTREES_VITRINE.pays : options.pays,
    publiee: options.publiee ?? true,
  })
  const accroche = options.accroche === undefined ? ENTREES_VITRINE.accroche : options.accroche
  const entrees = { metier: base.metier, ville: base.ville, pays: base.pays, accroche }
  const etat = options.ia ?? 'frais'
  const [vitrine] = await db
    .update(vitrines)
    .set({
      accroche,
      bio: 'Une présentation de plusieurs phrases pour la vitrine.',
      seoTitre: options.seoTitre ?? null,
      seoDescription: options.seoDescription ?? null,
      ...(etat === 'aucun'
        ? {}
        : {
            seoIaTitre: SEO_IA_STOCKE.titre,
            seoIaDescription: SEO_IA_STOCKE.description,
            seoIaSignature: signatureAttendue(etat === 'frais' ? entrees : { ...entrees, metier: 'Un ancien métier' }),
            seoIaGenereLe: new Date('2026-11-01T10:00:00.000Z'),
          }),
    })
    .where(eq(vitrines.id, base.id))
    .returning()
  if (!vitrine) throw new Error('Vitrine de test introuvable après mise à jour.')
  return { user, vitrine }
}

export async function lireVitrineSeo(vitrineId: string): Promise<VitrineRow | undefined> {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.id, vitrineId))
  return ligne
}

/** Modifie la vitrine DIRECTEMENT en base (simule une écriture concurrente d'un autre onglet). */
export async function modifierVitrineEnBase(vitrineId: string, valeurs: Partial<typeof vitrines.$inferInsert>): Promise<void> {
  await db.update(vitrines).set(valeurs).where(eq(vitrines.id, vitrineId))
}

export async function lireGenerationsSeo(userId: string) {
  const lignes = await db.select().from(generationsIa).where(eq(generationsIa.userId, userId))
  return lignes.filter((ligne) => ligne.type === TYPE_SEO)
}

export function aSeoIa(vitrine: VitrineRow): boolean {
  return vitrine.seoIaTitre !== null || vitrine.seoIaDescription !== null || vitrine.seoIaSignature !== null || vitrine.seoIaGenereLe !== null
}

// ---------------------------------------------------------------------------------------------
// Fournisseur scripté du SEO (seule chose fausse : l'API tierce) et horloge
// ---------------------------------------------------------------------------------------------

interface EntreeSeoVue {
  metier: string
  ville: string
}

/** Lit l'entrée envoyée au fournisseur dans le bloc <donnees> du message (JSON, chevrons échappés). */
export function entreeDuMessage(requete: RequeteVue): EntreeSeoVue {
  const bloc = /<donnees>\s*([\s\S]*?)\s*<\/donnees>/.exec(requete.message)?.[1]
  if (!bloc) throw new Error('Message sans bloc <donnees>.')
  const donnees: unknown = JSON.parse(bloc)
  if (typeof donnees !== 'object' || donnees === null) throw new Error('Bloc <donnees> illisible.')
  const { metier, ville } = donnees as Record<string, unknown>
  return { metier: typeof metier === 'string' ? metier : '', ville: typeof ville === 'string' ? ville : '' }
}

/** SEO valide (forme, ville dans le titre ET la description, aucun fait inventé, accents, aucune formulation interdite). */
export function seoPourEntree(entree: EntreeSeoVue): SeoIaFixture {
  const metier = entree.metier.toLocaleLowerCase('fr')
  return {
    titre: `${entree.metier} à ${entree.ville}`,
    description: `Consultations de ${metier} à ${entree.ville} pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.`,
  }
}

export interface OptionsFournisseurSeo {
  /** Exécuté PENDANT l'appel au fournisseur (écriture concurrente simulée), avant de répondre. */
  pendantAppel?: () => Promise<void>
}

/** Étape de fournisseur qui répond le SEO valide calculé depuis l'entrée reçue, après `pendantAppel`. */
export function etapeSeo(options: OptionsFournisseurSeo = {}): EtapeFournisseur {
  return async (requete) => {
    await options.pendantAppel?.()
    return seoPourEntree(entreeDuMessage(requete))
  }
}

/** Fournisseur scripté : une étape = un appel, la dernière se répète. Par défaut, un SEO valide à chaque appel. */
export function creerFournisseurSeo(etapes: EtapeFournisseur[] = [etapeSeo()]) {
  return creerProviderScripte(etapes)
}

/** Dépendances d'exécution : horloge RÉELLE (les fenêtres de 24 h se calculent sur le temps courant), attente instantanée. */
export function depsSeo(provider: ReturnType<typeof creerProviderScripte> | null) {
  const horloge = creerHorloge(Date.now())
  return { provider, now: horloge.now, sleep: horloge.sleep }
}

// ---------------------------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------------------------

/** Espionne (et tait) toute la console ; `texte()` donne ce qui a été journalisé, `erreurs()` error + warn. */
export function espionnerConsole() {
  const espions = (['log', 'info', 'warn', 'error', 'debug'] as const).map((methode) => ({
    methode,
    espion: vi.spyOn(console, methode).mockImplementation(() => undefined),
  }))
  const brut = (methodes: readonly string[]) =>
    espions
      .filter(({ methode }) => methodes.includes(methode))
      .flatMap(({ espion }) => espion.mock.calls)
      .map((appel) => JSON.stringify(appel))
      .join('\n')
  return {
    texte: () => brut(['log', 'info', 'warn', 'error', 'debug']),
    erreurs: () => brut(['warn', 'error']),
  }
}
