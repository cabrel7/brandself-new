import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { generationsIa, medias, progressionsInscription, services, users, vitrines } from '../../shared/db/schema'
import type { ProgressionInscription } from '../../shared/db/schema'
import { GENERATION_EXPIRATION_MS, GENERATION_STATUTS_TERMINAUX } from '../../shared/ia'
import { ONBOARDING_ABANDON_RETENTION_JOURS } from '../../shared/onboarding'
import type { OnboardingEtape, OnboardingManquant } from '../../shared/onboarding'
import { ONBOARDING_TERMINER_CLE_PREFIXE, ONBOARDING_TERMINER_LIMIT } from '../../shared/limites'
import { schemaPropositionRepli } from '../../shared/schemas/ia'
import type {
  OnboardingEtapeInput,
  OnboardingIdentiteInput,
  OnboardingPhotoInput,
  OnboardingPropositionInput,
  OnboardingTerminerInput,
} from '../../shared/schemas/onboarding'
import { VEDETTE_MAX } from '../../shared/listes'
import { BIO_MAX, METIER_MAX, NOM_MAX, PRENOM_MAX, VILLE_MAX } from '../../shared/vitrine'
import { ConflictError, UnprocessableError, ValidationError } from '../exceptions/http'
import { db } from '../utils/db'
import { PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION, readPgError } from '../utils/pg-error'
import { enforceLimit } from './limiteur'
import { createGeneration } from './ia/generations'
import type { CreationResultat } from './ia/generations'
import { detecterInjection, entreeOnboarding, nettoyerTexte } from './ia/nettoyage'
import type { EntreeOnboarding } from './ia/entrees'
import type { MediaRow } from './medias'
import {
  computeEtapeReprise,
  computeManquants,
  computeUsernameSuggere,
  identiteComplete,
  identiteIaModifiee,
  schemaServicesBrouillon,
} from './onboarding-regles'
import type { IdentiteProgression, ServiceBrouillon } from './onboarding-regles'
import { checkServiceCoherence, normalizeServiceState, pickAvailableSlug, slugFromTitle } from './services-regles'
import type { ServiceState } from './services-regles'
import { cleanupMedias, requireOwnedMedias } from './vitrine-acces'
import type { Transaction } from './vitrine-acces'

// S8 §6 : service de l'inscription guidée. La progression vit dans `progressions_inscription` (une ligne par
// utilisateur) ; la vitrine n'existe qu'à `terminer`, en une seule transaction. L'étape de reprise est
// déduite des données (onboarding-regles.ts), jamais stockée.

export interface PropositionBrouillon {
  accroche: string
  presentation: string
  services: ServiceBrouillon[]
}

export interface OnboardingTermine {
  statut: 'termine'
  username: string
}

export interface OnboardingEnCours {
  statut: 'en_cours'
  etapeReprise: OnboardingEtape
  identite: IdentiteProgression
  photo: MediaRow | null
  /** Null si absente, expirée ou purgée : l'étape 3 relance alors une génération. */
  generationId: string | null
  proposition: PropositionBrouillon | null
  usernameSuggere: string
}

export type OnboardingView = OnboardingTermine | OnboardingEnCours

export interface TerminerResultat {
  /** Vrai à la création de la vitrine, faux au rejeu (double clic, deuxième appareil). */
  creee: boolean
}

const USERNAME_UNIQUE = 'vitrines_username_unique'
const USER_ID_UNIQUE = 'vitrines_user_id_unique'
const VITRINE_PHOTO_FK = 'vitrines_photo_media_id_medias_id_fk'
const PROGRESSION_PHOTO_FK = 'progressions_inscription_photo_media_id_medias_id_fk'
const LOG_CONTEXTE = 'onboarding'
const TYPE_ONBOARDING = 'onboarding_vitrine'
const MSG_PRESENTATION_REQUISE = 'Écrivez quelques mots de présentation.'

const IDENTITE_VIDE: IdentiteProgression = { titre: null, prenom: null, nom: null, metier: null, ville: null, pays: null }

/** Remise à zéro de la proposition quand l'identité envoyée à l'IA change. */
const REMISE_PROPOSITION = {
  generationId: null,
  accroche: null,
  presentation: null,
  servicesProposes: null,
  propositionValideeLe: null,
} as const

