// A4 (D-A4-04 à D-A4-06, D-A4-19, D-A4-20) : registre des réglages d'exploitation, LECTURE et ÉCRITURE.
//
// Lecture (`lire`) : jamais d'exception, y compris sur le chemin public. Un instantané de la table (19 lignes au plus)
// est gardé 5 s par processus ; la lecture a un délai de 300 ms ; un échec est mémorisé 5 s (la base malade n'est pas
// interrogée à chaque requête). Table illisible ou valeur invalide : repli PAR CLÉ (drapeau de sécurité = valeur
// restrictive `repliFerme`, sinon valeur du code), journal sans la valeur. Pas de ligne : valeur du code.
// Écriture (`ecrire`) : DANS la transaction de l'appelant, sous verrou, validation par le registre, journal inclus.
import { eq, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../shared/admin'
import { reglages } from '../../shared/db/schema'
import { REGLAGES, REGLAGES_LISTE } from '../../shared/reglages'
import type { LireReglage, ReglageCle, ReglageDefinition, ReglageValeur, ReglageValeurDe } from '../../shared/reglages'
import { schemaValeurReglage } from '../../shared/schemas/admin-a4'
import { valeurDuCode } from '../config/reglages-code'
import { UnprocessableError } from '../exceptions/http'
import { db } from '../utils/db'
import { enregistrer } from './admin/audit'
import type { TransactionAdmin } from './admin/audit'

/** Durée de vie de l'instantané (et de l'échec mémorisé), en millisecondes. */
export const REGLAGES_CACHE_MS = 5_000
/** Délai de lecture de la table : au-delà, repli. */
export const REGLAGES_LECTURE_TIMEOUT_MS = 300

type Executeur = Pick<typeof db, 'select'>

interface LigneReglage {
  valeur: unknown
  modifiePar: string
  modifieLe: Date
}

/** `null` = table illisible (échec mémorisé). */
type Instantane = Map<string, LigneReglage> | null

export interface ReglageCourant {
  valeur: ReglageValeur
  surcharge: boolean
  modifieLe: Date | null
  modifiePar: string | null
}

export interface EcritureReglage {
  cle: ReglageCle
  /** `null` = rétablir la valeur du code (la ligne est supprimée). */
  valeur: ReglageValeur | null
  adminId: string
  motif: string
  cleIdempotence: string
  ip: string
}

interface CacheInstantane {
  instantane: Instantane
  expireLe: number
}

let cache: CacheInstantane | null = null
let chargement: Promise<Instantane> | null = null

export function _viderCache(): void {
  cache = null
  chargement = null
}

function signalerValeurInvalide(cle: ReglageCle): void {
  // Jamais la valeur lue : une clé suffit à diagnostiquer.
  console.error(`[reglages] valeur invalide en base pour « ${cle} » : repli (REGLAGE_VALEUR_INVALIDE)`)
}

/** Repli par clé : restrictif pour un drapeau de sécurité (D-A4-06), valeur du code sinon. */
function repli(definition: ReglageDefinition): ReglageValeur {
  return definition.securite ? definition.repliFerme : valeurDuCode(definition.cle)
}

async function lireLignes(executeur: Executeur): Promise<Map<string, LigneReglage>> {
  const lignes = await executeur
    .select({ cle: reglages.cle, valeur: reglages.valeur, modifiePar: reglages.modifiePar, modifieLe: reglages.modifieLe })
    .from(reglages)
  return new Map(lignes.map((ligne) => [ligne.cle, { valeur: ligne.valeur, modifiePar: ligne.modifiePar, modifieLe: ligne.modifieLe }]))
}

function avecDelai<T>(promesse: Promise<T>, delaiMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error('REGLAGES_DELAI')), delaiMs)
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur)
        resolve(valeur)
      },
      (erreur: unknown) => {
        clearTimeout(minuteur)
        reject(erreur instanceof Error ? erreur : new Error('REGLAGES_ECHEC'))
      },
    )
  })
}

async function chargerInstantane(): Promise<Instantane> {
  try {
    return await avecDelai(lireLignes(db), REGLAGES_LECTURE_TIMEOUT_MS)
  } catch {
    console.error('[reglages] table illisible : repli par clé pendant 5 s (REGLAGES_LECTURE_ECHEC)')
    return null
  }
}

async function instantane(): Promise<Instantane> {
  const maintenant = Date.now()
  if (cache && cache.expireLe > maintenant) return cache.instantane
  chargement ??= chargerInstantane().then((resultat) => {
    cache = { instantane: resultat, expireLe: Date.now() + REGLAGES_CACHE_MS }
    chargement = null
    return resultat
  })
  return chargement
}

function interpreter(cle: ReglageCle, ligne: LigneReglage | undefined): { valeur: ReglageValeur, surcharge: boolean } {
  const definition: ReglageDefinition = REGLAGES[cle]
  if (!ligne) return { valeur: valeurDuCode(cle), surcharge: false }
  const verifiee = schemaValeurReglage(cle).safeParse(ligne.valeur)
  if (!verifiee.success) {
    signalerValeurInvalide(cle)
    return { valeur: repli(definition), surcharge: false }
  }
  return { valeur: verifiee.data, surcharge: true }
}

