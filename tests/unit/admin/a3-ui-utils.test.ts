import { describe, expect, it } from 'vitest'
import { ERROR_CODES } from '../../../shared/erreurs'
import { PAIEMENT_SOURCES } from '../../../shared/admin-paiements'
import { PAIEMENT_STATUTS } from '../../../shared/paiements'
import type { AlertesDto } from '../../../shared/schemas/admin-paiements'
import { compterFiltresActifs } from '../../../app/utils/admin-ui'
import { listerAlertes } from '../../../app/utils/admin-alertes'
import {
  COULEURS_STATUT,
  formaterMontantAdmin,
  formaterMontantOuTiret,
  LIBELLES_STATUT,
  lireFiltresPaiements,
  lirePage,
  messageErreurAdmin,
  ERREUR_GENERIQUE,
  motifValide,
  nouvelleCleIdempotence,
  peutMarquerPaye,
  peutReverifier,
  periodeInvalide,
} from '../../../app/utils/admin-paiements'
import { ADMIN_CLE_IDEMPOTENCE_FORMAT, ADMIN_CLE_IDEMPOTENCE_MAX, ADMIN_CLE_IDEMPOTENCE_MIN } from '../../../shared/admin'

const normaliser = (texte: string): string => texte.replace(/\s/g, ' ')

describe('A3 UI : montants entiers par devise', () => {
  it('XAF sans décimale, EUR avec deux', () => {
    expect(normaliser(formaterMontantAdmin(15000, 'XAF'))).toBe('15 000 XAF')
    expect(normaliser(formaterMontantAdmin(1250, 'EUR'))).toBe('12,50 €')
  })
  it('une devise inconnue garde le code et l’entier', () => {
    expect(normaliser(formaterMontantAdmin(2500, 'GBP'))).toBe('2 500 GBP')
  })
  it('un montant inconnu s’affiche en tiret', () => {
    expect(formaterMontantOuTiret(null, 'XAF')).toBe('—')
    expect(normaliser(formaterMontantOuTiret(0, 'XAF'))).toBe('0 XAF')
  })
})

describe('A3 UI : libellés complets', () => {
  it('chaque statut a un libellé et une couleur', () => {
    for (const statut of PAIEMENT_STATUTS) {
      expect(LIBELLES_STATUT[statut]).toBeTruthy()
      expect(COULEURS_STATUT[statut]).toBeTruthy()
    }
  })
  it('un code d’erreur absent retombe sur le message générique', () => {
    expect(messageErreurAdmin(null)).toBe(ERREUR_GENERIQUE)
    expect(messageErreurAdmin('VITRINE_INTROUVABLE')).toBe(ERREUR_GENERIQUE)
  })
  it('les codes A3 ont un message propre', () => {
    for (const code of ['PAIEMENT_OUVERT', 'DEJA_PAYE', 'REVERIFICATION_REQUISE', 'RAPPEL_RECENT', 'EXPORT_TROP_GRAND', 'REAUTH_INVALIDE'] as const) {
      expect(ERROR_CODES).toContain(code)
      expect(messageErreurAdmin(code)).not.toBe(ERREUR_GENERIQUE)
    }
  })
})

describe('A3 UI : actions proposées (le serveur reste l’autorité)', () => {
  it('revérifier : K-PAY seulement', () => {
    expect(peutReverifier({ source: 'kpay' })).toBe(true)
    expect(peutReverifier({ source: 'manuel' })).toBe(false)
  })
  it('marquer payé : K-PAY et statut remplaçable, jamais réussi ni en cours', () => {
    expect(peutMarquerPaye({ source: 'kpay', statut: 'echoue' })).toBe(true)
    expect(peutMarquerPaye({ source: 'kpay', statut: 'anomalie' })).toBe(true)
    expect(peutMarquerPaye({ source: 'kpay', statut: 'reussi' })).toBe(false)
    expect(peutMarquerPaye({ source: 'kpay', statut: 'en_attente' })).toBe(false)
    expect(peutMarquerPaye({ source: 'manuel', statut: 'echoue' })).toBe(false)
  })
})