/** Service proposé : « Sur devis », jamais de prix inventé (décision #76). Le type et la durée viennent de la proposition. */
const ETAT_SERVICE_PROPOSE: ServiceState = {
  type: 'rdv',
  nbSeances: null,
  rythme: null,
  dureeMin: null,
  tarif: 'devis',
  prixMontant: null,
  prixDevise: null,
  paiementMode: null,
  paiementInstructions: null,
  actif: true,
  enVedette: true,
}

function nonVide(valeur: string | null): valeur is string {
  return valeur !== null && valeur.trim() !== ''
}

function incomplet(manquants: readonly OnboardingManquant[]): UnprocessableError {
  return new UnprocessableError('ONBOARDING_INCOMPLET', { manquants: [...manquants] })
}

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------

function identiteDe(ligne: ProgressionInscription | undefined): IdentiteProgression {
  if (!ligne) return IDENTITE_VIDE
  const { titre, prenom, nom, metier, ville, pays } = ligne
  return { titre, prenom, nom, metier, ville, pays }
}

function propositionDe(ligne: ProgressionInscription | undefined): PropositionBrouillon | null {
  if (!ligne?.propositionValideeLe || ligne.accroche === null || ligne.presentation === null) return null
  const brouillon = schemaServicesBrouillon.safeParse(ligne.servicesProposes)
  return brouillon.success
    ? { accroche: ligne.accroche, presentation: ligne.presentation, services: brouillon.data }
    : null
}

/**
 * Identifiant de la génération à reprendre à l'étape 3. Une génération d'un autre utilisateur, expirée,
 * purgée (terminale sans contenu) ou perdue (en attente depuis trop longtemps) n'est pas reprise.
 */
async function generationAReprendre(ligne: ProgressionInscription | undefined, now: Date): Promise<string | null> {
  if (!ligne?.generationId) return null
  const [generation] = await db
    .select({
      id: generationsIa.id,
      statut: generationsIa.statut,
      createdAt: generationsIa.createdAt,
      aUneSortie: sql<boolean>`${generationsIa.sortie} is not null`,
    })
    .from(generationsIa)
    .where(
      and(
        eq(generationsIa.id, ligne.generationId),
        eq(generationsIa.userId, ligne.userId),
        eq(generationsIa.type, TYPE_ONBOARDING),
      ),
    )
    .limit(1)
  if (!generation) return null
  if ((GENERATION_STATUTS_TERMINAUX as readonly string[]).includes(generation.statut)) {
    return generation.statut !== 'expiree' && generation.aUneSortie ? generation.id : null
  }
  return now.getTime() - generation.createdAt.getTime() <= GENERATION_EXPIRATION_MS ? generation.id : null
}

/** État de l'inscription. Lecture seule : ne crée jamais de ligne. Une vitrine existante = parcours terminé. */
export async function getOnboarding(userId: string, now: Date = new Date()): Promise<OnboardingView> {
  const [vitrine] = await db
    .select({ username: vitrines.username })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  if (vitrine) return { statut: 'termine', username: vitrine.username }

  const [courante] = await db
    .select({ progression: progressionsInscription, photo: medias })
    .from(progressionsInscription)
    .leftJoin(
      medias,
      and(eq(medias.id, progressionsInscription.photoMediaId), eq(medias.userId, progressionsInscription.userId)),
    )
    .where(eq(progressionsInscription.userId, userId))
    .limit(1)

  const progression = courante?.progression
  const identite = identiteDe(progression)
  const photo = courante?.photo ?? null
  return {
    statut: 'en_cours',
    etapeReprise: computeEtapeReprise({
      ...identite,
      photoMediaId: photo?.id ?? null,
      propositionValideeLe: progression?.propositionValideeLe ?? null,
    }),
    identite,
    photo,
    generationId: await generationAReprendre(progression, now),
    proposition: propositionDe(progression),
    usernameSuggere: computeUsernameSuggere(identite),
  }
}

// ---------------------------------------------------------------------------------------------
// Écriture des étapes
// ---------------------------------------------------------------------------------------------

async function verrouiller(tx: Transaction, userId: string): Promise<ProgressionInscription | undefined> {
  const [ligne] = await tx
    .select()
    .from(progressionsInscription)
    .where(eq(progressionsInscription.userId, userId))
    .for('update')
  return ligne
}

