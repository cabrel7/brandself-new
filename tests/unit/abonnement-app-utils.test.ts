import { describe, expect, it } from 'vitest'
import {
  chiffresTelephone, dernierJourAvant, detailPeriode, formaterJourLocal, formaterMontant,
  libelleJoursRestants, phraseRappels, premierJourMoisSuivant, telephoneSaisiPlausible,
} from '../../app/utils/abonnement'
import { lignesPlan } from '../../app/utils/tarifs'

describe('abonnement (app/utils)', () => {
  it('formate un montant XAF sans décimale', () => {
    expect(formaterMontant(48000, 'XAF', 0).replace(/\s/g, ' ')).toBe('48 000 XAF')
  })

  it('formate un jour local et un dernier jour inclus', () => {
    expect(formaterJourLocal('2026-11-22')).toBe('22 novembre 2026')
    // Échéance exclusive à minuit local (UTC+1) : le dernier jour couvert est la veille.
    expect(dernierJourAvant('2026-11-22T23:00:00.000Z', 'Africa/Douala')).toBe('22 novembre 2026')
  })

  it('donne le premier jour du mois suivant dans le fuseau', () => {
    // 23 h 30 UTC le 30 novembre = 0 h 30 le 1er décembre à Douala : le mois courant est décembre.
    expect(premierJourMoisSuivant(new Date('2026-11-30T23:30:00Z'), 'Africa/Douala')).toBe('1 janvier 2027')
    expect(premierJourMoisSuivant(new Date('2026-11-15T10:00:00Z'), 'Africa/Douala')).toBe('1 décembre 2026')
  })

  it('accorde les jours restants', () => {
    expect(libelleJoursRestants(31)).toBe('Il vous reste 31 jours.')
    expect(libelleJoursRestants(1)).toBe('Il vous reste 1 jour.')
    expect(libelleJoursRestants(0)).toContain('dernier jour')
  })

  it('décrit une période et nettoie un numéro', () => {
    const prix = { periodeMois: 12 as const, montant: 48000, montantParMois: 4000, remisePct: 20, miseEnAvant: true }
    expect(detailPeriode(prix, 'XAF', 0)).toContain('le plus avantageux')
    expect(chiffresTelephone('+237 6 53-45.67 89')).toBe('237653456789')
    expect(telephoneSaisiPlausible('6534')).toBe(false)
    expect(telephoneSaisiPlausible('653456789')).toBe(true)
    expect(phraseRappels()).toBe('Nous vous envoyons un rappel 7 jours et 3 jours avant, puis le jour de l’échéance.')
  })

  it('compose les lignes d’un plan depuis ses limites', () => {
    const base = { 'services': 3, 'realisations': 3, 'temoignages': 3, 'reservations_mois': 10, 'generations_ia_mois': 3 }
    const gratuit = lignesPlan({ id: 'gratuit', limites: base, badge: true, statistiquesJours: 7 })
    expect(gratuit[0]).toBe('3 services, 3 réalisations, 3 témoignages')
    expect(gratuit).toContain('10 réservations par mois')
    const illimite = { 'services': null, 'realisations': null, 'temoignages': null, 'reservations_mois': null, 'generations_ia_mois': null }
    const payant = lignesPlan({ id: 'payant', limites: illimite, badge: false, statistiquesJours: 90 })
    expect(payant[0]).toBe('Services, réalisations et témoignages illimités')
    expect(payant).toContain('Sans badge Brandself')
  })
})
