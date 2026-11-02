import { describe, expect, it } from 'vitest'
import {
  DUREE_REQUISE,
  PAIEMENT_MODES,
  PAIEMENT_MODES_HORS_LIGNE,
  PAIEMENT_MODE_LIBELLES,
  RYTHMES,
  RYTHME_LIBELLES,
  RYTHME_PHRASES,
  SERVICE_ACTIONS,
  SERVICE_TYPES,
  SERVICE_TYPE_LIBELLES,
  SERVICE_TYPE_PASTILLES,
  TARIFS,
  TARIF_LIBELLES,
  VEDETTE_MAX,
  formatDureeCourte,
  formatDureeLongue,
  initialeDuTitre,
  libellePrix,
  metaStudio,
  resumeSeancesCourt,
  resumeSeancesLong,
  serviceActionHref,
  serviceDetailHref,
} from '../../shared/services'

// U16 — tables de libellés (une seule table de correspondance, SPRINTS S3) et fonctions pures.
const normaliser = (texte: string) => texte.replace(/[\u00a0\u202f]/g, ' ')
const MOTS_INTERDITS = /\b(espace|bloc|module|widget|section)s?\b/i

function toutesLesChaines(valeur: unknown): string[] {
  if (typeof valeur === 'string') return [valeur]
  if (valeur && typeof valeur === 'object') return Object.values(valeur).flatMap(toutesLesChaines)
  return []
}

describe('tables de libellés (U16)', () => {
  it.each([
    ['SERVICE_TYPE_PASTILLES', SERVICE_TYPE_PASTILLES, SERVICE_TYPES],
    ['SERVICE_TYPE_LIBELLES', SERVICE_TYPE_LIBELLES, SERVICE_TYPES],
    ['SERVICE_ACTIONS', SERVICE_ACTIONS, SERVICE_TYPES],
    ['DUREE_REQUISE', DUREE_REQUISE, SERVICE_TYPES],
    ['TARIF_LIBELLES', TARIF_LIBELLES, TARIFS],
    ['RYTHME_LIBELLES', RYTHME_LIBELLES, RYTHMES],
    ['RYTHME_PHRASES', RYTHME_PHRASES, RYTHMES],
    ['PAIEMENT_MODE_LIBELLES', PAIEMENT_MODE_LIBELLES, PAIEMENT_MODES],
  ] as const)('should have exactly one entry per value in %s', (_nom, table, valeurs) => {
    expect(Object.keys(table).sort()).toEqual([...valeurs].sort())
  })

  it('should give every label a non-empty text', () => {
    const textes = toutesLesChaines([
      SERVICE_TYPE_PASTILLES,
      SERVICE_TYPE_LIBELLES,
      SERVICE_ACTIONS,
      TARIF_LIBELLES,
      RYTHME_LIBELLES,
      RYTHME_PHRASES,
      PAIEMENT_MODE_LIBELLES,
    ])

    expect(textes.length).toBeGreaterThan(30)
    for (const texte of textes) {
      expect(texte.trim()).not.toBe('')
    }
  })

  it('should respect the product vocabulary: never "espace", "bloc", "module", "widget" or "section" (CLAUDE.md §2)', () => {
    const textes = toutesLesChaines([SERVICE_TYPE_PASTILLES, SERVICE_TYPE_LIBELLES, SERVICE_ACTIONS, TARIF_LIBELLES, RYTHME_LIBELLES, RYTHME_PHRASES, PAIEMENT_MODE_LIBELLES])

    for (const texte of textes) {
      expect(texte).not.toMatch(MOTS_INTERDITS)
    }
  })

  it('should give the wording of the specification for pastilles, actions and rhythms', () => {
    expect(SERVICE_TYPE_PASTILLES).toEqual({ rdv: 'Rendez-vous', accompagnement: 'Accompagnement', atelier: 'Atelier', devis: 'Prestation' })
    expect(SERVICE_ACTIONS.rdv).toEqual({ court: 'Réserver', long: 'Réserver' })
    expect(SERVICE_ACTIONS.accompagnement).toEqual({ court: 'Réserver la 1re séance', long: 'Réserver la première séance' })
    expect(SERVICE_ACTIONS.devis).toEqual({ court: 'Demander un devis', long: 'Demander un devis' })
    expect(SERVICE_ACTIONS.atelier.court).toMatch(/^S.inscrire$/)
    expect(RYTHME_LIBELLES.hebdomadaire).toBe('Une séance par semaine')
    expect(PAIEMENT_MODE_LIBELLES.sur_place).toEqual({ titre: 'Sur place, à la séance', description: 'Le client règle directement auprès de vous.' })
  })

  it('should only require a duration for the types that need one (the devis alone can go without)', () => {
    expect(DUREE_REQUISE).toEqual({ rdv: true, accompagnement: true, atelier: true, devis: false })
  })

  it('should propose only sur_place while online payment is off, and keep the product constant at 3 vedettes', () => {
    expect([...PAIEMENT_MODES_HORS_LIGNE]).toEqual(['sur_place'])
    expect(VEDETTE_MAX).toBe(3)
  })
})

