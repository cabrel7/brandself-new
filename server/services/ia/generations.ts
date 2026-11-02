import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, inArray, isNotNull, lt, notInArray, or, sql } from 'drizzle-orm'
import { generationsIa } from '../../../shared/db/schema'
import type { GenerationIa } from '../../../shared/db/schema'
import {
  GENERATION_EXPIRATION_MS,
  GENERATION_STATUTS_TERMINAUX,
  IA_ATTENTE_BASE_MS,
  IA_DELAI_TENTATIVE_MS,
  IA_DELAI_TOTAL_MS,
  IA_RETENTION_JOURS,
  IA_TENTATIVES_MAX,
  IA_TYPES,
} from '../../../shared/ia'
import type { GenerationStatut, IaErreurCode, IaFournisseurAppele, IaType, MotifRepli } from '../../../shared/ia'
import {
  IA_GLOBAL_LIMIT,
  IA_LIMITE_CLE_GLOBALE,
  IA_LIMITE_CLE_UTILISATEUR_PREFIXE,
  IA_UTILISATEUR_LIMIT,
} from '../../../shared/limites'
import { ServiceUnavailableError, NotFoundError } from '../../exceptions/http'
import { enqueueGeneration } from '../../jobs/ia'
import { getIaQueue } from '../../jobs/queues'
import { db } from '../../utils/db'
import { enforceLimit, hitLimit } from '../limiteur'
import { schemaEntreeAmelioration, schemaEntreeOnboarding } from './entrees'
import type { EntreeAmelioration, EntreeIa, EntreeOnboarding } from './entrees'
import { empreinte } from './nettoyage'
import { outilPour } from './outils'
import { getActivePrompt, getPromptById, renderGabarit, serialiserDonnees } from './prompts'
import { repliAmelioration, repliOnboarding } from './repli'
import { IaErreur } from './types'
import type { ExecutionDeps, IaProvider, IaReponse, IaRequete } from './types'
import { validerSortie } from './verification'

// S8 §4.8 : cycle de vie d'une génération. Le web crée la ligne (ou un repli immédiat), le worker l'exécute
// (`executeGeneration`), la lecture la fait expirer si le job est perdu (`getOwnGeneration`), un job
// quotidien purge les données après la rétention (`purgeGenerations`).
// Journal : identifiant, type, statut, motif et codes. JAMAIS l'entrée, la sortie, le prompt ni la clé.

export type GenerationRow = GenerationIa

export interface CreationResultat {
  generation: GenerationRow
  /** Vrai si une génération identique existait déjà : rien n'a été créé, rien n'a été compté. */
  dedoublonnee: boolean
}

export interface OptionsCreation {
  /** Injection suspectée dans l'entrée : le worker sert le repli sans appeler le fournisseur. */
  injection: boolean
}

type Cible =
  | { type: 'onboarding_vitrine', entree: EntreeOnboarding }
  | { type: 'ameliorer_texte', entree: EntreeAmelioration }

const MS_PAR_JOUR = 86_400_000
const PROMPT_ABSENT = 'sans_prompt'
const STATUTS_ACTIFS = ['en_attente', 'en_cours'] as const
/** Replis dus à une panne passagère de NOTRE infrastructure : une nouvelle demande doit pouvoir réessayer. */
const MOTIFS_REPLI_TRANSITOIRES: readonly MotifRepli[] = ['file_indisponible', 'limiteur_indisponible', 'plafond_global']

class GenerationIllisibleError extends Error {
  constructor() {
    super('GENERATION_ILLISIBLE')
    this.name = 'GenerationIllisibleError'
  }
}

function estTypeIa(valeur: string): valeur is IaType {
  return (IA_TYPES as readonly string[]).includes(valeur)
}

