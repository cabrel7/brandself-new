// A2 : briques de LECTURE partagées par les listes, la recherche et les fiches (utilisateurs, vitrines).
// Lecture seule, aucune donnée de visiteur : un compte ou une vitrine est décrit par ses colonnes propres, ses
// compteurs et son état d'abonnement CALCULÉ (jamais stocké). Les conditions de recherche suivent D-A2-11.
import { and, eq, or, sql } from 'drizzle-orm'
import type { SQL } from 'drizzle-orm'
import { ADMIN_RECHERCHE_MAX, ADMIN_RECHERCHE_MIN } from '../../../shared/admin-a2'
import { abonnements, sessions, users, vitrines } from '../../../shared/db/schema'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import type { EtatAbonnement, PlanId } from '../../../shared/plans'
import { PLAN_PAYANT_ID } from '../../config/plans'
import { db } from '../../utils/db'
import { resoudrePlanEffectif } from '../plans'

/** Page de résultats d'une liste d'administration. */
export interface PageAdmin<T> {
  elements: T[]
  total: number
  page: number
  limite: number
}

export interface UtilisateurLigneVue {
  id: string
  nom: string
  email: string
  username: string | null
  plan: PlanId
  etat: EtatAbonnement
  suspendu: boolean
  inscritLe: Date
  derniereConnexion: Date | null
  vitrine: { publiee: boolean, bloquee: boolean } | null
}

export interface VitrineLigneVue {
  id: string
  utilisateurId: string
  username: string
  nom: string
  metier: string | null
  plan: PlanId
  publiee: boolean
  bloquee: boolean
  blocageMotif: string | null
  proprietaireSuspendu: boolean
  creeLe: Date
}

// ---------------------------------------------------------------------------------------------
// État d'abonnement en SQL (filtres et tris). Même règle que `resoudrePlanEffectif` : actif avant l'échéance, grâce
// pendant `graceJours` jours (réglage `abonnement.grace_jours`, lu par l'appelant via `lireGraceJours`), sinon gratuit. Le calcul affiché, lui, passe toujours par
// `resoudrePlanEffectif` (source unique) ; le SQL ne sert qu'à filtrer et trier.
// ---------------------------------------------------------------------------------------------

export function sqlEtatAbonnement(now: Date, graceJours: number): SQL<EtatAbonnement> {
  return sql<EtatAbonnement>`(CASE
    WHEN ${abonnements.id} IS NULL OR ${abonnements.plan} <> ${PLAN_PAYANT_ID} THEN 'gratuit'
    WHEN ${abonnements.expireLe} > ${now.toISOString()}::timestamptz THEN 'actif'
    WHEN ${abonnements.expireLe} + make_interval(days => ${graceJours}::int) > ${now.toISOString()}::timestamptz THEN 'grace'
    ELSE 'gratuit' END)`
}

/** `payant` = droits du plan payant (actif OU grâce), comme `PlanEffectif.plan`. */
export function sqlPlanAbonnement(now: Date, graceJours: number): SQL<PlanId> {
  return sql<PlanId>`(CASE WHEN ${sqlEtatAbonnement(now, graceJours)} = 'gratuit' THEN 'gratuit' ELSE ${PLAN_PAYANT_ID} END)`
}

/** Plan et état d'un compte (source unique : `resoudrePlanEffectif`). */
export function planDuCompte(
  abonnement: { plan: string | null, expireLe: Date | null },
  fuseau: string,
  now: Date,
  graceJours: number,
): { plan: PlanId, etat: EtatAbonnement } {
  const lu = abonnement.plan !== null && abonnement.expireLe !== null
    ? { plan: abonnement.plan, expireLe: abonnement.expireLe }
    : null
  const effectif = resoudrePlanEffectif(lu, now, fuseau, graceJours)
  return { plan: effectif.plan, etat: effectif.etat }
}

/** Dernière connexion = création de la session la plus récente encore en base (les sessions expirées sont purgées). */
export function sqlDerniereConnexion(): SQL<Date | null> {
  return sql<Date | null>`(SELECT max(${sessions.createdAt}) FROM ${sessions} WHERE ${sessions.userId} = ${users.id})`
    .mapWith((valeur: string | Date | null) => (valeur === null ? null : new Date(valeur)))
}

// ---------------------------------------------------------------------------------------------
// Recherche (D-A2-11)
// ---------------------------------------------------------------------------------------------

