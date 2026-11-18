import { describe, expect, it } from 'vitest'
import {
  CODE_ANOMALIE_REMPLACE_PAR_MANUEL,
  EXPORT_PAIEMENTS_COLONNES,
  PAIEMENT_STATUTS_REMPLACABLES,
  REVENUS_MENTION_INCERTITUDE,
  WEBHOOK_REFUS_MOTIFS,
} from '../../../shared/admin-paiements'
import { CLES_AUDIT_INTERDITES } from '../../../shared/admin'
import { ERROR_CODES } from '../../../shared/erreurs'
import { JOBS, WEBHOOKS_REFUSES_PURGE_CRON } from '../../../shared/jobs'
import {
  ADMIN_ABONNEMENT_EXPIRES_FENETRE_JOURS,
  ADMIN_ABONNEMENT_RENOUVELLEMENT_JOURS,
  ADMIN_ALERTE_PAIEMENT_OUVERT_MIN,
  ADMIN_ALERTE_WEBHOOKS_REFUSES_SEUIL,
  ADMIN_EXPORT_LIGNES_MAX,
  ADMIN_RAPPEL_INTERVALLE_HEURES,
  ADMIN_REVERIFICATION_LIMIT,
  WEBHOOKS_REFUSES_RETENTION_JOURS,
} from '../../../shared/limites'
import { ABONNEMENT_GRACE_JOURS } from '../../../shared/plans'
import { CODE_ECHEC_FORMAT } from '../../../shared/paiements'
import * as schemas from '../../../shared/schemas/admin-paiements'

const MOTIF = 'Vérification demandée par le titulaire'
const CLE = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
const INSTANT = '2026-11-14T10:00:00.000Z'

describe('limites décidées de A3', () => {
  it('should pin the decided values', () => {
    expect(ADMIN_REVERIFICATION_LIMIT).toEqual({ limit: 10, windowS: 60 })
    expect(WEBHOOKS_REFUSES_RETENTION_JOURS).toBe(90)
    expect(ADMIN_ALERTE_PAIEMENT_OUVERT_MIN).toBe(60)
    expect(ADMIN_ALERTE_WEBHOOKS_REFUSES_SEUIL).toBe(10)
    expect(ADMIN_EXPORT_LIGNES_MAX).toBe(5000)
    expect(ADMIN_RAPPEL_INTERVALLE_HEURES).toBe(24)
  })

  it('should cut the tabs as 7 days, 7 days of grace, then 30 days (so 37 days back, D-A3-14)', () => {
    expect(ADMIN_ABONNEMENT_RENOUVELLEMENT_JOURS).toBe(7)
    expect(ABONNEMENT_GRACE_JOURS).toBe(7)
    expect(ABONNEMENT_GRACE_JOURS + ADMIN_ABONNEMENT_EXPIRES_FENETRE_JOURS).toBe(37)
  })

  it('should declare the purge job, with a distinct name', () => {
    expect(JOBS.purgerWebhooksRefuses).toBe('webhooks-refuses-purger')
    expect(new Set(Object.values(JOBS)).size).toBe(Object.values(JOBS).length)
    expect(WEBHOOKS_REFUSES_PURGE_CRON).toMatch(/^\d+ \d+ \* \* \*$/)
  })

  it('should declare the A3 error codes', () => {
    for (const code of ['PAIEMENT_OUVERT', 'DEJA_PAYE', 'REVERIFICATION_REQUISE', 'RAPPEL_RECENT', 'EXPORT_TROP_GRAND', 'FOURNISSEUR_INDISPONIBLE']) {
      expect(ERROR_CODES, code).toContain(code)
    }
  })
})

describe('constantes de paiement manuel', () => {
  it('should never allow replacing a paid payment', () => {
    expect([...PAIEMENT_STATUTS_REMPLACABLES]).toEqual(['echoue', 'expire', 'annule', 'anomalie'])
    expect(PAIEMENT_STATUTS_REMPLACABLES).not.toContain('reussi')
  })

  it('should use an anomaly code accepted by the payment failure code format', () => {
    expect(CODE_ECHEC_FORMAT.test(CODE_ANOMALIE_REMPLACE_PAR_MANUEL)).toBe(true)
  })

  it('should count only signature and oversized-body refusals, never unknown providers', () => {
    expect([...WEBHOOK_REFUS_MOTIFS]).toEqual(['SIGNATURE_INVALIDE', 'CORPS_TROP_GROS'])
  })

  it('should never export a phone number and keep the uncertainty notice', () => {
    for (const colonne of EXPORT_PAIEMENTS_COLONNES) expect(colonne.toLowerCase(), colonne).not.toMatch(/telephone|numero|empreinte/)
    expect(REVENUS_MENTION_INCERTITUDE).toMatch(/non confirmé/)
  })
})

