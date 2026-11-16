import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ERROR_MESSAGES } from '../../../server/exceptions/http'
import { libelleAction, LIBELLE_ACTION_REPLI } from '../../../server/services/emails/admin-reauth-contenu'
import {
  ADMIN_ACTION_FORMAT,
  ADMIN_ACTIONS,
  ADMIN_CIBLES,
  ADMIN_CIBLE_TYPE_FORMAT,
  APP_VERSION_DEFAUT,
  EXPORT_JOURNAL_COLONNES,
  MAINTENANCE_PREFIXES_AUTH,
  MAINTENANCE_PREFIXES_STUDIO,
  MAINTENANCE_RETRY_AFTER_S,
  SANTE_ETATS,
  SAUVEGARDE_ETATS,
} from '../../../shared/admin'
import { loadEnv } from '../../../shared/env'
import { ERROR_CODES, ERROR_STATUS } from '../../../shared/erreurs'
import { MOTIFS_REPLI, MOTIFS_REPLI_TRANSITOIRES } from '../../../shared/ia'
import {
  BATTEMENT_CLE_FORMAT,
  BATTEMENT_SAUVEGARDE,
  ENVOIS_CODES_PURGE_CRON,
  ENVOIS_CODES_RETENTION_JOURS,
  FILES_NON_RELANCABLES,
  FILES_SUPERVISEES,
  FILE_MESSAGES_AUTH,
  JOBS,
  SAUVEGARDE_ALERTE_HEURES,
  SUPERVISION_CONTROLE_INTERVALLE_MS,
  SUPERVISION_ECHECS_LISTES_MAX,
  SUPERVISION_FENETRE_TRANCHES,
  SUPERVISION_PURGE_LIMITE_MAX,
  SUPERVISION_TRANCHE_S,
} from '../../../shared/jobs'
import { IA_GLOBAL_LIMIT, IA_UTILISATEUR_LIMIT, SEO_IA_VITRINE_LIMIT } from '../../../shared/limites'
import {
  MAINTENANCE_MESSAGE_LONGUEUR_MAX,
  REGLAGES,
  REGLAGES_LISTE,
  REGLAGE_CLES,
  REGLAGE_CLES_LISTE,
  REGLAGE_CLE_FORMAT,
  REGLAGE_CLE_SECRETE_MOTIF,
  estCleReglage,
} from '../../../shared/reglages'
import type { ReglageCle, ReglageValeur } from '../../../shared/reglages'
import * as schemas from '../../../shared/schemas/admin-a4'

const MOTIF = 'Ajustement décidé après revue'
const CLE_IDEMPOTENCE = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const INSTANT = '2026-11-16T10:00:00.000Z'
const EMPREINTE = 'a'.repeat(64)

/** Valeurs de départ cohérentes (les défauts) : sert de « lecture » aux validations croisées. */
function lectureDefauts(surcharges: Partial<Record<ReglageCle, ReglageValeur>> = {}) {
  return (cle: ReglageCle): ReglageValeur => (cle in surcharges ? (surcharges[cle] as ReglageValeur) : REGLAGES[cle].defaut)
}

/** Toutes les clés d'objet atteignables depuis un schéma (objets, tableaux, unions, optionnels, enregistrements). */
function clesDuSchema(schema: unknown, vues = new Set<unknown>()): string[] {
  if (vues.has(schema)) return []
  vues.add(schema)
  const def = (schema as { def?: Record<string, unknown> }).def
  if (!def) return []
  const type = def.type as string
  if (type === 'object') {
    const forme = (schema as { shape: Record<string, unknown> }).shape
    return Object.entries(forme).flatMap(([cle, enfant]) => [cle, ...clesDuSchema(enfant, vues)])
  }
  if (type === 'array') return clesDuSchema(def.element, vues)
  if (type === 'union') return (def.options as unknown[]).flatMap((option) => clesDuSchema(option, vues))
  if (type === 'record') return clesDuSchema(def.valueType, vues)
  if ('innerType' in def) return clesDuSchema(def.innerType, vues)
  return []
}

