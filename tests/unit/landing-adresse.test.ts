// Page d'accueil : règles d'adresse du champ (`Adresse.vue`).
// Le contrôle de format s'appuie sur `validateUsername` (testé directement). La normalisation de saisie
// (`versAdresse`) est DÉFINIE DANS le composant .vue : elle n'est pas importable. Pour la tester sans toucher
// au code de production, on en extrait le texte source du fichier réel et on l'exécute : si la fonction est
// renommée ou déplacée, le test échoue bruyamment (« introuvable ») au lieu de passer à vide.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateUsername } from '../../shared/schemas/username'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SOURCE = readFileSync(path.join(RACINE, 'app/components/marketing/Adresse.vue'), 'utf8')

function premierMessage(valeur: string): string | undefined {
  const resultat = validateUsername(valeur)
  return resultat.success ? undefined : resultat.error.issues[0]?.message
}

function extraireVersAdresse(): (saisie: string) => string {
  const entete = /function versAdresse\(saisie: string\): string \{\n([\s\S]*?)\n\}\n/.exec(SOURCE)
  const longueur = /const LONGUEUR_MAX = (\d+)/.exec(SOURCE)
  if (!entete?.[1] || !longueur?.[1]) throw new Error('versAdresse ou LONGUEUR_MAX introuvable dans Adresse.vue')
  const fabrique = new Function('saisie', 'LONGUEUR_MAX', entete[1]) as (saisie: string, max: number) => string
  return saisie => fabrique(saisie, Number(longueur[1]))
}

/** Reproduit `valeur` du composant : le tiret final de saisie en cours est retiré avant validation. */
function valeurValidee(saisie: string, versAdresse: (s: string) => string): string {
  return versAdresse(saisie).replace(/-$/, '')
}

describe('validateUsername : cas du champ d’adresse', () => {
  it.each(['dr-cabrel', 'maitre-nom', 'abc', 'a1b', 'studio-photo-2', 'x'.repeat(30)])(
    'should accept %s',
    (adresse) => {
      expect(validateUsername(adresse).success).toBe(true)
    },
  )

  it.each(['', 'a', 'ab'])('should refuse "%s" as too short', (adresse) => {
    expect(validateUsername(adresse).success).toBe(false)
    expect(premierMessage(adresse)).toBe('au moins 3 caractères')
  })

  it('should refuse 31 characters', () => {
    expect(premierMessage('x'.repeat(31))).toBe('30 caractères au maximum')
  })

  it.each(['admin', 'api', 'studio', 'connexion', 'tarifs', 'contact', 'mcp', 'jesuispro', 'www'])(
    'should refuse the reserved word %s',
    (mot) => {
      expect(premierMessage(mot)).toBe('ce nom est réservé')
    },
  )

  it('should refuse a reserved word whatever its case', () => {
    expect(validateUsername('ADMIN').success).toBe(false)
    expect(validateUsername('  Api  ').success).toBe(false)
  })

  it('should normalize case and surrounding spaces of the schema', () => {
    const resultat = validateUsername('  Dr-Cabrel ')

    expect(resultat.success).toBe(true)
    expect(resultat.success && resultat.data).toBe('dr-cabrel')
  })

  it.each(['dr-', '-dr', 'dr--cabrel', 'dr cabrel', 'dr_cabrel', 'drcabrél', 'dr.cabrel', 'dr/cabrel', '../etc'])(
    'should refuse the malformed address %s',
    (adresse) => {
      expect(validateUsername(adresse).success).toBe(false)
    },
  )

  it('should report a single readable first message for the field', () => {
    expect(premierMessage('dr-')).toContain('minuscules, chiffres et tirets')
  })
})

describe('versAdresse (extraite de Adresse.vue)', () => {
  const versAdresse = extraireVersAdresse()

  it.each([
    ['Dr Cabrel', 'dr-cabrel'],
    ['MAÎTRE Nom', 'maitre-nom'],
    ['Éléonore Ndzié', 'eleonore-ndzie'],
    ['  dr   cabrel  ', 'dr-cabrel-'],
    ['dr_cabrel', 'dr-cabrel'],
    ['dr--cabrel', 'dr-cabrel'],
    ['dr.cabrel!', 'drcabrel'],
    ['---dr', 'dr'],
    ['', ''],
    ['!!!', ''],
    ['😀', ''],
    ['ça va', 'ca-va'],
  ])('should turn "%s" into "%s"', (saisie, attendu) => {
    expect(versAdresse(saisie)).toBe(attendu)
  })

  it('should cut the address to 30 characters', () => {
    expect(versAdresse('a'.repeat(80))).toHaveLength(30)
  })

  it('should produce an output made only of lowercase letters, digits and single dashes', () => {
    const entrees = ['Hello World', 'ÀÉÎÕÜ ñ', 'a  b   c', 'x_y-z', '<script>alert(1)</script>', 'Ünï-cödé 123', '\t\n a   b']
    for (const entree of entrees) expect(versAdresse(entree)).toMatch(/^(?:[a-z0-9-]*)$/)
    for (const entree of entrees) expect(versAdresse(entree)).not.toMatch(/--|^-/)
  })

  it('should be idempotent', () => {
    for (const entree of ['Dr Cabrel', 'MAÎTRE  Nom', 'a_b_c', '--x--y--']) {
      expect(versAdresse(versAdresse(entree))).toBe(versAdresse(entree))
    }
  })

  it('should let the in-progress trailing dash pass and be removed before validation', () => {
    expect(versAdresse('dr ')).toBe('dr-')
    expect(valeurValidee('dr ', versAdresse)).toBe('dr')
  })
})

describe('chaîne complète saisie → validation', () => {
  const versAdresse = extraireVersAdresse()

  it.each([
    ['Dr Cabrel', true],
    ['Maître Nom', true],
    ['ADMIN', false],
    ['Api', false],
    ['  ', false],
    ['ab', false],
    ['é', false],
    ['Studio Photo', true],
  ])('should validate the input "%s" with expected success %s', (saisie, attendu) => {
    const valeur = valeurValidee(saisie, versAdresse)

    expect(valeur !== '' && validateUsername(valeur).success).toBe(attendu)
  })

  it('should never produce an address that validateUsername refuses for its format when the input has 3+ letters and no reserved word', () => {
    for (const saisie of ['Le Grand Docteur', 'Zoé Études', 'a b c d e f', 'x'.repeat(100), '1 2 3']) {
      const valeur = valeurValidee(saisie, versAdresse)
      expect(validateUsername(valeur).success, `${saisie} → ${valeur}`).toBe(true)
    }
  })

  it('should keep a clean address when 30-character truncation ends on a dash', () => {
    // 29 lettres + espace + suite : la coupe à 30 laisse un tiret final, retiré avant validation.
    const valeur = valeurValidee(`${'a'.repeat(29)} bcd`, versAdresse)

    expect(valeur).toBe('a'.repeat(29))
    expect(validateUsername(valeur).success).toBe(true)
  })
})
