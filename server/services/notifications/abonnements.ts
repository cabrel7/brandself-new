import { Temporal } from '@js-temporal/polyfill'
import { and, asc, gt, eq, lte } from 'drizzle-orm'
import { abonnements, users, vitrines } from '../../../shared/db/schema'
import { isValidTimeZone } from '../../../shared/fuseau'
import { PLANIFICATION_LOT_UTILISATEURS } from '../../../shared/notifications'
import {
  ABONNEMENT_RAPPEL_HEURE_LOCALE,
  ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES,
  ABONNEMENT_RAPPELS_JOURS,
} from '../../../shared/plans'
import type { AbonnementRappelJours } from '../../../shared/plans'
import { JOUR_MS } from '../../../shared/temps'
import { db } from '../../utils/db'
import { insertScheduledEmailEvents, resolveRecipient } from '../email-outbox'
import type { ScheduledEmailEvent } from '../email-outbox'
import { dansFenetre } from './fenetres'
import { construireOccurrenceRappel } from './pertinence'

// S10 (docs/specs/S10-abonnements.md #122, §5.3) : rappels d'échéance J-7, J-3 et J0 dans l'outbox S9.
// Appelée par `planifierNotifications` (tick de 5 minutes), jamais par un ordonnanceur propre. Une ligne =
// un rappel pour UNE échéance (`occurrence` = `J{n}:{expire_le ISO}`), idempotent par l'unicité à 4 colonnes
// de l'outbox : un tick rejoué, deux ticks concurrents ou un redémarrage ne doublent rien. Catégorie
// `transactionnel` : aucun plafond hebdomadaire, aucune préférence de désabonnement. Aucun journal ne
// contient d'adresse, de nom ni de fuseau : des NOMBRES seulement.

type Database = typeof db

/** Jours ajoutés au plus grand rappel pour borner le balayage (décalages horaires, heure d'été, fenêtre de 9 h à 15 h). */
const MARGE_BALAYAGE_JOURS = 2
const DERNIER_INSTANT_PAYE_MS = 1
const TYPE_RAPPEL_ABONNEMENT = 'abonnement_rappel'

export interface RappelsAbonnementResultat {
  /** Lignes d'outbox créées par ce passage. */
  rappels: number
  /** Fuseaux distincts invalides rencontrés (leurs abonnements sont ignorés, jamais en erreur). */
  fuseauxInvalides: ReadonlySet<string>
}

/**
 * Rappel dû à cet instant pour cette échéance, ou `null`. PURE (l'horloge est un argument).
 * Dernier jour inclus = date locale du dernier instant payé (`expire_le` est exclusif et vaut le minuit local
 * suivant : pour une échéance alignée, c'est la date locale de `expire_le − 1 jour`). J{n} tombe `n` jours
 * calendaires avant ; l'envoi se fait dans la fenêtre locale `[9 h, 9 h + rattrapage)`.
 * `fuseau` doit être valide (l'appelant le vérifie).
 */
export function rappelDu(expireLe: Date, fuseau: string, now: Date): AbonnementRappelJours | null {
  if (expireLe.getTime() <= now.getTime()) return null
  const local = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(fuseau)
  if (!dansFenetre(local, ABONNEMENT_RAPPEL_HEURE_LOCALE, ABONNEMENT_RAPPEL_RATTRAPAGE_HEURES)) return null
  const dernierJour = Temporal.Instant
    .fromEpochMilliseconds(expireLe.getTime() - DERNIER_INSTANT_PAYE_MS)
    .toZonedDateTimeISO(fuseau)
    .toPlainDate()
  const aujourdhui = local.toPlainDate()
  return ABONNEMENT_RAPPELS_JOURS.find((jours) => dernierJour.subtract({ days: jours }).equals(aujourdhui)) ?? null
}

/**
 * Pose les rappels dus à `now` pour tous les abonnements dont l'échéance est proche. Seuls les abonnements
 * non échus sont balayés (index `abonnements_expire_le_idx`) : après l'échéance, plus aucun rappel. Un compte
 * sans destinataire (e-mail temporaire sans e-mail de contact) est ignoré. Un fuseau invalide est écarté et compté.
 */
export async function planifierRappelsAbonnement(
  now: Date,
  database: Database = db,
): Promise<RappelsAbonnementResultat> {
  const horizon = new Date(now.getTime() + (Math.max(...ABONNEMENT_RAPPELS_JOURS) + MARGE_BALAYAGE_JOURS) * JOUR_MS)
  const fuseauxInvalides = new Set<string>()
  let rappels = 0
  let curseur = ''
  for (;;) {
    const lot = await database
      .select({
        id: abonnements.id,
        expireLe: abonnements.expireLe,
        fuseau: users.fuseau,
        email: users.email,
        emailContact: vitrines.emailContact,
      })
      .from(abonnements)
      .innerJoin(users, eq(users.id, abonnements.userId))
      .leftJoin(vitrines, eq(vitrines.userId, users.id))
      .where(and(
        gt(abonnements.expireLe, now),
        lte(abonnements.expireLe, horizon),
        gt(abonnements.id, curseur),
      ))
      .orderBy(asc(abonnements.id))
      .limit(PLANIFICATION_LOT_UTILISATEURS)

    const evenements: ScheduledEmailEvent[] = []
    for (const ligne of lot) {
      if (!isValidTimeZone(ligne.fuseau)) {
        fuseauxInvalides.add(ligne.fuseau)
        continue
      }
      const jours = rappelDu(ligne.expireLe, ligne.fuseau, now)
      if (jours === null || resolveRecipient(ligne.emailContact, ligne.email) === null) continue
      evenements.push({
        entiteType: 'abonnement',
        entiteId: ligne.id,
        type: TYPE_RAPPEL_ABONNEMENT,
        occurrence: construireOccurrenceRappel(jours, ligne.expireLe),
        prochaineTentative: now,
        categorie: 'transactionnel',
        creeLe: now,
      })
    }
    if (evenements.length > 0) {
      rappels += await database.transaction((tx) => insertScheduledEmailEvents(tx, evenements))
    }
    const dernier = lot.at(-1)
    if (dernier === undefined || lot.length < PLANIFICATION_LOT_UTILISATEURS) break
    curseur = dernier.id
  }
  return { rappels, fuseauxInvalides }
}
