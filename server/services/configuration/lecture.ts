// A5 (D-A5-04) : lecture des versions ACTIVES de la configuration commerciale (plans, prix, frais, moyens), avec repli
// sur les constantes du code (qui valent la v1 seedée, test `seed-v1`).
//  - cache mémoire de 5 s pour les lectures « d'affichage » (PlanService, offre, sitemap, statistiques) ;
//  - SANS cache (`sansCache`, ou lecture dans la transaction) pour ce qui décide d'un encaissement ou d'un quota
//    (initiation de paiement, `assertQuota`, verrouillage des paiements) ;
//  - une lecture en échec ou une valeur invalide ne casse jamais le service : repli sur le code, et le prix repris du
//    code reste « non validé » (le paiement reste verrouillé en production, jamais ouvert).
import { and, eq } from 'drizzle-orm'
import { configurationVersions } from '../../../shared/db/schema'
import { VERSION_CATEGORIE_PAR_TYPE } from '../../../shared/admin'
import type { VersionCategorie } from '../../../shared/admin'
import { CAPACITES_PAYANTES, PLAN_IDS } from '../../../shared/plans'
import type { PlanId } from '../../../shared/plans'
import {
  schemaValeursFrais,
  schemaValeursMoyens,
  schemaValeursPlan,
  schemaValeursPrix,
} from '../../../shared/schemas/admin-versions'
import type { ValeursPlan } from '../../../shared/schemas/admin-versions'
import { FRAIS_PAIEMENT, MOYENS_PAIEMENT } from '../../config/paiements'
import type { ConfigFrais, MoyenPaiementConfig, TableFrais } from '../../config/paiements'
import { PLANS, PLAN_PAYANT_ID, PRIX_PLANS } from '../../config/plans'
import type { ConfigPlan, GrillePrix } from '../../config/plans'
import { db } from '../../utils/db'

/** Durée de vie du cache de lecture (D-A5-04). */
export const CONFIGURATION_CACHE_MS = 5_000

type Lecteur = Pick<typeof db, 'select'>

export interface LigneVersionActive {
  categorie: string
  cle: string
  valeurs: unknown
  valideeLe: Date | null
}

export interface InstantaneConfiguration {
  plans: Record<PlanId, ValeursPlan>
  grille: GrillePrix
  /** `null` : grille non validée (repli du code compris) : la production reste verrouillée. */
  prixValideeLe: Date | null
  frais: TableFrais
  /** Par fournisseur : identifiants des moyens ACTIFS. Absent : la valeur du code s'applique. */
  moyensActifs: ReadonlyMap<string, ReadonlySet<string>>
}

export interface ConfigPaiementsLue {
  moyens: readonly MoyenPaiementConfig[]
  frais: TableFrais
  prix: GrillePrix
  validee: boolean
}

function planDuCode(plan: PlanId): ValeursPlan {
  const valeurs = PLANS[plan]
  return { ...valeurs, capacites: { mcp: plan === PLAN_PAYANT_ID && CAPACITES_PAYANTES.includes('mcp') } }
}

/** Instantané des valeurs du CODE (repli). Le prix n'y est jamais validé. */
export function instantaneDuCode(): InstantaneConfiguration {
  return {
    plans: { gratuit: planDuCode('gratuit'), payant: planDuCode('payant') },
    grille: PRIX_PLANS[PLAN_PAYANT_ID],
    prixValideeLe: null,
    frais: FRAIS_PAIEMENT,
    moyensActifs: new Map(),
  }
}

function signaler(raison: string, categorie: string): void {
  // Jamais la valeur : le type et la raison seulement.
  console.error({ configuration: 'version_invalide', categorie, raison })
}

/**
 * Construit l'instantané depuis les lignes `active` : chaque valeur est revalidée par son schéma strict ; une ligne
 * invalide est ignorée (repli sur le code pour cette clé). PURE, testable sans base.
 */
