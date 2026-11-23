import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { instantConstat } from '../../server/services/essai'
import { planifierPurgeEssaiEmpreintes, essaiEmpreintesJobOptions } from '../../server/jobs/essai-empreintes'
import { buildTransactionalEmail } from '../../server/services/emails/contenus'
import type { EssaiConstatContent } from '../../server/services/emails/notifications-contenus'
import { evaluerPertinence } from '../../server/services/notifications/pertinence'
import type { EntreeEssaiConstat } from '../../server/services/notifications/pertinence'
import {
  ESSAI_CONSTAT_EMAIL_TYPE,
  ESSAI_CONSTAT_PEREMPTION_JOURS,
  ESSAI_EMAIL_TYPES,
  ESSAI_EMPREINTES_CONSERVATION_MOIS,
  ESSAI_OCCURRENCE_PREFIXE,
} from '../../shared/essai'
import { JOBS, TRANSACTIONAL_EMAIL_TYPES, ESSAI_EMPREINTES_PURGE_CRON, ESSAI_EMPREINTES_PURGE_SCHEDULER_ID } from '../../shared/jobs'
import { PREFERENCES_EMAIL_LIBELLES } from '../../shared/notifications'

// E1 : constat de fin d'essai (e-mail de service) et purge des empreintes. Règles PURES, sans base.

