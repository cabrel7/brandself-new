import { describe, expect, it } from 'vitest'
import {
  RAPPEL_JOURNEE_RATTRAPAGE_HEURES,
  RAPPEL_VISITEUR_AVANCE_HEURES,
  RAPPEL_VISITEUR_RATTRAPAGE_HEURES,
  RESUME_RATTRAPAGE_HEURES,
} from '../../shared/notifications'

// S9 §1 #83, #102, §4.4, §9 / CA12 à CA14, CA22, CA24, CA31, CA32 : revalidation PURE avant tout envoi, sur des
// entrées construites (le chargement en base est séparé et prouvé en intégration par processTransactionalEmail).
// NOM ET FORME D'ENTRÉE SUPPOSÉS (la spec ne nomme que le fichier `pertinence.ts` et `verifierPertinence(row, now)`) :
//   evaluerPertinence(entree, now: Date): CodeAnnulation | null     (null = on peut envoyer)
// avec, par type, les faits déjà chargés : voir les constructeurs ci-dessous. L'ordre des tests de la spec §4.4 est
// l'ordre de priorité des codes.

const pertinence = () => import('../../server/services/notifications/pertinence')

const HEURE_MS = 3_600_000
const DEBUT = new Date('2026-11-12T09:00:00.000Z')
const PREVU = new Date(DEBUT.getTime() - RAPPEL_VISITEUR_AVANCE_HEURES * HEURE_MS)
const CREE_LE = new Date('2026-11-02T07:00:00.000Z')

function rappel(reservation: Partial<{ statut: string, rappelEmail: boolean, debut: Date, vitrinePubliee: boolean }> | null, surcharge: { occurrence?: string } = {}) {
  return {
    type: 'reservation_visiteur_rappel' as const,
    occurrence: surcharge.occurrence ?? DEBUT.toISOString(),
    createdAt: PREVU,
    reservation: reservation === null ? null : { statut: 'confirmee', rappelEmail: true, debut: DEBUT, vitrinePubliee: true, ...reservation },
  }
}

function resume(utilisateur: Partial<{ emailHebdo: boolean, vitrinePubliee: boolean, destinataire: boolean }> | null) {
  return {
    type: 'utilisateur_resume_hebdo' as const,
    occurrence: '2026-W44',
    createdAt: CREE_LE,
    utilisateur: utilisateur === null ? null : { emailHebdo: true, vitrinePubliee: true, destinataire: true, ...utilisateur },
  }
}

function journee(utilisateur: Partial<{ emailRappelJour: boolean, destinataire: boolean, rendezVousDansJournee: number }> | null) {
  return {
    type: 'utilisateur_rappel_journee' as const,
    occurrence: '2026-11-10',
    createdAt: CREE_LE,
    utilisateur: utilisateur === null ? null : { emailRappelJour: true, destinataire: true, rendezVousDansJournee: 2, ...utilisateur },
  }
}

describe('evaluerPertinence : reservation_visiteur_rappel (CA12 à CA14)', () => {
  it('should allow a confirmed reservation with the reminder asked, on time', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({}), PREVU)).toBeNull()
  })

  it('should allow it up to 6 hours after the planned time, boundary included', async () => {
    const { evaluerPertinence } = await pertinence()
    const limite = new Date(PREVU.getTime() + RAPPEL_VISITEUR_RATTRAPAGE_HEURES * HEURE_MS)

    expect(evaluerPertinence(rappel({}), limite)).toBeNull()
  })

  it('should drop it one millisecond past the catch-up window (RAPPEL_PERIME)', async () => {
    const { evaluerPertinence } = await pertinence()
    const trop = new Date(PREVU.getTime() + RAPPEL_VISITEUR_RATTRAPAGE_HEURES * HEURE_MS + 1)

    expect(evaluerPertinence(rappel({}), trop)).toBe('RAPPEL_PERIME')
  })

  it('should drop it after a 7 hour worker outage (CA13)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({}), new Date(PREVU.getTime() + 7 * HEURE_MS))).toBe('RAPPEL_PERIME')
  })

  it('should drop it once the appointment has started or passed', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({}), DEBUT)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(rappel({}), new Date(DEBUT.getTime() + HEURE_MS))).toBe('RAPPEL_PERIME')
  })

  it('should drop it when the appointment was moved: the occurrence no longer matches debut.toISOString()', async () => {
    const { evaluerPertinence } = await pertinence()
    const deplace = new Date(DEBUT.getTime() + 2 * HEURE_MS)

    expect(evaluerPertinence(rappel({ debut: deplace }), PREVU)).toBe('RAPPEL_PERIME')
  })

  it.each(['en_attente', 'annulee', 'refusee', 'terminee'])('should drop it for a reservation in status %s (RESERVATION_NON_CONFIRMEE, CA12)', async (statut) => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({ statut }), PREVU)).toBe('RESERVATION_NON_CONFIRMEE')
  })

  it('should drop it when the reservation vanished (ENTITE_INTROUVABLE, #102)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel(null), PREVU)).toBe('ENTITE_INTROUVABLE')
  })

  it('should drop it with PREFERENCE_DESACTIVEE when the visitor did not ask for the reminder (arbitrage 7)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({ rappelEmail: false }), PREVU)).toBe('PREFERENCE_DESACTIVEE')
  })

  it('should drop it with VITRINE_NON_PUBLIEE when the vitrine was unpublished since the planning', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({ vitrinePubliee: false }), PREVU)).toBe('VITRINE_NON_PUBLIEE')
  })

  it('should report the unpublished vitrine after the status and the preference, before the lateness', async () => {
    const { evaluerPertinence } = await pertinence()
    const tard = new Date(PREVU.getTime() + 20 * HEURE_MS)

    expect(evaluerPertinence(rappel({ vitrinePubliee: false, statut: 'annulee' }), PREVU)).toBe('RESERVATION_NON_CONFIRMEE')
    expect(evaluerPertinence(rappel({ vitrinePubliee: false, rappelEmail: false }), PREVU)).toBe('PREFERENCE_DESACTIVEE')
    expect(evaluerPertinence(rappel({ vitrinePubliee: false }), tard)).toBe('VITRINE_NON_PUBLIEE')
  })

  it('should report the status before the lateness (priority of the §4.4 table)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(rappel({ statut: 'annulee' }), new Date(PREVU.getTime() + 20 * HEURE_MS))).toBe('RESERVATION_NON_CONFIRMEE')
  })
})

