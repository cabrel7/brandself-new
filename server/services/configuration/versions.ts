// A5 (D-A5-01 à D-A5-09, D-A5-14 à D-A5-17) : versions de la configuration commerciale en AJOUT SEUL.
//  - brouillon -> (programmee | active) -> remplacee ; une version n'est jamais supprimée ni éditée (déclencheur) ;
//  - prix : activer = valider (`validee_le` posé dans la même transaction réauthentifiée) ;
//  - baisse de limite d'un plan : impact acquitté, sinon 409 `IMPACT_CHANGE` ;
//  - prompts : même mécanisme sur `prompts_ia` (`actif`), activation immédiate seulement ;
//  - chaque écriture : une transaction, rejeu par clé d'idempotence, verrou (catégorie, clé), réauthentification
//    (sauf brouillon : inerte), journal dans la MÊME transaction (CA13).
import { and, asc, count, desc, eq, lte, max, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import type { AdminVersionType } from '../../../shared/admin'
import { configurationVersions, promptsIa } from '../../../shared/db/schema'
import type { IaType } from '../../../shared/ia'
import { IA_TYPES } from '../../../shared/ia'
import type { ImpactPlan, ValeursPlan, ValeursPrompt } from '../../../shared/schemas/admin-versions'
import { schemaValeursPlan, VERSION_PLAN_LIMITES_CLES } from '../../../shared/schemas/admin-versions'
import { ConflictError, UnprocessableError, ValidationError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { enregistrer } from '../admin/audit'
import type { TransactionAdmin } from '../admin/audit'
import { activerPrompt, creerVersionPrompt } from '../ia/prompts'
import { ADAPTATEURS } from './adaptateurs'
import type { AdaptateurVersion } from './adaptateurs'
import { empreinteValeurs, entreeIntrouvable, horlogeDe, idDerive, rejouer, verrouillerConfiguration } from './ecriture'
import type { AuteurEcriture, AuteurEcritureReauth } from './ecriture'
import { apercuImpactPlan, impactNonNul, memeImpact } from './impact'
import { instantaneDuCode, lireInstantaneSansCache, viderCacheConfiguration } from './lecture'

export type TypeVersionConfiguration = Exclude<AdminVersionType, 'prompts'>

const PREFIXE_ID_VERSION = 'a5v'
/** `statut` journalisé d'une version programmée que le job n'a pas pu appliquer. */
const STATUT_NON_APPLICABLE = 'non_applicable'
/** Catégorie journalisée d'une version de prompt (hors `configuration_versions`). */
const CATEGORIE_PROMPT = 'prompt'
const TYPE_PAR_CATEGORIE: Record<string, TypeVersionConfiguration> = { plan: 'plans', prix: 'prix', frais: 'frais', moyens: 'moyens', essai: 'essai' }

export interface VersionConfigurationLue {
  type: TypeVersionConfiguration
  id: string
  cle: string
  numero: number
  statut: string
  effectiveA: Date | null
  valideeLe: Date | null
  motif: string
  creePar: string
  creeLe: Date
  valeurs: unknown
}

export interface VersionPromptLue {
  type: 'prompts'
  id: string
  cle: string
  numero: number
  statut: 'active' | 'inactive'
  motif: string | null
  creePar: string | null
  creeLe: Date
  valeurs: { systeme: string, gabarit: string, variables: string[], parametres: unknown, schemaSortie: string }
}

export type VersionLue = VersionConfigurationLue | VersionPromptLue

export interface ResultatVersion {
  version: VersionLue
  rejoue: boolean
}

export interface PageVersions {
  type: AdminVersionType
  elements: VersionLue[]
  total: number
  page: number
  limite: number
}

type LigneConfiguration = typeof configurationVersions.$inferSelect
type LignePrompt = typeof promptsIa.$inferSelect

function versVersionConfiguration(ligne: LigneConfiguration): VersionConfigurationLue {
  return {
    type: TYPE_PAR_CATEGORIE[ligne.categorie] ?? 'plans',
    id: ligne.id,
    cle: ligne.cle,
    numero: ligne.numero,
    statut: ligne.statut,
    effectiveA: ligne.effectiveA,
    valideeLe: ligne.valideeLe,
    motif: ligne.motif,
    creePar: ligne.creePar,
    creeLe: ligne.creeLe,
    valeurs: ligne.valeurs,
  }
}

function versVersionPrompt(ligne: LignePrompt): VersionPromptLue {
  return {
    type: 'prompts',
    id: ligne.id,
    cle: ligne.type,
    numero: ligne.version,
    statut: ligne.actif ? 'active' : 'inactive',
    motif: ligne.motif,
    creePar: ligne.creePar,
    creeLe: ligne.createdAt,
    valeurs: {
      systeme: ligne.systeme,
      gabarit: ligne.gabarit,
      variables: ligne.variables,
      parametres: ligne.parametres,
      schemaSortie: ligne.schemaSortie,
    },
  }
}

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------

/** Historique d'un type (plus récent d'abord), d'une clé ou de toutes. */
export async function listerVersions(
  type: AdminVersionType,
  filtre: { cle?: string, page: number, limite: number },
): Promise<PageVersions> {
  const { page, limite } = filtre
  const decalage = (page - 1) * limite
  if (type === 'prompts') {
    if (filtre.cle !== undefined && !(IA_TYPES as readonly string[]).includes(filtre.cle)) return { type, elements: [], total: 0, page, limite }
    const condition = filtre.cle === undefined ? undefined : eq(promptsIa.type, filtre.cle)
    const [lignes, [total]] = await Promise.all([
      db.select().from(promptsIa).where(condition).orderBy(desc(promptsIa.createdAt), desc(promptsIa.version), asc(promptsIa.type)).limit(limite).offset(decalage),
      db.select({ total: count() }).from(promptsIa).where(condition),
    ])
    return { type, elements: lignes.map(versVersionPrompt), total: total?.total ?? 0, page, limite }
  }
  const categorie = ADAPTATEURS[type].categorie
  const condition = filtre.cle === undefined
    ? eq(configurationVersions.categorie, categorie)
    : and(eq(configurationVersions.categorie, categorie), eq(configurationVersions.cle, filtre.cle))
  const [lignes, [total]] = await Promise.all([
    db.select().from(configurationVersions).where(condition)
      .orderBy(asc(configurationVersions.cle), desc(configurationVersions.numero)).limit(limite).offset(decalage),
    db.select({ total: count() }).from(configurationVersions).where(condition),
  ])
  return { type, elements: lignes.map(versVersionConfiguration), total: total?.total ?? 0, page, limite }
}

type LecteurVersions = Pick<typeof db, 'select'>

/** Une version par identifiant, du type demandé (un identifiant d'un autre type est « introuvable »). */
export async function lireVersion(type: AdminVersionType, id: string, lecteur: LecteurVersions = db): Promise<VersionLue> {
  if (type === 'prompts') {
    const [ligne] = await lecteur.select().from(promptsIa).where(eq(promptsIa.id, id)).limit(1)
    if (!ligne) throw entreeIntrouvable()
    return versVersionPrompt(ligne)
  }
  const [ligne] = await lecteur.select().from(configurationVersions).where(eq(configurationVersions.id, id)).limit(1)
  if (!ligne || ligne.categorie !== ADAPTATEURS[type].categorie) throw entreeIntrouvable()
  return versVersionConfiguration(ligne)
}

type CibleVersion =
  | { espace: 'configuration', ligne: LigneConfiguration }
  | { espace: 'prompt', ligne: LignePrompt }

async function trouverCible(tx: TransactionAdmin, id: string, verrou: boolean): Promise<CibleVersion> {
  const requeteConfig = tx.select().from(configurationVersions).where(eq(configurationVersions.id, id)).limit(1)
  const [config] = await (verrou ? requeteConfig.for('update') : requeteConfig)
  if (config) return { espace: 'configuration', ligne: config }
  const requetePrompt = tx.select().from(promptsIa).where(eq(promptsIa.id, id)).limit(1)
  const [prompt] = await (verrou ? requetePrompt.for('update') : requetePrompt)
  if (prompt) return { espace: 'prompt', ligne: prompt }
  throw entreeIntrouvable()
}

function categorieEtCle(cible: CibleVersion): { categorie: string, cle: string } {
  return cible.espace === 'configuration'
    ? { categorie: cible.ligne.categorie, cle: cible.ligne.cle }
    : { categorie: CATEGORIE_PROMPT, cle: cible.ligne.type }
}

function resoudreAdaptateur(adaptateur: AdminVersionType | { type: AdminVersionType }): AdminVersionType {
  return typeof adaptateur === 'string' ? adaptateur : adaptateur.type
}

// ---------------------------------------------------------------------------------------------
// Journal
// ---------------------------------------------------------------------------------------------

type EtatJournal = Record<string, string | number | boolean | null>

function etatConfiguration(ligne: LigneConfiguration, extra: EtatJournal = {}): EtatJournal {
  return {
    version_id: ligne.id,
    categorie: ligne.categorie,
    cle_config: ligne.cle,
    numero: ligne.numero,
    statut: ligne.statut,
    empreinte: empreinteValeurs(ligne.valeurs),
    ...extra,
  }
}

function etatPrompt(ligne: LignePrompt, extra: EtatJournal = {}): EtatJournal {
  return {
    version_id: ligne.id,
    categorie: CATEGORIE_PROMPT,
    cle_config: ligne.type,
    numero: ligne.version,
    statut: ligne.actif ? 'active' : 'inactive',
    empreinte: empreinteValeurs({ systeme: ligne.systeme, gabarit: ligne.gabarit, parametres: ligne.parametres }),
    ...extra,
  }
}

const etatCible = (cible: CibleVersion, extra: EtatJournal = {}): EtatJournal =>
  cible.espace === 'configuration' ? etatConfiguration(cible.ligne, extra) : etatPrompt(cible.ligne, extra)

// ---------------------------------------------------------------------------------------------
// Création d'un brouillon
// ---------------------------------------------------------------------------------------------

export interface EntreeBrouillon {
  cle: string
  valeurs: unknown
  motif: string
}

/**
 * Crée un brouillon (configuration) ou une version inactive (prompt). Inerte : aucune réauthentification. L'identifiant
 * dérive de la clé d'idempotence : un rejeu retrouve la même version, sans second effet (CA15).
 */
export async function creerBrouillon(
  auteur: AuteurEcriture,
  adaptateur: AdminVersionType | { type: AdminVersionType },
  entree: EntreeBrouillon,
): Promise<ResultatVersion> {
  const type = resoudreAdaptateur(adaptateur)
  const id = idDerive(PREFIXE_ID_VERSION, auteur.adminId, auteur.cleIdempotence)
  const parametres = { empreinte: empreinteValeurs(entree.valeurs) }
  const rejoue = await db.transaction(async (tx) => {
    const dejaFait = await rejouer(tx, auteur, {
      action: ADMIN_ACTIONS.versionCreer,
      cibleType: ADMIN_CIBLES.version,
      cibleId: id,
      motif: entree.motif,
      parametres,
    })
    if (dejaFait !== null) return true
    if (type === 'prompts') {
      await verrouillerConfiguration(tx, CATEGORIE_PROMPT, entree.cle)
      const creee = await creerVersionPrompt(tx, {
        id,
        type: entree.cle as IaType,
        valeurs: entree.valeurs as ValeursPrompt,
        creePar: auteur.adminId,
        motif: entree.motif,
      })
      await enregistrer(tx, {
        adminId: auteur.adminId,
        action: ADMIN_ACTIONS.versionCreer,
        cibleType: ADMIN_CIBLES.version,
        cibleId: id,
        apres: etatPrompt(creee),
        motif: entree.motif,
        ip: auteur.ip,
        cleIdempotence: auteur.cleIdempotence,
      })
      return false
    }
    const adaptateurType: AdaptateurVersion = ADAPTATEURS[type] as AdaptateurVersion
    await verrouillerConfiguration(tx, adaptateurType.categorie, entree.cle)
    await adaptateurType.validerCoherence(tx, entree.cle, entree.valeurs)
    const [dernier] = await tx
      .select({ numero: max(configurationVersions.numero) })
      .from(configurationVersions)
      .where(and(eq(configurationVersions.categorie, adaptateurType.categorie), eq(configurationVersions.cle, entree.cle)))
    const [creee] = await tx
      .insert(configurationVersions)
      .values({
        id,
        categorie: adaptateurType.categorie,
        cle: entree.cle,
        numero: (dernier?.numero ?? 0) + 1,
        valeurs: entree.valeurs,
        statut: 'brouillon',
        motif: entree.motif,
        creePar: auteur.adminId,
        creeLe: horlogeDe(auteur),
      })
      .returning()
    if (!creee) throw new Error('VERSION_NON_CREEE')
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action: ADMIN_ACTIONS.versionCreer,
      cibleType: ADMIN_CIBLES.version,
      cibleId: id,
      apres: etatConfiguration(creee),
      motif: entree.motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return false
  })
  return { version: await lireVersion(type, id), rejoue }
}

// ---------------------------------------------------------------------------------------------
// Activation, programmation
// ---------------------------------------------------------------------------------------------

export interface OptionsActivation {
  /** `null` = immédiat ; une date = programmation (refusée pour les prompts). */
  programmeePour: string | null
  impactAcquitte?: ImpactPlan | undefined
  motif: string
}

/** Au moins une limite devient plus basse (ou finie alors qu'elle était illimitée) : l'impact doit être acquitté. */
export function estUneBaisse(actuelle: ValeursPlan, candidate: ValeursPlan): boolean {
  return VERSION_PLAN_LIMITES_CLES.some((cle) => {
    const nouvelle = candidate[cle]
    const ancienne = actuelle[cle]
    return nouvelle !== null && (ancienne === null || nouvelle < ancienne)
  })
}

/** Impact actuel de la version `ligne` d'un plan si elle BAISSE une limite du plan en vigueur ; `null` sinon. */
async function impactDeLaBaisse(tx: TransactionAdmin, ligne: LigneConfiguration): Promise<ImpactPlan | null> {
  const candidate = schemaValeursPlan.parse(ligne.valeurs)
  const plans = (await lireInstantaneSansCache(tx)).plans
  const plan = ligne.cle === 'gratuit' ? 'gratuit' : 'payant'
  if (!estUneBaisse(plans[plan] ?? instantaneDuCode().plans[plan], candidate)) return null
  return apercuImpactPlan(plan, candidate, tx)
}

/**
 * Baisse de limite : l'impact acquitté doit être celui du moment (sinon 409 `IMPACT_CHANGE`). Renvoie l'empreinte de
 * l'impact vérifié (à garder dans le journal d'une programmation, pour la revalider à l'application), `null` hors baisse.
 */
async function exigerImpactAcquitte(tx: TransactionAdmin, ligne: LigneConfiguration, acquitte: ImpactPlan | undefined): Promise<string | null> {
  const actuel = await impactDeLaBaisse(tx, ligne)
  if (actuel === null) return null
  // Un impact entièrement nul n'a rien à acquitter (aucun compte, aucun élément touché) : l'absence d'acquittement passe.
  if (acquitte === undefined && !impactNonNul(actuel)) return empreinteValeurs(actuel)
  if (acquitte === undefined || !memeImpact(acquitte, actuel)) throw new ConflictError('IMPACT_CHANGE', { impact: actuel })
  return empreinteValeurs(actuel)
}

async function activerConfiguration(
  tx: TransactionAdmin,
  auteur: AuteurEcritureReauth,
  ligne: LigneConfiguration,
  options: OptionsActivation,
  maintenant: Date,
): Promise<{ ligne: LigneConfiguration, impactEmpreinte: string | null }> {
  if (ligne.statut !== 'brouillon') throw new UnprocessableError('VERSION_NON_ACTIVABLE')
  const type = TYPE_PAR_CATEGORIE[ligne.categorie]
  if (type === undefined) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
  const adaptateur: AdaptateurVersion = ADAPTATEURS[type] as AdaptateurVersion
  // La cohérence se rejoue à l'activation : l'autre plan, ou les moyens, ont pu changer depuis le brouillon.
  await adaptateur.validerCoherence(tx, ligne.cle, ligne.valeurs)
  const impactEmpreinte = type === 'plans' ? await exigerImpactAcquitte(tx, ligne, options.impactAcquitte) : null
  const valideeLe = type === 'prix' ? maintenant : null

  if (options.programmeePour !== null) {
    const echeance = new Date(options.programmeePour)
    if (echeance.getTime() <= maintenant.getTime()) throw new ValidationError({ programmeePour: ['La date doit être dans le futur.'] })
    const [dejaProgrammee] = await tx
      .select({ id: configurationVersions.id })
      .from(configurationVersions)
      .where(and(eq(configurationVersions.categorie, ligne.categorie), eq(configurationVersions.cle, ligne.cle), eq(configurationVersions.statut, 'programmee')))
      .limit(1)
    if (dejaProgrammee !== undefined) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
    const [programmee] = await tx
      .update(configurationVersions)
      .set({ statut: 'programmee', effectiveA: echeance, ...(valideeLe === null ? {} : { valideeLe }) })
      .where(eq(configurationVersions.id, ligne.id))
      .returning()
    if (!programmee) throw new Error('VERSION_NON_PROGRAMMEE')
    return { ligne: programmee, impactEmpreinte }
  }

  await tx
    .update(configurationVersions)
    .set({ statut: 'remplacee' })
    .where(and(eq(configurationVersions.categorie, ligne.categorie), eq(configurationVersions.cle, ligne.cle), eq(configurationVersions.statut, 'active')))
  const [activee] = await tx
    .update(configurationVersions)
    .set({ statut: 'active', effectiveA: maintenant, ...(valideeLe === null ? {} : { valideeLe }) })
    .where(eq(configurationVersions.id, ligne.id))
    .returning()
  if (!activee) throw new Error('VERSION_NON_ACTIVEE')
  return { ligne: activee, impactEmpreinte }
}

/**
 * Active (immédiat) ou programme une version (D-A5-03, D-A5-06, D-A5-07). À appeler dans une transaction (`tx`) :
 * rejeu, verrou, réauthentification, puis écriture et journal. Prompt : activation immédiate seulement.
 */
export async function programmerOuActiver(
  tx: TransactionAdmin,
  auteur: AuteurEcritureReauth,
  id: string,
  options: OptionsActivation,
): Promise<{ type: AdminVersionType, rejoue: boolean }> {
  const programmee = options.programmeePour !== null
  const parametres = { programmee_pour: options.programmeePour }
  const apercu = await trouverCible(tx, id, false)
  const type: AdminVersionType = apercu.espace === 'prompt' ? 'prompts' : (TYPE_PAR_CATEGORIE[apercu.ligne.categorie] ?? 'plans')
  const action = programmee ? ADMIN_ACTIONS.versionProgrammer : ADMIN_ACTIONS.versionActiver
  const dejaFait = await rejouer(tx, auteur, { action, cibleType: ADMIN_CIBLES.version, cibleId: id, motif: options.motif, parametres })
  if (dejaFait !== null) return { type, rejoue: true }
  const { categorie, cle } = categorieEtCle(apercu)
  await verrouillerConfiguration(tx, categorie, cle)
  const cible = await trouverCible(tx, id, true)
  await auteur.reauth(tx)
  const maintenant = horlogeDe(auteur)

  if (cible.espace === 'prompt') {
    // Un prompt n'a pas de date d'effet : programmer est refusé (D-A5-09).
    if (programmee) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
    const { precedente, activee } = await activerPrompt(tx, id)
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action,
      cibleType: ADMIN_CIBLES.version,
      cibleId: id,
      avant: etatCible(cible),
      apres: etatPrompt(activee, { ...parametres, remplace_id: precedente?.id ?? null }),
      motif: options.motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return { type, rejoue: false }
  }

  const [actuelle] = await tx
    .select({ id: configurationVersions.id })
    .from(configurationVersions)
    .where(and(eq(configurationVersions.categorie, cible.ligne.categorie), eq(configurationVersions.cle, cible.ligne.cle), eq(configurationVersions.statut, 'active')))
    .limit(1)
  const { ligne: resultat, impactEmpreinte } = await activerConfiguration(tx, auteur, cible.ligne, options, maintenant)
  await enregistrer(tx, {
    adminId: auteur.adminId,
    action,
    cibleType: ADMIN_CIBLES.version,
    cibleId: id,
    avant: etatCible(cible),
    // Programmation d'une baisse : l'empreinte de l'impact acquitté est gardée, le job la revalide à l'application.
    apres: etatConfiguration(resultat, {
      ...parametres,
      remplace_id: programmee ? null : (actuelle?.id ?? null),
      ...(programmee && impactEmpreinte !== null ? { impact_empreinte: impactEmpreinte } : {}),
    }),
    motif: options.motif,
    ip: auteur.ip,
    cleIdempotence: auteur.cleIdempotence,
  })
  return { type, rejoue: false }
}

// ---------------------------------------------------------------------------------------------
// Retour arrière, validation d'un prix
// ---------------------------------------------------------------------------------------------

async function retourConfiguration(
  tx: TransactionAdmin,
  ligne: LigneConfiguration,
  impactAcquitte: ImpactPlan | undefined,
): Promise<{ cible: LigneConfiguration, remplacee: LigneConfiguration | null }> {
  const parCle = and(eq(configurationVersions.categorie, ligne.categorie), eq(configurationVersions.cle, ligne.cle))
  let cible: LigneConfiguration | undefined
  let remplacee: LigneConfiguration | null = null
  if (ligne.statut === 'active') {
    // Annuler la version active : la précédente (numéro le plus haut parmi les remplacées plus anciennes).
    const [precedente] = await tx
      .select()
      .from(configurationVersions)
      .where(and(parCle, eq(configurationVersions.statut, 'remplacee'), sql`${configurationVersions.numero} < ${ligne.numero}`))
      .orderBy(desc(configurationVersions.numero))
      .limit(1)
    cible = precedente
    remplacee = ligne
  } else if (ligne.statut === 'remplacee') {
    cible = ligne
    const [active] = await tx.select().from(configurationVersions).where(and(parCle, eq(configurationVersions.statut, 'active'))).limit(1)
    remplacee = active ?? null
  }
  if (!cible) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
  // Rétablir une version qui baisse des limites a le même effet qu'une activation : l'aperçu d'impact acquitté est exigé.
  if (TYPE_PAR_CATEGORIE[cible.categorie] === 'plans') await exigerImpactAcquitte(tx, cible, impactAcquitte)
  if (remplacee !== null) {
    await tx.update(configurationVersions).set({ statut: 'remplacee' }).where(eq(configurationVersions.id, remplacee.id))
  }
  const [restauree] = await tx.update(configurationVersions).set({ statut: 'active' }).where(eq(configurationVersions.id, cible.id)).returning()
  if (!restauree) throw new Error('VERSION_NON_RESTAUREE')
  return { cible: restauree, remplacee }
}

async function retourPrompt(tx: TransactionAdmin, ligne: LignePrompt): Promise<{ cible: LignePrompt, remplacee: LignePrompt | null }> {
  let identifiantCible = ligne.id
  if (ligne.actif) {
    const [precedente] = await tx
      .select({ id: promptsIa.id })
      .from(promptsIa)
      .where(and(eq(promptsIa.type, ligne.type), sql`${promptsIa.version} < ${ligne.version}`))
      .orderBy(desc(promptsIa.version))
      .limit(1)
    if (!precedente) throw new UnprocessableError('VERSION_NON_ACTIVABLE')
    identifiantCible = precedente.id
  }
  const { precedente, activee } = await activerPrompt(tx, identifiantCible)
  return { cible: activee, remplacee: precedente }
}

export interface OptionsRetour {
  motif: string
  /** Aperçu d'impact acquitté : exigé quand le retour baisse une limite de plan (comme une activation). */
  impactAcquitte?: ImpactPlan | undefined
}

/**
 * Retour arrière (CA11). `id` = la version ACTIVE (la précédente est rétablie) ou une version `remplacee` à rétablir.
 * La version retirée devient `remplacee`. Les contenus ne sont jamais modifiés ni supprimés (CA03 : les éléments masqués
 * par une baisse réapparaissent).
 */
export async function retourArriere(
  tx: TransactionAdmin,
  auteur: AuteurEcritureReauth,
  id: string,
  options: OptionsRetour,
): Promise<{ type: AdminVersionType, rejoue: boolean }> {
  const apercu = await trouverCible(tx, id, false)
  const type: AdminVersionType = apercu.espace === 'prompt' ? 'prompts' : (TYPE_PAR_CATEGORIE[apercu.ligne.categorie] ?? 'plans')
  const dejaFait = await rejouer(tx, auteur, { action: ADMIN_ACTIONS.versionRetour, cibleType: ADMIN_CIBLES.version, cibleId: id, motif: options.motif, parametres: {} })
  if (dejaFait !== null) return { type, rejoue: true }
  const { categorie, cle } = categorieEtCle(apercu)
  await verrouillerConfiguration(tx, categorie, cle)
  const cible = await trouverCible(tx, id, true)
  await auteur.reauth(tx)
  if (cible.espace === 'prompt') {
    const { cible: restauree, remplacee } = await retourPrompt(tx, cible.ligne)
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action: ADMIN_ACTIONS.versionRetour,
      cibleType: ADMIN_CIBLES.version,
      cibleId: id,
      avant: etatCible(cible),
      apres: etatPrompt(restauree, { remplace_id: remplacee?.id ?? null }),
      motif: options.motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return { type, rejoue: false }
  }
  const { cible: restauree, remplacee } = await retourConfiguration(tx, cible.ligne, options.impactAcquitte)
  await enregistrer(tx, {
    adminId: auteur.adminId,
    action: ADMIN_ACTIONS.versionRetour,
    cibleType: ADMIN_CIBLES.version,
    cibleId: id,
    avant: etatCible(cible),
    apres: etatConfiguration(restauree, { remplace_id: remplacee?.id ?? null }),
    motif: options.motif,
    ip: auteur.ip,
    cleIdempotence: auteur.cleIdempotence,
  })
  return { type, rejoue: false }
}

/** Valide la grille de prix ACTIVE sans changer de grille (D-A5-07) : `validee_le` posé une fois. */
export async function validerPrix(
  tx: TransactionAdmin,
  auteur: AuteurEcritureReauth,
  id: string,
  options: { motif: string },
): Promise<{ type: AdminVersionType, rejoue: boolean }> {
  const dejaFait = await rejouer(tx, auteur, { action: ADMIN_ACTIONS.versionValiderPrix, cibleType: ADMIN_CIBLES.version, cibleId: id, motif: options.motif, parametres: {} })
  if (dejaFait !== null) return { type: 'prix', rejoue: true }
  const apercu = await trouverCible(tx, id, false)
  if (apercu.espace !== 'configuration' || apercu.ligne.categorie !== 'prix') throw entreeIntrouvable()
  await verrouillerConfiguration(tx, apercu.ligne.categorie, apercu.ligne.cle)
  const cible = await trouverCible(tx, id, true)
  if (cible.espace !== 'configuration') throw entreeIntrouvable()
  await auteur.reauth(tx)
  if (cible.ligne.statut !== 'active') throw new UnprocessableError('VERSION_NON_ACTIVABLE')
  if (cible.ligne.valideeLe !== null) throw new ConflictError('ETAT_DEJA_APPLIQUE')
  const [validee] = await tx
    .update(configurationVersions)
    .set({ valideeLe: horlogeDe(auteur) })
    .where(eq(configurationVersions.id, id))
    .returning()
  if (!validee) throw new Error('PRIX_NON_VALIDE')
  await enregistrer(tx, {
    adminId: auteur.adminId,
    action: ADMIN_ACTIONS.versionValiderPrix,
    cibleType: ADMIN_CIBLES.version,
    cibleId: id,
    avant: etatConfiguration(cible.ligne, { validee: false }),
    apres: etatConfiguration(validee, { validee: true }),
    motif: options.motif,
    ip: auteur.ip,
    cleIdempotence: auteur.cleIdempotence,
  })
  return { type: 'prix', rejoue: false }
}

// ---------------------------------------------------------------------------------------------
// Enveloppes transactionnelles (les routes appellent celles-ci)
// ---------------------------------------------------------------------------------------------

async function enTransaction(
  corps: (tx: TransactionAdmin) => Promise<{ type: AdminVersionType, rejoue: boolean }>,
  id: string,
): Promise<ResultatVersion> {
  const { type, rejoue } = await db.transaction(corps)
  // Après le commit : la prochaine lecture de ce processus relit la base (les autres processus : 5 s au plus).
  viderCacheConfiguration()
  return { version: await lireVersion(type, id), rejoue }
}

export function activerVersion(auteur: AuteurEcritureReauth, id: string, options: OptionsActivation): Promise<ResultatVersion> {
  return enTransaction((tx) => programmerOuActiver(tx, auteur, id, options), id)
}

export function retourVersion(auteur: AuteurEcritureReauth, id: string, options: OptionsRetour): Promise<ResultatVersion> {
  return enTransaction((tx) => retourArriere(tx, auteur, id, options), id)
}

export function validerPrixVersion(auteur: AuteurEcritureReauth, id: string, options: { motif: string }): Promise<ResultatVersion> {
  return enTransaction((tx) => validerPrix(tx, auteur, id, options), id)
}

/** Aperçu d'impact exposé à la route (lecture seule). */
export async function apercuImpact(plan: 'gratuit' | 'payant', valeurs: ValeursPlan): Promise<ImpactPlan> {
  return apercuImpactPlan(plan, valeurs, db)
}

// ---------------------------------------------------------------------------------------------
// Job `versions-appliquer` (D-A5-03)
// ---------------------------------------------------------------------------------------------

const MOTIF_NON_APPLICABLE = 'Version programmée non appliquée : elle n\'est plus valable depuis sa programmation.'
const IP_JOB = 'job'

type RaisonNonApplicable = 'COHERENCE' | 'IMPACT_CHANGE'

/**
 * Revalide une version programmée au moment de l'appliquer (D-A5-03) : cohérence rejouée, et pour une baisse de limite
 * d'un plan, impact recalculé et comparé à celui qui avait été acquitté à la programmation (empreinte gardée dans le
 * journal). `null` = applicable, sinon la raison. Aucune écriture. Seules les erreurs métier valent refus : une panne
 * de base remonte (le job réessaiera).
 */
async function raisonNonApplicable(tx: TransactionAdmin, ligne: LigneConfiguration): Promise<{ raison: RaisonNonApplicable | null, adminId: string }> {
  const [programmation] = (await tx.execute<{ admin_id: string, empreinte: string | null }>(sql`
    SELECT admin_id, apres->>'impact_empreinte' AS empreinte FROM journal_admin
    WHERE action = ${ADMIN_ACTIONS.versionProgrammer} AND cible_type = ${ADMIN_CIBLES.version} AND cible_id = ${ligne.id}
      AND coalesce(apres->>'statut', '') <> ${STATUT_NON_APPLICABLE}
    ORDER BY numero DESC LIMIT 1`)).rows
  const adminId = programmation?.admin_id ?? ligne.creePar
  const type = TYPE_PAR_CATEGORIE[ligne.categorie]
  if (type === undefined) return { raison: 'COHERENCE', adminId }
  try {
    await (ADAPTATEURS[type] as AdaptateurVersion).validerCoherence(tx, ligne.cle, ligne.valeurs)
  } catch (erreur) {
    if (erreur instanceof ValidationError || erreur instanceof UnprocessableError || erreur instanceof ConflictError) return { raison: 'COHERENCE', adminId }
    throw erreur
  }
  if (type !== 'plans') return { raison: null, adminId }
  const actuel = await impactDeLaBaisse(tx, ligne)
  if (actuel === null) return { raison: null, adminId }
  const acquitte = programmation?.empreinte ?? null
  // Sans empreinte gardée (programmation antérieure à ce contrôle) : seule une baisse sans effet reste applicable.
  const change = acquitte === null ? impactNonNul(actuel) : acquitte !== empreinteValeurs(actuel)
  return { raison: change ? 'IMPACT_CHANGE' : null, adminId }
}

/**
 * Fait passer à `active` les versions programmées dont la date est échue. Idempotent : une version déjà appliquée
 * n'est plus `programmee`. Le programme a été journalisé (réauthentifié) au moment de la programmation. Chaque version
 * est REVALIDÉE avant d'être appliquée (cohérence, impact acquitté) : si elle ne l'est plus, elle n'est pas appliquée,
 * elle devient `remplacee` (jamais active : la contrainte de statuts n'a pas d'autre état terminal) et une ligne
 * `version.programmer` à `statut = non_applicable` (raison `COHERENCE` ou `IMPACT_CHANGE`) en garde la trace. Renvoie
 * le nombre de versions appliquées.
 */
export async function appliquerVersionsProgrammees(maintenant: Date = new Date()): Promise<number> {
  const dues = await db
    .select({ id: configurationVersions.id, categorie: configurationVersions.categorie, cle: configurationVersions.cle })
    .from(configurationVersions)
    .where(and(eq(configurationVersions.statut, 'programmee'), lte(configurationVersions.effectiveA, maintenant)))
    .orderBy(asc(configurationVersions.effectiveA))
  let appliquees = 0
  for (const due of dues) {
    const issue = await db.transaction(async (tx): Promise<'appliquee' | 'ignoree' | 'non_applicable'> => {
      await verrouillerConfiguration(tx, due.categorie, due.cle)
      const [encoreProgrammee] = await tx
        .select()
        .from(configurationVersions)
        .where(and(eq(configurationVersions.id, due.id), eq(configurationVersions.statut, 'programmee')))
        .for('update')
        .limit(1)
      if (!encoreProgrammee) return 'ignoree'
      const { raison, adminId } = await raisonNonApplicable(tx, encoreProgrammee)
      if (raison !== null) {
        await tx.update(configurationVersions).set({ statut: 'remplacee' }).where(eq(configurationVersions.id, due.id))
        await enregistrer(tx, {
          adminId,
          action: ADMIN_ACTIONS.versionProgrammer,
          cibleType: ADMIN_CIBLES.version,
          cibleId: due.id,
          avant: etatConfiguration(encoreProgrammee),
          apres: etatConfiguration({ ...encoreProgrammee, statut: STATUT_NON_APPLICABLE }, { raison }),
          motif: MOTIF_NON_APPLICABLE,
          ip: IP_JOB,
        })
        return 'non_applicable'
      }
      await tx
        .update(configurationVersions)
        .set({ statut: 'remplacee' })
        .where(and(eq(configurationVersions.categorie, due.categorie), eq(configurationVersions.cle, due.cle), eq(configurationVersions.statut, 'active')))
      await tx.update(configurationVersions).set({ statut: 'active' }).where(eq(configurationVersions.id, due.id))
      return 'appliquee'
    })
    if (issue === 'appliquee') appliquees += 1
  }
  if (appliquees > 0) viderCacheConfiguration()
  return appliquees
}