/** Fin EXCLUSIVE d'un essai : le dernier instant payé est le 7 décembre 2026 à 10 h 59 (Douala, UTC+1). */
const FIN_ESSAI = new Date('2026-12-07T10:00:00.000Z')
const OCCURRENCE = `${ESSAI_OCCURRENCE_PREFIXE}${FIN_ESSAI.toISOString()}`
const JOUR_MS = 86_400_000
const SITE = 'https://jesuis.pro'
const MOTS_INTERDITS = /\b(espaces?|blocs?|modules?|widgets?|sections?)\b/i
const TUTOIEMENT = /\b(tu|toi|ton|ta|tes|t')\b/i

describe('instantConstat : lendemain du dernier jour, 9 h locale du compte', () => {
  it('should be 9 h Douala the day after the last day of the trial (Douala is UTC+1)', () => {
    expect(instantConstat(FIN_ESSAI, 'Africa/Douala').toISOString()).toBe('2026-12-08T08:00:00.000Z')
  })

  it('should follow the time zone of the account (Paris is UTC+1 in December: same instant as Douala)', () => {
    expect(instantConstat(FIN_ESSAI, 'Europe/Paris').toISOString()).toBe('2026-12-08T08:00:00.000Z')
    expect(instantConstat(FIN_ESSAI, 'America/Montreal').toISOString()).toBe('2026-12-08T14:00:00.000Z')
  })

  it('should fall back to Africa/Douala when the time zone is invalid', () => {
    expect(instantConstat(FIN_ESSAI, 'Pas/UneZone').toISOString()).toBe(instantConstat(FIN_ESSAI, 'Africa/Douala').toISOString())
  })

  it('should treat the end as EXCLUSIVE: an end at local midnight sends on the day that starts at that midnight', () => {
    const minuitDouala = new Date('2026-12-07T23:00:00.000Z')

    expect(instantConstat(minuitDouala, 'Africa/Douala').toISOString()).toBe('2026-12-08T08:00:00.000Z')
  })

  it('should always be strictly after the end of the trial', () => {
    for (const fin of ['2026-12-07T08:00:00.000Z', '2026-12-07T10:00:00.000Z', '2026-12-07T22:59:59.999Z', '2026-12-07T23:00:00.000Z']) {
      expect(instantConstat(new Date(fin), 'Africa/Douala').getTime()).toBeGreaterThan(new Date(fin).getTime())
    }
  })
})

describe('evaluerPertinence : constat de fin d\'essai', () => {
  const ENVOI = new Date('2026-12-08T08:05:00.000Z')
  const abonnementOk = { origine: 'essai', expireLe: FIN_ESSAI, destinataire: true }

  function entree(abonnement: Partial<NonNullable<EntreeEssaiConstat['abonnement']>> | null = {}, surcharges: Partial<EntreeEssaiConstat> = {}): EntreeEssaiConstat {
    return {
      type: ESSAI_CONSTAT_EMAIL_TYPE,
      occurrence: OCCURRENCE,
      createdAt: new Date('2026-11-23T10:00:00.000Z'),
      abonnement: abonnement === null ? null : { ...abonnementOk, ...abonnement },
      ...surcharges,
    }
  }

  it('should let the report go the day after the end when the trial was not converted', () => {
    expect(evaluerPertinence(entree(), ENVOI)).toBeNull()
  })

  it('should cancel with ENTITE_INTROUVABLE when the subscription row is gone', () => {
    expect(evaluerPertinence(entree(null), ENVOI)).toBe('ENTITE_INTROUVABLE')
  })

  it('should cancel with ABONNEMENT_RENOUVELE when the end date changed (payment or days offered)', () => {
    const prolonge = new Date(FIN_ESSAI.getTime() + 30 * JOUR_MS)

    expect(evaluerPertinence(entree({ origine: 'paiement', expireLe: prolonge }), ENVOI)).toBe('ABONNEMENT_RENOUVELE')
    expect(evaluerPertinence(entree({ expireLe: prolonge }), ENVOI)).toBe('ABONNEMENT_RENOUVELE')
  })

  it('should cancel with ESSAI_TERMINE when the origin is no longer a trial on the same end date', () => {
    expect(evaluerPertinence(entree({ origine: 'paiement' }), ENVOI)).toBe('ESSAI_TERMINE')
  })

  it('should cancel with RAPPEL_PERIME before the end of the trial and after the staleness window', () => {
    expect(evaluerPertinence(entree(), new Date(FIN_ESSAI.getTime() - 1))).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(entree(), new Date(FIN_ESSAI.getTime() + (ESSAI_CONSTAT_PEREMPTION_JOURS * JOUR_MS) + 1))).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(entree(), new Date(FIN_ESSAI.getTime() + (ESSAI_CONSTAT_PEREMPTION_JOURS * JOUR_MS)))).toBeNull()
  })

  it('should cancel with RAPPEL_PERIME for a malformed occurrence', () => {
    expect(evaluerPertinence(entree({}, { occurrence: 'ESSAI:2026-12-07' }), ENVOI)).toBe('RAPPEL_PERIME')
    expect(evaluerPertinence(entree({}, { occurrence: 'J0:2026-12-07T10:00:00.000Z' }), ENVOI)).toBe('RAPPEL_PERIME')
  })

  it('should cancel with DESTINATAIRE_ABSENT when no address exists, and never read the weekly preference (service message)', () => {
    expect(evaluerPertinence(entree({ destinataire: false }), ENVOI)).toBe('DESTINATAIRE_ABSENT')
  })
})

