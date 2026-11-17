import { describe, expect, it } from 'vitest'
import { REGLAGE_CLES } from '../../../shared/reglages'
import type { ReglageDto, SanteDto } from '../../../shared/schemas/admin-a4'
import { filtresJournalDepuis, libelleActionJournal, lignesEtatJournal, periodeJournalInvalide } from '../../../app/utils/admin-journal'
import {
  erreurSaisieReglage,
  lireCategorieReglage,
  peutRetablirReglage,
  valeurRepliReglage,
} from '../../../app/utils/admin-reglages'
import {
  fileEnAlerte,
  formaterOctetsSupervision,
  formaterTauxSupervision,
  listerPointsSupervision,
  tronquerIdentifiant,
} from '../../../app/utils/admin-supervision'

function reglage(partiel: Partial<ReglageDto> & Pick<ReglageDto, 'cle' | 'type' | 'valeur' | 'defaut'>): ReglageDto {
  return {
    libelle: 'Libellé',
    aide: 'Aide',
    categorie: 'acces',
    reauth: true,
    modifiable: true,
    securite: false,
    surcharge: false,
    min: null,
    max: null,
    longueurMax: null,
    modifieLe: null,
    modifiePar: null,
    ...partiel,
  }
}

const santeOk: SanteDto = {
  base: { etat: 'ok', latenceMs: 3 },
  redis: { etat: 'ok', latenceMs: 1 },
  disque: { etat: 'ok', libreOctets: 10, totalOctets: 20, libresPct: 50 },
  sauvegarde: { etat: 'ok', derniereReussiteLe: '2026-01-01T00:00:00.000Z', ageHeures: 2 },
  version: '1.0.0',
  genereLe: '2026-01-01T02:00:00.000Z',
}

describe('A4 UI : réglages', () => {
  const entier = reglage({ cle: REGLAGE_CLES.iaLimiteUtilisateurHeure, type: 'entier', valeur: 10, defaut: 10, min: 1, max: 100 })

  it('refuse un entier hors bornes, vide ou non entier', () => {
    expect(erreurSaisieReglage(entier, 0, [entier])).not.toBe('')
    expect(erreurSaisieReglage(entier, 101, [entier])).not.toBe('')
    expect(erreurSaisieReglage(entier, null, [entier])).not.toBe('')
    expect(erreurSaisieReglage(entier, 2.5, [entier])).not.toBe('')
    expect(erreurSaisieReglage(entier, 50, [entier])).toBe('')
  })

  it('applique la validation croisée du registre (maintenance sans message)', () => {
    const active = reglage({ cle: REGLAGE_CLES.maintenanceActive, type: 'booleen', valeur: false, defaut: false })
    const message = reglage({ cle: REGLAGE_CLES.maintenanceMessage, type: 'texte', valeur: '', defaut: '', longueurMax: 280 })
    expect(erreurSaisieReglage(active, true, [active, message])).not.toBe('')
    expect(erreurSaisieReglage(active, false, [active, message])).toBe('')
  })

  it('le repli d\'un drapeau de sécurité est la valeur restrictive, pas la valeur du code', () => {
    const inscriptions = reglage({ cle: REGLAGE_CLES.inscriptionsOuvertes, type: 'booleen', valeur: true, defaut: true, securite: true })
    expect(valeurRepliReglage(inscriptions)).toBe(false)
    expect(valeurRepliReglage(entier)).toBe(10)
  })

  it('« Rétablir » exige une valeur personnalisée et un réglage modifiable', () => {
    expect(peutRetablirReglage(entier)).toBe(false)
    expect(peutRetablirReglage({ ...entier, surcharge: true })).toBe(true)
    expect(peutRetablirReglage({ ...entier, surcharge: true, modifiable: false })).toBe(false)
  })

  it('une catégorie inconnue retombe sur la première', () => {
    expect(lireCategorieReglage('nimporte')).toBe('acces')
    expect(lireCategorieReglage(['ia'])).toBe('ia')
    expect(lireCategorieReglage(undefined)).toBe('acces')
  })
})

describe('A4 UI : supervision', () => {
  it('ne signale rien quand tout est en ordre', () => {
    expect(listerPointsSupervision(santeOk, undefined)).toEqual([])
  })

  it('une sauvegarde inconnue est un point à examiner, jamais une bonne nouvelle', () => {
    const points = listerPointsSupervision({ ...santeOk, sauvegarde: { etat: 'inconnue', derniereReussiteLe: null, ageHeures: null } }, undefined)
    expect(points.map((point) => point.id)).toEqual(['sauvegarde'])
  })

  it('signale une file au seuil d\'échecs', () => {
    expect(fileEnAlerte(20, 20)).toBe(true)
    expect(fileEnAlerte(19, 20)).toBe(false)
  })

  it('formate sans NaN : taux sans total, octets absents', () => {
    expect(formaterTauxSupervision(0, 0)).toBe('—')
    expect(formaterOctetsSupervision(null)).toBe('—')
    expect(formaterOctetsSupervision(1_536)).toMatch(/^1,5 Ko$/)
  })

  it('tronque un identifiant long seulement', () => {
    expect(tronquerIdentifiant('abc')).toBe('abc')
    expect(tronquerIdentifiant('0123456789abcdef')).toBe('01234567…')
  })
})

describe('A4 UI : journal', () => {
  it('une action inconnue s\'affiche telle quelle', () => {
    expect(libelleActionJournal('reglage.modifier')).toBe('Modification d’un réglage')
    expect(libelleActionJournal('futur.action')).toBe('futur.action')
  })

  it('lit un état plat en lignes lisibles', () => {
    expect(lignesEtatJournal(null)).toEqual([])
    expect(lignesEtatJournal({ ia_active: true, valeur: null, longueur: 200 })).toEqual([
      { cle: 'ia_active', libelle: 'ia active', valeur: 'oui' },
      { cle: 'valeur', libelle: 'valeur', valeur: '—' },
      { cle: 'longueur', libelle: 'longueur', valeur: '200' },
    ])
  })

  it('ne transmet à l\'export que les filtres connus', () => {
    expect(filtresJournalDepuis({ action: 'job.relancer', page: '3', limite: '25', du: '2026-01-01' })).toEqual({ action: 'job.relancer', du: '2026-01-01' })
  })

  it('détecte une période inversée', () => {
    expect(periodeJournalInvalide('2026-02-01', '2026-01-01')).toBe(true)
    expect(periodeJournalInvalide('', '2026-01-01')).toBe(false)
  })
})