export function construireInstantane(lignes: readonly LigneVersionActive[]): InstantaneConfiguration {
  const instantane = instantaneDuCode()
  const plans = { ...instantane.plans }
  let grille = instantane.grille
  let prixValideeLe: Date | null = null
  const frais: Record<string, Record<string, ConfigFrais>> = {}
  for (const [fournisseur, methodes] of Object.entries(FRAIS_PAIEMENT)) frais[fournisseur] = { ...methodes }
  const moyensActifs = new Map<string, ReadonlySet<string>>()

  for (const ligne of lignes) {
    if (ligne.categorie === VERSION_CATEGORIE_PAR_TYPE.plans) {
      const valeurs = schemaValeursPlan.safeParse(ligne.valeurs)
      if (!valeurs.success || !(PLAN_IDS as readonly string[]).includes(ligne.cle)) {
        signaler('plan', ligne.categorie)
        continue
      }
      plans[ligne.cle as PlanId] = valeurs.data
    } else if (ligne.categorie === VERSION_CATEGORIE_PAR_TYPE.prix) {
      const valeurs = schemaValeursPrix.safeParse(ligne.valeurs)
      if (!valeurs.success || ligne.cle !== PLAN_PAYANT_ID) {
        signaler('prix', ligne.categorie)
        continue
      }
      grille = valeurs.data
      prixValideeLe = ligne.valideeLe
    } else if (ligne.categorie === VERSION_CATEGORIE_PAR_TYPE.frais) {
      const valeurs = schemaValeursFrais.safeParse(ligne.valeurs)
      const [fournisseur, methode] = ligne.cle.split(':')
      if (!valeurs.success || fournisseur === undefined || methode === undefined) {
        signaler('frais', ligne.categorie)
        continue
      }
      frais[fournisseur] = { ...frais[fournisseur], [methode]: valeurs.data }
    } else if (ligne.categorie === VERSION_CATEGORIE_PAR_TYPE.moyens) {
      const valeurs = schemaValeursMoyens.safeParse(ligne.valeurs)
      if (!valeurs.success) {
        signaler('moyens', ligne.categorie)
        continue
      }
      moyensActifs.set(ligne.cle, new Set(valeurs.data.actifs))
    }
  }
  return { plans, grille, prixValideeLe, frais: frais as TableFrais, moyensActifs }
}

/** Applique les drapeaux `actif` d'une version de moyens au catalogue du code (un moyen ne se crée pas, D-A5-08). */
export function appliquerMoyensActifs(
  moyens: readonly MoyenPaiementConfig[],
  moyensActifs: ReadonlyMap<string, ReadonlySet<string>>,
): MoyenPaiementConfig[] {
  return moyens.map((moyen) => {
    const actifs = moyensActifs.get(moyen.fournisseur)
    return actifs === undefined ? { ...moyen } : { ...moyen, actif: actifs.has(moyen.id) }
  })
}

async function chargerLignesActives(lecteur: Lecteur): Promise<LigneVersionActive[]> {
  return lecteur
    .select({
      categorie: configurationVersions.categorie,
      cle: configurationVersions.cle,
      valeurs: configurationVersions.valeurs,
      valideeLe: configurationVersions.valideeLe,
    })
    .from(configurationVersions)
    .where(eq(configurationVersions.statut, 'active'))
}

/** Lit l'instantané SANS cache et SANS repli : lève si la base est illisible (contrôle au démarrage, R9). */
export async function lireInstantaneStrict(lecteur: Lecteur = db): Promise<InstantaneConfiguration> {
  return construireInstantane(await chargerLignesActives(lecteur))
}

/** Lit l'instantané SANS cache (`lecteur` = la transaction de l'appelant, pour lire dans la transaction). */
export async function lireInstantaneSansCache(lecteur: Lecteur = db): Promise<InstantaneConfiguration> {
  try {
    return construireInstantane(await chargerLignesActives(lecteur))
  } catch {
    console.error({ configuration: 'lecture_impossible' })
    return instantaneDuCode()
  }
}