describe('contenu du constat de fin d\'essai', () => {
  function constat(surcharges: Partial<EssaiConstatContent> = {}): EssaiConstatContent {
    return {
      type: ESSAI_CONSTAT_EMAIL_TYPE,
      outboxId: '11111111-1111-4111-8111-111111111111',
      generatedAt: new Date('2026-11-23T10:00:00.000Z'),
      destinataire: 'cabrel.pro@exemple.test',
      prenom: 'Cabrel',
      fuseau: 'Africa/Douala',
      siteUrl: SITE,
      expireLe: FIN_ESSAI,
      periodeMois: 1,
      ...surcharges,
    }
  }

  it('should be a service message: HTML and text, no List-Unsubscribe, no unsubscribe link, routed by buildTransactionalEmail', () => {
    const message = buildTransactionalEmail(constat())

    expect(message.subject).toBe('Votre essai gratuit est terminé')
    expect(message.html).toBeTruthy()
    expect(message.headers).toBeUndefined()
    expect(message.attachments).toEqual([])
    expect(message.text).not.toMatch(/desabonnement|Ne plus recevoir/i)
    expect(message.text).toMatch(/message de service/)
  })

  it('should state the facts: ended on the last day, back to the free plan, hidden and never deleted, link to the subscription', () => {
    const texte = buildTransactionalEmail(constat()).text.replaceAll('’', "'")

    expect(texte).toContain("s'est terminé le 7 décembre 2026")
    expect(texte).toContain('revenue au plan gratuit')
    expect(texte).toMatch(/rien n'est supprimé/)
    expect(texte).toContain(`${SITE}/studio/compte?periode=1#abonnement`)
  })

  it('should use the formal address and none of the forbidden words', () => {
    const message = buildTransactionalEmail(constat({ prenom: '' }))

    expect(message.text.startsWith('Bonjour,')).toBe(true)
    expect(message.text).not.toMatch(MOTS_INTERDITS)
    expect(message.text).not.toMatch(TUTOIEMENT)
    expect(message.text).toContain('votre')
  })

  it('should write the last included day in the time zone of the recipient', () => {
    const fin = new Date('2026-07-31T23:00:00.000Z')

    expect(buildTransactionalEmail(constat({ expireLe: fin })).text).toContain('31 juillet 2026')
    expect(buildTransactionalEmail(constat({ expireLe: fin, fuseau: 'Europe/Paris' })).text).toContain('1er août 2026')
  })
})

describe('contrats partagés du constat et du désabonnement des e-mails d\'essai', () => {
  it('should declare the constat as a transactional type outside the relational trial types', () => {
    expect(TRANSACTIONAL_EMAIL_TYPES).toContain(ESSAI_CONSTAT_EMAIL_TYPE)
    expect(TRANSACTIONAL_EMAIL_TYPES).toHaveLength(20)
    expect(ESSAI_EMAIL_TYPES as readonly string[]).not.toContain(ESSAI_CONSTAT_EMAIL_TYPE)
    expect(ESSAI_CONSTAT_EMAIL_TYPE.startsWith('abonnement_')).toBe(true)
    expect(`${ESSAI_OCCURRENCE_PREFIXE}${FIN_ESSAI.toISOString()}`.length).toBeLessThanOrEqual(32)
  })

  it('should word the weekly preference object as the trial e-mails do', () => {
    expect(PREFERENCES_EMAIL_LIBELLES.email_hebdo.objet).toBe('nos conseils et le résumé de la semaine')
  })
})

describe('purge des empreintes de l\'essai : planification', () => {
  it('should keep the empreintes 24 months', () => {
    expect(ESSAI_EMPREINTES_CONSERVATION_MOIS).toBe(24)
  })

  it('should schedule one repeated daily job without any data, with the shared identifier and cron, one attempt', async () => {
    const upsertJobScheduler = vi.fn().mockResolvedValue(undefined)

    await planifierPurgeEssaiEmpreintes({ upsertJobScheduler })

    expect(upsertJobScheduler).toHaveBeenCalledTimes(1)
    const [identifiant, repetition, modele] = upsertJobScheduler.mock.calls[0] as [string, { pattern: string, tz: string }, { name: string, data: unknown, opts: unknown }]
    expect(identifiant).toBe(ESSAI_EMPREINTES_PURGE_SCHEDULER_ID)
    expect(repetition).toEqual({ pattern: ESSAI_EMPREINTES_PURGE_CRON, tz: 'UTC' })
    expect(ESSAI_EMPREINTES_PURGE_CRON).toMatch(/^\d+ \d+ \* \* \*$/)
    expect(modele).toEqual({ name: JOBS.purgerEssaiEmpreintes, data: {}, opts: essaiEmpreintesJobOptions })
    expect(essaiEmpreintesJobOptions.attempts).toBe(1)
  })

  it('should be wired in the worker: the job name is handled and scheduled on the maintenance queue', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../worker/index.ts'), 'utf-8')

    expect(source).toContain('JOBS.purgerEssaiEmpreintes')
    expect(source).toMatch(/purgerEmpreintesEssai\(/)
    expect(source).toMatch(/planifierPurgeEssaiEmpreintes\(maintenanceQueue\)/)
  })
})