/** Relit l'entrée stockée (JSON non typé) ; `null` si elle a été purgée ou ne correspond pas au type. */
function lireCible(ligne: GenerationRow): Cible | null {
  if (!estTypeIa(ligne.type)) return null
  if (ligne.type === 'onboarding_vitrine') {
    const entree = schemaEntreeOnboarding.safeParse(ligne.entree)
    return entree.success ? { type: ligne.type, entree: entree.data } : null
  }
  const entree = schemaEntreeAmelioration.safeParse(ligne.entree)
  return entree.success ? { type: ligne.type, entree: entree.data } : null
}

/** Texte déterministe servi quand l'IA n'a rien produit (jamais de vitrine vide). */
function repliPour(cible: Cible): unknown {
  return cible.type === 'onboarding_vitrine' ? repliOnboarding(cible.entree) : repliAmelioration(cible.entree)
}

function ciblePour(type: IaType, entree: EntreeIa): Cible {
  if (type === 'onboarding_vitrine' && !('champ' in entree)) return { type, entree }
  if (type === 'ameliorer_texte' && 'champ' in entree) return { type, entree }
  throw new GenerationIllisibleError()
}

function journaliser(ligne: Pick<GenerationRow, 'id' | 'type'>, details: Record<string, unknown>): void {
  console.info({ ia: 'generation', id: ligne.id, type: ligne.type, ...details })
}

// ---------------------------------------------------------------------------------------------
// Création (côté web)
// ---------------------------------------------------------------------------------------------

type TransactionDb = Parameters<Parameters<typeof db.transaction>[0]>[0]

/** Une génération identique réutilisable (S8 §4.8 et décision d'arbitrage (a)). */
async function chercherExistante(
  tx: TransactionDb,
  userId: string,
  type: IaType,
  empreinteEntree: string,
  now: Date,
): Promise<GenerationRow | undefined> {
  const debutFenetreActive = new Date(now.getTime() - GENERATION_EXPIRATION_MS)
  const [ligne] = await tx
    .select()
    .from(generationsIa)
    .where(
      and(
        eq(generationsIa.userId, userId),
        eq(generationsIa.type, type),
        eq(generationsIa.entreeEmpreinte, empreinteEntree),
        or(
          // En cours : seulement si le job a une chance d'aboutir (sinon la lecture la fera expirer).
          and(inArray(generationsIa.statut, STATUTS_ACTIFS), gt(generationsIa.createdAt, debutFenetreActive)),
          and(eq(generationsIa.statut, 'terminee'), isNotNull(generationsIa.sortie)),
          // Un repli dû à NOTRE infrastructure n'est pas définitif ; les autres le sont (même entrée, même repli).
          and(
            eq(generationsIa.statut, 'repli'),
            isNotNull(generationsIa.sortie),
            notInArray(generationsIa.motifRepli, [...MOTIFS_REPLI_TRANSITOIRES]),
          ),
        ),
      ),
    )
    .orderBy(desc(generationsIa.createdAt))
    .limit(1)
  return ligne
}

/**
 * Limites avant tout appel payant. Le dépassement de la limite par utilisateur remonte (429) ; un limiteur
 * ou un plafond global qui ne peut pas répondre donne un repli (« fail-closed » = pas d'appel payant si on
 * ne peut pas compter, et non « inscription impossible »).
 */
async function motifRepliAvantAppel(userId: string): Promise<MotifRepli | null> {
  try {
    await enforceLimit(
      `${IA_LIMITE_CLE_UTILISATEUR_PREFIXE}${userId}`,
      IA_UTILISATEUR_LIMIT.limit,
      IA_UTILISATEUR_LIMIT.windowS,
      { failClosed: true },
    )
    const global = await hitLimit(IA_LIMITE_CLE_GLOBALE, IA_GLOBAL_LIMIT.limit, IA_GLOBAL_LIMIT.windowS, {
      failClosed: true,
    })
    return global.allowed ? null : 'plafond_global'
  } catch (erreur) {
    if (erreur instanceof ServiceUnavailableError) return 'limiteur_indisponible'
    throw erreur
  }
}