describe('registre des réglages (D-A4-04, D-A4-06, D-A4-07)', () => {
  it('should hold the 19 settings of the spec table, each under its own key', () => {
    expect(REGLAGE_CLES_LISTE).toHaveLength(19)
    expect(new Set(REGLAGE_CLES_LISTE).size).toBe(19)
    expect(REGLAGES_LISTE.map((reglage) => reglage.cle)).toEqual([...REGLAGE_CLES_LISTE])
    for (const cle of REGLAGE_CLES_LISTE) {
      expect(REGLAGES[cle].cle, cle).toBe(cle)
      expect(cle, cle).toMatch(REGLAGE_CLE_FORMAT)
    }
  })

  it('should never contain a key that names a secret, a key, a token, a password or a URL (CA06)', () => {
    for (const cle of REGLAGE_CLES_LISTE) expect(cle, cle).not.toMatch(REGLAGE_CLE_SECRETE_MOTIF)
    for (const intrus of ['KPAY_SECRET_KEY', 'NUXT_BETTER_AUTH_SECRET', 'IA_CLE_API', 'DATABASE_URL']) {
      expect(estCleReglage(intrus), intrus).toBe(false)
    }
  })

  it('should reject an inherited property name as a key (no prototype lookup)', () => {
    for (const intrus of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '']) {
      expect(estCleReglage(intrus), intrus).toBe(false)
    }
    expect(estCleReglage('mcp.actif')).toBe(true)
  })

  it('should pin the defaults and the bounds of the spec table', () => {
    const attendu: Record<string, [ReglageValeur, number | null, number | null]> = {
      'ia.limite_utilisateur_heure': [10, 1, 100],
      'ia.plafond_global_jour': [2000, 10, 100_000],
      'seo.limite_vitrine_jour': [5, 0, 20],
      'abonnement.grace_jours': [7, 0, 30],
      'retention.ia_jours': [30, 7, 365],
      'retention.inscriptions_abandonnees_jours': [90, 7, 365],
      'retention.indisponibilites_jours': [90, 30, 365],
      'retention.oauth_orphelins_jours': [7, 1, 90],
      'agenda.preavis_defaut_heures': [2, 0, 720],
      'agenda.horizon_defaut_jours': [60, 1, 365],
      'supervision.seuil_echecs_15_min': [20, 1, 10_000],
      'supervision.disque_alerte_pct': [15, 5, 50],
    }
    for (const [cle, [defaut, min, max]] of Object.entries(attendu)) {
      const reglage = REGLAGES[cle as ReglageCle]
      expect(reglage.type, cle).toBe('entier')
      if (reglage.type !== 'entier') continue
      expect([reglage.defaut, reglage.min, reglage.max], cle).toEqual([defaut, min, max])
    }
    expect(REGLAGES['maintenance.message']).toMatchObject({ type: 'texte', defaut: '', longueurMax: 280 })
    expect(MAINTENANCE_MESSAGE_LONGUEUR_MAX).toBe(280)
  })

  it('should take its numeric defaults from the constants the code already uses (one source of truth)', () => {
    expect(REGLAGES['ia.limite_utilisateur_heure'].defaut).toBe(IA_UTILISATEUR_LIMIT.limit)
    expect(REGLAGES['ia.plafond_global_jour'].defaut).toBe(IA_GLOBAL_LIMIT.limit)
    expect(REGLAGES['seo.limite_vitrine_jour'].defaut).toBe(SEO_IA_VITRINE_LIMIT.limit)
  })

  it('should keep every default inside its own bounds', () => {
    for (const reglage of REGLAGES_LISTE) {
      if (reglage.type !== 'entier') continue
      expect(reglage.defaut, reglage.cle).toBeGreaterThanOrEqual(reglage.min)
      expect(reglage.defaut, reglage.cle).toBeLessThanOrEqual(reglage.max)
      expect(reglage.min, reglage.cle).toBeLessThan(reglage.max)
    }
  })

  it('should flag exactly four security switches, all falling back CLOSED (D-A4-06)', () => {
    const securite = REGLAGES_LISTE.filter((reglage) => reglage.securite)
    expect(securite.map((reglage) => reglage.cle).sort()).toEqual(
      ['ia.active', 'inscriptions.ouvertes', 'mcp.actif', 'paiement.en_ligne'],
    )
    for (const reglage of securite) {
      expect(reglage.type, reglage.cle).toBe('booleen')
      expect(reglage.securite && reglage.repliFerme, reglage.cle).toBe(false)
    }
  })

  it('should keep the code defaults of the three environment-backed switches (D-A4-07) and name their variable only', () => {
    expect(REGLAGES['mcp.actif']).toMatchObject({ defaut: false, variableEnv: 'MCP_ACTIF' })
    expect(REGLAGES['paiement.en_ligne']).toMatchObject({ defaut: false, variableEnv: 'PAIEMENT_EN_LIGNE' })
    expect(REGLAGES['seo.regeneration_active']).toMatchObject({ defaut: true, variableEnv: 'SEO_IA_REGENERATION_ACTIVE' })
    expect(REGLAGES_LISTE.filter((reglage) => reglage.variableEnv !== undefined)).toHaveLength(3)
  })

  it('should make the payment switch read-only and ask for a re-authentication on every other sensitive write (D-A4-19)', () => {
    expect(REGLAGES['paiement.en_ligne'].modifiable).toBe(false)
    expect(REGLAGES_LISTE.filter((reglage) => !reglage.modifiable).map((reglage) => reglage.cle)).toEqual(['paiement.en_ligne'])
    const sansReauth = REGLAGES_LISTE.filter((reglage) => !reglage.reauth).map((reglage) => reglage.cle).sort()
    expect(sansReauth).toEqual([
      'agenda.horizon_defaut_jours',
      'agenda.preavis_defaut_heures',
      'maintenance.message',
      'paiement.en_ligne',
      'supervision.disque_alerte_pct',
      'supervision.seuil_echecs_15_min',
    ])
  })

  it('should give every setting a short label and a help sentence, without forbidden user-facing words', () => {
    for (const reglage of REGLAGES_LISTE) {
      expect(reglage.libelle.length, reglage.cle).toBeGreaterThan(5)
      expect(reglage.aide.length, reglage.cle).toBeGreaterThan(10)
      expect(`${reglage.libelle} ${reglage.aide}`, reglage.cle).not.toMatch(/\b(espace|bloc|module|widget|section)\b/i)
    }
  })

  it('should refuse a seo limit above the global ceiling, and a ceiling below the seo limit (cross-validation)', () => {
    const seo = REGLAGES['seo.limite_vitrine_jour']
    const plafond = REGLAGES['ia.plafond_global_jour']
    expect(seo.valider?.(20, lectureDefauts({ 'ia.plafond_global_jour': 10 }))).toEqual(expect.any(String))
    expect(seo.valider?.(10, lectureDefauts({ 'ia.plafond_global_jour': 10 }))).toBeNull()
    expect(plafond.valider?.(10, lectureDefauts({ 'seo.limite_vitrine_jour': 20 }))).toEqual(expect.any(String))
    expect(plafond.valider?.(20, lectureDefauts({ 'seo.limite_vitrine_jour': 20 }))).toBeNull()
  })

  it('should refuse the maintenance switch without a message, and an emptied message while it is active', () => {
    const actif = REGLAGES['maintenance.active']
    const message = REGLAGES['maintenance.message']
    expect(actif.valider?.(true, lectureDefauts())).toEqual(expect.any(String))
    expect(actif.valider?.(true, lectureDefauts({ 'maintenance.message': '   ' }))).toEqual(expect.any(String))
    expect(actif.valider?.(true, lectureDefauts({ 'maintenance.message': 'Retour dans 10 minutes.' }))).toBeNull()
    expect(actif.valider?.(false, lectureDefauts())).toBeNull()
    expect(message.valider?.('', lectureDefauts({ 'maintenance.active': true }))).toEqual(expect.any(String))
    expect(message.valider?.('', lectureDefauts({ 'maintenance.active': false }))).toBeNull()
    expect(message.valider?.('Retour bientôt.', lectureDefauts({ 'maintenance.active': true }))).toBeNull()
  })

  it('should never echo the offending value in a cross-validation message', () => {
    const message = REGLAGES['seo.limite_vitrine_jour'].valider?.(20, lectureDefauts({ 'ia.plafond_global_jour': 10 }))
    expect(message).not.toMatch(/\d/)
  })
})