async function exigerSansVitrine(tx: Transaction, userId: string): Promise<void> {
  const [vitrine] = await tx.select({ id: vitrines.id }).from(vitrines).where(eq(vitrines.userId, userId)).limit(1)
  if (vitrine) throw new ConflictError('ONBOARDING_TERMINE')
}

/** La progression existe, n'est pas terminée et contient les `parties` demandées, sinon 422 avec ce qui manque. */
function exiger(ligne: ProgressionInscription | undefined, parties: readonly OnboardingManquant[]): ProgressionInscription {
  const manquants = computeManquants(ligne ?? null).filter((partie) => parties.includes(partie))
  if (!ligne || manquants.length > 0) throw incomplet(manquants)
  if (ligne.termineLe !== null) throw new ConflictError('ONBOARDING_TERMINE')
  return ligne
}

async function enregistrerIdentite(tx: Transaction, userId: string, input: OnboardingIdentiteInput): Promise<null> {
  // Création idempotente : deux premiers enregistrements simultanés ne se disputent qu'une seule ligne.
  await tx.insert(progressionsInscription).values({ userId }).onConflictDoNothing()
  const actuelle = await verrouiller(tx, userId)
  if (!actuelle) throw new Error('Progression introuvable après insertion.')
  if (actuelle.termineLe !== null) throw new ConflictError('ONBOARDING_TERMINE')

  const ligne = (valeur: string, max: number) => nettoyerTexte(valeur, { max, multiligne: false })
  const identite: IdentiteProgression = {
    titre: input.titre,
    prenom: ligne(input.prenom, PRENOM_MAX),
    nom: ligne(input.nom, NOM_MAX),
    metier: ligne(input.metier, METIER_MAX),
    ville: ligne(input.ville, VILLE_MAX),
    pays: input.pays,
  }
  const remise = identiteIaModifiee(identiteDe(actuelle), identite) ? REMISE_PROPOSITION : {}
  await tx
    .update(progressionsInscription)
    .set({ ...identite, ...remise, updatedAt: new Date() })
    .where(eq(progressionsInscription.userId, userId))
  return null
}

/** Renvoie l'ancienne photo si elle est remplacée : sa suppression se fait APRÈS le commit. */
async function enregistrerPhoto(tx: Transaction, userId: string, input: OnboardingPhotoInput): Promise<string | null> {
  const actuelle = exiger(await verrouiller(tx, userId), ['identite'])
  await requireOwnedMedias(tx, userId, [input.photoMediaId])
  await tx
    .update(progressionsInscription)
    .set({ photoMediaId: input.photoMediaId, updatedAt: new Date() })
    .where(eq(progressionsInscription.userId, userId))
  return actuelle.photoMediaId !== null && actuelle.photoMediaId !== input.photoMediaId ? actuelle.photoMediaId : null
}

/** Génération terminale de l'utilisateur dont la sortie est lisible ; sinon 409 PROPOSITION_INDISPONIBLE. */
async function lireSortieValidable(tx: Transaction, userId: string, generationId: string | null) {
  if (generationId === null) throw new ConflictError('PROPOSITION_INDISPONIBLE')
  const [generation] = await tx
    .select({ sortie: generationsIa.sortie })
    .from(generationsIa)
    .where(
      and(
        eq(generationsIa.id, generationId),
        eq(generationsIa.userId, userId),
        eq(generationsIa.type, TYPE_ONBOARDING),
        inArray(generationsIa.statut, [...GENERATION_STATUTS_TERMINAUX]),
        isNotNull(generationsIa.sortie),
      ),
    )
    .limit(1)
  const sortie = schemaPropositionRepli.safeParse(generation?.sortie)
  if (!sortie.success) throw new ConflictError('PROPOSITION_INDISPONIBLE')
  return sortie.data
}

/**
 * Le client envoie des choix (index, interrupteurs, texte de présentation), jamais le contenu des services :
 * ils sont recopiés depuis la sortie de la génération de l'utilisateur.
 */