export interface RechercheNormalisee {
  /** Texte saisi, espaces de bord retirés (3 à 100 caractères, déjà validé par la route). */
  texte: string
  /** Adresse complète en minuscules : égalité seulement, jamais de recherche partielle sur une adresse. */
  email: string | null
  /** `+` et chiffres (format E.164 des comptes) : égalité seulement. `null` si la saisie n'est pas un numéro. */
  telephone: string | null
  /** Préfixe d'adresse de vitrine (minuscules). */
  prefixeUsername: string
  /** Motif `ILIKE` « contient » avec `%`, `_` et `\` échappés. */
  motifNom: string
}

const NUMERO_SAISI = /^\+?[\d\s().-]+$/
const SEPARATEURS_NUMERO = /[\s().-]/g
const NON_CHIFFRES = /\D/g
const CHIFFRES_NUMERO_MIN = 7
const CARACTERES_SPECIAUX_LIKE = /[\\%_]/g

/** Normalise une saisie de recherche : aucune requête n'est construite à partir du texte brut. */
export function normaliserRecherche(saisie: string): RechercheNormalisee {
  const texte = saisie.trim().slice(0, ADMIN_RECHERCHE_MAX)
  const minuscules = texte.toLowerCase()
  const chiffres = texte.replace(SEPARATEURS_NUMERO, '').replace(NON_CHIFFRES, '')
  const estNumero = NUMERO_SAISI.test(texte) && chiffres.length >= CHIFFRES_NUMERO_MIN
  return {
    texte,
    email: texte.includes('@') ? minuscules : null,
    telephone: estNumero ? `+${chiffres}` : null,
    prefixeUsername: minuscules.replace(CARACTERES_SPECIAUX_LIKE, '\\$&'),
    motifNom: `%${texte.replace(CARACTERES_SPECIAUX_LIKE, '\\$&')}%`,
  }
}

/** La saisie a la longueur minimale de recherche (garde de défense : la route valide déjà). */
export function rechercheValide(saisie: string): boolean {
  const longueur = saisie.trim().length
  return longueur >= ADMIN_RECHERCHE_MIN && longueur <= ADMIN_RECHERCHE_MAX
}

/**
 * Condition de recherche d'un COMPTE (requête `users LEFT JOIN vitrines`) : adresse e-mail (égalité), téléphone
 * (égalité), adresse de vitrine (préfixe), nom du compte ou de la vitrine (contient). Rien dans le contenu visiteur.
 */
export function sqlRechercheUtilisateur(saisie: RechercheNormalisee): SQL {
  const conditions: SQL[] = []
  if (saisie.email !== null) conditions.push(sql`lower(${users.email}) = ${saisie.email}`)
  if (saisie.telephone !== null) conditions.push(eq(users.phoneNumber, saisie.telephone))
  if (saisie.email === null) {
    conditions.push(sql`${vitrines.username} LIKE ${`${saisie.prefixeUsername}%`}`)
    conditions.push(sql`${users.nom} ILIKE ${saisie.motifNom}`)
    conditions.push(sql`${users.name} ILIKE ${saisie.motifNom}`)
    conditions.push(sql`(${vitrines.prenom} || ' ' || ${vitrines.nom}) ILIKE ${saisie.motifNom}`)
  }
  return or(...conditions) ?? sql`false`
}

/** Condition de recherche d'une VITRINE (requête `vitrines JOIN users`) : mêmes règles, l'adresse e-mail vise le titulaire. */
export function sqlRechercheVitrine(saisie: RechercheNormalisee): SQL {
  const conditions: SQL[] = []
  if (saisie.email !== null) conditions.push(sql`lower(${users.email}) = ${saisie.email}`)
  if (saisie.telephone !== null) conditions.push(eq(users.phoneNumber, saisie.telephone))
  if (saisie.email === null) {
    conditions.push(sql`${vitrines.username} LIKE ${`${saisie.prefixeUsername}%`}`)
    conditions.push(sql`(${vitrines.prenom} || ' ' || ${vitrines.nom}) ILIKE ${saisie.motifNom}`)
  }
  return or(...conditions) ?? sql`false`
}

// ---------------------------------------------------------------------------------------------
// Lignes
// ---------------------------------------------------------------------------------------------

export function nomAffiche(nomCompte: string, nomUsuel: string): string {
  return nomCompte.trim() || nomUsuel.trim()
}

/** Colonnes d'une ligne de la liste des comptes (requête `users LEFT JOIN vitrines LEFT JOIN abonnements`). */
export function colonnesUtilisateur() {
  return {
    id: users.id,
    nom: users.nom,
    nomUsuel: users.name,
    email: users.email,
    fuseau: users.fuseau,
    suspendu: users.banned,
    inscritLe: users.createdAt,
    derniereConnexion: sqlDerniereConnexion(),
    username: vitrines.username,
    vitrineId: vitrines.id,
    publieeLe: vitrines.publieeLe,
    blocageAdmin: vitrines.blocageAdmin,
    abonnementPlan: abonnements.plan,
    abonnementExpireLe: abonnements.expireLe,
  }
}

