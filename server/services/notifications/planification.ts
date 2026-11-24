import { Temporal } from '@js-temporal/polyfill'
import { and, asc, eq, exists, gt, gte, inArray, lt, notExists, or, sql } from 'drizzle-orm'
import { TEMP_EMAIL_DOMAIN } from '../../../shared/compte'
import { abonnements, emailsTransactionnels, reservations, users, vitrines } from '../../../shared/db/schema'
import { ESSAI_EMAIL_ENTITE_TYPE } from '../../../shared/essai'
import { isValidTimeZone } from '../../../shared/fuseau'
import {
  EMAIL_STATUTS,
  PLANIFICATION_LOT_UTILISATEURS,
  RAPPEL_JOURNEE_HEURE_LOCALE,
  RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  RAPPEL_JOURNEE_STATUTS,
  RAPPEL_VISITEUR_AVANCE_HEURES,
  RAPPEL_VISITEUR_ECART_MIN_HEURES,
  RESUME_HEURE_LOCALE,
  RESUME_JOUR_ISO,
  RESUME_RATTRAPAGE_HEURES,
} from '../../../shared/notifications'
import type { EmailStatut } from '../../../shared/notifications'
import { HEURE_MS } from '../../../shared/temps'
import { db } from '../../utils/db'
import {
  cancelPendingEmailEvents,
  insertScheduledEmailEvent,
  insertScheduledEmailEvents,
} from '../email-outbox'
import type { DbTransaction } from '../email-outbox'
import { sqlVitrinePublique } from '../visibilite'
import { planifierRappelsAbonnement } from './abonnements'
import { dansFenetre, debutSemaineIso, journeeLocale, periodeResume } from './fenetres'
import { plafondRelationnelAtteint } from './plafond'
import type { LigneOutboxPlafond } from './plafond'

// S9 (docs/specs/S9-notifications.md #81 à #88, #98, #101, §4.2, §4.3) : planification des e-mails.
// L'outbox est l'unique planificateur : une ligne = un e-mail, `prochaine_tentative` = heure d'envoi,
// `occurrence` = clé d'idempotence. Rien n'est écrit dans Redis. Aucun journal ne contient d'adresse,
// de nom, de fuseau ni de contenu : des NOMBRES seulement.

const VERROU_RELATIONNEL_PREFIXE = 'relationnel:'
/** Largeur d'une semaine (approximation d'une heure près lors d'un changement d'heure, sans effet sur le plafond). */
const SEMAINE_MS = 7 * 24 * HEURE_MS
const TYPE_RESUME = 'utilisateur_resume_hebdo'
const TYPE_RAPPEL_JOURNEE = 'utilisateur_rappel_journee'
const TYPE_RAPPEL_VISITEUR = 'reservation_visiteur_rappel'

type Database = typeof db

export interface PlanificationResultat {
  resumes: number
  rappelsJour: number
  /** S10 : rappels d'échéance d'abonnement (J-7, J-3, J0) créés par ce passage. */
  rappelsAbonnement: number
  /** Fuseaux distincts invalides (préférences S9 et abonnements S10 confondus). */
  fuseauxInvalides: number
}

/** Accès et sortie injectables (tests) ; la date `now` est toujours un argument. */
export interface PlanificationDeps {
  database: Database
  /** Journal : reçoit des phrases ne contenant que des nombres. */
  log: (message: string) => void
}

const DEPS_DEFAUT: PlanificationDeps = {
  database: db,
  log: (message) => console.info(message),
}

// ---------------------------------------------------------------------------------------------
// Rappel visiteur (§4.2) : appelé DANS les transactions de confirmation et d'annulation.
// ---------------------------------------------------------------------------------------------

/** Heure d'envoi du rappel : `debut` moins l'avance, en durée absolue (pas en jours calendaires). */
export function heureRappelVisiteur(debut: Date): Date {
  return new Date(debut.getTime() - RAPPEL_VISITEUR_AVANCE_HEURES * HEURE_MS)
}