describe('entrées A3 strictes', () => {
  it('should accept a payment action with motive and key and refuse unknown or missing keys', () => {
    expect(schemas.schemaActionPaiement.safeParse({ motif: MOTIF, cleIdempotence: CLE }).success).toBe(true)
    expect(schemas.schemaActionPaiement.safeParse({ motif: MOTIF }).success).toBe(false)
    expect(schemas.schemaActionPaiement.safeParse({ cleIdempotence: CLE }).success).toBe(false)
    expect(schemas.schemaActionPaiement.safeParse({ motif: MOTIF, cleIdempotence: CLE, telephone: '1' }).success).toBe(false)
    expect(schemas.schemaActionPaiement.safeParse({ motif: MOTIF, cleIdempotence: 'court' }).success).toBe(false)
  })

  it('should accept only the three tabs', () => {
    for (const onglet of ['renouvellement', 'grace', 'expires']) expect(schemas.schemaListeAbonnementsQuery.safeParse({ onglet }).success, onglet).toBe(true)
    for (const onglet of ['', 'tous', 'GRACE']) expect(schemas.schemaListeAbonnementsQuery.safeParse({ onglet }).success, onglet).toBe(false)
    expect(schemas.schemaListeAbonnementsQuery.safeParse({}).success).toBe(false)
    expect(schemas.schemaListeAbonnementsQuery.parse({ onglet: 'grace' })).toMatchObject({ page: 1, limite: 25 })
  })

  it('should validate payment list filters', () => {
    expect(schemas.schemaListePaiementsQuery.safeParse({ statut: 'reussi', source: 'manuel', devise: 'XAF', du: '2026-11-01', au: '2026-11-30', page: '2' }).success).toBe(true)
    for (const requete of [{ statut: 'paye' }, { source: 'carte' }, { devise: 'xaf' }, { devise: 'XAFF' }, { du: '01/11/2026' }, { page: '0' }, { limite: '101' }, { inconnu: 'x' }]) {
      expect(schemas.schemaListePaiementsQuery.safeParse(requete).success, JSON.stringify(requete)).toBe(false)
    }
  })

  it('should require a motive in the body of an export and default the filters', () => {
    expect(schemas.schemaExportPaiements.parse({ motif: MOTIF })).toEqual({ motif: MOTIF, filtres: {} })
    expect(schemas.schemaExportPaiements.safeParse({ filtres: {} }).success).toBe(false)
    expect(schemas.schemaExportPaiements.safeParse({ motif: 'abc' }).success).toBe(false)
    expect(schemas.schemaExportPaiements.safeParse({ motif: MOTIF, filtres: { statut: 'reussi', inconnu: 1 } }).success).toBe(false)
    expect(schemas.schemaExportPaiements.safeParse({ motif: MOTIF, colonnes: ['telephone'] }).success).toBe(false)
  })

  it('should take the motive alone for a reminder', () => {
    expect(schemas.schemaRappelAbonnement.safeParse({ motif: MOTIF }).success).toBe(true)
    expect(schemas.schemaRappelAbonnement.safeParse({ motif: MOTIF, cleIdempotence: CLE }).success).toBe(false)
  })
})

