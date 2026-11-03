import { eq } from 'drizzle-orm'
import { vi } from 'vitest'
import type { MockInstance } from 'vitest'
import { vitrines } from '../../../shared/db/schema'
import type { PreferenceEmail } from '../../../shared/notifications'
import { RAPPEL_VISITEUR_AVANCE_HEURES } from '../../../shared/notifications'
import { db } from '../../../server/utils/db'
import type { EmailMessage } from '../../../server/services/emails/transport'
import { insertMediaRow } from './fabriques'
import {
  heures,
  insererOutbox,
  insererReservation,
  lireOutboxParId,
  RecordingTransport,
} from './notifications'
import type { OutboxRow, Pro } from './notifications'

// Aides communes aux tests d'intégration S9 (outbox, planification, désabonnement, prochaine étape).
// Rien n'est mocké ici sauf la sortie console (pour prouver qu'aucune donnée personnelle n'est journalisée).

/** Message avec les en-têtes que le lot B ajoute à `EmailMessage` (List-Unsubscribe, RFC 8058). */
export type MessageAvecEntetes = EmailMessage & { headers?: Record<string, string> }

export const modulesEmailOutbox = () => import('../../../server/services/email-outbox')
export const modulesPlanification = () => import('../../../server/services/notifications/planification')
export const modulesPurge = () => import('../../../server/services/notifications/purge')
export const modulesDesabonnement = () => import('../../../server/services/desabonnement')

/** Photo + disponibilités : toutes les étapes avant « réalisation » sont faites. */
export async function ajouterPhoto(pro: Pro): Promise<void> {
  const media = await insertMediaRow(pro.user.id)
  await db.update(vitrines).set({ photoMediaId: media.id }).where(eq(vitrines.id, pro.vitrine.id))
}

/** Une ligne de rappel visiteur insérée à la main, comme le ferait la confirmation (état de départ de l'envoi). */
export async function poserRappelVisiteur(pro: Pro, options: {
  debut: Date
  statut?: 'en_attente' | 'confirmee' | 'annulee' | 'terminee' | 'refusee'
  rappelEmail?: boolean
  prochaineTentative?: Date
  createdAt?: Date
}): Promise<{ ligne: OutboxRow, reservationId: string }> {
  const reservation = await insererReservation(pro.vitrine.id, pro.service.id, {
    debut: options.debut,
    statut: options.statut ?? 'confirmee',
    rappelEmail: options.rappelEmail ?? true,
  })
  const prevu = new Date(options.debut.getTime() - heures(RAPPEL_VISITEUR_AVANCE_HEURES))
  const ligne = await insererOutbox({
    type: 'reservation_visiteur_rappel',
    entiteType: 'reservation',
    entiteId: reservation.id,
    occurrence: options.debut.toISOString(),
    prochaineTentative: options.prochaineTentative ?? prevu,
    createdAt: options.createdAt ?? new Date(prevu.getTime() - heures(48)),
  })
  return { ligne, reservationId: reservation.id }
}

export interface Traitement {
  resultat: { statut: string }
  ligne: OutboxRow
  transport: RecordingTransport
}

/** Traite une ligne avec un transport d'enregistrement (seul élément factice) et relit la ligne. */
export async function traiter(id: string, now: Date, transport: RecordingTransport = new RecordingTransport()): Promise<Traitement> {
  const { processTransactionalEmail } = await modulesEmailOutbox()
  const resultat = await processTransactionalEmail(id, transport, now)
  return { resultat, ligne: await lireOutboxParId(id), transport }
}

export interface EspionJournaux {
  /** Tout ce qui a été écrit sur la console, sérialisé. */
  contenu: () => string
  restaurer: () => void
}

/** Capture console.log/info/warn/error/debug sans les laisser sortir ; le contenu sert aux assertions « aucune donnée personnelle ». */
export function espionnerJournaux(): EspionJournaux {
  const espions: MockInstance[] = []
  const lignes: string[] = []
  for (const niveau of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    espions.push(vi.spyOn(console, niveau).mockImplementation((...args: unknown[]) => {
      lignes.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, (_k, v: unknown) => (v instanceof Error ? `${v.name}:${v.message}` : v)))).join(' '))
    }))
  }
  return {
    contenu: () => lignes.join('\n'),
    restaurer: () => {
      for (const espion of espions) espion.mockRestore()
    },
  }
}

export async function jetonDesabonnement(userId: string, preference: PreferenceEmail, now: Date): Promise<string> {
  const { signUnsubscribeToken } = await modulesDesabonnement()
  return signUnsubscribeToken(userId, preference, now)
}