/**
 * Crée une génération (ou renvoie l'identique, ou un repli immédiat). Le fournisseur n'est JAMAIS appelé
 * ici : la ligne est en `en_attente` et un job `ia-generer` est mis en file après le commit. Seul l'abus
 * (429) interrompt le parcours.
 * Concurrence : un verrou consultatif par (utilisateur, type, empreinte) rend « chercher puis insérer »
 * atomique : deux demandes simultanées ne créent qu'une génération et qu'un job.
 */
export async function createGeneration(
  userId: string,
  type: IaType,
  entree: EntreeIa,
  options: OptionsCreation,
  now: Date = new Date(),
): Promise<CreationResultat> {
  const cible = ciblePour(type, entree)
  const prompt = await getActivePrompt(type)
  const empreinteEntree = empreinte(entree, prompt?.id ?? PROMPT_ABSENT)

  const { generation, aMettreEnFile, dedoublonnee } = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${userId}:${type}:${empreinteEntree}`}, 0))`,
    )
    const existante = await chercherExistante(tx, userId, type, empreinteEntree, now)
    if (existante) return { generation: existante, aMettreEnFile: false, dedoublonnee: true }

    const motif = (await motifRepliAvantAppel(userId)) ?? (prompt ? null : 'sans_prompt')
    const base = {
      id: randomUUID(),
      userId,
      type,
      promptId: prompt?.id ?? null,
      entreeEmpreinte: empreinteEntree,
      injectionSuspectee: options.injection,
      entree,
      createdAt: now,
    }
    const [ligne] = await tx
      .insert(generationsIa)
      .values(
        motif
          ? { ...base, statut: 'repli', motifRepli: motif, sortie: repliPour(cible), termineeLe: now }
          : { ...base, statut: 'en_attente' },
      )
      .returning()
    if (!ligne) throw new GenerationIllisibleError()
    return { generation: ligne, aMettreEnFile: motif === null, dedoublonnee: false }
  })

  if (!aMettreEnFile) {
    if (!dedoublonnee) journaliser(generation, { statut: generation.statut, motif: generation.motifRepli })
    return { generation, dedoublonnee }
  }
  return { generation: await mettreEnFile(generation, cible), dedoublonnee: false }
}

/** Mise en file après le commit ; si la file est inaccessible, la ligne passe en repli `file_indisponible`. */
async function mettreEnFile(generation: GenerationRow, cible: Cible): Promise<GenerationRow> {
  try {
    await enqueueGeneration(getIaQueue(), generation.id)
    return generation
  } catch (erreur) {
    console.error({ ia: 'file indisponible', id: generation.id, nom: erreur instanceof Error ? erreur.name : typeof erreur })
    const [repli] = await db
      .update(generationsIa)
      .set({
        statut: 'repli',
        motifRepli: 'file_indisponible',
        sortie: repliPour(cible),
        termineeLe: new Date(),
      })
      .where(and(eq(generationsIa.id, generation.id), eq(generationsIa.statut, 'en_attente')))
      .returning()
    if (repli) return repli
    const [relue] = await db.select().from(generationsIa).where(eq(generationsIa.id, generation.id)).limit(1)
    return relue ?? generation
  }
}

// ---------------------------------------------------------------------------------------------
// Exécution (worker)
// ---------------------------------------------------------------------------------------------

interface Bilan {
  tentatives: number
  tokensEntree: number | null
  tokensSortie: number | null
  modele: string | null
  fournisseur: IaFournisseurAppele | null
  erreurCode: IaErreurCode | null
}

type Issue = { statut: 'terminee', sortie: unknown } | { statut: 'repli', motif: MotifRepli }

type ResultatAppel = { ok: true, reponse: IaReponse } | { ok: false, code: 'delai' | 'fournisseur' | 'reponse_vide' }

const repli = (motif: MotifRepli): Issue => ({ statut: 'repli', motif })

