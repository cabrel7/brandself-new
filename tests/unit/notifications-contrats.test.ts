import { describe, expect, it } from 'vitest'
import { ERROR_MESSAGES } from '../../server/exceptions/http'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import { loadEnv } from '../../shared/env'
import { JOBS, TRANSACTIONAL_EMAIL_TYPES } from '../../shared/jobs'
import { DESABONNEMENT_ACTION_LIMIT, DESABONNEMENT_APERCU_LIMIT } from '../../shared/limites'
import * as N from '../../shared/notifications'
import { isReserved } from '../../shared/reserved'
import { validateUsername } from '../../shared/schemas/username'

// S9 §3 : contrats de shared/ (valeurs réglables, types d'e-mails, jobs, erreurs, limiteur, mot réservé, env).
// Les valeurs sont figées ici parce qu'elles sont des DÉCISIONS (#81 à #102) : une modification doit être volontaire.

const BASE_ENV = {
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
}
const PRODUCTION = {
  ...BASE_ENV,
  NODE_ENV: 'production',
  RESEND_API_KEY: 're_test_cle_resend',
  EMAIL_EXPEDITEUR: 'Brandself <bonjour@brandself.io>',
  NUXT_PUBLIC_SITE_URL: 'https://brandself.io',
}

describe('shared/notifications.ts : valeurs décidées (#84, #86, #87, #88, #92, #97)', () => {
  it('should pin the visitor reminder parameters (24 h, 6 h gap, 6 h catch-up, 2 h minimum notice)', () => {
    expect(N.RAPPEL_VISITEUR_AVANCE_HEURES).toBe(24)
    expect(N.RAPPEL_VISITEUR_ECART_MIN_HEURES).toBe(6)
    expect(N.RAPPEL_VISITEUR_RATTRAPAGE_HEURES).toBe(6)
    expect(N.RAPPEL_VISITEUR_PREAVIS_MIN_HEURES).toBe(2)
  })

  it('should pin the day reminder (07:00 local, 3 h catch-up, 2 statuses, 20 lines)', () => {
    expect(N.RAPPEL_JOURNEE_HEURE_LOCALE).toBe(7)
    expect(N.RAPPEL_JOURNEE_RATTRAPAGE_HEURES).toBe(3)
    expect([...N.RAPPEL_JOURNEE_STATUTS]).toEqual(['confirmee', 'en_attente'])
    expect(N.RAPPEL_JOURNEE_MAX_LIGNES).toBe(20)
  })

  it('should pin the weekly summary (Monday 08:00 local, 6 h catch-up, 7 days, one relational e-mail per week)', () => {
    expect(N.RESUME_JOUR_ISO).toBe(1)
    expect(N.RESUME_HEURE_LOCALE).toBe(8)
    expect(N.RESUME_RATTRAPAGE_HEURES).toBe(6)
    expect(N.RESUME_PERIODE_JOURS).toBe(7)
    expect(N.RELATIONNEL_MAX_PAR_SEMAINE).toBe(1)
  })

  it('should pin the schedulers, the retention, the batch size and the send rate', () => {
    expect(N.NOTIFICATIONS_SCHEDULER_ID).toBe('notifications-planifier')
    expect(N.NOTIFICATIONS_TICK_CRON).toBe('*/5 * * * *')
    expect(N.NOTIFICATIONS_TICK_TZ).toBe('UTC')
    expect(N.NOTIFICATIONS_PURGE_SCHEDULER_ID).toBe('notifications-purger')
    expect(N.NOTIFICATIONS_PURGE_CRON).toBe('30 3 * * *')
    expect(N.NOTIFICATIONS_PURGE_TZ).toBe('UTC')
    expect(N.OUTBOX_RETENTION_JOURS).toBe(90)
    expect(N.PLANIFICATION_LOT_UTILISATEURS).toBe(500)
    expect(N.EMAILS_DEBIT_MAX).toBe(2)
    expect(N.EMAILS_DEBIT_FENETRE_MS).toBe(1000)
  })

  it('should pin the unsubscribe token (v1, 90 days, HKDF info)', () => {
    expect(N.DESABONNEMENT_JETON_VERSION).toBe('v1')
    expect(N.DESABONNEMENT_JETON_VALIDITE_JOURS).toBe(90)
    expect(N.DESABONNEMENT_HKDF_INFO).toBe('brandself-desabonnement-v1')
    expect(N.DESABONNEMENT_JETON_LONGUEUR_MIN).toBe(20)
    expect(N.DESABONNEMENT_JETON_LONGUEUR_MAX).toBe(512)
  })

  it('should keep every local window inside one day (dansFenetre compares minutes since midnight)', () => {
    expect(N.RAPPEL_JOURNEE_HEURE_LOCALE + N.RAPPEL_JOURNEE_RATTRAPAGE_HEURES).toBeLessThanOrEqual(24)
    expect(N.RESUME_HEURE_LOCALE + N.RESUME_RATTRAPAGE_HEURES).toBeLessThanOrEqual(24)
  })

  it('should expose the default suggestion of the summary with its three texts', () => {
    expect(N.SUGGESTION_RESUME_DEFAUT).toEqual({
      titre: 'Demandez un témoignage',
      texte: 'Écrivez à un client satisfait : un avis rassure vos prochains visiteurs avant de réserver.',
      chemin: '/studio/temoignages/nouveau',
    })
  })

  it('should list two preferences, two categories and five statuses', () => {
    expect([...N.PREFERENCES_EMAIL]).toEqual(['email_hebdo', 'email_rappel_jour'])
    expect([...N.EMAIL_CATEGORIES]).toEqual(['transactionnel', 'relationnel'])
    expect([...N.EMAIL_STATUTS]).toEqual(['en_attente', 'en_cours', 'envoye', 'echec', 'annule'])
  })

  it('should list nine cancellation codes that fit the erreur_code CHECK (A-Z0-9_, 1 to 64 characters)', () => {
    expect([...N.CODES_ANNULATION].sort()).toEqual([
      'AUCUN_RENDEZ_VOUS',
      'DESTINATAIRE_ABSENT',
      'ENTITE_INTROUVABLE',
      'PLAFOND_RELATIONNEL',
      'PREFERENCE_DESACTIVEE',
      'RAPPEL_PERIME',
      'RESERVATION_ANNULEE',
      'RESERVATION_NON_CONFIRMEE',
      'VITRINE_NON_PUBLIEE',
    ])
    for (const code of N.CODES_ANNULATION) {
      expect(code).toMatch(/^[A-Z0-9_]{1,64}$/)
    }
  })

  it('should give both preferences a French label usable in « Ne plus recevoir … ? »', () => {
    expect(N.PREFERENCES_EMAIL_LIBELLES.email_hebdo).toEqual({ titre: 'Résumé de la semaine', objet: 'le résumé de la semaine' })
    expect(N.PREFERENCES_EMAIL_LIBELLES.email_rappel_jour).toEqual({ titre: 'Rendez-vous du jour', objet: 'les rendez-vous du jour' })
  })
})