async function enregistrerProposition(
  tx: Transaction,
  userId: string,
  input: OnboardingPropositionInput,
  now: Date,
): Promise<null> {
  const actuelle = exiger(await verrouiller(tx, userId), ['identite', 'photo'])
  const sortie = await lireSortieValidable(tx, userId, actuelle.generationId)
  const accroche = sortie.accroches[input.accrocheIndex]
  const presentation = nettoyerTexte(input.presentation, { max: BIO_MAX, multiligne: true })
  if (accroche === undefined) throw new ConflictError('PROPOSITION_INDISPONIBLE')
  if (presentation === '') throw new ValidationError({ presentation: [MSG_PRESENTATION_REQUISE] })

  const brouillon: ServiceBrouillon[] = sortie.services.map((service, index) => ({
    titre: service.titre,
    description: service.description,
    type: service.type,
    dureeMin: service.dureeMin,
    nbSeances: service.nbSeances,
    actif: input.servicesActifs[index] ?? false,
  }))
  await tx
    .update(progressionsInscription)
    .set({ accroche, presentation, servicesProposes: brouillon, propositionValideeLe: now, updatedAt: now })
    .where(eq(progressionsInscription.userId, userId))
  return null
}

function traduireErreurPhoto(error: unknown): never {
  const { code, constraint } = readPgError(error)
  if (code === PG_FOREIGN_KEY_VIOLATION && constraint === PROGRESSION_PHOTO_FK) throw new UnprocessableError('MEDIA_INVALIDE')
  throw error
}

/** Enregistre une étape (1, 2 ou 3) et renvoie le nouvel état. Une vitrine existante = 409 ONBOARDING_TERMINE. */
export async function saveEtape(userId: string, input: OnboardingEtapeInput, now: Date = new Date()): Promise<OnboardingView> {
  let anciennePhoto: string | null = null
  try {
    anciennePhoto = await db.transaction(async (tx) => {
      await exigerSansVitrine(tx, userId)
      switch (input.etape) {
        case 1:
          return enregistrerIdentite(tx, userId, input)
        case 2:
          return enregistrerPhoto(tx, userId, input)
        case 3:
          return enregistrerProposition(tx, userId, input, now)
      }
    })
  } catch (error) {
    traduireErreurPhoto(error)
  }
  // Après le commit : l'ancienne photo disparaît si plus rien ne la référence. Jamais bloquant.
  if (anciennePhoto !== null) await cleanupMedias(userId, [anciennePhoto], LOG_CONTEXTE)
  return getOnboarding(userId, now)
}

// ---------------------------------------------------------------------------------------------
// Génération
// ---------------------------------------------------------------------------------------------

function memeEntree(a: EntreeOnboarding, b: EntreeOnboarding): boolean {
  return a.titre === b.titre && a.metier === b.metier && a.ville === b.ville && a.pays === b.pays
}

/** Relie la génération à la progression, sauf si l'identité a changé pendant l'appel (la génération est alors périmée). */
async function relierGeneration(userId: string, generationId: string, entree: EntreeOnboarding): Promise<void> {
  await db.transaction(async (tx) => {
    const ligne = await verrouiller(tx, userId)
    if (!ligne || ligne.termineLe !== null || !memeEntree(entreeOnboarding(ligne), entree)) return
    await tx
      .update(progressionsInscription)
      .set({ generationId, updatedAt: new Date() })
      .where(eq(progressionsInscription.userId, userId))
  })
}

/**
 * Lance (ou reprend) la génération de l'étape 3. Les contrôles gratuits passent AVANT le limiteur : vitrine
 * existante (409) et identité incomplète (422) ne consomment aucune demande. `createGeneration` ouvre sa
 * propre transaction : elle n'est jamais appelée à l'intérieur d'une autre.
 */
export async function generer(userId: string, now: Date = new Date()): Promise<CreationResultat> {
  const [vitrine] = await db.select({ id: vitrines.id }).from(vitrines).where(eq(vitrines.userId, userId)).limit(1)
  if (vitrine) throw new ConflictError('ONBOARDING_TERMINE')

  const [progression] = await db
    .select()
    .from(progressionsInscription)
    .where(eq(progressionsInscription.userId, userId))
    .limit(1)
  if (!progression || !identiteComplete(progression)) throw incomplet(['identite'])

  const entree = entreeOnboarding(progression)
  // Une saisie réduite à du vide par le nettoyage (caractères invisibles) n'est pas une identité.
  if (entree.metier === '' || entree.ville === '') throw incomplet(['identite'])

  // Champs seuls ET joints : une consigne coupée entre le métier et la ville n'apparaît qu'une fois réunie
  // (le gabarit les place l'un près de l'autre).
  const injection = [entree.metier, entree.ville, `${entree.metier} ${entree.ville}`].some(detecterInjection)
  const resultat = await createGeneration(userId, TYPE_ONBOARDING, entree, { injection }, now)
  await relierGeneration(userId, resultat.generation.id, entree)
  return resultat
}