/** Un appel borné par `delaiMs` : le fournisseur doit respecter le délai, la minuterie garantit qu'il le fait. */
async function appeler(
  provider: IaProvider,
  base: Omit<IaRequete, 'delaiMs' | 'signal'>,
  delaiMs: number,
): Promise<ResultatAppel> {
  const controleur = new AbortController()
  let minuteur: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_resolve, rejeter) => {
    minuteur = setTimeout(() => {
      controleur.abort()
      rejeter(new IaErreur('delai'))
    }, delaiMs)
  })
  try {
    const reponse = await Promise.race([provider.generer({ ...base, delaiMs, signal: controleur.signal }), limite])
    return { ok: true, reponse }
  } catch (erreur) {
    // Le message d'une erreur fournisseur peut citer l'entrée : seul le code est conservé.
    return { ok: false, code: erreur instanceof IaErreur ? erreur.code : 'fournisseur' }
  } finally {
    clearTimeout(minuteur)
  }
}

function ajouter(courant: number | null, ajout: number): number {
  return (courant ?? 0) + ajout
}

async function jouer(ligne: GenerationRow, cible: Cible | null, deps: ExecutionDeps, bilan: Bilan): Promise<Issue> {
  if (ligne.injectionSuspectee) return repli('injection')
  const { provider } = deps
  if (!provider) return repli('sans_fournisseur')
  const prompt = ligne.promptId ? await getPromptById(ligne.promptId) : null
  if (!prompt || !cible) return repli('sans_prompt')

  const base: Omit<IaRequete, 'delaiMs' | 'signal'> = {
    systeme: prompt.systeme,
    message: renderGabarit(prompt.gabarit, { donnees: serialiserDonnees(cible.entree) }),
    outil: outilPour(cible.type),
    parametres: prompt.parametres,
  }
  const echeance = ligne.createdAt.getTime() + IA_DELAI_TOTAL_MS
  let causeFournisseur = false

  for (let essai = 1; essai <= IA_TENTATIVES_MAX; essai += 1) {
    const reste = echeance - deps.now()
    if (reste <= 0) return repli('delai_depasse')

    bilan.tentatives = essai
    bilan.fournisseur = provider.nom
    const appel = await appeler(provider, base, Math.min(IA_DELAI_TENTATIVE_MS, reste))
    if (appel.ok) {
      bilan.tokensEntree = ajouter(bilan.tokensEntree, appel.reponse.tokensEntree)
      bilan.tokensSortie = ajouter(bilan.tokensSortie, appel.reponse.tokensSortie)
      bilan.modele = appel.reponse.modele.slice(0, 100)
      const verdict = validerSortie(cible.type, appel.reponse.donnees, cible.entree)
      if (verdict.ok) return { statut: 'terminee', sortie: verdict.valeur }
      bilan.erreurCode = verdict.code
      causeFournisseur = false
    } else {
      bilan.erreurCode = appel.code
      causeFournisseur = true
    }

    if (essai < IA_TENTATIVES_MAX) {
      const attente = Math.min(IA_ATTENTE_BASE_MS * 2 ** (essai - 1), echeance - deps.now())
      if (attente > 0) await deps.sleep(attente)
    }
  }
  return repli(causeFournisseur ? 'echec_fournisseur' : 'sortie_invalide')
}

/**
 * Exécute une génération `en_attente` (appelé par le worker). Réclamation atomique : une génération déjà
 * traitée, expirée ou supprimée met 0 ligne à jour et l'appel se termine sans effet. L'écriture finale est
 * conditionnelle (`statut = 'en_cours'`) : si la lecture a fait expirer la ligne entre-temps, une seule
 * écriture gagne. Renvoie le statut écrit, ou `null` si rien n'a été réclamé.
 */
