import { describe, expect, it } from 'vitest'
import { EXPORT_CARACTERES_FORMULE, EXPORT_NEUTRALISATION } from '../../../shared/admin-paiements'
import { celluleCsv, neutraliserCellule } from '../../../server/services/admin/export'

// A3 CA10 et D-A3-09 : neutralisation des formules (OWASP CSV injection) et mise en forme RFC 4180 des cellules.
// Les cellules commençant par `=`, `+`, `-`, `@`, tabulation ou retour chariot reçoivent une apostrophe en préfixe.

describe('neutraliserCellule', () => {
  it.each(EXPORT_CARACTERES_FORMULE)('should prefix an apostrophe to a cell starting with %j', (caractere) => {
    expect(neutraliserCellule(`${caractere}HYPERLINK("http://evil.example","clic")`)).toBe(`'${caractere}HYPERLINK("http://evil.example","clic")`)
  })

  it('should give the exact spec example: =HYPERLINK(...) leaves as \'=HYPERLINK(...)', () => {
    expect(neutraliserCellule('=HYPERLINK("http://x","y")')).toBe('\'=HYPERLINK("http://x","y")')
  })

  it.each(['', 'KPAY-12+3', 'a-b', 'jean@exemple.test', '5000', '2026-11-14T10:00:00.000Z', ' =espace-devant', 'tx_abc', 'é=1'])('should leave the harmless cell %j untouched', (valeur) => {
    expect(neutraliserCellule(valeur)).toBe(valeur)
  })

  it('should only look at the FIRST character: a formula character in the middle is harmless', () => {
    expect(neutraliserCellule('abc=1+2')).toBe('abc=1+2')
  })

  it('should use the declared apostrophe constant as the one-character prefix', () => {
    expect(EXPORT_NEUTRALISATION).toBe('\'')
    expect(neutraliserCellule('=1').startsWith(EXPORT_NEUTRALISATION)).toBe(true)
    expect(neutraliserCellule('=1')).toHaveLength(3)
  })

  it('should cover every character the spec lists, and nothing else is a formula guard', () => {
    expect([...EXPORT_CARACTERES_FORMULE].sort()).toEqual(['\t', '\r', '+', '-', '=', '@'].sort())
  })
})

describe('celluleCsv (RFC 4180)', () => {
  it('should leave a plain cell as it is', () => {
    expect(celluleCsv('KPAY-1')).toBe('KPAY-1')
  })

  it.each([
    ['une virgule', 'a,b', '"a,b"'],
    ['un guillemet', 'a"b', '"a""b"'],
    ['un saut de ligne', 'a\nb', '"a\nb"'],
    ['un retour chariot', 'a\rb', '"a\rb"'],
  ])('should quote a cell with %s', (_titre, valeur, attendu) => {
    expect(celluleCsv(valeur)).toBe(attendu)
  })

  it('should neutralise BEFORE quoting: the apostrophe stays inside the quotes, in front of the formula', () => {
    expect(celluleCsv('=HYPERLINK("http://x","y")')).toBe('"\'=HYPERLINK(""http://x"",""y"")"')
    expect(celluleCsv('+1')).toBe('\'+1')
  })

  it('should keep a cell starting with a tab or a carriage return neutralised AND quoted when needed', () => {
    expect(celluleCsv('\t=cmd')).toBe('\'\t=cmd')
    expect(celluleCsv('\r=cmd')).toBe('"\'\r=cmd"')
  })
})