/**
 * Insère la ligne de rappel d'une réservation CONFIRMÉE dont le visiteur l'a demandé, seulement si l'heure
 * prévue tombe au moins RAPPEL_VISITEUR_ECART_MIN_HEURES après `now` (sinon l'e-mail de confirmation en tient lieu).
 * Renvoie vrai si une ligne a été créée.
 */
export async function programmerRappelVisiteur(
  tx: DbTransaction,
  reservation: { id: string, debut: Date, rappelEmail: boolean },
  now: Date,
): Promise<boolean> {
  if (!reservation.rappelEmail) return false
  const prevu = heureRappelVisiteur(reservation.debut)
  if (prevu.getTime() - now.getTime() < RAPPEL_VISITEUR_ECART_MIN_HEURES * HEURE_MS) return false
  return insertScheduledEmailEvent(tx, {
    entiteType: 'reservation',
    entiteId: reservation.id,
    type: TYPE_RAPPEL_VISITEUR,
    occurrence: reservation.debut.toISOString(),
    prochaineTentative: prevu,
    categorie: 'transactionnel',
    creeLe: now,
  })
}

/** Annulation ou refus : la ligne de rappel encore en attente passe à `annule` (même transaction). */
export async function annulerRappelVisiteur(tx: DbTransaction, reservationId: string, now: Date): Promise<number> {
  return cancelPendingEmailEvents(
    tx,
    { entiteType: 'reservation', entiteId: reservationId, type: TYPE_RAPPEL_VISITEUR },
    'RESERVATION_ANNULEE',
    now,
  )
}

// ---------------------------------------------------------------------------------------------
// Planification récurrente (§4.3) : résumé hebdomadaire et rendez-vous du jour.
// ---------------------------------------------------------------------------------------------

/** Compte dont le destinataire existe : e-mail réel, ou e-mail de contact de la vitrine non vide (#101). */
function destinataireResolvable() {
  return sql`(lower(${users.email}) NOT LIKE ${`%@${TEMP_EMAIL_DOMAIN}`} OR btrim(coalesce(${vitrines.emailContact}, '')) <> '')`
}

/** Aucune ligne n'existe déjà pour cet utilisateur, ce type et cette occurrence. */
function pasEncorePlanifie(database: Database, type: string, occurrence: string) {
  return notExists(
    database
      .select({ un: sql`1` })
      .from(emailsTransactionnels)
      .where(and(
        eq(emailsTransactionnels.entiteType, 'utilisateur'),
        eq(emailsTransactionnels.entiteId, users.id),
        eq(emailsTransactionnels.type, type),
        eq(emailsTransactionnels.occurrence, occurrence),
      )),
  )
}

function estStatut(valeur: string): valeur is EmailStatut {
  return (EMAIL_STATUTS as readonly string[]).includes(valeur)
}

/**
 * Plafond « un seul e-mail relationnel par semaine », vérifié SOUS VERROU consultatif transactionnel par
 * utilisateur : deux planifications concurrentes se sérialisent, la seconde voit la ligne de la première.
 * E1 : les relances de l'essai (`entite_id` = id de l'ABONNEMENT du compte, planifiées à l'avance) comptent aussi, mais
 * par leur semaine d'ENVOI prévu (`prochaine_tentative` dans la semaine), pas par leur création : une relance posée
 * lundi dernier pour mercredi prochain ne bloque pas cette semaine-ci, une relance prévue cette semaine bloque le résumé.
 * Choix de priorité : un compte en essai reçoit la relance, pas le résumé (vide pour une vitrine toute neuve) ; à
 * l'envoi, la relance est annulée (`PLAFOND_RELATIONNEL`) si un relationnel est DÉJÀ parti cette semaine.
 */
