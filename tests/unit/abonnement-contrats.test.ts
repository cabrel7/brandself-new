import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES, UnauthorizedError, ContentTooLargeError, ForbiddenError, ServiceUnavailableError } from '../../server/exceptions/http'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import {
  FILE_EMAILS_LEGACY,
  FILE_EMAILS_NOTIFICATIONS,
  FILE_IA,
  FILE_MAINTENANCE,
  FILE_MESSAGES_AUTH,
  FILE_PAIEMENTS,
  FILE_SYSTEM,
  JOBS,
  PAIEMENT_EXPIRATION_MINUTES,
  PAIEMENTS_CONCURRENCE_WORKER,
  PAIEMENTS_SCHEDULER_ID,
  PAIEMENTS_TICK_MS,
  PAIEMENTS_VERIFICATION_CALENDRIER_S,
  PAIEMENTS_VERIFICATION_LOT,
} from '../../shared/jobs'
import {
  KPAY_APPELS_MAX_PAR_MINUTE,
  PAIEMENT_INIT_LIMIT_NUMERO,
  PAIEMENT_INIT_LIMIT_UTILISATEUR,
  PAIEMENT_SUIVI_LIMIT,
  PAIEMENTS_OUVERTS_MAX,
  WEBHOOK_CORPS_MAX_OCTETS,
} from '../../shared/limites'
import {
  CODE_ECHEC_FORMAT,
  CODES_ANOMALIE,
  FOURNISSEUR_FORMAT,
  FOURNISSEURS_PAIEMENT,
  MESSAGES_ECHEC,
  messageEchec,
  METHODE_FORMAT,
  METHODES_PAIEMENT,
  PAIEMENT_RELANCE_APRES_S,
  PAIEMENT_STATUTS,
  PAIEMENT_STATUTS_OUVERTS,
  PAIEMENT_SUIVI_INTERVALLE_MS,
  PAIEMENT_SUIVI_MAX_MS,
  TELEPHONE_MASQUE_CARACTERE,
  DEVISES_EXPOSANT,
} from '../../shared/paiements'
import {
  ABONNEMENT_CHEMIN,
  ABONNEMENT_GRACE_JOURS,
  ABONNEMENT_RAPPELS_JOURS,
  ETATS_ABONNEMENT,
  interpolerLimite,
  LIMITE_ACTION,
  LIMITE_MESSAGES,
  PERIODE_MISE_EN_AVANT,
  PERIODES_MOIS,
  PLAN_IDS,
  RESSOURCES_MASQUABLES,
  RESSOURCES_QUOTA,
} from '../../shared/plans'
import { DEVISES } from '../../shared/compte'
import { MOTIFS_REPLI, MOTIFS_REPLI_TRANSITOIRES } from '../../shared/ia'
import { MS_PAR_MINUTE } from '../../shared/temps'

// S10 §3 : contrats partagés (plans, paiements, files, limites, erreurs, motifs IA).

describe('shared/plans.ts', () => {
  it('should list the plans, states, resources and periods of the spec', () => {
    expect([...PLAN_IDS]).toEqual(['gratuit', 'payant'])
    expect([...ETATS_ABONNEMENT]).toEqual(['gratuit', 'actif', 'grace'])
    expect([...RESSOURCES_QUOTA]).toEqual(['services', 'realisations', 'temoignages', 'reservations_mois', 'generations_ia_mois'])
    expect([...RESSOURCES_MASQUABLES]).toEqual(['services', 'realisations', 'temoignages'])
    expect([...PERIODES_MOIS]).toEqual([1, 3, 12])
    expect(PERIODES_MOIS).toContain(PERIODE_MISE_EN_AVANT)
    expect(ABONNEMENT_GRACE_JOURS).toBe(7)
    expect([...ABONNEMENT_RAPPELS_JOURS]).toEqual([7, 3, 0])
  })

  it('should carry a title and a text for every quota resource, with the limit placeholder', () => {
    for (const ressource of RESSOURCES_QUOTA) {
      expect(LIMITE_MESSAGES[ressource].titre.length).toBeGreaterThan(5)
      expect(LIMITE_MESSAGES[ressource].texte).toContain('{limite}')
    }
    expect(LIMITE_MESSAGES.reservations_mois.texte).toContain('{date}')
  })

  it('should keep the user-facing vocabulary (vitrine, no espace/bloc/module/widget/section)', () => {
    const textes = RESSOURCES_QUOTA.map((r) => `${LIMITE_MESSAGES[r].titre} ${LIMITE_MESSAGES[r].texte}`).join(' ')

    expect(textes).not.toMatch(/\b(espace|bloc|module|widget|section)s?\b/i)
    expect(LIMITE_MESSAGES.services.texte).toContain('vitrine')
  })

  it('should interpolate the limit and the date, and leave other texts untouched', () => {
    expect(interpolerLimite(LIMITE_MESSAGES.services.texte, { limite: 3 })).toMatch(/^Vous avez atteint 3 services, la limite du plan gratuit\./)
    const reservations = interpolerLimite(LIMITE_MESSAGES.reservations_mois.texte, { limite: 10, date: '1 décembre' })
    expect(reservations).toContain('10 réservations')
    expect(reservations).toContain('avant le 1 décembre')
    expect(reservations).not.toContain('{')
    expect(interpolerLimite('Aucun marqueur', { limite: 3 })).toBe('Aucun marqueur')
  })

  it('should point the unlock action to the subscription card', () => {
    expect(LIMITE_ACTION).toEqual({ libelle: 'Voir l’abonnement', chemin: '/studio/compte#abonnement' })
    expect(ABONNEMENT_CHEMIN).toBe(LIMITE_ACTION.chemin)
  })
})