describe('sorties A3 (liste blanche)', () => {
  const paiement = {
    id: 'p1',
    reference: 'ref-1',
    fournisseur: 'kpay',
    source: 'fournisseur',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_CMR',
    statut: 'reussi',
    plan: 'payant',
    periodeMois: 3,
    devise: 'XAF',
    montant: 5000,
    fraisReels: null,
    netReel: null,
    codeEchec: null,
    creeLe: INSTANT,
    appliqueLe: INSTANT,
    termineLe: INSTANT,
    utilisateur: { id: 'u1', email: 'pro@exemple.test' },
  }

  it('should accept exactly the listed keys', () => {
    expect(schemas.schemaPaiementDto.parse(paiement)).toEqual(paiement)
    expect(schemas.schemaPaiementDto.parse({ ...paiement, utilisateur: null }).utilisateur).toBeNull()
  })

  it.each([{ telephone: '+237600000000' }, { telephoneMasque: '••00' }, { telephoneEmpreinte: 'abc' }, { numero: '600' }, { payload: {} }])('should refuse the extra key %j', (extra) => {
    expect(schemas.schemaPaiementDto.safeParse({ ...paiement, ...extra }).success).toBe(false)
    expect(schemas.schemaPaiementDto.safeParse({ ...paiement, utilisateur: { id: 'u1', email: 'a@exemple.test', ...extra } }).success).toBe(false)
  })

  it('should refuse a non-integer amount, an unknown status, a bad currency or a bad duration', () => {
    for (const modif of [{ montant: 50.5 }, { montant: -1 }, { statut: 'paye' }, { devise: 'xaf' }, { periodeMois: 2 }, { source: 'cheque' }]) {
      expect(schemas.schemaPaiementDto.safeParse({ ...paiement, ...modif }).success, JSON.stringify(modif)).toBe(false)
    }
  })

  it('should expose only five fields of a provider event', () => {
    const evenement = { evenement: 'payment.completed', source: 'webhook', traitement: 'ignore', motif: 'STATUT_FINAL', recuLe: INSTANT }

    expect(schemas.schemaEvenementPaiementDto.parse(evenement)).toEqual(evenement)
    expect(schemas.schemaEvenementPaiementDto.safeParse({ ...evenement, corps: '{}' }).success).toBe(false)
  })

  const agregat = { brut: 0, nombre: 0, fraisReels: 0, nombreSansFrais: 0 }
  const periode = { debut: INSTANT, fin: INSTANT, kpay: agregat, manuel: agregat }

  it('should require one card per currency and the uncertainty notice, with no cross-currency total', () => {
    const revenus = {
      devises: [{ devise: 'XAF', mois: { courant: periode, precedent: periode }, abonnesActifs: 2, repartition: [{ periodeMois: 1, nombre: 1, brut: 1000 }] }],
      offerts: { jours: 30, nombre: 1 },
      mention: REVENUS_MENTION_INCERTITUDE,
      genereLe: INSTANT,
    }

    expect(schemas.schemaRevenusDto.parse(revenus)).toEqual(revenus)
    expect(schemas.schemaRevenusDto.safeParse({ ...revenus, total: 1000 }).success).toBe(false)
    expect(schemas.schemaRevenusDto.safeParse({ ...revenus, mention: '' }).success).toBe(false)
    expect(schemas.schemaRevenusDto.safeParse({ ...revenus, devises: [{ ...revenus.devises[0], brut: 1 }] }).success).toBe(false)
  })

  it('should bound the incoherence lists to 20 identifiers', () => {
    const alertes = (ids: string[]) => ({
      paiementsEnAttente: { nombre: 0, ids: [] },
      webhooksRefuses1h: 0,
      incoherences: { paiementsSansProlongation: ids, abonnementsSansPaiement: [] },
      encaissementsTardifs: 0,
      genereLe: INSTANT,
    })

    expect(schemas.schemaAlertesDto.safeParse(alertes(Array.from({ length: 20 }, (_, i) => `p${i}`))).success).toBe(true)
    expect(schemas.schemaAlertesDto.safeParse(alertes(Array.from({ length: 21 }, (_, i) => `p${i}`))).success).toBe(false)
  })

  it('should answer a re-verification and a manual marking with exactly their fields', () => {
    expect(schemas.schemaReverificationReponse.safeParse({ resultat: 'deja_applique', statut: 'reussi', rejoue: false }).success).toBe(true)
    expect(schemas.schemaReverificationReponse.safeParse({ resultat: 'rembourse', statut: 'reussi', rejoue: false }).success).toBe(false)
    expect(schemas.schemaMarquagePaiementReponse.safeParse({ paiementId: 'p2', expireLe: INSTANT, rejoue: true }).success).toBe(true)
    expect(schemas.schemaMarquagePaiementReponse.safeParse({ paiementId: 'p2', expireLe: INSTANT, rejoue: true, code: '123456' }).success).toBe(false)
    expect(schemas.schemaRappelAbonnementReponse.safeParse({ planifie: true }).success).toBe(true)
  })

  it('should keep every response schema free of audit-blacklisted keys except the account holder e-mail', () => {
    // `email` : titulaire du compte. `nom` de la vue d'ensemble : l'administrateur connecté lui-même (comme A1).
    const autorisees = new Set(['email', 'schemaVueEnsembleEnrichieDto.nom'])
    const cles = (valeur: unknown): string[] => {
      const def = (valeur as { _zod?: { def?: Record<string, unknown> } })._zod?.def
      if (!def) return []
      const shape = def.shape as Record<string, unknown> | undefined
      const enfants = shape ? Object.entries(shape).flatMap(([cle, enfant]) => [cle, ...cles(enfant)]) : []
      const element = def.element ? cles(def.element) : []
      const interne = def.innerType ? cles(def.innerType) : []
      return [...enfants, ...element, ...interne]
    }
    const violations = Object.entries(schemas)
      .filter(([nom]) => /^schema.*(Dto|Reponse)$/.test(nom))
      .flatMap(([nom, schema]) => cles(schema).filter((cle) => CLES_AUDIT_INTERDITES.includes(cle) && !autorisees.has(cle) && !autorisees.has(`${nom}.${cle}`)).map((cle) => `${nom}.${cle}`))

    expect(violations).toEqual([])
  })
})
