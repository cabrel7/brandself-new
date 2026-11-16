import { describe, expect, it } from 'vitest'
import type { PaysDto, ReferentielsDto } from '../../../shared/schemas/admin-catalogues'
import {
  erreurFuseaux,
  lireOngletCatalogue,
  modificationsPays,
  nomBloqueValide,
  noteCanal,
  resumeCanaux,
  saisieDepuisPays,
} from '../../../app/utils/admin-catalogues'
import { optionsIndicatifsSms, optionsPays } from '../../../app/utils/referentiels'

const PAYS: PaysDto = {
  code: 'CM', libelle: 'Cameroun', indicatif: '237', actif: true, deviseDefaut: 'XAF', fuseaux: ['Africa/Douala'],
  canalSms: true, canalWhatsapp: false, canalEmail: true, smsEffectif: false, whatsappEffectif: false, utilise: true,
  modifieLe: '2026-01-01T00:00:00.000Z',
}

describe('A5 UI : catalogues', () => {
  it('lit l’onglet dans l’URL, pays par défaut', () => {
    expect(lireOngletCatalogue('devises')).toBe('devises')
    expect(lireOngletCatalogue('x')).toBe('pays')
  })

  it('n’envoie que les champs modifiés', () => {
    const saisie = saisieDepuisPays(PAYS)
    expect(modificationsPays(PAYS, saisie)).toEqual({})
    saisie.actif = false
    saisie.libelle = '  Cameroun  '
    saisie.fuseaux = ['Africa/Douala', 'Africa/Lagos']
    expect(modificationsPays(PAYS, saisie)).toEqual({ actif: false, fuseaux: ['Africa/Douala', 'Africa/Lagos'] })
  })

  it('contrôle les fuseaux', () => {
    expect(erreurFuseaux(['Africa/Douala'])).toBe('')
    expect(erreurFuseaux([])).not.toBe('')
    expect(erreurFuseaux(['Africa/Nulle-part'])).toContain('Africa/Nulle-part')
    expect(erreurFuseaux(['Africa/Douala', 'Africa/Douala'])).not.toBe('')
  })

  it('signale un canal ouvert sans fournisseur', () => {
    expect(noteCanal('sms', true, false)).toContain('fournisseur')
    expect(noteCanal('sms', true, true)).toBe('')
    expect(noteCanal('whatsapp', false, false)).toBe('')
    expect(resumeCanaux(PAYS)).toBe('Email')
    expect(resumeCanaux({ smsEffectif: false, whatsappEffectif: false, canalEmail: false })).toBe('Aucun canal ouvert')
  })

  it('valide un nom bloqué comme le serveur (rogné, minuscules)', () => {
    expect(nomBloqueValide('  Admin ')).toBe(true)
    expect(nomBloqueValide('a')).toBe(false)
    expect(nomBloqueValide('mon nom')).toBe(false)
  })
})

describe('A5 UI : référentiels', () => {
  const REF: ReferentielsDto = {
    pays: [
      { code: 'CA', libelle: 'Canada', indicatif: '1', deviseDefaut: 'USD', fuseaux: ['America/Toronto'], canaux: { sms: true, whatsapp: false, email: true } },
      { code: 'US', libelle: 'États-Unis', indicatif: '1', deviseDefaut: 'USD', fuseaux: ['America/New_York'], canaux: { sms: true, whatsapp: false, email: true } },
      { code: 'CM', libelle: 'Cameroun', indicatif: '237', deviseDefaut: 'XAF', fuseaux: ['Africa/Douala'], canaux: { sms: false, whatsapp: false, email: true } },
    ],
    devises: ['XAF'],
  }

  it('regroupe un indicatif partagé et masque les pays sans SMS', () => {
    expect(optionsIndicatifsSms(REF)).toEqual([{ label: '+1', value: '+1', description: 'Canada / États-Unis' }])
  })

  it('retombe sur les listes du code si la lecture échoue', () => {
    expect(optionsIndicatifsSms(null).length).toBeGreaterThan(0)
    expect(optionsPays(null).some((o) => o.value === 'CM')).toBe(true)
    expect(optionsPays(REF).map((o) => o.value)).toEqual(['CA', 'US', 'CM'])
  })

  it('aucun pays avec SMS : liste vide (pas de repli silencieux)', () => {
    expect(optionsIndicatifsSms({ pays: [], devises: [] })).toEqual([])
  })
})