describe('schemaValeurReglage', () => {
  it('should refuse 0 for the hourly IA limit and accept its bounds (CA01)', () => {
    const schema = schemas.schemaValeurReglage(REGLAGE_CLES.iaLimiteUtilisateurHeure)
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse(1).success).toBe(true)
    expect(schema.safeParse(100).success).toBe(true)
    expect(schema.safeParse(101).success).toBe(false)
  })

  it.each([1.5, '10', true, null, Number.NaN, Number.POSITIVE_INFINITY])('should refuse %j for an integer setting', (valeur) => {
    expect(schemas.schemaValeurReglage(REGLAGE_CLES.iaLimiteUtilisateurHeure).safeParse(valeur).success).toBe(false)
  })

  it('should accept 0 for the seo limit, which allows no regeneration at all', () => {
    expect(schemas.schemaValeurReglage(REGLAGE_CLES.seoLimiteVitrineJour).safeParse(0).success).toBe(true)
    expect(schemas.schemaValeurReglage(REGLAGE_CLES.seoLimiteVitrineJour).safeParse(21).success).toBe(false)
  })

  it('should accept a boolean only for a switch', () => {
    const schema = schemas.schemaValeurReglage(REGLAGE_CLES.iaActive)
    expect(schema.safeParse(false).success).toBe(true)
    expect(schema.safeParse(0).success).toBe(false)
    expect(schema.safeParse('true').success).toBe(false)
  })

  it('should trim the maintenance message and bound it to 280 characters', () => {
    const schema = schemas.schemaValeurReglage(REGLAGE_CLES.maintenanceMessage)
    expect(schema.parse('  Retour dans 10 minutes.  ')).toBe('Retour dans 10 minutes.')
    expect(schema.safeParse('a'.repeat(280)).success).toBe(true)
    expect(schema.safeParse('a'.repeat(281)).success).toBe(false)
    expect(schema.safeParse('').success).toBe(true)
  })

  it.each(['ligne 1\nligne 2', 'tab\there', 'nul\u0000', 'inversé ‮txt'])(
    'should refuse control and bidirectional characters in the message (%j)',
    (texte) => {
      expect(schemas.schemaValeurReglage(REGLAGE_CLES.maintenanceMessage).safeParse(texte).success).toBe(false)
    },
  )

  it('should keep the message as plain text: a tag is stored as is, never interpreted by the schema', () => {
    expect(schemas.schemaValeurReglage(REGLAGE_CLES.maintenanceMessage).parse('<b>x</b>')).toBe('<b>x</b>')
  })

  it('should build a schema for every key of the registry', () => {
    for (const cle of REGLAGE_CLES_LISTE) {
      expect(schemas.schemaValeurReglage(cle).safeParse(REGLAGES[cle].defaut).success, cle).toBe(true)
    }
  })
})

describe('entrées des réglages', () => {
  it('should accept a value, or null to restore the default, with a motive and an idempotency key (D-A4-19)', () => {
    expect(schemas.schemaModifierReglage.safeParse({ valeur: 12, motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }).success).toBe(true)
    expect(schemas.schemaModifierReglage.safeParse({ valeur: null, motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }).success).toBe(true)
    expect(schemas.schemaModifierReglage.safeParse({ valeur: true, motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }).success).toBe(true)
  })

  it.each([
    ['sans valeur', { motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }],
    ['sans motif', { valeur: 12, cleIdempotence: CLE_IDEMPOTENCE }],
    ['motif trop court', { valeur: 12, motif: 'abc', cleIdempotence: CLE_IDEMPOTENCE }],
    ['sans clé d’idempotence', { valeur: 12, motif: MOTIF }],
    ['clé d’idempotence trop courte', { valeur: 12, motif: MOTIF, cleIdempotence: 'abc' }],
    ['clé d’idempotence aux caractères interdits', { valeur: 12, motif: MOTIF, cleIdempotence: 'abcdefgh ijkl' }],
    ['valeur objet', { valeur: { a: 1 }, motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }],
    ['valeur décimale', { valeur: 1.5, motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }],
    ['champ en trop', { valeur: 12, motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE, cle: 'ia.active' }],
  ])('should refuse a write %s', (_nom, corps) => {
    expect(schemas.schemaModifierReglage.safeParse(corps).success).toBe(false)
  })

  it('should refuse a key outside the format before any lookup (CA06: KPAY_SECRET_KEY is not even a key shape)', () => {
    expect(schemas.schemaReglageCleParam.safeParse({ cle: 'KPAY_SECRET_KEY' }).success).toBe(false)
    expect(schemas.schemaReglageCleParam.safeParse({ cle: 'mcp.actif' }).success).toBe(true)
    expect(schemas.schemaReglageCleParam.safeParse({ cle: 'mcp.actif', autre: 1 }).success).toBe(false)
  })
})

