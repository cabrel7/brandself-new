import { describe, expect, it } from 'vitest'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import {
  ACCROCHE_MOTS_MAX,
  ACCROCHE_MOTS_MIN,
  ACCROCHES_PROPOSEES,
  AMELIORER_CHAMPS,
  AMELIORER_OBJECTIFS,
  AMELIORER_TEXTE_MIN,
  DUREES_PROPOSEES,
  GENERATION_EXPIRATION_MS,
  GENERATION_POLL_MAX_MS,
  GENERATION_POLL_MS,
  GENERATION_STATUTS,
  GENERATION_STATUTS_TERMINAUX,
  IA_ATTENTE_BASE_MS,
  IA_CONCURRENCE_WORKER,
  IA_DELAI_TENTATIVE_MS,
  IA_DELAI_TOTAL_MS,
  IA_FOURNISSEURS,
  IA_MODELE_DEFAUT,
  IA_RETENTION_JOURS,
  IA_TENTATIVES_MAX,
  IA_TYPES,
  MOTIFS_REPLI,
  PRESENTATION_MOTS_MAX,
  PRESENTATION_MOTS_MIN,
  SEANCES_PROPOSEES,
  SERVICES_PROPOSES,
  countWords,
} from '../../shared/ia'
import { FILE_IA, IA_JOB_ID_PREFIXE, JOBS } from '../../shared/jobs'
import { IA_GLOBAL_LIMIT, IA_UTILISATEUR_LIMIT } from '../../shared/limites'
import { ONBOARDING_ETAPES, ONBOARDING_ETAPES_TOTAL, ONBOARDING_MANQUANTS, PAYS_DEFAUT, USERNAME_DEBOUNCE_MS } from '../../shared/onboarding'
import { PAYS } from '../../shared/vitrine'
import { ERROR_MESSAGES } from '../../server/exceptions/http'

// S8 §3 : contrats partagés (constantes, countWords, codes d'erreur). Ces tests protègent les valeurs
// décidées par la spec : un changement involontaire d'une borne doit faire échouer la suite.

describe('countWords', () => {
  it.each([
    ['', 0],
    ['   ', 0],
    ['Bonjour', 1],
    ['Bonjour tout le monde', 4],
    ["c'est", 1],
    ['c’est', 1],
    ["j'accompagne votre cœur", 3],
    ['rendez-vous', 1],
    ['Sage-femme à Douala', 3],
    ['  espaces   multiples  ', 2],
    ['ligne un\nligne deux', 4],
    ['tab\tsépare', 2],
    ['Bonjour monde', 2],
    ['2026', 1],
    ['Dr Cabrel', 2],
  ])('should count %j as %i word(s)', (texte, attendu) => {
    expect(countWords(texte)).toBe(attendu)
  })

  it.each(['—', '...', '-', '« »', '!!!', '😀', '😀 😀'])(
    'should not count the token-only punctuation or emoji %j',
    (texte) => {
      expect(countWords(texte)).toBe(0)
    },
  )

  it('should count a word followed by a dash separated by spaces as one word', () => {
    expect(countWords('Bonjour — monde')).toBe(2)
  })

  it('should stay linear on a very long input (no catastrophic backtracking)', () => {
    const long = 'mot '.repeat(50_000)
    const debut = performance.now()

    expect(countWords(long)).toBe(50_000)
    expect(performance.now() - debut).toBeLessThan(1_000)
  })
})

