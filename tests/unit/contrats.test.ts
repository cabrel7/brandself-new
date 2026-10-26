import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import { PALETTES } from '../../shared/palettes'
import { PAYS, PAYS_CODES, TITRES } from '../../shared/vitrine'

const MIGRATION_0009 = readFileSync(
  path.resolve(import.meta.dirname, '../../server/db/migrations/0009_s2_vitrines_medias.sql'),
  'utf-8',
)

/** Valeurs de la liste `IN (...)` qui suit le nom d'une contrainte CHECK dans la migration. */
function valeursDeLaContrainte(nom: string): string[] {
  const motif = new RegExp(`${nom}\\s+CHECK\\s*\\([^;]*?\\bIN\\s*\\(([^)]*)\\)`, 'i')
  const correspondance = MIGRATION_0009.match(motif)
  if (!correspondance) {
    throw new Error(`Contrainte ${nom} introuvable dans la migration 0009.`)
  }
  return [...correspondance[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
}

describe('contrats partagés', () => {
  describe('synchronisation base / code (les listes sont recopiées en dur dans la migration)', () => {
    it('should keep the palette CHECK of migration 0009 identical to PALETTES', () => {
      expect(valeursDeLaContrainte('vitrines_palette_check')).toEqual([...PALETTES])
    })

    it('should keep the titre CHECK of migration 0009 identical to TITRES', () => {
      expect(valeursDeLaContrainte('vitrines_titre_check')).toEqual([...TITRES])
    })

    it('should only list ISO-like uppercase country codes, as required by vitrines_pays_check', () => {
      for (const code of PAYS_CODES) {
        expect(code).toMatch(/^[A-Z]{2}$/)
      }
      expect(new Set(PAYS_CODES).size).toBe(PAYS.length)
    })
  })

  describe('erreurs', () => {
    it('should map every error code to an HTTP status in the 4xx/5xx range', () => {
      for (const code of ERROR_CODES) {
        expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400)
        expect(ERROR_STATUS[code]).toBeLessThan(600)
      }
      expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort())
    })

    it('should follow the §5 table for the codes the upload and rate limit rely on', () => {
      expect(ERROR_STATUS).toMatchObject({
        TAILLE_REQUISE: 411,
        FICHIER_TROP_LOURD: 413,
        TYPE_NON_SUPPORTE: 415,
        IMAGE_ILLISIBLE: 422,
        IMAGE_TROP_GRANDE: 422,
        TROP_DE_REQUETES: 429,
        ERREUR_INTERNE: 500,
      })
    })
  })
})