async function insererResumeSousPlafond(
  database: Database,
  userId: string,
  label: string,
  debutSemaine: Date,
  now: Date,
): Promise<boolean> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${VERROU_RELATIONNEL_PREFIXE}${userId}`}::text))`)
    const finSemaine = new Date(debutSemaine.getTime() + SEMAINE_MS)
    const lignes = await tx
      .select({
        categorie: emailsTransactionnels.categorie,
        statut: emailsTransactionnels.statut,
        createdAt: emailsTransactionnels.createdAt,
        entiteType: emailsTransactionnels.entiteType,
        prochaineTentative: emailsTransactionnels.prochaineTentative,
      })
      .from(emailsTransactionnels)
      .where(and(
        eq(emailsTransactionnels.categorie, 'relationnel'),
        or(
          and(eq(emailsTransactionnels.entiteId, userId), gte(emailsTransactionnels.createdAt, debutSemaine)),
          // Relances de l'essai : l'entité est l'abonnement du compte (E1).
          and(
            eq(emailsTransactionnels.entiteType, ESSAI_EMAIL_ENTITE_TYPE),
            inArray(emailsTransactionnels.entiteId, tx.select({ id: abonnements.id }).from(abonnements).where(eq(abonnements.userId, userId))),
            gte(emailsTransactionnels.prochaineTentative, debutSemaine),
            lt(emailsTransactionnels.prochaineTentative, finSemaine),
          ),
        ),
      ))
    const pourPlafond: LigneOutboxPlafond[] = lignes.map((ligne) => ({
      categorie: 'relationnel',
      // Un statut inconnu compte comme une ligne partie (prudence : jamais de second e-mail relationnel).
      statut: estStatut(ligne.statut) ? ligne.statut : 'envoye',
      // Une relance d'essai compte à la semaine de son envoi prévu (voir ci-dessus), un résumé à celle de sa création.
      createdAt: ligne.entiteType === ESSAI_EMAIL_ENTITE_TYPE ? (ligne.prochaineTentative ?? ligne.createdAt) : ligne.createdAt,
    }))
    if (plafondRelationnelAtteint(pourPlafond, debutSemaine)) return false
    return insertScheduledEmailEvent(tx, {
      entiteType: 'utilisateur',
      entiteId: userId,
      type: TYPE_RESUME,
      occurrence: label,
      prochaineTentative: now,
      categorie: 'relationnel',
      creeLe: now,
    })
  })
}

async function planifierResumes(
  deps: PlanificationDeps,
  fuseau: string,
  local: Temporal.ZonedDateTime,
  now: Date,
): Promise<number> {
  const { database } = deps
  const periode = periodeResume(local)
  const debutSemaine = new Date(debutSemaineIso(local).epochMilliseconds)
  let planifies = 0
  let curseur = ''
  for (;;) {
    const lot = await database
      .select({ id: users.id })
      .from(users)
      .innerJoin(vitrines, eq(vitrines.userId, users.id))
      .where(and(
        eq(users.fuseau, fuseau),
        eq(users.email_hebdo, true),
        // A2 : ni vitrine masquée, ni bloquée, ni titulaire suspendu (visibilite.ts).
        sqlVitrinePublique(),
        destinataireResolvable(),
        pasEncorePlanifie(database, TYPE_RESUME, periode.label),
        gt(users.id, curseur),
      ))
      .orderBy(asc(users.id))
      .limit(PLANIFICATION_LOT_UTILISATEURS)
    for (const { id } of lot) {
      if (await insererResumeSousPlafond(database, id, periode.label, debutSemaine, now)) planifies += 1
    }
    const dernier = lot.at(-1)
    if (dernier === undefined || lot.length < PLANIFICATION_LOT_UTILISATEURS) return planifies
    curseur = dernier.id
  }
}