// ---------------------------------------------------------------------------------------------
// Cache mémoire de 5 s (un instantané par processus, rafraîchi en vol unique)
// ---------------------------------------------------------------------------------------------

let instantaneCourant: InstantaneConfiguration = instantaneDuCode()
let chargeLe = 0
let rafraichissement: Promise<void> | null = null

function perime(maintenant: number): boolean {
  return maintenant - chargeLe >= CONFIGURATION_CACHE_MS
}

function rafraichir(): Promise<void> {
  rafraichissement ??= (async () => {
    try {
      instantaneCourant = construireInstantane(await chargerLignesActives(db))
    } catch {
      // On garde l'instantané précédent (ou le code au démarrage) : jamais de service interrompu par une lecture.
      console.error({ configuration: 'rafraichissement_impossible' })
    } finally {
      chargeLe = Date.now()
      rafraichissement = null
    }
  })()
  return rafraichissement
}

/** Attend, si l'instantané a plus de 5 s, son rafraîchissement. À appeler avant une lecture synchrone. */
export async function assurerInstantane(): Promise<void> {
  if (perime(Date.now())) await rafraichir()
}

/** Instantané courant, SANS attente (jamais plus ancien que le dernier rafraîchissement ; rafraîchit en tâche de fond). */
export function instantaneCache(): InstantaneConfiguration {
  if (perime(Date.now())) void rafraichir()
  return instantaneCourant
}

/** Vide le cache du processus (après une écriture validée : la prochaine lecture relit la base). */
export function viderCacheConfiguration(): void {
  chargeLe = 0
  rafraichissement = null
}

// ---------------------------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------------------------

export interface OptionsLecture {
  sansCache?: boolean
  /** Lecteur (transaction) pour une lecture sans cache dans la transaction de l'appelant. */
  lecteur?: Lecteur
}

export interface VersionActiveLue {
  id: string
  numero: number
  valeurs: unknown
  valideeLe: Date | null
}

/** Valeurs du CODE pour une clé (v1 seedée) : repli quand aucune version active n'est lisible. Prix jamais validé. */
function versionDuCode(categorie: VersionCategorie, cle: string, instantane: InstantaneConfiguration): VersionActiveLue | null {
  const repli = (valeurs: unknown): VersionActiveLue => ({ id: 'code', numero: 1, valeurs, valideeLe: null })
  if (categorie === 'plan') return (PLAN_IDS as readonly string[]).includes(cle) ? repli(instantane.plans[cle as PlanId]) : null
  if (categorie === 'prix') return cle === PLAN_PAYANT_ID ? repli(instantane.grille) : null
  if (categorie === 'frais') {
    const [fournisseur, methode] = cle.split(':')
    const frais = (instantane.frais as Record<string, Record<string, ConfigFrais> | undefined>)[fournisseur ?? '']?.[methode ?? '']
    return frais === undefined ? null : repli(frais)
  }
  const actifs = instantane.moyensActifs.get(cle)
  return repli({ actifs: actifs === undefined ? MOYENS_PAIEMENT.filter((m) => m.fournisseur === cle && m.actif).map((m) => m.id) : [...actifs] })
}

/**
 * Version active d'une clé. `sansCache` : relue en base (lecteur = transaction de l'appelant). Sinon, instantané de
 * 5 s. Base illisible ou aucune version active : repli sur le code (jamais d'exception ; le prix reste non validé).
 */