export async function executeGeneration(id: string, deps: ExecutionDeps): Promise<GenerationStatut | null> {
  const debut = deps.now()
  const [ligne] = await db
    .update(generationsIa)
    .set({ statut: 'en_cours', demarreeLe: new Date(debut) })
    .where(and(eq(generationsIa.id, id), eq(generationsIa.statut, 'en_attente')))
    .returning()
  if (!ligne) return null

  const cible = lireCible(ligne)
  const bilan: Bilan = {
    tentatives: 0,
    tokensEntree: null,
    tokensSortie: null,
    modele: null,
    fournisseur: null,
    erreurCode: null,
  }
  const issue = await jouer(ligne, cible, deps, bilan)
  const sortie = issue.statut === 'terminee' ? issue.sortie : cible ? repliPour(cible) : null
  const fin = deps.now()

  const [ecrite] = await db
    .update(generationsIa)
    .set({
      statut: issue.statut,
      motifRepli: issue.statut === 'repli' ? issue.motif : null,
      tentatives: bilan.tentatives,
      tokensEntree: bilan.tokensEntree,
      tokensSortie: bilan.tokensSortie,
      dureeMs: Math.max(0, fin - debut),
      fournisseur: bilan.fournisseur,
      modele: bilan.modele,
      erreurCode: bilan.erreurCode,
      sortie,
      termineeLe: new Date(fin),
    })
    .where(and(eq(generationsIa.id, id), eq(generationsIa.statut, 'en_cours')))
    .returning({ statut: generationsIa.statut })

  journaliser(ligne, {
    statut: issue.statut,
    motif: issue.statut === 'repli' ? issue.motif : null,
    tentatives: bilan.tentatives,
    erreur: bilan.erreurCode,
    ecrite: Boolean(ecrite),
  })
  return ecrite ? issue.statut : null
}

// ---------------------------------------------------------------------------------------------
// Lecture et purge
// ---------------------------------------------------------------------------------------------

function estTerminale(statut: string): boolean {
  return (GENERATION_STATUTS_TERMINAUX as readonly string[]).includes(statut)
}

/**
 * Lecture d'une génération de l'utilisateur. Une génération d'autrui ou inconnue est introuvable (404, sans
 * rien révéler). Un job perdu (worker arrêté, Redis vidé) ne bloque jamais l'écran : au-delà de
 * GENERATION_EXPIRATION_MS, la génération passe à `expiree` avec le repli calculé ici.
 */
export async function getOwnGeneration(userId: string, id: string, now: Date = new Date()): Promise<GenerationRow> {
  const lire = async (): Promise<GenerationRow | undefined> => {
    const [ligne] = await db
      .select()
      .from(generationsIa)
      .where(and(eq(generationsIa.id, id), eq(generationsIa.userId, userId)))
      .limit(1)
    return ligne
  }
  const ligne = await lire()
  if (!ligne) throw new NotFoundError('GENERATION_INTROUVABLE')
  if (estTerminale(ligne.statut) || now.getTime() - ligne.createdAt.getTime() <= GENERATION_EXPIRATION_MS) {
    return ligne
  }

  const cible = lireCible(ligne)
  await db
    .update(generationsIa)
    .set({ statut: 'expiree', sortie: cible ? repliPour(cible) : null, termineeLe: now })
    .where(and(eq(generationsIa.id, id), inArray(generationsIa.statut, STATUTS_ACTIFS)))
  journaliser(ligne, { statut: 'expiree' })
  return (await lire()) ?? ligne
}

/** Rétention (§0 #75) : l'entrée et la sortie passent à NULL, les métadonnées (quota, coût) restent. */
export async function purgeGenerations(now: Date = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - IA_RETENTION_JOURS * MS_PAR_JOUR)
  const purgees = await db
    .update(generationsIa)
    .set({ entree: null, sortie: null })
    .where(
      and(
        lt(generationsIa.createdAt, limite),
        or(isNotNull(generationsIa.entree), isNotNull(generationsIa.sortie)),
      ),
    )
    .returning({ id: generationsIa.id })
  return purgees.length
}