describe('evaluerPertinence : utilisateur_resume_hebdo (CA31, CA32)', () => {
  it('should allow a published vitrine, the preference on, a reachable recipient, within the catch-up', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(resume({}), CREE_LE)).toBeNull()
  })

  it('should allow it up to 6 hours after the line was created (boundary included) and drop it right after', async () => {
    const { evaluerPertinence } = await pertinence()
    const limite = new Date(CREE_LE.getTime() + RESUME_RATTRAPAGE_HEURES * HEURE_MS)

    expect(evaluerPertinence(resume({}), limite)).toBeNull()
    expect(evaluerPertinence(resume({}), new Date(limite.getTime() + 1))).toBe('RAPPEL_PERIME')
  })

  it('should drop it for a deleted account (CA32)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(resume(null), CREE_LE)).toBe('ENTITE_INTROUVABLE')
  })

  it('should drop it when the user switched the summary off after the planning', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(resume({ emailHebdo: false }), CREE_LE)).toBe('PREFERENCE_DESACTIVEE')
  })

  it('should drop it when the vitrine was unpublished after the planning (CA31)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(resume({ vitrinePubliee: false }), CREE_LE)).toBe('VITRINE_NON_PUBLIEE')
  })

  it('should drop it when there is no recipient left (#101)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(resume({ destinataire: false }), CREE_LE)).toBe('DESTINATAIRE_ABSENT')
  })

  it('should follow the §4.4 priority: preference, then vitrine, then lateness, then recipient', async () => {
    const { evaluerPertinence } = await pertinence()
    const tard = new Date(CREE_LE.getTime() + 20 * HEURE_MS)

    expect(evaluerPertinence(resume({ emailHebdo: false, vitrinePubliee: false }), CREE_LE)).toBe('PREFERENCE_DESACTIVEE')
    expect(evaluerPertinence(resume({ vitrinePubliee: false }), tard)).toBe('VITRINE_NON_PUBLIEE')
    expect(evaluerPertinence(resume({ destinataire: false }), tard)).toBe('RAPPEL_PERIME')
  })
})

describe('evaluerPertinence : utilisateur_rappel_journee (CA21, CA22, CA24)', () => {
  it('should allow a user with the preference on and appointments today', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(journee({}), CREE_LE)).toBeNull()
  })

  it('should allow it up to 3 hours after creation (boundary included) and drop it right after', async () => {
    const { evaluerPertinence } = await pertinence()
    const limite = new Date(CREE_LE.getTime() + RAPPEL_JOURNEE_RATTRAPAGE_HEURES * HEURE_MS)

    expect(evaluerPertinence(journee({}), limite)).toBeNull()
    expect(evaluerPertinence(journee({}), new Date(limite.getTime() + 1))).toBe('RAPPEL_PERIME')
  })

  it('should drop it when the only appointment was cancelled meanwhile (AUCUN_RENDEZ_VOUS, CA22)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(journee({ rendezVousDansJournee: 0 }), CREE_LE)).toBe('AUCUN_RENDEZ_VOUS')
  })

  it('should allow a single remaining appointment', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(journee({ rendezVousDansJournee: 1 }), CREE_LE)).toBeNull()
  })

  it('should drop it when the preference was switched off before the sending (CA24)', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(journee({ emailRappelJour: false }), CREE_LE)).toBe('PREFERENCE_DESACTIVEE')
  })

  it('should drop it for a deleted account and for a missing recipient', async () => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence(journee(null), CREE_LE)).toBe('ENTITE_INTROUVABLE')
    expect(evaluerPertinence(journee({ destinataire: false }), CREE_LE)).toBe('DESTINATAIRE_ABSENT')
  })

  it('should follow the §4.4 priority: preference, lateness, appointments, recipient', async () => {
    const { evaluerPertinence } = await pertinence()
    const tard = new Date(CREE_LE.getTime() + 10 * HEURE_MS)

    expect(evaluerPertinence(journee({ emailRappelJour: false, rendezVousDansJournee: 0 }), CREE_LE)).toBe('PREFERENCE_DESACTIVEE')
    expect(evaluerPertinence(journee({ rendezVousDansJournee: 0 }), tard)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(journee({ rendezVousDansJournee: 0, destinataire: false }), CREE_LE)).toBe('AUCUN_RENDEZ_VOUS')
  })
})

describe('evaluerPertinence : types historiques (#102, pas de régression)', () => {
  it.each([
    'reservation_professionnel_nouvelle',
    'reservation_visiteur_recue',
    'reservation_visiteur_confirmee',
    'reservation_visiteur_annulee',
    'reservation_visiteur_refusee',
    'demande_professionnel_nouvelle',
    'demande_visiteur_recue',
    'message_professionnel_nouvelle',
  ])('should never cancel %s: it is always sent as before S9', async (type) => {
    const { evaluerPertinence } = await pertinence()

    expect(evaluerPertinence({ type, occurrence: '', createdAt: CREE_LE }, new Date(CREE_LE.getTime() + 400 * 24 * HEURE_MS))).toBeNull()
  })
})