export async function lireVersionActive(
  categorie: VersionCategorie,
  cle: string,
  options: OptionsLecture = {},
): Promise<VersionActiveLue | null> {
  if (options.sansCache !== true) {
    await assurerInstantane()
    const instantane = instantaneCache()
    const ligne = categorie === 'prix' ? { valeurs: instantane.grille, valideeLe: instantane.prixValideeLe } : null
    const repli = versionDuCode(categorie, cle, instantane)
    return repli === null ? null : { ...repli, ...(ligne === null ? {} : { valideeLe: ligne.valideeLe }) }
  }
  try {
    const [ligne] = await (options.lecteur ?? db)
      .select({
        id: configurationVersions.id,
        numero: configurationVersions.numero,
        valeurs: configurationVersions.valeurs,
        valideeLe: configurationVersions.valideeLe,
      })
      .from(configurationVersions)
      .where(and(eq(configurationVersions.categorie, categorie), eq(configurationVersions.cle, cle), eq(configurationVersions.statut, 'active')))
      .limit(1)
    if (ligne !== undefined) return ligne
  } catch {
    console.error({ configuration: 'lecture_impossible' })
  }
  return versionDuCode(categorie, cle, instantaneDuCode())
}

/** Valeurs complètes d'un plan (capacités comprises), depuis l'instantané en cache. */
export function lirePlanVersionne(plan: PlanId): ValeursPlan {
  return instantaneCache().plans[plan]
}

/** Configuration d'un plan au format historique `ConfigPlan` (SYNCHRONE, depuis l'instantané de 5 s au plus). */
export function lirePlanConfig(plan: PlanId): ConfigPlan {
  const { capacites: _capacites, ...config } = lirePlanVersionne(plan)
  return config
}

/** Même lecture, sans cache et dans la transaction de l'appelant (`assertQuota` : la limite décide d'une écriture). */
export async function lirePlanConfigSansCache(plan: PlanId, lecteur: Lecteur = db): Promise<ConfigPlan> {
  const { capacites: _capacites, ...config } = (await lireInstantaneSansCache(lecteur)).plans[plan]
  return config
}

export interface GrillePrixLue {
  grille: GrillePrix
  /** Alias de `grille` (forme commune des versions lues). */
  valeurs: GrillePrix
  valideeLe: Date | null
  /** Vrai si la grille est validée (jamais pour le repli du code). */
  validee: boolean
}

export async function lireGrillePrix(options: OptionsLecture = {}): Promise<GrillePrixLue> {
  const instantane = options.sansCache === true ? await lireInstantaneSansCache(options.lecteur ?? db) : (await assurerInstantane(), instantaneCache())
  return { grille: instantane.grille, valeurs: instantane.grille, valideeLe: instantane.prixValideeLe, validee: instantane.prixValideeLe !== null }
}

/** Frais d'un fournisseur et d'une méthode (`undefined` : aucun barème, le paiement est indisponible). */
export async function lireFrais(fournisseur: string, methode: string, options: OptionsLecture = {}): Promise<ConfigFrais | undefined> {
  const instantane = options.sansCache === true ? await lireInstantaneSansCache(options.lecteur ?? db) : (await assurerInstantane(), instantaneCache())
  return (instantane.frais as Record<string, Record<string, ConfigFrais> | undefined>)[fournisseur]?.[methode]
}

/** Moyens de paiement : catalogue du code, drapeaux `actif` de la version active. */
export async function lireMoyensActifs(options: OptionsLecture = {}): Promise<MoyenPaiementConfig[]> {
  const instantane = options.sansCache === true ? await lireInstantaneSansCache(options.lecteur ?? db) : (await assurerInstantane(), instantaneCache())
  return appliquerMoyensActifs(MOYENS_PAIEMENT, instantane.moyensActifs)
}

/** Moyens, frais et grille d'un même instantané (cohérents entre eux), plus l'état « validée » de la grille. */
export async function lireConfigPaiements(options: OptionsLecture = {}): Promise<ConfigPaiementsLue> {
  const instantane = options.sansCache === true ? await lireInstantaneSansCache(options.lecteur ?? db) : (await assurerInstantane(), instantaneCache())
  return {
    moyens: appliquerMoyensActifs(MOYENS_PAIEMENT, instantane.moyensActifs),
    frais: instantane.frais,
    prix: instantane.grille,
    validee: instantane.prixValideeLe !== null,
  }
}