async function planifierRappelsJour(
  deps: PlanificationDeps,
  fuseau: string,
  local: Temporal.ZonedDateTime,
  now: Date,
): Promise<number> {
  const { database } = deps
  const journee = journeeLocale(local)
  const debut = new Date(journee.debut.epochMilliseconds)
  const fin = new Date(journee.fin.epochMilliseconds)
  let planifies = 0
  let curseur = ''
  for (;;) {
    const lot = await database
      .select({ id: users.id })
      .from(users)
      .innerJoin(vitrines, eq(vitrines.userId, users.id))
      .where(and(
        eq(users.fuseau, fuseau),
        eq(users.email_rappel_jour, true),
        // A2 (D-A2-09) : aucune NOUVELLE planification pour un compte suspendu (les rappels déjà posés partent).
        eq(users.banned, false),
        destinataireResolvable(),
        exists(
          database
            .select({ un: sql`1` })
            .from(reservations)
            .where(and(
              eq(reservations.vitrineId, vitrines.id),
              inArray(reservations.statut, [...RAPPEL_JOURNEE_STATUTS]),
              gte(reservations.debut, debut),
              lt(reservations.debut, fin),
            )),
        ),
        pasEncorePlanifie(database, TYPE_RAPPEL_JOURNEE, journee.label),
        gt(users.id, curseur),
      ))
      .orderBy(asc(users.id))
      .limit(PLANIFICATION_LOT_UTILISATEURS)
    if (lot.length > 0) {
      planifies += await database.transaction((tx) => insertScheduledEmailEvents(tx, lot.map(({ id }) => ({
        entiteType: 'utilisateur' as const,
        entiteId: id,
        type: TYPE_RAPPEL_JOURNEE,
        occurrence: journee.label,
        prochaineTentative: now,
        categorie: 'transactionnel' as const,
        creeLe: now,
      }))))
    }
    const dernier = lot.at(-1)
    if (dernier === undefined || lot.length < PLANIFICATION_LOT_UTILISATEURS) return planifies
    curseur = dernier.id
  }
}

/**
 * Pose les lignes d'outbox du résumé hebdomadaire (lundi, 8 h locale, rattrapage borné) et du rendez-vous du
 * jour (7 h locale, rattrapage borné), fuseau par fuseau distinct. Un fuseau invalide est écarté et compté ;
 * les autres sont traités. Idempotent : l'unicité `(entité, type, occurrence)` tranche les rejeux.
 */
export async function planifierNotifications(
  now: Date,
  deps: Partial<PlanificationDeps> = {},
): Promise<PlanificationResultat> {
  const effectives: PlanificationDeps = { ...DEPS_DEFAUT, ...deps }
  const fuseaux = await effectives.database
    .selectDistinct({ fuseau: users.fuseau })
    .from(users)
    .where(or(eq(users.email_hebdo, true), eq(users.email_rappel_jour, true)))

  const resultat: PlanificationResultat = { resumes: 0, rappelsJour: 0, rappelsAbonnement: 0, fuseauxInvalides: 0 }
  // Ensemble : un même fuseau invalide, vu par les préférences ET par un abonnement, ne se compte qu'une fois.
  const invalides = new Set<string>()
  for (const { fuseau } of fuseaux) {
    if (!isValidTimeZone(fuseau)) {
      invalides.add(fuseau)
      continue
    }
    const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(fuseau)
    if (local.dayOfWeek === RESUME_JOUR_ISO && dansFenetre(local, RESUME_HEURE_LOCALE, RESUME_RATTRAPAGE_HEURES)) {
      resultat.resumes += await planifierResumes(effectives, fuseau, local, now)
    }
    if (dansFenetre(local, RAPPEL_JOURNEE_HEURE_LOCALE, RAPPEL_JOURNEE_RATTRAPAGE_HEURES)) {
      resultat.rappelsJour += await planifierRappelsJour(effectives, fuseau, local, now)
    }
  }
  // S10 #122 : rappels d'échéance, indépendants des préférences d'e-mail (transactionnels) : toujours balayés.
  const abonnement = await planifierRappelsAbonnement(now, effectives.database)
  resultat.rappelsAbonnement = abonnement.rappels
  for (const fuseau of abonnement.fuseauxInvalides) invalides.add(fuseau)
  resultat.fuseauxInvalides = invalides.size
  if (resultat.fuseauxInvalides > 0) {
    effectives.log(`[notifications] fuseau invalide ignoré (${resultat.fuseauxInvalides})`)
  }
  return resultat
}