// ---------------------------------------------------------------------------------------------
// Terminer
// ---------------------------------------------------------------------------------------------

interface IdentiteComplete {
  titre: string | null
  prenom: string
  nom: string
  metier: string
  ville: string
  pays: string
}

function identiteCompleteDe(ligne: ProgressionInscription): IdentiteComplete | null {
  const { titre, prenom, nom, metier, ville, pays } = ligne
  if (!nonVide(prenom) || !nonVide(nom) || !nonVide(metier) || !nonVide(ville) || !nonVide(pays)) return null
  return { titre, prenom, nom, metier, ville, pays }
}

async function photoAppartient(tx: Transaction, userId: string, mediaId: string | null): Promise<boolean> {
  if (mediaId === null) return false
  const [media] = await tx
    .select({ id: medias.id })
    .from(medias)
    .where(and(eq(medias.id, mediaId), eq(medias.userId, userId)))
    .limit(1)
  return media !== undefined
}

/** Services cochés à l'étape 3 : dans l'ordre proposé, tous en vedette (3 au plus), « Sur devis », réservables. */
function lignesServices(vitrineId: string, brouillon: readonly ServiceBrouillon[]): (typeof services.$inferInsert)[] {
  const slugsPris = new Set<string>()
  return brouillon
    .filter((service) => service.actif)
    .map((service, ordre) => {
      const etat = normalizeServiceState(ETAT_SERVICE_PROPOSE, {
        type: service.type,
        nbSeances: service.nbSeances,
        dureeMin: service.dureeMin,
        enVedette: ordre < VEDETTE_MAX,
      })
      if (Object.keys(checkServiceCoherence(etat)).length > 0) throw incomplet(['proposition'])
      const slug = pickAvailableSlug(slugFromTitle(service.titre), slugsPris)
      slugsPris.add(slug)
      return {
        id: randomUUID(),
        vitrineId,
        slug,
        titre: service.titre,
        description: service.description,
        type: etat.type,
        nbSeances: etat.nbSeances,
        rythme: etat.rythme,
        dureeMin: etat.dureeMin,
        tarif: etat.tarif,
        prixMontant: etat.prixMontant,
        prixDevise: etat.prixDevise,
        paiementMode: etat.paiementMode,
        paiementInstructions: etat.paiementInstructions,
        reservable: true,
        enVedette: etat.enVedette,
        ordre,
        actif: etat.actif,
      }
    })
}

function traduireErreurTerminer(error: unknown): never {
  const { code, constraint } = readPgError(error)
  if (code === PG_UNIQUE_VIOLATION && constraint === USERNAME_UNIQUE) throw new ConflictError('USERNAME_PRIS')
  if (code === PG_UNIQUE_VIOLATION && constraint === USER_ID_UNIQUE) throw new ConflictError('VITRINE_EXISTE')
  if (code === PG_FOREIGN_KEY_VIOLATION && constraint === VITRINE_PHOTO_FK) throw incomplet(['photo'])
  throw error
}

async function creerVitrineEtServices(
  tx: Transaction,
  userId: string,
  ligne: ProgressionInscription,
  input: OnboardingTerminerInput,
): Promise<void> {
  const identite = identiteCompleteDe(ligne)
  const brouillon = schemaServicesBrouillon.safeParse(ligne.servicesProposes)
  if (!identite || ligne.accroche === null || ligne.presentation === null || !brouillon.success) {
    throw incomplet(['proposition'])
  }

  const vitrineId = randomUUID()
  await tx.insert(vitrines).values({
    id: vitrineId,
    userId,
    username: input.username,
    ...identite,
    accroche: ligne.accroche,
    bio: ligne.presentation,
    photoMediaId: ligne.photoMediaId,
    palette: input.palette,
    // Le fuseau du compte devient celui de la vitrine (même sous-requête que createVitrine).
    fuseau: sql<string>`(select ${users.fuseau} from ${users} where ${users.id} = ${userId})`,
    // Photo, accroche, présentation et identité sont validées : la vitrine est publiable, donc publiée.
    publieeLe: sql`now()`,
  })

  const lignes = lignesServices(vitrineId, brouillon.data)
  if (lignes.length > 0) await tx.insert(services).values(lignes)

  // La CHECK `validation_check` impose services_proposes non nul tant que la proposition est validée :
  // le brouillon et sa validation sont vidés ensemble une fois la vitrine créée. La photo appartient
  // désormais à la vitrine : la progression la lâche, sinon remplacer la photo du Profil laisserait un
  // orphelin (deleteMediaIfUnreferenced voit encore la référence de la progression).
  // Minimisation : l'identité et les textes vivent désormais dans la vitrine, la progression n'en garde pas
  // de copie. `termine_le` reste (le rejeu idempotent de `terminer` s'appuie dessus). Les CHECK de la
  // migration 0018 tolèrent ces NULL (longueurs via coalesce, validation_check déjà levée ci-dessus).
  await tx
    .update(progressionsInscription)
    .set({
      termineLe: new Date(),
      prenom: null,
      nom: null,
      metier: null,
      ville: null,
      accroche: null,
      presentation: null,
      servicesProposes: null,
      propositionValideeLe: null,
      photoMediaId: null,
      updatedAt: new Date(),
    })
    .where(eq(progressionsInscription.userId, userId))
}