describe('constantes IA (shared/ia)', () => {
  it('should keep the decided content bounds (spec §3.1)', () => {
    expect([ACCROCHES_PROPOSEES, SERVICES_PROPOSES]).toEqual([3, 3])
    expect([ACCROCHE_MOTS_MIN, ACCROCHE_MOTS_MAX]).toEqual([10, 15])
    expect([PRESENTATION_MOTS_MIN, PRESENTATION_MOTS_MAX]).toEqual([80, 260])
    expect([...DUREES_PROPOSEES]).toEqual([30, 45, 60, 90, 120])
    expect([...SEANCES_PROPOSEES]).toEqual([4, 6, 8, 10, 12])
  })

  it('should keep the decided delays (spec §0 #72)', () => {
    expect(IA_DELAI_TOTAL_MS).toBe(25_000)
    expect(IA_DELAI_TENTATIVE_MS).toBe(15_000)
    expect(IA_TENTATIVES_MAX).toBe(3)
    expect(IA_ATTENTE_BASE_MS).toBe(1_000)
    expect(GENERATION_EXPIRATION_MS).toBe(45_000)
    expect(GENERATION_POLL_MS).toBe(2_000)
    expect(GENERATION_POLL_MAX_MS).toBe(60_000)
  })

  it('should keep the expiration strictly after the total budget (a late result can still land)', () => {
    expect(GENERATION_EXPIRATION_MS).toBeGreaterThan(IA_DELAI_TOTAL_MS)
  })

  it('should keep retention 30 days and the worker concurrency at 4', () => {
    expect(IA_RETENTION_JOURS).toBe(30)
    expect(IA_CONCURRENCE_WORKER).toBe(4)
  })

  it('should list the types, statuses, providers and the default model', () => {
    expect([...IA_TYPES]).toEqual(['onboarding_vitrine', 'ameliorer_texte'])
    expect([...GENERATION_STATUTS]).toEqual(['en_attente', 'en_cours', 'terminee', 'repli', 'expiree'])
    expect([...GENERATION_STATUTS_TERMINAUX]).toEqual(['terminee', 'repli', 'expiree'])
    expect([...IA_FOURNISSEURS]).toEqual(['anthropic', 'faux', 'aucun'])
    expect(IA_MODELE_DEFAUT).toBe('claude-haiku-5-5')
  })

  it('should list the nine fallback reasons', () => {
    expect([...MOTIFS_REPLI]).toEqual([
      'echec_fournisseur',
      'delai_depasse',
      'sortie_invalide',
      'injection',
      'sans_fournisseur',
      'sans_prompt',
      'file_indisponible',
      'limiteur_indisponible',
      'plafond_global',
    ])
  })

  it('should only allow the single "reformuler" objective on "bio" and "accroche"', () => {
    expect([...AMELIORER_CHAMPS]).toEqual(['bio', 'accroche'])
    expect([...AMELIORER_OBJECTIFS]).toEqual(['reformuler'])
    expect(AMELIORER_TEXTE_MIN).toBe(20)
  })

  it('should have terminal statuses included in all statuses', () => {
    for (const statut of GENERATION_STATUTS_TERMINAUX) expect(GENERATION_STATUTS).toContain(statut)
  })
})

describe('limites, jobs et parcours (shared)', () => {
  it('should limit AI requests to 10 per hour and per user, and 2000 per day globally', () => {
    expect(IA_UTILISATEUR_LIMIT).toEqual({ limit: 10, windowS: 3600 })
    expect(IA_GLOBAL_LIMIT).toEqual({ limit: 2000, windowS: 86_400 })
  })

  it('should name the queue and the two jobs', () => {
    expect(FILE_IA).toBe('ia')
    expect(JOBS.genererIa).toBe('ia-generer')
    expect(JOBS.purgerIa).toBe('ia-purger')
    expect(IA_JOB_ID_PREFIXE).toBe('ia-generation-')
  })

  it('should describe four onboarding steps with the decided titles', () => {
    expect(ONBOARDING_ETAPES_TOTAL).toBe(4)
    expect(ONBOARDING_ETAPES).toEqual({ 1: 'Qui êtes-vous ?', 2: 'Votre photo', 3: 'Notre proposition', 4: 'Votre adresse' })
    expect([...ONBOARDING_MANQUANTS]).toEqual(['identite', 'photo', 'proposition'])
    expect(USERNAME_DEBOUNCE_MS).toBe(450)
  })

  it('should preselect a known country by default (Cameroun)', () => {
    expect(PAYS.map((p) => p.code)).toContain(PAYS_DEFAUT)
    expect(PAYS_DEFAUT).toBe('CM')
  })
})

describe('codes d’erreur S8 (§3.6)', () => {
  it.each([
    ['ONBOARDING_INCOMPLET', 422, 'Il manque encore une étape avant de continuer.'],
    ['ONBOARDING_TERMINE', 409, 'Votre vitrine est déjà créée. Retrouvez-la dans votre studio.'],
    ['PROPOSITION_INDISPONIBLE', 409, 'La proposition n’est pas encore prête. Patientez un instant.'],
    ['GENERATION_INTROUVABLE', 404, 'Cette proposition est introuvable.'],
  ] as const)('should expose %s with status %i and its French message', (code, statut, message) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
    expect(ERROR_MESSAGES[code]).toBe(message)
  })

  it('should never use the vocabulary forbidden by CLAUDE.md §2 in the new messages', () => {
    const interdits = /\b(espace|bloc|module|widget|section)\b/i
    for (const code of ['ONBOARDING_INCOMPLET', 'ONBOARDING_TERMINE', 'PROPOSITION_INDISPONIBLE', 'GENERATION_INTROUVABLE'] as const) {
      expect(ERROR_MESSAGES[code]).not.toMatch(interdits)
    }
  })
})