interface BruteUtilisateur {
  id: string
  nom: string
  nomUsuel: string
  email: string
  fuseau: string
  suspendu: boolean
  inscritLe: Date
  derniereConnexion: Date | null
  username: string | null
  vitrineId: string | null
  publieeLe: Date | null
  blocageAdmin: boolean | null
  abonnementPlan: string | null
  abonnementExpireLe: Date | null
}

export function versLigneUtilisateur(brute: BruteUtilisateur, now: Date, graceJours: number): UtilisateurLigneVue {
  const { plan, etat } = planDuCompte({ plan: brute.abonnementPlan, expireLe: brute.abonnementExpireLe }, brute.fuseau, now, graceJours)
  return {
    id: brute.id,
    nom: nomAffiche(brute.nom, brute.nomUsuel),
    email: brute.email,
    username: brute.username,
    plan,
    etat,
    suspendu: brute.suspendu,
    inscritLe: brute.inscritLe,
    derniereConnexion: brute.derniereConnexion,
    vitrine: brute.vitrineId === null
      ? null
      : { publiee: brute.publieeLe !== null, bloquee: brute.blocageAdmin === true },
  }
}

/** Colonnes d'une ligne de la liste des vitrines (requête `vitrines JOIN users LEFT JOIN abonnements`). */
export function colonnesVitrine() {
  return {
    id: vitrines.id,
    utilisateurId: vitrines.userId,
    username: vitrines.username,
    prenom: vitrines.prenom,
    nom: vitrines.nom,
    metier: vitrines.metier,
    publieeLe: vitrines.publieeLe,
    blocageAdmin: vitrines.blocageAdmin,
    blocageMotif: vitrines.blocageMotif,
    creeLe: vitrines.createdAt,
    proprietaireSuspendu: users.banned,
    fuseau: users.fuseau,
    abonnementPlan: abonnements.plan,
    abonnementExpireLe: abonnements.expireLe,
  }
}

interface BruteVitrine {
  id: string
  utilisateurId: string
  username: string
  prenom: string
  nom: string
  metier: string
  publieeLe: Date | null
  blocageAdmin: boolean
  blocageMotif: string | null
  creeLe: Date
  proprietaireSuspendu: boolean
  fuseau: string
  abonnementPlan: string | null
  abonnementExpireLe: Date | null
}

export function versLigneVitrine(brute: BruteVitrine, now: Date, graceJours: number): VitrineLigneVue {
  const { plan } = planDuCompte({ plan: brute.abonnementPlan, expireLe: brute.abonnementExpireLe }, brute.fuseau, now, graceJours)
  return {
    id: brute.id,
    utilisateurId: brute.utilisateurId,
    username: brute.username,
    nom: `${brute.prenom} ${brute.nom}`.trim(),
    metier: brute.metier.trim() === '' ? null : brute.metier,
    plan,
    publiee: brute.publieeLe !== null,
    bloquee: brute.blocageAdmin,
    blocageMotif: brute.blocageMotif,
    proprietaireSuspendu: brute.proprietaireSuspendu,
    creeLe: brute.creeLe,
  }
}

/** Requête de base des comptes (jointures gauche : un compte sans vitrine ni abonnement reste listé). */
export function baseUtilisateurs() {
  return db
    .select(colonnesUtilisateur())
    .from(users)
    .leftJoin(vitrines, eq(vitrines.userId, users.id))
    .leftJoin(abonnements, eq(abonnements.userId, users.id))
}

/** Requête de base des vitrines (titulaire obligatoire, abonnement facultatif). */
export function baseVitrines() {
  return db
    .select(colonnesVitrine())
    .from(vitrines)
    .innerJoin(users, eq(users.id, vitrines.userId))
    .leftJoin(abonnements, eq(abonnements.userId, users.id))
}

/** Conditions combinées en ET ; aucune condition = aucune restriction. */
export function toutesLesConditions(conditions: readonly (SQL | undefined)[]): SQL | undefined {
  const presentes = conditions.filter((condition): condition is SQL => condition !== undefined)
  return presentes.length === 0 ? undefined : and(...presentes)
}

/** Fuseau des bornes de dates saisies dans les filtres (jour civil de la plateforme). */
export const FUSEAU_FILTRES = ABONNEMENT_FUSEAU_REPLI
