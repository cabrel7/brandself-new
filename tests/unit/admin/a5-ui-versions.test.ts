import { describe, expect, it } from 'vitest'
import type { ImpactPlan, ValeursPlan, ValeursPrix, VersionDto } from '../../../shared/schemas/admin-versions'
import {
  actionsVersion,
  cheminActionVersion,
  clesDuTypeVersion,
  erreursPlan,
  erreursPrix,
  erreursPrompt,
  erreurTaux,
  formMoyensDepuis,
  formPlanDepuis,
  formPrixDepuis,
  impactNonNul,
  instantDepuisSaisie,
  lireTypeVersion,
  lignesImpact,
  phraseImpact,
  pourcentageDepuisPointsBase,
  programmationValide,
  valeursMoyensDepuis,
  valeursPlanDepuis,
  valeursPrixDepuis,
  variablesDuGabarit,
} from '../../../app/utils/admin-versions'

const PLAN: ValeursPlan = {
  services: 3, realisations: 3, temoignages: 3, reservationsParMois: 10, generationsIaParMois: 3,
  badge: true, statistiquesJours: 7, statistiquesDetails: false, capacites: { mcp: false },
}
const PRIX: ValeursPrix = {
  XAF: { 1: 5000, 3: 13500, 12: 48000 },
  EUR: { 1: 800, 3: 2200, 12: 7700 },
  USD: { 1: 900, 3: 2500, 12: 8600 },
}
const BASE = { id: 'v-1', cle: 'payant', numero: 2, effectiveA: '2026-01-01T00:00:00.000Z', valideeLe: null, motif: 'Motif', creePar: 'a', creeLe: '2026-01-01T00:00:00.000Z' }

describe('A5 UI : versions', () => {
  it('lit le type dans l’URL, plans par défaut', () => {
    expect(lireTypeVersion('prix')).toBe('prix')
    expect(lireTypeVersion('inconnu')).toBe('plans')
    expect(lireTypeVersion(['frais'])).toBe('frais')
  })

  it('liste les clés choisissables (vide pour frais et moyens)', () => {
    expect(clesDuTypeVersion('plans')).toEqual(['gratuit', 'payant'])
    expect(clesDuTypeVersion('frais')).toEqual([])
  })

  it('propose les actions selon le statut', () => {
    const brouillon: VersionDto = { type: 'plans', ...BASE, statut: 'brouillon', effectiveA: null, valeurs: PLAN }
    const active: VersionDto = { type: 'prix', ...BASE, statut: 'active', valeurs: PRIX }
    const remplacee: VersionDto = { type: 'prix', ...BASE, statut: 'remplacee', valeurs: PRIX }
    expect(actionsVersion(brouillon)).toEqual(['activer', 'programmer'])
    expect(actionsVersion(active)).toEqual(['valider', 'retour'])
    expect(actionsVersion({ ...active, valideeLe: '2026-01-02T00:00:00.000Z' })).toEqual(['retour'])
    expect(actionsVersion({ ...active, numero: 1, valideeLe: '2026-01-02T00:00:00.000Z' })).toEqual([])
    expect(actionsVersion(remplacee)).toEqual([])
  })

  it('un prompt ne se programme pas', () => {
    const prompt: VersionDto = {
      type: 'prompts', id: 'p-1', cle: 'seo_vitrine', numero: 3, statut: 'inactive', motif: null, creePar: null,
      creeLe: '2026-01-01T00:00:00.000Z',
      valeurs: { systeme: 's', gabarit: 'g', variables: [], parametres: {}, schemaSortie: 'seo' },
    }
    expect(actionsVersion(prompt)).toEqual(['activer'])
  })

  it('construit le chemin d’écriture', () => {
    expect(cheminActionVersion('plans', 'v 1', 'programmer')).toBe('/api/admin/versions/plans/v%201/activer')
    expect(cheminActionVersion('prix', 'v1', 'valider')).toBe('/api/admin/versions/prix/v1/valider')
    expect(cheminActionVersion('moyens', 'v1', 'retour')).toBe('/api/admin/versions/moyens/v1/retour')
  })

  it('refuse une programmation passée ou trop proche', () => {
    const maintenant = new Date('2026-06-01T10:00:00.000Z')
    expect(instantDepuisSaisie('')).toBeNull()
    expect(programmationValide('', maintenant)).toBe(false)
    expect(programmationValide('2026-06-01T10:05:00.000Z', maintenant)).toBe(false)
    expect(programmationValide('2026-06-02T10:00:00.000Z', maintenant)).toBe(true)
  })
})