describe('files et jobs (D-A4-01, D-A4-02, D-A4-03)', () => {
  it('should supervise the seven queues with a producer, never the legacy `emails` one', () => {
    expect([...FILES_SUPERVISEES].sort()).toEqual(
      ['emails-notifications', 'ia', 'ia-fond', 'maintenance', 'messages-auth', 'paiements', 'system'],
    )
    expect(FILES_SUPERVISEES).not.toContain('emails')
  })

  it('should forbid the retry of `messages-auth` only (its jobs carry a login code)', () => {
    expect([...FILES_NON_RELANCABLES]).toEqual([FILE_MESSAGES_AUTH])
  })

  it('should pin the failure counter: 5-minute slices, 3 slices = 15 minutes, check every 5 minutes', () => {
    expect(SUPERVISION_TRANCHE_S).toBe(300)
    expect(SUPERVISION_FENETRE_TRANCHES * SUPERVISION_TRANCHE_S).toBe(900)
    expect(SUPERVISION_CONTROLE_INTERVALLE_MS).toBe(SUPERVISION_TRANCHE_S * 1000)
    expect(SUPERVISION_ECHECS_LISTES_MAX).toBe(20)
    expect(SUPERVISION_PURGE_LIMITE_MAX).toBe(1000)
  })

  it('should declare the A4 and A5 jobs with distinct names', () => {
    expect(JOBS.controlerEchecsFiles).toBe('supervision-echecs-controler')
    expect(JOBS.purgerEnvois).toBe('envois-codes-purger')
    expect(JOBS.appliquerVersions).toBe('versions-appliquer')
    expect(new Set(Object.values(JOBS)).size).toBe(Object.values(JOBS).length)
    expect(ENVOIS_CODES_PURGE_CRON).toMatch(/^\d+ \d+ \* \* \*$/)
    expect(ENVOIS_CODES_RETENTION_JOURS).toBe(90)
  })

  it('should keep the backup heartbeat key valid for the table CHECK, and alert after 26 hours', () => {
    expect(BATTEMENT_SAUVEGARDE).toMatch(BATTEMENT_CLE_FORMAT)
    expect(BATTEMENT_SAUVEGARDE).toBe('sauvegarde_derniere_reussite')
    expect(SAUVEGARDE_ALERTE_HEURES).toBe(26)
  })

  it('should validate a retry request: queue, job identifier, motive, idempotency key', () => {
    const valide = { file: 'ia', id: 'ia-generation-3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10', motif: MOTIF, cleIdempotence: CLE_IDEMPOTENCE }
    expect(schemas.schemaJobRelancer.safeParse(valide).success).toBe(true)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, file: 'emails' }).success).toBe(false)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, file: 'inconnue' }).success).toBe(false)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, id: 'a'.repeat(65) }).success).toBe(false)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, id: 'a b' }).success).toBe(false)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, id: '' }).success).toBe(false)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, cleIdempotence: undefined }).success).toBe(false)
    expect(schemas.schemaJobRelancer.safeParse({ ...valide, data: {} }).success).toBe(false)
  })

  it('should default a purge to 1000 jobs, and refuse 0, 1001 and an unknown queue', () => {
    expect(schemas.schemaJobPurger.parse({ file: 'ia', motif: MOTIF })).toEqual({ file: 'ia', motif: MOTIF, limite: 1000 })
    expect(schemas.schemaJobPurger.safeParse({ file: 'ia', motif: MOTIF, limite: 1000 }).success).toBe(true)
    expect(schemas.schemaJobPurger.safeParse({ file: 'ia', motif: MOTIF, limite: 1001 }).success).toBe(false)
    expect(schemas.schemaJobPurger.safeParse({ file: 'ia', motif: MOTIF, limite: 0 }).success).toBe(false)
    expect(schemas.schemaJobPurger.safeParse({ file: 'x', motif: MOTIF }).success).toBe(false)
    expect(schemas.schemaJobPurger.safeParse({ file: 'ia' }).success).toBe(false)
  })
})