describe('shared/jobs.ts : types d’e-mails et jobs (#81, #82)', () => {
  it('should add the three planned e-mail types after the eight historical ones, without duplicates', () => {
    expect([...TRANSACTIONAL_EMAIL_TYPES]).toEqual([
      'reservation_professionnel_nouvelle',
      'reservation_visiteur_recue',
      'reservation_visiteur_confirmee',
      'reservation_visiteur_annulee',
      'reservation_visiteur_refusee',
      'demande_professionnel_nouvelle',
      'demande_visiteur_recue',
      'message_professionnel_nouvelle',
      'reservation_visiteur_rappel',
      'utilisateur_resume_hebdo',
      'utilisateur_rappel_journee',
    ])
    expect(new Set(TRANSACTIONAL_EMAIL_TYPES).size).toBe(TRANSACTIONAL_EMAIL_TYPES.length)
  })

  it('should prefix every type with the entity it belongs to (the coherence CHECK reads the prefix)', () => {
    for (const type of TRANSACTIONAL_EMAIL_TYPES) {
      expect(type).toMatch(/^(reservation|demande|message|utilisateur)_/)
    }
    expect(TRANSACTIONAL_EMAIL_TYPES.filter((type) => type.startsWith('utilisateur_'))).toEqual([
      'utilisateur_resume_hebdo',
      'utilisateur_rappel_journee',
    ])
  })

  it('should declare the two new jobs with the scheduler identifiers of notifications.ts', () => {
    expect(JOBS.planifierNotifications).toBe('notifications-planifier')
    expect(JOBS.purgerNotifications).toBe('notifications-purger')
    expect(JOBS.planifierNotifications).toBe(N.NOTIFICATIONS_SCHEDULER_ID)
    expect(JOBS.purgerNotifications).toBe(N.NOTIFICATIONS_PURGE_SCHEDULER_ID)
  })
})

describe('shared/erreurs.ts et server/exceptions/http.ts', () => {
  it.each([
    ['JETON_INVALIDE', 404],
    ['JETON_EXPIRE', 410],
    ['VITRINE_NON_PUBLIEE', 422],
    ['ETAPE_INCONNUE', 422],
  ] as const)('should declare %s with HTTP status %i and a French message', (code, statut) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
    expect(ERROR_MESSAGES[code].length).toBeGreaterThan(5)
  })

  it('should keep one status and one message per code (no orphan)', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort())
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort())
  })

  it('should not reveal whether a token was ever valid in the INVALIDE message (generic wording)', () => {
    expect(ERROR_MESSAGES.JETON_INVALIDE).not.toMatch(/expir|utilisateur|compte|adresse/i)
  })
})

describe('shared/limites.ts et shared/reserved.ts', () => {
  it('should limit the unsubscribe action (POST) to 20 per 60 s per IP and the preview (GET) to 60 per 60 s, separately', () => {
    expect(DESABONNEMENT_ACTION_LIMIT).toEqual({ limit: 20, windowS: 60 })
    expect(DESABONNEMENT_APERCU_LIMIT).toEqual({ limit: 60, windowS: 60 })
  })

  it('should reserve « desabonnement » as a username (route /desabonnement, #3.9)', () => {
    expect(isReserved('desabonnement')).toBe(true)
    expect(validateUsername('desabonnement').success).toBe(false)
    expect(validateUsername('DESABONNEMENT').success).toBe(false)
  })

  it('should not reserve names that merely contain it', () => {
    expect(validateUsername('desabonnement-pro').success).toBe(true)
    expect(validateUsername('mon-desabonnement').success).toBe(true)
  })
})