describe('A5 UI : impact', () => {
  const IMPACT: ImpactPlan = {
    services: { comptes: 1, elementsMasques: 2 },
    realisations: { comptes: 0, elementsMasques: 0 },
    temoignages: { comptes: 0, elementsMasques: 0 },
    reservationsMois: { comptes: 0 },
    generationsIaMois: { comptes: 0 },
  }

  it('détecte un impact non nul et accorde les phrases', () => {
    expect(impactNonNul(IMPACT)).toBe(true)
    expect(impactNonNul({ ...IMPACT, services: { comptes: 0, elementsMasques: 0 } })).toBe(false)
    const [services, , , reservations] = lignesImpact(IMPACT)
    expect(phraseImpact(services!)).toBe('1 compte, 2 éléments masqués')
    expect(phraseImpact(reservations!)).toBe('0 compte')
  })
})

describe('A5 UI : formulaires', () => {
  it('plan : aller-retour fidèle et refus du gratuit illimité', () => {
    const form = formPlanDepuis(PLAN)
    expect(valeursPlanDepuis(form)).toEqual(PLAN)
    expect(erreursPlan('gratuit', form)).toEqual({})
    form.limites.services.illimite = true
    expect(valeursPlanDepuis(form).services).toBeNull()
    expect(erreursPlan('gratuit', form)['limites.services']).toBeDefined()
    expect(erreursPlan('payant', form)).toEqual({})
    form.limites.realisations.valeur = 10_001
    expect(erreursPlan('payant', form)['limites.realisations']).toBeDefined()
  })

  it('prix : saisie en unité usuelle, jamais de flottant', () => {
    const form = formPrixDepuis(PRIX)
    expect(form.EUR['1']).toBe('8,00')
    expect(valeursPrixDepuis(form)).toEqual(PRIX)
    form.EUR['1'] = '8,005'
    expect(erreursPrix(form)['EUR.1']).toBeDefined()
    expect(valeursPrixDepuis(form)).toBeNull()
    form.EUR['1'] = '8,5'
    form.XAF['3'] = '0'
    expect(erreursPrix(form)['XAF.3']).toBeDefined()
  })

  it('frais : taux borné et pourcentage lisible', () => {
    expect(erreurTaux(500)).toBe('')
    expect(erreurTaux(5001)).not.toBe('')
    expect(erreurTaux(1.5)).not.toBe('')
    expect(pourcentageDepuisPointsBase(500)).toBe('5 %')
    expect(pourcentageDepuisPointsBase(125)).toBe('1,25 %')
  })

  it('moyens : un interrupteur par moyen connu, seuls les actifs partent', () => {
    const form = formMoyensDepuis({ actifs: ['kpay:ORANGE_CMR'] }, ['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'])
    expect(form).toEqual({ 'kpay:MTN_MOMO_CMR': false, 'kpay:ORANGE_CMR': true })
    form['kpay:MTN_MOMO_CMR'] = true
    expect(valeursMoyensDepuis(form).actifs).toEqual(['kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR'])
  })

  it('prompt : bornes et variables du gabarit', () => {
    expect(erreursPrompt({ systeme: 's', gabarit: 'g {{donnees}}', temperature: 0.5, maxTokens: 1000 })).toEqual({})
    const erreurs = erreursPrompt({ systeme: ' ', gabarit: '', temperature: 2, maxTokens: 50 })
    expect(Object.keys(erreurs).sort()).toEqual(['gabarit', 'maxTokens', 'systeme', 'temperature'])
    expect(variablesDuGabarit('a {{donnees}} b {{nom}} {{donnees}}')).toEqual(['donnees', 'nom'])
  })
})