describe('sorties de la supervision : strictes et sans donnée personnelle', () => {
  const file = {
    file: 'ia',
    compteurs: { attente: 0, actifs: 1, differes: 0, echoues: 2, termines: 10 },
    echecs15Min: 2,
    relancable: true,
    echecs: [{ id: 'ia-generation-1', nom: 'ia-generer', echecLe: INSTANT, tentatives: 3, motif: 'DELAI_DEPASSE' }],
  }

  it('should accept a queue state and refuse job data, a raw error message or a lowercase reason code', () => {
    expect(schemas.schemaEtatFileDto.safeParse(file).success).toBe(true)
    expect(schemas.schemaEtatFileDto.safeParse({ ...file, echecs: [{ ...file.echecs[0], data: { code: '123456' } }] }).success).toBe(false)
    expect(schemas.schemaEtatFileDto.safeParse({ ...file, echecs: [{ ...file.echecs[0], failedReason: 'Error: boom' }] }).success).toBe(false)
    expect(schemas.schemaEtatFileDto.safeParse({ ...file, echecs: [{ ...file.echecs[0], motif: 'Error: boom at x' }] }).success).toBe(false)
  })

  it('should list 20 failures per queue at most', () => {
    const echec = file.echecs[0]
    expect(schemas.schemaEtatFileDto.safeParse({ ...file, echecs: Array.from({ length: 20 }, () => echec) }).success).toBe(true)
    expect(schemas.schemaEtatFileDto.safeParse({ ...file, echecs: Array.from({ length: 21 }, () => echec) }).success).toBe(false)
  })

  it('should accept the state of every supervised queue and the threshold in force', () => {
    const files = FILES_SUPERVISEES.map((nom) => ({ ...file, file: nom, echecs: [] }))
    expect(schemas.schemaEtatFilesDto.safeParse({ files, seuilEchecs15Min: 20, genereLe: INSTANT }).success).toBe(true)
    expect(schemas.schemaEtatFilesDto.safeParse({ files, seuilEchecs15Min: 0, genereLe: INSTANT }).success).toBe(false)
  })

  it('should accept the purge response and refuse a negative count', () => {
    expect(schemas.schemaPurgeFilesReponse.safeParse({ purges: 12 }).success).toBe(true)
    expect(schemas.schemaPurgeFilesReponse.safeParse({ purges: -1 }).success).toBe(false)
  })

  it('should never allow a phone number, an e-mail, a code or an identifier in the code-delivery log (D-A4-15)', () => {
    const valide = {
      jours: 7,
      total: { envoyes: 3, echecs: 1 },
      lignes: [{ canal: 'sms', pays: 'CM', envoyes: 2, echecs: 1 }, { canal: 'email', pays: null, envoyes: 1, echecs: 0 }],
      erreurs: [{ codeErreur: 'OTP_SMS_NON_CONFIGURE', nombre: 1 }],
      genereLe: INSTANT,
    }
    expect(schemas.schemaEnvoisDto.safeParse(valide).success).toBe(true)
    expect(schemas.schemaEnvoisDto.safeParse({ ...valide, lignes: [{ ...valide.lignes[0], telephone: '+237600000000' }] }).success).toBe(false)
    expect(schemas.schemaEnvoisDto.safeParse({ ...valide, lignes: [{ ...valide.lignes[0], pays: '+237' }] }).success).toBe(false)
    expect(schemas.schemaEnvoisDto.safeParse({ ...valide, lignes: [{ ...valide.lignes[0], canal: 'pigeon' }] }).success).toBe(false)
    expect(schemas.schemaEnvoisDto.safeParse({ ...valide, erreurs: [{ codeErreur: 'x'.repeat(41), nombre: 1 }] }).success).toBe(false)
  })

  it('should keep the IA aggregates free of the request and the answer (D-A4-17, CA16)', () => {
    const valide = {
      jours: 30,
      total: 5,
      parStatut: [{ statut: 'terminee', nombre: 4 }, { statut: 'repli', nombre: 1 }],
      parMotifRepli: [{ motif: 'ia_coupee', nombre: 1 }],
      parType: [{ type: 'onboarding_vitrine', nombre: 5 }],
      parFournisseur: [{ fournisseur: 'anthropic', nombre: 4 }, { fournisseur: null, nombre: 1 }],
      tokensEntree: 100,
      tokensSortie: 50,
      dureeMoyenneMs: 1200,
      injectionsSuspectees: 0,
      quotaGratuitMois: 3,
      consommateurs: [{ utilisateurId: 'u-1', nombre: 5 }],
      genereLe: INSTANT,
    }
    expect(schemas.schemaAgregatsIaDto.safeParse(valide).success).toBe(true)
    expect(schemas.schemaAgregatsIaDto.safeParse({ ...valide, entree: { texte: 'x' } }).success).toBe(false)
    expect(schemas.schemaAgregatsIaDto.safeParse({ ...valide, sortie: {} }).success).toBe(false)
    expect(schemas.schemaAgregatsIaDto.safeParse({ ...valide, consommateurs: [{ ...valide.consommateurs[0], email: 'a@b.fr' }] }).success).toBe(false)
    expect(schemas.schemaAgregatsIaDto.safeParse({ ...valide, jours: 31 }).success).toBe(false)
    expect(schemas.schemaAgregatsIaDto.safeParse({ ...valide, quotaGratuitMois: null }).success).toBe(true)
    expect(schemas.schemaAgregatsIaDto.safeParse({ ...valide, parMotifRepli: [{ motif: 'inconnu', nombre: 1 }] }).success).toBe(false)
  })

  it('should accept the ia_coupee fallback reason (database CHECK of migration 0031) and treat it as transient', () => {
    expect(MOTIFS_REPLI).toContain('ia_coupee')
    expect(MOTIFS_REPLI_TRANSITOIRES).toContain('ia_coupee')
    expect(new Set(MOTIFS_REPLI).size).toBe(MOTIFS_REPLI.length)
  })

  it('should accept PWA aggregates built from the existing event enums only', () => {
    const valide = {
      jours: 30,
      total: 3,
      lignes: [{ type: 'installee', origine: 'studio', deviceType: 'mobile', nombre: 3 }],
      genereLe: INSTANT,
    }
    expect(schemas.schemaAgregatsPwaDto.safeParse(valide).success).toBe(true)
    expect(schemas.schemaAgregatsPwaDto.safeParse({ ...valide, lignes: [{ ...valide.lignes[0], type: 'autre' }] }).success).toBe(false)
  })

  it('should keep the assistant aggregates free of arguments, results and states', () => {
    const valide = {
      jours: 30,
      total: 10,
      comptesActifs: 2,
      capacitesActives: 1,
      parOutil: [{ outil: 'lister_reservations', nombre: 10 }],
      parAssistant: [{ assistantId: 'client-1', nombre: 10 }],
      genereLe: INSTANT,
    }
    expect(schemas.schemaAgregatsAssistantsDto.safeParse(valide).success).toBe(true)
    for (const intrus of ['argumentsResume', 'resultat', 'avant', 'apres', 'arguments_resume']) {
      expect(schemas.schemaAgregatsAssistantsDto.safeParse({ ...valide, [intrus]: {} }).success, intrus).toBe(false)
    }
    expect(schemas.schemaAgregatsAssistantsDto.safeParse({ ...valide, parOutil: [{ outil: 'x', nombre: 1, resultat: {} }] }).success).toBe(false)
  })

  it('should describe a health state where a missing backup is `inconnue`, never `ok` (CA21)', () => {
    const valide = {
      base: { etat: 'ok', latenceMs: 3 },
      redis: { etat: 'ok', latenceMs: 1 },
      disque: { etat: 'degrade', libreOctets: 1_000_000_000, totalOctets: 8_000_000_000, libresPct: 12.5 },
      sauvegarde: { etat: 'inconnue', derniereReussiteLe: null, ageHeures: null },
      version: APP_VERSION_DEFAUT,
      genereLe: INSTANT,
    }
    expect(schemas.schemaSanteDto.safeParse(valide).success).toBe(true)
    expect(schemas.schemaSanteDto.safeParse({ ...valide, version: 'a b' }).success).toBe(false)
    expect(schemas.schemaSanteDto.safeParse({ ...valide, sauvegarde: { ...valide.sauvegarde, etat: 'bonne' } }).success).toBe(false)
    expect(schemas.schemaSanteDto.safeParse({ ...valide, disque: { ...valide.disque, libresPct: 101 } }).success).toBe(false)
    expect(schemas.schemaSanteDto.safeParse({ ...valide, env: {} }).success).toBe(false)
    expect([...SAUVEGARDE_ETATS]).toEqual(['ok', 'ancienne', 'inconnue'])
    expect([...SANTE_ETATS]).toEqual(['ok', 'degrade', 'indisponible'])
  })

  it('should never carry any personal or raw-content key anywhere in the output schemas of A4', () => {
    const interdits = ['email', 'courriel', 'telephone', 'phone', 'entree', 'sortie', 'contenu', 'data', 'ip', 'cleIdempotence', 'arguments_resume', 'argumentsResume', 'resultat']
    const sorties = [
      schemas.schemaListeReglagesDto,
      schemas.schemaModifierReglageReponse,
      schemas.schemaEtatPublicDto,
      schemas.schemaEtatFilesDto,
      schemas.schemaPurgeFilesReponse,
      schemas.schemaEnvoisDto,
      schemas.schemaAgregatsIaDto,
      schemas.schemaAgregatsPwaDto,
      schemas.schemaAgregatsAssistantsDto,
      schemas.schemaSanteDto,
      schemas.schemaCapaciteReponse,
      schemas.schemaListeJournalDto,
      schemas.schemaJournalVerificationDto,
    ]
    for (const sortie of sorties) {
      const cles = clesDuSchema(sortie)
      expect(cles.length).toBeGreaterThan(0)
      for (const interdit of interdits) expect(cles, interdit).not.toContain(interdit)
    }
  })
})