describe('A3 UI : motif et clé d’idempotence', () => {
  it('motif de 5 à 500 caractères après rognage', () => {
    expect(motifValide('    abc  ')).toBe(false)
    expect(motifValide('client appelé')).toBe(true)
    expect(motifValide('x'.repeat(501))).toBe(false)
  })
  it('la clé respecte le format du contrat et change à chaque appel', () => {
    const a = nouvelleCleIdempotence()
    const b = nouvelleCleIdempotence()
    expect(a).not.toBe(b)
    expect(a).toMatch(ADMIN_CLE_IDEMPOTENCE_FORMAT)
    expect(a.length).toBeGreaterThanOrEqual(ADMIN_CLE_IDEMPOTENCE_MIN)
    expect(a.length).toBeLessThanOrEqual(ADMIN_CLE_IDEMPOTENCE_MAX)
  })
})

describe('A3 UI : filtres lus dans l’URL', () => {
  it('ignore toute valeur inconnue ou mal formée', () => {
    const filtres = lireFiltresPaiements(
      { statut: 'bidon', source: 'kpay', devise: 'ZZZ', du: '2026-02-30x', au: '2026-11-01' },
      PAIEMENT_STATUTS,
      PAIEMENT_SOURCES,
    )
    expect(filtres).toEqual({ source: 'kpay', au: '2026-11-01' })
  })
  it('prend la première valeur d’un paramètre répété', () => {
    expect(lireFiltresPaiements({ statut: ['reussi', 'echoue'] }, PAIEMENT_STATUTS, PAIEMENT_SOURCES)).toEqual({ statut: 'reussi' })
  })
  it('période inversée détectée', () => {
    expect(periodeInvalide({ du: '2026-11-10', au: '2026-11-01' })).toBe(true)
    expect(periodeInvalide({ du: '2026-11-01', au: '2026-11-01' })).toBe(false)
    expect(periodeInvalide({ du: '2026-11-01' })).toBe(false)
  })
  it('page : entier positif, sinon 1', () => {
    expect(lirePage('3')).toBe(3)
    expect(lirePage('0')).toBe(1)
    expect(lirePage('abc')).toBe(1)
    expect(lirePage(undefined)).toBe(1)
  })
})

describe('A3 UI : lignes d’alerte', () => {
  const vide: AlertesDto = {
    paiementsEnAttente: { nombre: 0, ids: [] },
    webhooksRefuses1h: 0,
    incoherences: { paiementsSansProlongation: [], abonnementsSansPaiement: [] },
    encaissementsTardifs: 0,
    genereLe: '2026-11-15T10:00:00.000Z',
  }
  it('rien à signaler : aucune ligne', () => {
    expect(listerAlertes(vide)).toEqual([])
  })
  it('chaque alerte non nulle produit une ligne, avec lien quand une page existe', () => {
    const lignes = listerAlertes({
      ...vide,
      paiementsEnAttente: { nombre: 2, ids: ['a', 'b'] },
      webhooksRefuses1h: 11,
      incoherences: { paiementsSansProlongation: ['p1'], abonnementsSansPaiement: [] },
    })
    expect(lignes.map((l) => l.id)).toEqual(['paiements-en-attente', 'webhooks-refuses', 'sans-prolongation'])
    expect(lignes[0]?.to).toBe('/admin/paiements?statut=en_attente')
    expect(lignes[1]?.to).toBeUndefined()
    expect(lignes[2]?.to).toBe('/admin/paiements?id=p1')
  })
  it('accord au singulier', () => {
    const [ligne] = listerAlertes({ ...vide, encaissementsTardifs: 1 })
    expect(ligne?.libelle).toContain('1 encaissement tardif ignoré')
  })
})

describe('A3 UI : compteur de filtres actifs', () => {
  it('ignore la recherche, le tri et les valeurs absentes', () => {
    expect(compterFiltresActifs({ q: 'awa', tri: 'email', ordre: 'asc', plan: 'payant', du: '2026-11-01' }, ['q', 'tri', 'ordre'])).toBe(2)
    expect(compterFiltresActifs({ plan: undefined }, [])).toBe(0)
  })
})