describe('shared/paiements.ts', () => {
  it('should declare K-PAY as the only provider, with card declared but not active', () => {
    expect([...FOURNISSEURS_PAIEMENT]).toEqual(['kpay'])
    expect([...METHODES_PAIEMENT]).toEqual(['mobile_money', 'carte'])
    for (const f of FOURNISSEURS_PAIEMENT) expect(f).toMatch(FOURNISSEUR_FORMAT)
    for (const m of METHODES_PAIEMENT) expect(m).toMatch(METHODE_FORMAT)
  })

  it('should list the seven payment statuses, open ones included', () => {
    expect([...PAIEMENT_STATUTS]).toEqual(['cree', 'en_attente', 'reussi', 'echoue', 'annule', 'expire', 'anomalie'])
    for (const s of PAIEMENT_STATUTS_OUVERTS) expect(PAIEMENT_STATUTS).toContain(s)
  })

  it('should keep anomaly codes within the CHECK format and cover the spec list', () => {
    expect([...CODES_ANOMALIE]).toEqual(['MONTANT_INCOHERENT', 'ID_INCOHERENT', 'DEVISE_INCOHERENTE', 'PAIEMENT_INCONNU', 'REMBOURSE', 'EVENEMENT_NON_GERE'])
    for (const code of [...CODES_ANOMALIE, ...Object.keys(MESSAGES_ECHEC)]) expect(code).toMatch(CODE_ECHEC_FORMAT)
  })

  it('should know the decimals of every currency the app prices', () => {
    for (const devise of DEVISES) expect(DEVISES_EXPOSANT[devise]).toBeDefined()
    expect(DEVISES_EXPOSANT.XAF).toBe(0)
  })

  it('should map failure codes to a French message and fall back to the default one', () => {
    expect(messageEchec('PAYER_NOT_FOUND')).toBe('Ce numéro n’a pas de compte Mobile Money chez cet opérateur. Vérifiez le numéro et l’opérateur.')
    expect(messageEchec('EXPIRE')).toContain('activé automatiquement')
    expect(messageEchec(null)).toBe('Le paiement n’a pas abouti. Vous pouvez réessayer.')
    expect(messageEchec('CODE_INCONNU')).toBe(messageEchec(null))
  })

  it.each(['__proto__', 'constructor', 'toString', 'hasOwnProperty'])('should never read the prototype for the failure code %s', (code) => {
    expect(messageEchec(code)).toBe(messageEchec(null))
  })

  it('should poll our own API every 5 s for 3 minutes at most and allow a retry after 60 s', () => {
    expect(PAIEMENT_SUIVI_INTERVALLE_MS).toBe(5_000)
    expect(PAIEMENT_SUIVI_MAX_MS).toBe(180_000)
    expect(PAIEMENT_RELANCE_APRES_S).toBe(60)
    expect(TELEPHONE_MASQUE_CARACTERE).toBe('•')
  })
})