describe('sortie d’un réglage', () => {
  const reglage = {
    cle: 'ia.limite_utilisateur_heure',
    type: 'entier',
    libelle: 'Demandes d’IA par utilisateur et par heure',
    aide: 'Nombre de propositions que chaque compte peut demander en une heure.',
    categorie: 'ia',
    reauth: true,
    modifiable: true,
    securite: false,
    valeur: 12,
    defaut: 10,
    surcharge: true,
    min: 1,
    max: 100,
    longueurMax: null,
    modifieLe: INSTANT,
    modifiePar: 'admin-1',
  }

  it('should accept a setting and refuse an unknown key, an extra field and a value that does not match the type', () => {
    expect(schemas.schemaReglageDto.safeParse(reglage).success).toBe(true)
    expect(schemas.schemaReglageDto.safeParse({ ...reglage, cle: 'kpay.secret' }).success).toBe(false)
    expect(schemas.schemaReglageDto.safeParse({ ...reglage, email: 'a@b.fr' }).success).toBe(false)
    expect(schemas.schemaReglageDto.safeParse({ ...reglage, valeur: true }).success).toBe(false)
    expect(schemas.schemaReglageDto.safeParse({ ...reglage, defaut: 'dix' }).success).toBe(false)
  })

  it('should accept a setting never modified (no author, no date)', () => {
    expect(schemas.schemaReglageDto.safeParse({ ...reglage, surcharge: false, valeur: 10, modifieLe: null, modifiePar: null }).success).toBe(true)
  })

  it('should accept the whole registry and the idempotent replay flag', () => {
    const elements = REGLAGES_LISTE.map((definition) => ({
      cle: definition.cle,
      type: definition.type,
      libelle: definition.libelle,
      aide: definition.aide,
      categorie: definition.categorie,
      reauth: definition.reauth,
      modifiable: definition.modifiable,
      securite: definition.securite,
      valeur: definition.defaut,
      defaut: definition.defaut,
      surcharge: false,
      min: definition.type === 'entier' ? definition.min : null,
      max: definition.type === 'entier' ? definition.max : null,
      longueurMax: definition.type === 'texte' ? definition.longueurMax : null,
      modifieLe: null,
      modifiePar: null,
    }))
    expect(schemas.schemaListeReglagesDto.safeParse({ elements }).success).toBe(true)
    expect(schemas.schemaModifierReglageReponse.safeParse({ reglage, rejoue: false }).success).toBe(true)
    expect(schemas.schemaModifierReglageReponse.safeParse({ reglage }).success).toBe(false)
  })
})

describe('état public (maintenance)', () => {
  it('should give the message only during a maintenance', () => {
    expect(schemas.schemaEtatPublicDto.safeParse({ maintenance: true, message: 'Retour dans 10 minutes.' }).success).toBe(true)
    expect(schemas.schemaEtatPublicDto.safeParse({ maintenance: false, message: null }).success).toBe(true)
    expect(schemas.schemaEtatPublicDto.safeParse({ maintenance: false, message: 'Texte oublié' }).success).toBe(false)
    expect(schemas.schemaEtatPublicDto.safeParse({ maintenance: true, message: 'a'.repeat(281) }).success).toBe(false)
    expect(schemas.schemaEtatPublicDto.safeParse({ maintenance: true, message: null, inscriptions: true }).success).toBe(false)
  })

  it('should block the studio writes and the sign-in routes, never the public pages, the administration or the state itself (D-A4-08)', () => {
    expect([...MAINTENANCE_PREFIXES_STUDIO]).toEqual(['/api/studio'])
    expect([...MAINTENANCE_PREFIXES_AUTH]).toEqual(['/api/auth/sign-in', '/api/auth/email-otp', '/api/auth/phone-number'])
    expect(MAINTENANCE_RETRY_AFTER_S).toBe(300)
    for (const prefixe of [...MAINTENANCE_PREFIXES_STUDIO, ...MAINTENANCE_PREFIXES_AUTH]) {
      expect(prefixe).not.toMatch(/^\/api\/(admin|public)/)
    }
  })
})