describe('durées et séances (U16)', () => {
  it('should format durations', () => {
    expect(formatDureeCourte(45)).toBe('45 min')
    expect(formatDureeLongue(45)).toBe('45 minutes')
    expect(formatDureeCourte(5)).toBe('5 min')
  })

  it('should summarise sessions in short form, without duration when it is unknown', () => {
    expect(resumeSeancesCourt(6, 30)).toBe('6 séances · 30 min')
    expect(resumeSeancesCourt(6, null)).toBe('6 séances')
  })

  it('should summarise sessions in long form with the rhythm phrase when there is one', () => {
    expect(resumeSeancesLong(6, 30, 'hebdomadaire')).toBe('6 séances de 30 minutes, une par semaine')
    expect(resumeSeancesLong(4, 45, 'bimensuel')).toBe('4 séances de 45 minutes, une toutes les deux semaines')
    expect(resumeSeancesLong(6, 30, null)).toBe('6 séances de 30 minutes')
    expect(resumeSeancesLong(6, null, 'mensuel')).toBe('6 séances, une par mois')
  })
})

describe('metaStudio (U16)', () => {
  const base = { type: 'rdv', tarif: 'payant', nbSeances: null, dureeMin: 45, actif: true } as const

  it.each([
    [{ ...base }, 'Rendez-vous · 45 min · Payant'],
    [{ ...base, tarif: 'gratuit' }, 'Rendez-vous · 45 min · Gratuit'],
    [{ ...base, type: 'atelier', dureeMin: 90 }, 'Atelier · 90 min · Payant'],
    [{ ...base, type: 'accompagnement', nbSeances: 6, dureeMin: 30 }, 'Accompagnement · 6 séances · Payant'],
    [{ ...base, type: 'devis', tarif: 'devis', dureeMin: null }, 'Sur devis'],
    [{ ...base, type: 'devis', tarif: 'devis', dureeMin: 40 }, 'Sur devis'],
  ] as const)('should describe %j as %j', (service, attendu) => {
    expect(metaStudio(service)).toBe(attendu)
  })

  it('should append "· Masqué" for a masked service', () => {
    expect(metaStudio({ ...base, actif: false })).toBe('Rendez-vous · 45 min · Payant · Masqué')
    expect(metaStudio({ ...base, type: 'devis', tarif: 'devis', dureeMin: null, actif: false })).toBe('Sur devis · Masqué')
  })

  it('should not crash nor print "null" when an optional value is missing', () => {
    expect(metaStudio({ ...base, dureeMin: null })).not.toMatch(/null|undefined|NaN/)
    expect(metaStudio({ ...base, type: 'accompagnement', nbSeances: null, dureeMin: null })).not.toMatch(/null|undefined|NaN/)
  })
})

describe('libellePrix (U16)', () => {
  const rdv = { type: 'rdv', tarif: 'payant', prixMontant: 15000, prixDevise: 'XAF' } as const

  it('should say Gratuit for a free service and Sur devis for a devis tarif', () => {
    expect(libellePrix({ ...rdv, tarif: 'gratuit', prixMontant: null, prixDevise: null })).toBe('Gratuit')
    expect(libellePrix({ ...rdv, tarif: 'devis', prixMontant: null, prixDevise: null })).toBe('Sur devis')
  })

  it('should format a paid service price, and prefix an accompagnement with "Forfait "', () => {
    expect(normaliser(libellePrix(rdv))).toBe('15 000 XAF')
    expect(normaliser(libellePrix({ ...rdv, type: 'accompagnement' }))).toBe('Forfait 15 000 XAF')
    expect(normaliser(libellePrix({ ...rdv, prixMontant: 1250, prixDevise: 'EUR' }))).toBe('12,50 €')
  })

  it('should fall back to Sur devis for an incoherent paid service without price (never "null XAF")', () => {
    expect(libellePrix({ ...rdv, prixMontant: null })).toBe('Sur devis')
    expect(libellePrix({ ...rdv, prixDevise: null })).toBe('Sur devis')
  })
})

describe('initialeDuTitre (U16)', () => {
  it.each([
    ['Échographie', 'É'],
    ['consultation', 'C'],
    ['  bilan', 'B'],
    ['œuvre', 'Œ'],
    ['3 séances', '3'],
    ['😀 fête', '😀'],
  ])('should take the first letter of %j: %j', (titre, attendu) => {
    expect(initialeDuTitre(titre)).toBe(attendu)
  })

  it('should answer a non-empty fallback for an empty title', () => {
    expect(initialeDuTitre('').length).toBeGreaterThan(0)
    expect(initialeDuTitre('   ').length).toBeGreaterThan(0)
  })
})

describe('liens (U16)', () => {
  it('should build the detail and action links', () => {
    expect(serviceDetailHref('dr-cabrel', 'consultation-de-cardiologie')).toBe('/dr-cabrel/services/consultation-de-cardiologie')
    // S7-bis : le bouton d'action mène à l'agenda de la vitrine, service présélectionné.
    expect(serviceActionHref('dr-cabrel', 'consultation-de-cardiologie')).toBe('/dr-cabrel/agenda?service=consultation-de-cardiologie')
  })

  it('should never point the action link to the legacy /reserver step', () => {
    expect(serviceActionHref('dr-cabrel', 'consultation-de-cardiologie')).not.toContain('/reserver')
  })
})