describe('shared/jobs.ts et shared/limites.ts : paiements', () => {
  it('should give the payment queue its own name', () => {
    const noms = [FILE_SYSTEM, FILE_MAINTENANCE, FILE_MESSAGES_AUTH, FILE_EMAILS_NOTIFICATIONS, FILE_IA, FILE_EMAILS_LEGACY, FILE_PAIEMENTS]

    expect(FILE_PAIEMENTS).toBe('paiements')
    expect(new Set(noms).size).toBe(noms.length)
    expect(PAIEMENTS_CONCURRENCE_WORKER).toBe(1)
  })

  it('should declare the verification job and its scheduler', () => {
    expect(JOBS.verifierPaiements).toBe('paiements-verifier')
    expect(JOBS.verifierPaiements).toBe(PAIEMENTS_SCHEDULER_ID)
    expect(PAIEMENTS_TICK_MS).toBe(10_000)
    expect(PAIEMENTS_VERIFICATION_LOT).toBe(5)
    expect([...PAIEMENTS_VERIFICATION_CALENDRIER_S]).toEqual([15, 30, 60, 120, 300])
    expect(PAIEMENT_EXPIRATION_MINUTES).toBe(15)
  })

  it('should keep the worst-case K-PAY call rate under the global budget (the budget is below the provider cap of 100)', () => {
    const verificationsParMinute = (PAIEMENTS_VERIFICATION_LOT * MS_PAR_MINUTE) / PAIEMENTS_TICK_MS

    expect(verificationsParMinute).toBeLessThan(KPAY_APPELS_MAX_PAR_MINUTE)
    expect(KPAY_APPELS_MAX_PAR_MINUTE).toBe(60)
  })

  it('should set the abuse limits of the spec', () => {
    expect(PAIEMENT_INIT_LIMIT_UTILISATEUR).toEqual({ limit: 5, windowS: 900 })
    expect(PAIEMENT_INIT_LIMIT_NUMERO).toEqual({ limit: 3, windowS: 900 })
    expect(PAIEMENT_SUIVI_LIMIT).toEqual({ limit: 60, windowS: 60 })
    expect(PAIEMENTS_OUVERTS_MAX).toBe(2)
    expect(WEBHOOK_CORPS_MAX_OCTETS).toBe(16_384)
  })
})

describe('shared/ia.ts : motif quota_atteint (#126)', () => {
  it('should be a transient fallback reason (a new request after the quota resets must call the provider)', () => {
    expect(MOTIFS_REPLI).toContain('quota_atteint')
    expect(MOTIFS_REPLI_TRANSITOIRES).toContain('quota_atteint')
  })
})

describe('shared/erreurs.ts et server/exceptions/http.ts : paiement et plans', () => {
  it.each([
    ['LIMITE_PLAN_ATTEINTE', 403],
    ['RESERVATIONS_INDISPONIBLES', 409],
    ['PAIEMENT_INDISPONIBLE', 503],
    ['FOURNISSEUR_INDISPONIBLE', 503],
    ['MOYEN_PAIEMENT_INVALIDE', 422],
    ['DEVISE_NON_PAYABLE', 422],
    ['TELEPHONE_INVALIDE', 422],
    ['PAIEMENT_EN_COURS', 409],
    ['PAIEMENT_REFUSE', 422],
    ['PAIEMENT_INTROUVABLE', 404],
    ['SIGNATURE_INVALIDE', 401],
    ['FOURNISSEUR_INCONNU', 404],
    ['WEBHOOK_NON_CONFIGURE', 503],
    ['CORPS_TROP_GROS', 413],
    ['CORPS_ILLISIBLE', 400],
  ] as const)('should declare %s with HTTP status %i and a message', (code, statut) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
    expect(ERROR_MESSAGES[code].length).toBeGreaterThan(5)
  })

  it('should keep one status and one message per code (no orphan)', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort())
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort())
  })

  it('should never mention a plan to the visitor when reservations are unavailable', () => {
    expect(ERROR_MESSAGES.RESERVATIONS_INDISPONIBLES).not.toMatch(/plan|abonnement|gratuit/i)
    expect(ERROR_MESSAGES.RESERVATIONS_INDISPONIBLES).toBe(
      'Ce professionnel ne prend plus de nouvelle réservation en ligne ce mois-ci. Vous pouvez le contacter directement.',
    )
  })

  it('should keep the webhook error messages minimal (no cause, no internals)', () => {
    for (const code of ['SIGNATURE_INVALIDE', 'FOURNISSEUR_INCONNU', 'WEBHOOK_NON_CONFIGURE', 'CORPS_TROP_GROS', 'CORPS_ILLISIBLE'] as const) {
      expect(ERROR_MESSAGES[code]).not.toMatch(/signature (attendue|calculée)|secret|hmac|kpay/i)
    }
  })

  it('should carry the matching status in the typed exceptions', () => {
    const limite = new ForbiddenError('LIMITE_PLAN_ATTEINTE', { ressource: 'services', limite: 3, utilise: 3, plan: 'gratuit' })
    expect(limite.status).toBe(403)
    expect(limite.data).toEqual({ ressource: 'services', limite: 3, utilise: 3, plan: 'gratuit' })
    expect(new UnauthorizedError('SIGNATURE_INVALIDE').status).toBe(401)
    expect(new ContentTooLargeError('CORPS_TROP_GROS').status).toBe(413)
    const indisponible = new ServiceUnavailableError('FOURNISSEUR_INDISPONIBLE', { retryAfter: 30 })
    expect(indisponible.status).toBe(503)
    expect(indisponible.data).toEqual({ retryAfter: 30 })
  })
})