describe('capacités accordées', () => {
  const capacite = {
    id: 'cap-1',
    utilisateurId: 'u-1',
    capacite: 'mcp',
    motif: 'Compte pilote validé',
    accordePar: 'admin-1',
    accordeLe: INSTANT,
    revoqueLe: null,
  }

  it('should grant only the `mcp` capability, with a motive', () => {
    expect(schemas.schemaCapaciteAccorder.safeParse({ capacite: 'mcp', motif: MOTIF }).success).toBe(true)
    expect(schemas.schemaCapaciteAccorder.safeParse({ capacite: 'admin', motif: MOTIF }).success).toBe(false)
    expect(schemas.schemaCapaciteAccorder.safeParse({ capacite: 'mcp' }).success).toBe(false)
    expect(schemas.schemaCapaciteAccorder.safeParse({ capacite: 'mcp', motif: MOTIF, jours: 3 }).success).toBe(false)
    expect(schemas.schemaCapaciteParam.safeParse({ id: 'u-1', capacite: 'mcp' }).success).toBe(true)
    expect(schemas.schemaCapaciteParam.safeParse({ id: 'u-1', capacite: 'x' }).success).toBe(false)
  })

  it('should describe a granted and a revoked capability', () => {
    expect(schemas.schemaCapaciteReponse.safeParse({ capacite, rejoue: false }).success).toBe(true)
    expect(schemas.schemaCapaciteReponse.safeParse({ capacite: { ...capacite, revoqueLe: INSTANT }, rejoue: true }).success).toBe(true)
    expect(schemas.schemaCapaciteReponse.safeParse({ capacite: { ...capacite, email: 'a@b.fr' }, rejoue: false }).success).toBe(false)
  })
})

describe('journal d’administration', () => {
  const entree = {
    id: 'j-1',
    numero: 7,
    adminId: 'admin-1',
    action: 'reglage.modifier',
    cibleType: 'reglage',
    cibleId: 'maintenance.message',
    motif: MOTIF,
    avant: { longueur: 0 },
    apres: { longueur: 200 },
    creeLe: INSTANT,
    empreinte: EMPREINTE,
  }

  it('should paginate with page and limit like A2 and A3, 100 at most (D-A4-18)', () => {
    expect(schemas.schemaListeJournalQuery.parse({})).toEqual({ page: 1, limite: 25 })
    expect(schemas.schemaListeJournalQuery.parse({ page: '2', limite: '100' })).toEqual({ page: 2, limite: 100 })
    expect(schemas.schemaListeJournalQuery.safeParse({ limite: '101' }).success).toBe(false)
    expect(schemas.schemaListeJournalQuery.safeParse({ page: '0' }).success).toBe(false)
    expect(schemas.schemaListeJournalQuery.safeParse({ ordre: 'asc' }).success).toBe(false)
  })

  it('should filter by administrator, action, target and period, and refuse an inverted period', () => {
    const filtres = { adminId: 'admin-1', action: 'reglage.modifier', cibleType: 'reglage', cibleId: 'mcp.actif', du: '2026-11-01', au: '2026-11-16' }
    expect(schemas.schemaListeJournalQuery.safeParse(filtres).success).toBe(true)
    expect(schemas.schemaFiltresJournal.safeParse(filtres).success).toBe(true)
    expect(schemas.schemaListeJournalQuery.safeParse({ ...filtres, du: '2026-12-01' }).success).toBe(false)
    expect(schemas.schemaFiltresJournal.safeParse({ ...filtres, du: '2026-12-01' }).success).toBe(false)
    expect(schemas.schemaFiltresJournal.safeParse({ action: 'Reglage.Modifier' }).success).toBe(false)
    expect(schemas.schemaFiltresJournal.safeParse({ du: '16/11/2026' }).success).toBe(false)
  })

  it('should demand a motive for an export (CA13: without it, 422) and accept no filter at all', () => {
    expect(schemas.schemaExportJournal.safeParse({ filtres: {} }).success).toBe(false)
    expect(schemas.schemaExportJournal.safeParse({ motif: '    ', filtres: {} }).success).toBe(false)
    expect(schemas.schemaExportJournal.parse({ motif: MOTIF })).toEqual({ motif: MOTIF, filtres: {} })
    expect(schemas.schemaExportJournal.safeParse({ motif: MOTIF, filtres: { action: 'paiement.marquer_paye' } }).success).toBe(true)
    expect(schemas.schemaExportJournal.safeParse({ motif: MOTIF, extra: 1 }).success).toBe(false)
  })

  it('should list the CSV columns without IP address nor idempotency key', () => {
    expect([...EXPORT_JOURNAL_COLONNES]).toEqual(
      ['numero', 'creeLe', 'adminId', 'action', 'cibleType', 'cibleId', 'motif', 'avant', 'apres', 'empreinte'],
    )
  })

  it('should return an entry without IP address nor idempotency key, with flat before/after values', () => {
    expect(schemas.schemaJournalEntreeDto.safeParse(entree).success).toBe(true)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, ip: '203.0.113.7' }).success).toBe(false)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, cleIdempotence: CLE_IDEMPOTENCE }).success).toBe(false)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, avant: null, apres: null, cibleId: null }).success).toBe(true)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, apres: { texte: 'a'.repeat(65) } }).success).toBe(false)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, apres: { imbrique: { a: 1 } } }).success).toBe(false)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, apres: { 'Cle-Maj': 1 } }).success).toBe(false)
    expect(schemas.schemaJournalEntreeDto.safeParse({ ...entree, empreinte: 'xyz' }).success).toBe(false)
  })

  it('should bound a page of the journal to 100 entries', () => {
    const page = { total: 150, page: 1, limite: 100 }
    expect(schemas.schemaListeJournalDto.safeParse({ elements: Array.from({ length: 100 }, () => entree), ...page }).success).toBe(true)
    expect(schemas.schemaListeJournalDto.safeParse({ elements: Array.from({ length: 101 }, () => entree), ...page }).success).toBe(false)
  })

  it('should answer a verification as { intacte, premiereRupture } with the two always consistent (CA14)', () => {
    expect(schemas.schemaJournalVerificationDto.safeParse({ intacte: true, premiereRupture: null }).success).toBe(true)
    expect(schemas.schemaJournalVerificationDto.safeParse({ intacte: false, premiereRupture: 42 }).success).toBe(true)
    expect(schemas.schemaJournalVerificationDto.safeParse({ intacte: false, premiereRupture: null }).success).toBe(false)
    expect(schemas.schemaJournalVerificationDto.safeParse({ intacte: true, premiereRupture: 3 }).success).toBe(false)
    expect(schemas.schemaJournalVerificationDto.safeParse({ intacte: false, premiereRupture: 0 }).success).toBe(false)
  })
})

