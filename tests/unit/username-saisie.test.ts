import { describe, expect, it } from 'vitest'
import { finaliserUsernameSaisie, formaterUsernameSaisie, validateUsername } from '../../shared/schemas/username'

// Mise en forme automatique du champ d'adresse : on corrige ce qui peut l'être au lieu d'afficher une erreur.

describe('formaterUsernameSaisie', () => {
  it.each([
    ['Dr Cabrel Nguesso', 'dr-cabrel-nguesso'],
    ['dr cabrel', 'dr-cabrel'],
    ['  dr   cabrel  ', 'dr-cabrel-'],
    ['Éloïse Ndiaye', 'eloise-ndiaye'],
    ['jean_pierre', 'jean-pierre'],
    ['jean.pierre', 'jean-pierre'],
    ['n’guessan', 'n-guessan'],
    ["l'atelier", 'l-atelier'],
    ['dr--cabrel', 'dr-cabrel'],
    ['-dr-cabrel', 'dr-cabrel'],
    ['dr@cabrel!', 'drcabrel'],
    ['DR-CABREL', 'dr-cabrel'],
    ['', ''],
  ])('%j devient %j', (saisie, attendu) => {
    expect(formaterUsernameSaisie(saisie)).toBe(attendu)
  })

  it('garde le tiret final : on est peut-être en train d’écrire la suite', () => {
    expect(formaterUsernameSaisie('dr-')).toBe('dr-')
    expect(formaterUsernameSaisie('dr ')).toBe('dr-')
  })

  it('limite à 30 caractères', () => {
    expect(formaterUsernameSaisie('a'.repeat(50))).toHaveLength(30)
  })

  it('est idempotente', () => {
    const une = formaterUsernameSaisie('  Éloïse  N’Diaye__Dr ')
    expect(formaterUsernameSaisie(une)).toBe(une)
  })
})

describe('finaliserUsernameSaisie', () => {
  it('retire les tirets de fin', () => {
    expect(finaliserUsernameSaisie('dr-cabrel-')).toBe('dr-cabrel')
    expect(finaliserUsernameSaisie('Dr Cabrel  ')).toBe('dr-cabrel')
  })

  it('produit une adresse acceptée par la validation du serveur dès que le résultat est assez long et non réservé', () => {
    for (const saisie of ['Dr Cabrel Nguesso', 'Éloïse N’Diaye', 'jean_pierre.martin']) {
      expect(validateUsername(finaliserUsernameSaisie(saisie)).success, saisie).toBe(true)
    }
  })

  it('ne contourne pas les règles : trop court ou réservé reste refusé par le serveur', () => {
    expect(validateUsername(finaliserUsernameSaisie('ab')).success).toBe(false)
    expect(validateUsername(finaliserUsernameSaisie('Admin')).success).toBe(false)
  })
})
