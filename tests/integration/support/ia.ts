import { and, eq } from 'drizzle-orm'
import { db } from '../../../server/utils/db'
import { redis } from '../../../server/utils/redis'
import { generationsIa, progressionsInscription, promptsIa } from '../../../shared/db/schema'
import type { IaType } from '../../../shared/ia'
import {
  TEXTE_AMELIORE_DEFAUT,
  propositionAccrochesCourtes,
  propositionFaitsInventes,
  propositionValide,
} from '../../unit/support/ia-fixtures'
import type { GenerationIaRow } from './fabriques'

// CONTRAT DE LA COUCHE SERVICE ATTENDU PAR LES TESTS S8 (phase RED, à respecter en GREEN ; un seul fichier à
// corriger si un nom diffère). Imports PARESSEUX : un module absent fait échouer le seul test qui en a besoin.
//
// server/services/ia/types.ts          IaErreur(code: 'delai'|'fournisseur'|'reponse_vide', message?)
//                                      IaProvider { nom: 'anthropic'|'faux', generer(IaRequete): Promise<IaReponse> }
// server/services/ia/generations.ts    createGeneration(userId, type, entree, { injection }) -> GenerationIa (ligne)
//                                      executeGeneration(id, { provider|null, now(): number, sleep(ms) }) -> Promise<void>
//                                      getOwnGeneration(userId, id, now: Date) -> GenerationIa (ligne), 404 GENERATION_INTROUVABLE
//                                      purgeGenerations(now: Date) -> Promise<number>
// server/services/ia/ameliorer.ts     ameliorer(userId, input, now?) -> { generation, dedoublonnee }
// server/services/ia/fournisseurs/faux.ts   creerFauxProvider() -> IaProvider & { appels: number } (mode : Redis `ia:faux:mode`)
// server/services/ia/fournisseurs/index.ts  createIaProvider(env) -> IaProvider | null
// server/services/plans.ts             getIaQuota(userId, now: Date) -> QuotaIaDTO
// server/services/onboarding.ts        getOnboarding(userId), saveEtape(userId, input),
//                                      generer(userId) -> { generation, dedoublonnee }, terminer(userId, input) -> { creee }
// server/resources/generation.ts       toGenerationResource(row) -> GenerationDTO
// server/jobs/queues.ts                getIaQueue(); server/jobs/ia.ts : iaJobId, enqueueGeneration, planifierPurge

export const iaTypes = () => import('../../../server/services/ia/types')
export const iaGenerations = () => import('../../../server/services/ia/generations')
export const iaAmeliorer = () => import('../../../server/services/ia/ameliorer')
/** createGeneration renvoie { generation, dedoublonnee } : les tests de cycle de vie veulent la ligne. */
export async function creerGeneration() {
  const { createGeneration } = await iaGenerations()
  return async (...args: Parameters<typeof createGeneration>) => (await createGeneration(...args)).generation
}
export const iaPrompts = () => import('../../../server/services/ia/prompts')
export const iaFaux = () => import('../../../server/services/ia/fournisseurs/faux')
export const iaFournisseurs = () => import('../../../server/services/ia/fournisseurs')
export const iaRepli = () => import('../../../server/services/ia/repli')
export const plansService = () => import('../../../server/services/plans')
export const onboardingService = () => import('../../../server/services/onboarding')
export const ressourceGeneration = () => import('../../../server/resources/generation')
export const queuesJobs = () => import('../../../server/jobs/queues')
export const jobsIa = () => import('../../../server/jobs/ia')

export const CLE_MODE_FAUX = 'ia:faux:mode'
const DUREE_MODE_FAUX_S = 600

export type ModeFaux = 'normal' | 'panne' | 'lent' | 'invalide' | 'invente'

export async function definirModeFaux(mode: ModeFaux): Promise<void> {
  await redis.set(CLE_MODE_FAUX, mode, 'EX', DUREE_MODE_FAUX_S)
}

/** État propre : mode du faux fournisseur effacé et file `ia` vidée (les jobs d'un test ne fuient pas dans le suivant). */
export async function reinitialiserIa(): Promise<void> {
  await redis.del(CLE_MODE_FAUX)
  const { getIaQueue } = await queuesJobs()
  await getIaQueue().obliterate({ force: true })
}

// ---------------------------------------------------------------------------------------------
// Horloge et fournisseur scripté (seule chose « fausse » : l'API tierce).
// ---------------------------------------------------------------------------------------------

export const T0 = Date.parse('2026-11-02T10:00:00.000Z')

export function creerHorloge(debutMs: number = Date.now()) {
  let courant = debutMs
  const attentes: number[] = []
  return {
    now: () => courant,
    sleep: async (ms: number): Promise<void> => {
      attentes.push(ms)
      courant += ms
    },
    avancer: (ms: number): void => {
      courant += ms
    },
    attentes,
  }
}

export interface RequeteVue {
  systeme: string
  message: string
  outil: { nom: string, description: string, schema: Record<string, unknown> }
  parametres: { temperature: number, maxTokens: number }
  delaiMs: number
  signal: AbortSignal
}

