// S11 : règles pures de statistiques (unitaires, aucune base, aucun service externe).
import { describe, expect, it } from 'vitest'
import {
  empreinteVisite,
  estEmpreinteValide,
  estRobot,
  classifierAppareil,
  classifierSource,
  normaliserPage,
  paysDepuisEntetes,
  bornesPeriodeLocale,
  periodesAutorisees,
} from '../../server/services/statistiques-regles'

describe('employeVisite (HMAC empreinte)', () => {
  const ip = '203.0.113.7'
  const vitrine = 'seed-vitrine-dr-cabrel'

  it('produit une empreinte hex64', () => {
    expect(estEmpreinteValide(empreinteVisite(ip, vitrine, '2026-01-02'))).toBe(true)
    expect(empreinteVisite(ip, vitrine, '2026-01-02')).toMatch(/^[a-f0-9]{64}$/)
  })

  it('même IP + même vitrine + même jour → même empreinte', () => {
    const a = empreinteVisite(ip, vitrine, '2026-01-02')
    const b = empreinteVisite(ip, vitrine, '2026-01-02')
    expect(a).toBe(b)
  })

  it('même IP + même vitrine + jour différent → empreinte différente (sel journalier)', () => {
    expect(empreinteVisite(ip, vitrine, '2026-01-02')).not.toBe(empreinteVisite(ip, vitrine, '2026-01-03'))
  })

  it('même IP + même jour + vitrine différente → empreinte différente (cloisonnement)', () => {
    expect(empreinteVisite(ip, vitrine, '2026-01-02')).not.toBe(empreinteVisite(ip, 'autre-vitrine', '2026-01-02'))
  })
})

describe('normaliserPage (#182)', () => {
  const cases: Array<[string, { type: string; identifiant: string }]> = [
    ['/', { type: 'accueil', identifiant: '' }],
    ['/dr-cabrel', { type: 'accueil', identifiant: '' }],
    ['/dr-cabrel/', { type: 'accueil', identifiant: '' }],
    ['/dr-cabrel/services', { type: 'service', identifiant: '' }],
    ['/dr-cabrel/services/mon-cabinet', { type: 'service', identifiant: 'mon-cabinet' }],
    ['/dr-cabrel/realisations', { type: 'realisation', identifiant: '' }],
    ['/dr-cabrel/realisations/projet-x', { type: 'realisation', identifiant: 'projet-x' }],
    ['/dr-cabrel/agenda', { type: 'agenda', identifiant: '' }],
    ['/dr-cabrel/contact', { type: 'contact', identifiant: '' }],
    ['/dr-cabrel/reserver', { type: 'reservation', identifiant: '' }],
    ['/dr-cabrel/reserver/confirmation', { type: 'reservation', identifiant: 'confirmation' }],
    ['/@dr-cabrel', { type: 'autre', identifiant: '' }],
    ['/dr-cabrel/inconnu/truc', { type: 'autre', identifiant: '' }],
    ['/dr-cabrel/services/', { type: 'service', identifiant: '' }],
  ]
  it.each(cases)('%s → %s', (chemin, attendu) => {
    expect(normaliserPage(chemin)).toEqual(attendu)
  })
})

describe('classifierSource (#181)', () => {
  it('absent ou identique à l’URL courante → direct', () => {
    expect(classifierSource(null, '/dr-cabrel')).toBe('direct')
    expect(classifierSource('/dr-cabrel', '/dr-cabrel')).toBe('direct')
  })
  it('même domaine → interne', () => {
    expect(classifierSource('https://brandself.io/dr-cabrel/services', '/dr-cabrel/services', 'brandself.io')).toBe('interne')
    expect(classifierSource('https://www.brandself.io/', '/dr-cabrel', 'brandself.io')).toBe('interne')
  })
  it('hôte connu → marque', () => {
    expect(classifierSource('https://www.google.com/search?q=x', '/dr-cabrel')).toBe('google')
    expect(classifierSource('https://t.co/abc', '/dr-cabrel')).toBe('x')
    expect(classifierSource('https://l.facebook.com/', '/dr-cabrel')).toBe('facebook')
  })
  it('inconnu → autre', () => {
    expect(classifierSource('https://spam.example/', '/dr-cabrel')).toBe('autre')
    expect(classifierSource('n\'est pas une url', '/dr-cabrel')).toBe('autre')
  })
})

describe('classifierAppareil (#179)', () => {
  it('iPhone → mobile', () => {
    expect(classifierAppareil('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit')).toBe('mobile')
  })
  it('bureau → ordinateur', () => {
    expect(classifierAppareil('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36')).toBe('ordinateur')
  })
  it('UA absent → inconnu', () => {
    expect(classifierAppareil(null)).toBe('inconnu')
    expect(classifierAppareil('')).toBe('inconnu')
  })
})

describe('estRobot (#178)', () => {
  it('UA absent → robot', () => {
    expect(estRobot(null)).toBe(true)
    expect(estRobot('')).toBe(true)
  })
  it('navigateur → pas robot', () => {
    expect(estRobot('Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit')).toBe(false)
  })
  it('Googlebot → robot', () => {
    expect(estRobot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true)
  })
})

describe('paysDepuisEntetes (#180)', () => {
  it('cf-ipcountry valide', () => {
    expect(paysDepuisEntetes({ 'cf-ipcountry': 'CM' })).toBe('CM')
  })
  it('minuscules → null', () => {
    expect(paysDepuisEntetes({ 'cf-ipcountry': 'cm' })).toBe(null)
  })
  it('absent → null', () => {
    expect(paysDepuisEntetes({})).toBe(null)
  })
  it('ordre de priorité', () => {
    expect(paysDepuisEntetes({ 'x-country-code': 'FR', 'cf-ipcountry': 'CM' })).toBe('CM')
  })
})

describe('bornesPeriodeLocale', () => {
  it('7 jours incluant aujourd’hui (structure)', () => {
    const { debut, fin } = bornesPeriodeLocale(7, 'Africa/Douala')
    expect(debut.length).toBe(10)
    expect(fin.length).toBe(10)
    const d = new Date(debut).getTime()
    const f = new Date(fin).getTime()
    const jours = (f - d) / 86_400_000
    expect(jours).toBeGreaterThanOrEqual(5) // fuseau Douala vs UTC peut décaler d’un jour
    expect(jours).toBeLessThanOrEqual(7)
  })

  it('30 et 90 jours bornent correctement', () => {
    const { debut: d30, fin: f30 } = bornesPeriodeLocale(30, 'Africa/Douala')
    const { debut: d90, fin: f90 } = bornesPeriodeLocale(90, 'Africa/Douala')
    expect(f30).toBe(f90)
    expect(new Date(d90).getTime()).toBeLessThan(new Date(d30).getTime())
  })
})

describe('periodesAutorisees', () => {
  it('gratuit : 7 seulement', () => {
    expect(periodesAutorisees(7)).toEqual([7])
  })
  it('payant : 7, 30, 90', () => {
    expect(periodesAutorisees(90)).toEqual([7, 30, 90])
  })
  it('5 : rien', () => {
    expect(periodesAutorisees(5)).toEqual([])
  })
})