/**
 * Valeur en vigueur. Sans `executeur` : instantané en cache, jamais d'exception. Avec `executeur` (transaction
 * d'écriture) : lecture directe, sans cache.
 */
export async function lire<K extends ReglageCle>(cle: K, executeur?: Executeur): Promise<ReglageValeurDe<K>> {
  const definition: ReglageDefinition = REGLAGES[cle]
  try {
    const lignes = executeur ? await lireLignes(executeur) : await instantane()
    if (lignes === null) return repli(definition) as ReglageValeurDe<K>
    return interpreter(cle, lignes.get(cle)).valeur as ReglageValeurDe<K>
  } catch {
    return repli(definition) as ReglageValeurDe<K>
  }
}

/** Les 19 réglages avec leur valeur en vigueur, leur provenance et leur dernière modification (lecture directe : écran d'administration). */
export async function lireTout(executeur: Executeur = db): Promise<Record<ReglageCle, ReglageCourant>> {
  const lignes = await lireLignes(executeur)
  const resultat = {} as Record<ReglageCle, ReglageCourant>
  for (const definition of REGLAGES_LISTE) {
    const ligne = lignes.get(definition.cle)
    const { valeur, surcharge } = interpreter(definition.cle, ligne)
    resultat[definition.cle] = {
      valeur,
      surcharge,
      modifieLe: ligne?.modifieLe ?? null,
      modifiePar: ligne?.modifiePar ?? null,
    }
  }
  return resultat
}

const VERROU_REGLAGE_PREFIXE = 'reglage:'

/** Valeur journalisée (D-A4-20) : un texte donne sa seule longueur, un nombre ou un booléen reste en clair. */
export function etatJournal(valeur: ReglageValeur): Record<string, string | number | boolean> {
  return typeof valeur === 'string' ? { longueur: valeur.length } : { valeur }
}

/**
 * Écrit (ou rétablit le défaut d')un réglage DANS la transaction `tx`, sous verrou de clé. Lecture seule : 422
 * `REGLAGE_LECTURE_SEULE` ; hors bornes, hors type ou validation croisée : 422 `REGLAGE_INVALIDE` (jamais la valeur
 * dans la réponse). Le journal est écrit dans la même transaction. À l'appelant : `_viderCache()` après le commit.
 */
export async function ecrire(tx: TransactionAdmin, entree: EcritureReglage): Promise<ReglageCourant> {
  const definition: ReglageDefinition = REGLAGES[entree.cle]
  if (!definition.modifiable) throw new UnprocessableError('REGLAGE_LECTURE_SEULE')

  // Valeur normalisée par le registre (un texte est rogné) ; `null` = valeur du code.
  let ecrite: ReglageValeur | null = null
  if (entree.valeur !== null) {
    const verifiee = schemaValeurReglage(entree.cle).safeParse(entree.valeur)
    if (!verifiee.success) throw new UnprocessableError('REGLAGE_INVALIDE')
    ecrite = verifiee.data
  }
  const candidate = ecrite ?? valeurDuCode(entree.cle)

  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${VERROU_REGLAGE_PREFIXE}${entree.cle}`}, 0))`)
  const lignes = await lireLignes(tx)
  const avantLigne = lignes.get(entree.cle)
  const avant = interpreter(entree.cle, avantLigne).valeur

  // Validation croisée : la valeur candidate pour la clé écrite, la valeur en vigueur pour les autres.
  const lireCandidat: LireReglage = (cle) => (cle === entree.cle ? candidate : interpreter(cle, lignes.get(cle)).valeur)
  const refus = definition.valider?.(candidate, lireCandidat) ?? null
  if (refus !== null) throw new UnprocessableError('REGLAGE_INVALIDE', { champs: { valeur: [refus] } })

  let modifieLe: Date | null = null
  if (ecrite === null) {
    await tx.delete(reglages).where(eq(reglages.cle, entree.cle))
  } else {
    const [ligne] = await tx
      .insert(reglages)
      .values({ cle: entree.cle, valeur: ecrite, modifiePar: entree.adminId })
      .onConflictDoUpdate({
        target: reglages.cle,
        set: { valeur: ecrite, modifiePar: entree.adminId, modifieLe: sql`now()` },
      })
      .returning({ modifieLe: reglages.modifieLe })
    modifieLe = ligne?.modifieLe ?? null
  }

  await enregistrer(tx, {
    adminId: entree.adminId,
    action: ADMIN_ACTIONS.reglageModifier,
    cibleType: ADMIN_CIBLES.reglage,
    cibleId: entree.cle,
    avant: etatJournal(avant),
    apres: entree.valeur === null ? { ...etatJournal(candidate), defaut: true } : etatJournal(candidate),
    motif: entree.motif,
    ip: entree.ip,
    cleIdempotence: entree.cleIdempotence,
  })

  return {
    valeur: candidate,
    surcharge: entree.valeur !== null,
    modifieLe,
    modifiePar: entree.valeur === null ? null : entree.adminId,
  }
}

export const Reglages = { lire, lireTout, ecrire, _viderCache }