describe('shared/env.ts : EMAIL_EXPEDITEUR et NUXT_PUBLIC_SITE_URL (#91)', () => {
  it('should fall back, outside production, to the Resend test sender and to http://localhost:3000', () => {
    const env = loadEnv(BASE_ENV)

    expect(env.EMAIL_EXPEDITEUR).toBe(N.EMAIL_EXPEDITEUR_DEV_DEFAUT)
    expect(env.NUXT_PUBLIC_SITE_URL).toBe(N.SITE_URL_DEV_DEFAUT)
  })

  it('should require both in production and name each missing variable', () => {
    expect(() => loadEnv({ ...PRODUCTION, EMAIL_EXPEDITEUR: undefined })).toThrow(/EMAIL_EXPEDITEUR/)
    expect(() => loadEnv({ ...PRODUCTION, NUXT_PUBLIC_SITE_URL: undefined })).toThrow(/NUXT_PUBLIC_SITE_URL/)
    expect(() => loadEnv({ ...PRODUCTION, EMAIL_EXPEDITEUR: '', NUXT_PUBLIC_SITE_URL: '' })).toThrow(/EMAIL_EXPEDITEUR[\s\S]*NUXT_PUBLIC_SITE_URL/)
  })

  it('should refuse a non-https site URL in production but accept it in development', () => {
    expect(() => loadEnv({ ...PRODUCTION, NUXT_PUBLIC_SITE_URL: 'http://brandself.io' })).toThrow(/https/)
    expect(loadEnv({ ...BASE_ENV, NUXT_PUBLIC_SITE_URL: 'http://localhost:4000' }).NUXT_PUBLIC_SITE_URL).toBe('http://localhost:4000')
  })

  it('should accept a complete production configuration', () => {
    const env = loadEnv(PRODUCTION)

    expect(env.EMAIL_EXPEDITEUR).toBe('Brandself <bonjour@brandself.io>')
    expect(env.NUXT_PUBLIC_SITE_URL).toBe('https://brandself.io')
  })

  it('should drop trailing slashes of the site URL (links are built as `${site}/chemin`)', () => {
    expect(loadEnv({ ...PRODUCTION, NUXT_PUBLIC_SITE_URL: 'https://brandself.io/' }).NUXT_PUBLIC_SITE_URL).toBe('https://brandself.io')
    expect(loadEnv({ ...PRODUCTION, NUXT_PUBLIC_SITE_URL: 'https://brandself.io///' }).NUXT_PUBLIC_SITE_URL).toBe('https://brandself.io')
  })

  it.each(['pas-une-url', 'brandself.io', 'x y'])('should refuse the site URL %j', (valeur) => {
    expect(() => loadEnv({ ...BASE_ENV, NUXT_PUBLIC_SITE_URL: valeur })).toThrow(/NUXT_PUBLIC_SITE_URL/)
  })

  it.each(['ftp://brandself.io', 'javascript:alert(1)', 'http://brandself.io'])('should refuse the non-https site URL %j in production', (valeur) => {
    expect(() => loadEnv({ ...PRODUCTION, NUXT_PUBLIC_SITE_URL: valeur })).toThrow(/NUXT_PUBLIC_SITE_URL/)
  })

  it('should treat an empty variable as absent so a copied .env.example boots (EMAIL_EXPEDITEUR= and NUXT_PUBLIC_SITE_URL=)', () => {
    const env = loadEnv({ ...BASE_ENV, EMAIL_EXPEDITEUR: '', NUXT_PUBLIC_SITE_URL: '' })

    expect(env.EMAIL_EXPEDITEUR).toBe(N.EMAIL_EXPEDITEUR_DEV_DEFAUT)
    expect(env.NUXT_PUBLIC_SITE_URL).toBe(N.SITE_URL_DEV_DEFAUT)
  })

  it('should refuse a sender that is too short', () => {
    expect(() => loadEnv({ ...BASE_ENV, EMAIL_EXPEDITEUR: 'ab' })).toThrow(/EMAIL_EXPEDITEUR/)
  })
})

describe('étiquettes d’occurrence : compatibles avec le CHECK de la base', () => {
  const MOTIF = /^[0-9A-Z:.-]*$/
  const LONGUEUR_MAX = 32

  it.each([
    ['rappel visiteur (début en ISO UTC)', new Date('2026-11-12T09:00:00.000Z').toISOString()],
    ['rendez-vous du jour', '2026-11-10'],
    ['résumé (semaine ISO)', '2026-W44'],
  ])('should accept the occurrence of %s', (_libelle, occurrence) => {
    expect(occurrence).toMatch(MOTIF)
    expect(occurrence.length).toBeLessThanOrEqual(LONGUEUR_MAX)
    expect(occurrence).not.toBe('')
  })
})