describe('fenêtres des agrégats', () => {
  it('should default to 30 days and cap IA, PWA and assistants at 30 (the IA table is purged at 30 days)', () => {
    expect(schemas.schemaJoursQuery.parse({})).toEqual({ jours: 30 })
    expect(schemas.schemaJoursQuery.parse({ jours: '7' })).toEqual({ jours: 7 })
    expect(schemas.schemaJoursQuery.safeParse({ jours: '31' }).success).toBe(false)
    expect(schemas.schemaJoursQuery.safeParse({ jours: '0' }).success).toBe(false)
    expect(schemas.schemaJoursQuery.safeParse({ jours: '1.5' }).success).toBe(false)
    expect(schemas.schemaJoursQuery.safeParse({ jours: 'abc' }).success).toBe(false)
    expect(schemas.schemaJoursQuery.safeParse({ jours: '7', x: '1' }).success).toBe(false)
  })

  it('should default to 7 days for the code deliveries and cap them at the 90-day retention', () => {
    expect(schemas.schemaEnvoisQuery.parse({})).toEqual({ jours: 7 })
    expect(schemas.schemaEnvoisQuery.safeParse({ jours: '90' }).success).toBe(true)
    expect(schemas.schemaEnvoisQuery.safeParse({ jours: '91' }).success).toBe(false)
  })
})

describe('erreurs de l’A4', () => {
  it.each([
    ['MAINTENANCE', 503],
    ['INSCRIPTIONS_FERMEES', 403],
    ['REGLAGE_INCONNUE', 404],
    ['REGLAGE_INVALIDE', 422],
    ['REGLAGE_LECTURE_SEULE', 422],
    ['JOB_NON_RELANCABLE', 422],
    ['JOB_INTROUVABLE', 404],
  ] as const)('should declare %s with status %i and a French message', (code, statut) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
    expect(ERROR_MESSAGES[code].trim().length).toBeGreaterThan(10)
  })

  it('should keep the signup closure neutral (no hint about a given address) and never repeat a value', () => {
    expect(ERROR_MESSAGES.INSCRIPTIONS_FERMEES).not.toMatch(/adresse|compte existe|déjà|@/i)
    expect(ERROR_MESSAGES.REGLAGE_INVALIDE).not.toMatch(/\d/)
  })
})

describe('actions du journal de l’A4', () => {
  it.each([
    ['reglageModifier', 'reglage.modifier'],
    ['jobRelancer', 'job.relancer'],
    ['jobPurger', 'job.purger'],
    ['journalExporter', 'journal.exporter'],
    ['capaciteAccorder', 'capacite.accorder'],
    ['capaciteRevoquer', 'capacite.revoquer'],
  ] as const)('should declare %s as %s, in the journal format, with a readable e-mail label', (cle, action) => {
    expect(ADMIN_ACTIONS[cle]).toBe(action)
    expect(action).toMatch(ADMIN_ACTION_FORMAT)
    expect(libelleAction(action)).not.toBe(LIBELLE_ACTION_REPLI)
  })

  it('should declare the target types of A4 in the journal format', () => {
    for (const cible of [ADMIN_CIBLES.reglage, ADMIN_CIBLES.job, ADMIN_CIBLES.journal]) {
      expect(cible).toMatch(ADMIN_CIBLE_TYPE_FORMAT)
    }
  })
})

describe('APP_VERSION (D-A4-22)', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    NUXT_BETTER_AUTH_SECRET: 'secret-de-test-au-moins-trente-deux-caracteres',
  }

  it('should default to `inconnue` when absent or blank', () => {
    expect(loadEnv(base).APP_VERSION).toBe(APP_VERSION_DEFAUT)
    expect(loadEnv({ ...base, APP_VERSION: '   ' }).APP_VERSION).toBe(APP_VERSION_DEFAUT)
  })

  it.each(['1.4.2', 'v2026.11.16', 'a1b2c3d', '1.0.0+build.7', '1.0.0-rc_1'])('should accept %s', (version) => {
    expect(loadEnv({ ...base, APP_VERSION: ` ${version} ` }).APP_VERSION).toBe(version)
  })

  it('should refuse a value with spaces or a very long value without echoing it', () => {
    for (const valeur of ['version avec espaces', 'x'.repeat(65), 'a/b', 'a@b']) {
      let message = ''
      try {
        loadEnv({ ...base, APP_VERSION: valeur })
      } catch (erreur) {
        message = erreur instanceof Error ? erreur.message : String(erreur)
      }
      expect(message, valeur).toContain('APP_VERSION')
      expect(message, valeur).not.toContain(valeur)
    }
  })

  it('should be an instance of the zod object we validate with (sanity of the helper walker)', () => {
    expect(clesDuSchema(z.strictObject({ a: z.array(z.strictObject({ b: z.string().nullable() })) }))).toEqual(['a', 'b'])
  })
})