/**
 * Crée la vitrine publiée et ses services en une seule transaction, sous verrou de la progression : un rejeu
 * (double clic) renvoie `creee: false` sans rien refaire. La contrainte UNIQUE de la base fait foi pour
 * l'adresse : un conflit annule tout (409 USERNAME_PRIS), la progression reste intacte.
 */
export async function terminer(userId: string, input: OnboardingTerminerInput): Promise<TerminerResultat> {
  // Limite par utilisateur (compteur propre à `terminer`, sans lien avec le quota IA). Même politique que la
  // vérification d'adresse : une panne de Redis laisse passer (fail-open), jamais « inscription impossible ».
  await enforceLimit(
    `${ONBOARDING_TERMINER_CLE_PREFIXE}${userId}`,
    ONBOARDING_TERMINER_LIMIT.limit,
    ONBOARDING_TERMINER_LIMIT.windowS,
  )
  try {
    return await db.transaction(async (tx) => {
      const ligne = await verrouiller(tx, userId)
      if (ligne?.termineLe) return { creee: false }

      const [vitrine] = await tx.select({ id: vitrines.id }).from(vitrines).where(eq(vitrines.userId, userId)).limit(1)
      if (vitrine) throw new ConflictError('VITRINE_EXISTE')
      if (!ligne) throw incomplet(computeManquants(null))

      // La photo doit exister ET appartenir à l'utilisateur (suppression ou réécriture entre l'étape 2 et ici).
      const photoValide = await photoAppartient(tx, userId, ligne.photoMediaId)
      const manquants = computeManquants({ ...ligne, photoMediaId: photoValide ? ligne.photoMediaId : null })
      if (manquants.length > 0) throw incomplet(manquants)

      await creerVitrineEtServices(tx, userId, ligne, input)
      return { creee: true }
    })
  } catch (error) {
    return traduireErreurTerminer(error)
  }
}

// ---------------------------------------------------------------------------------------------
// Purge des inscriptions abandonnées
// ---------------------------------------------------------------------------------------------

const MS_PAR_JOUR = 86_400_000
const LOG_PURGE = 'purge-onboarding'

/**
 * Rétention des données personnelles : une progression jamais terminée et sans modification depuis
 * ONBOARDING_ABANDON_RETENTION_JOURS jours est supprimée (identité, textes, brouillon). Sa photo, devenue
 * orpheline, passe par le nettoyage de médias habituel (supprimée seulement si plus rien ne la référence).
 * Une progression terminée est déjà vidée de son identité par `terminer`. Idempotent. Renvoie le nombre supprimé.
 */
export async function purgeProgressionsAbandonnees(now: Date = new Date()): Promise<number> {
  const limite = new Date(now.getTime() - ONBOARDING_ABANDON_RETENTION_JOURS * MS_PAR_JOUR)
  const supprimees = await db
    .delete(progressionsInscription)
    .where(and(isNull(progressionsInscription.termineLe), lt(progressionsInscription.updatedAt, limite)))
    .returning({ userId: progressionsInscription.userId, photoMediaId: progressionsInscription.photoMediaId })
  for (const { userId, photoMediaId } of supprimees) {
    if (photoMediaId !== null) await cleanupMedias(userId, [photoMediaId], LOG_PURGE)
  }
  return supprimees.length
}