export type EtapeFournisseur =
  | 'valide'
  | 'invalide'
  | 'invente'
  | 'panne'
  | 'lent'
  | { donnees: unknown }
  | ((requete: RequeteVue, appel: number) => Promise<unknown> | unknown)

export interface ProviderScripte {
  readonly nom: 'faux'
  readonly appels: RequeteVue[]
  generer(requete: RequeteVue): Promise<{ donnees: unknown, tokensEntree: number, tokensSortie: number, modele: string }>
}

function donneesPour(etape: 'valide' | 'invalide' | 'invente', requete: RequeteVue, texteAmeliore: string): unknown {
  if (requete.outil.nom === 'proposer_texte') return { texte: texteAmeliore }
  if (etape === 'invalide') return propositionAccrochesCourtes()
  if (etape === 'invente') return propositionFaitsInventes()
  return propositionValide()
}

/**
 * Fournisseur déterministe : joue `etapes` dans l'ordre (la dernière se répète). `horloge` fait avancer le temps
 * simulé pour « lent » (délai consommé = `delaiMs`, puis erreur de délai).
 */
export function creerProviderScripte(
  etapes: EtapeFournisseur[],
  options: { horloge?: ReturnType<typeof creerHorloge>, texteAmeliore?: string } = {},
): ProviderScripte {
  const appels: RequeteVue[] = []
  const texteAmeliore = options.texteAmeliore ?? TEXTE_AMELIORE_DEFAUT
  return {
    nom: 'faux',
    appels,
    async generer(requete) {
      const index = appels.length
      appels.push(requete)
      const etape = etapes[Math.min(index, etapes.length - 1)]!
      const { IaErreur } = await iaTypes()
      let donnees: unknown
      if (etape === 'panne') throw new IaErreur('fournisseur')
      if (etape === 'lent') {
        options.horloge?.avancer(requete.delaiMs)
        throw new IaErreur('delai')
      }
      if (typeof etape === 'function') donnees = await etape(requete, index)
      else if (typeof etape === 'object') donnees = etape.donnees
      else donnees = donneesPour(etape, requete, texteAmeliore)
      return { donnees, tokensEntree: 100, tokensSortie: 300, modele: 'modele-test' }
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Lectures directes (preuves en base, jamais via le service testé).
// ---------------------------------------------------------------------------------------------

export async function lireGeneration(id: string): Promise<GenerationIaRow | undefined> {
  const [ligne] = await db.select().from(generationsIa).where(eq(generationsIa.id, id))
  return ligne
}

export async function lireGenerationsDe(userId: string): Promise<GenerationIaRow[]> {
  return db.select().from(generationsIa).where(eq(generationsIa.userId, userId))
}

export async function lireProgression(userId: string) {
  const [ligne] = await db.select().from(progressionsInscription).where(eq(progressionsInscription.userId, userId))
  return ligne
}

export async function promptActif(type: IaType) {
  const [ligne] = await db.select().from(promptsIa).where(and(eq(promptsIa.type, type), eq(promptsIa.actif, true)))
  if (!ligne) throw new Error(`Prompt actif absent pour ${type}`)
  return ligne
}

/** Modifie le prompt actif d'un type le temps de `fn`, puis le restaure à l'identique (la table n'est pas vidée entre les tests). */
export async function avecPromptModifie<T>(type: IaType, patch: Partial<typeof promptsIa.$inferInsert>, fn: () => Promise<T>): Promise<T> {
  const original = await promptActif(type)
  await db.update(promptsIa).set(patch).where(eq(promptsIa.id, original.id))
  try {
    return await fn()
  } finally {
    await db.update(promptsIa).set({
      actif: original.actif,
      variables: original.variables,
      parametres: original.parametres,
      systeme: original.systeme,
      gabarit: original.gabarit,
    }).where(eq(promptsIa.id, original.id))
  }
}

export function isoIlYA(dureeMs: number, depuis: number = Date.now()): Date {
  return new Date(depuis - dureeMs)
}

/** Ensemble des clés (profondeur incluse) d'une valeur JSON : pour vérifier qu'un DTO ne fuit aucun champ interne. */
export function toutesLesCles(valeur: unknown, cles: Set<string> = new Set()): Set<string> {
  if (Array.isArray(valeur)) valeur.forEach((v) => toutesLesCles(v, cles))
  else if (valeur !== null && typeof valeur === 'object') {
    for (const [cle, v] of Object.entries(valeur)) {
      cles.add(cle)
      toutesLesCles(v, cles)
    }
  }
  return cles
}

export const CLES_INTERNES = [
  'entree', 'entreeEmpreinte', 'entree_empreinte', 'motifRepli', 'motif_repli', 'fournisseur', 'modele',
  'tokensEntree', 'tokensSortie', 'tokens_entree', 'tokens_sortie', 'promptId', 'prompt_id', 'erreurCode', 'erreur_code',
  'userId', 'user_id', 'injectionSuspectee', 'injection_suspectee', 'tentatives', 'dureeMs', 'duree_ms',
] as const
