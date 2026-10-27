import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import { LISTE_SLUG_MAX, LISTE_SLUG_REGEX, VEDETTE_MAX } from '../../shared/listes'
import { ANNEE_MAX, ANNEE_MIN, GALERIE_MAX, REALISATION_LIEN_MAX } from '../../shared/realisations'
import { VEDETTE_MAX as VEDETTE_MAX_SERVICES } from '../../shared/services'
import { ERROR_MESSAGES } from '../../server/exceptions/http'

// Synchronisation base / code pour S4 : les bornes des CHECK de la migration 0011 sont recopiées en dur
// (comme celles de 0009 et 0010). Si l'une change sans l'autre, ce test échoue.

const RACINE = path.resolve(import.meta.dirname, '../..')
const DOSSIER_MIGRATIONS = path.join(RACINE, 'server/db/migrations')
const MIGRATION_0011 = readFileSync(path.join(DOSSIER_MIGRATIONS, '0011_s4_realisations.sql'), 'utf-8')
const SCHEMA_TS = readFileSync(path.join(RACINE, 'shared/db/schema.ts'), 'utf-8')

/** Les messages utilisent l'apostrophe typographique du projet : on tolère les deux. */
const sansTypographie = (texte: string) => texte.replaceAll('’', "'")

function bornesDeLaContrainte(nom: string): [number, number] {
  const motif = new RegExp(`${nom}\\s+CHECK\\s*\\([^;]*?BETWEEN\\s+(\\d+)\\s+AND\\s+(\\d+)`, 'i')
  const correspondance = MIGRATION_0011.match(motif)
  if (!correspondance) throw new Error(`Bornes de ${nom} introuvables dans la migration 0011.`)
  return [Number(correspondance[1]), Number(correspondance[2])]
}

describe('contrats S4 : synchronisation base / code', () => {
  it('should keep the year bounds of realisations_annee_check identical to ANNEE_MIN / ANNEE_MAX', () => {
    expect(bornesDeLaContrainte('realisations_annee_check')).toEqual([ANNEE_MIN, ANNEE_MAX])
  })

  it('should keep the year bounds of the data fix identical to ANNEE_MIN / ANNEE_MAX', () => {
    expect(MIGRATION_0011).toContain(`annee NOT BETWEEN ${ANNEE_MIN} AND ${ANNEE_MAX}`)
  })

  it('should keep the slug bounds and regex of realisations_slug_format_check identical to the shared constants', () => {
    expect(bornesDeLaContrainte('realisations_slug_format_check')).toEqual([1, LISTE_SLUG_MAX])
    expect(MIGRATION_0011).toContain(`'${LISTE_SLUG_REGEX.source}'`)
  })

  it('should keep the link length of realisations_lien_check identical to REALISATION_LIEN_MAX and require http(s)', () => {
    expect(MIGRATION_0011).toMatch(new RegExp(`realisations_lien_check CHECK \\(lien IS NULL OR \\(char_length\\(lien\\) <= ${REALISATION_LIEN_MAX} AND lien ~\\* '\\^https\\?://'\\)\\)`))
    expect(MIGRATION_0011).toContain(`char_length(lien) > ${REALISATION_LIEN_MAX}`)
  })

  it('should keep the gallery cap identical: the order range of realisation_images_ordre_check holds exactly GALERIE_MAX positions', () => {
    const [min, max] = bornesDeLaContrainte('realisation_images_ordre_check')

    expect(min).toBe(0)
    expect(max - min + 1).toBe(GALERIE_MAX)
  })

  it('should keep the vedette cap of the data fix identical to VEDETTE_MAX', () => {
    expect(MIGRATION_0011).toMatch(new RegExp(`v\\.rang > ${VEDETTE_MAX}\\b`))
  })

  it('should keep the suffix of a deduplicated slug within the slug limit (71 + dash + 8 hex = 80)', () => {
    const correspondance = MIGRATION_0011.match(/left\(r\.slug, (\d+)\)/)

    expect(correspondance).not.toBeNull()
    expect(Number(correspondance?.[1]) + '-'.length + 'a1b2c3d4'.length).toBe(LISTE_SLUG_MAX)
  })

  it('should guard the vedette against a masked realisation in the database too (NOT en_vedette OR actif)', () => {
    expect(MIGRATION_0011).toMatch(/realisations_vedette_actif_check CHECK \(NOT en_vedette OR actif\)/)
  })

  it('should declare every constraint and index named in schema.ts for the realisation tables in the migration', () => {
    const nomsDuSchema = [...SCHEMA_TS.matchAll(/'(realisation(?:s|_images)_[a-z_]+)'/g)].map((m) => m[1])

    expect(nomsDuSchema.length).toBeGreaterThanOrEqual(9)
    for (const nom of nomsDuSchema) {
      expect(MIGRATION_0011, `${nom} doit figurer dans la migration 0011`).toContain(nom)
    }
  })

  it('should be registered in the migration journal with its snapshot, right after 0010', () => {
    const journal = JSON.parse(readFileSync(path.join(DOSSIER_MIGRATIONS, 'meta/_journal.json'), 'utf-8')) as { entries: { idx: number, tag: string }[] }
    const tags = journal.entries.map((e) => e.tag)

    expect(tags.indexOf('0011_s4_realisations')).toBe(tags.indexOf('0010_s3_services') + 1)
    expect(existsSync(path.join(DOSSIER_MIGRATIONS, 'meta/0011_snapshot.json'))).toBe(true)
    const snapshot = readFileSync(path.join(DOSSIER_MIGRATIONS, 'meta/0011_snapshot.json'), 'utf-8')
    expect(snapshot).toContain('realisation_images')
    expect(snapshot).toContain('realisations_vitrine_id_slug_unique')
  })

  it('should document a manual rollback block that drops the gallery table', () => {
    expect(MIGRATION_0011).toMatch(/^-- BEGIN;$/m)
    expect(MIGRATION_0011).toMatch(/^-- DROP TABLE realisation_images;$/m)
    expect(MIGRATION_0011).toMatch(/^-- COMMIT;$/m)
  })
})

describe('contrats S4 : constantes partagées', () => {
  it('should still export VEDETTE_MAX from shared/services (S3 imports stay valid) with the same value as shared/listes', () => {
    expect(VEDETTE_MAX_SERVICES).toBe(VEDETTE_MAX)
    expect(VEDETTE_MAX).toBe(3)
  })
})

describe('contrats S4 : erreurs', () => {
  it('should map REALISATION_INTROUVABLE to 404 and keep the generic codes of the lists', () => {
    expect(ERROR_CODES).toContain('REALISATION_INTROUVABLE')
    expect(ERROR_STATUS).toMatchObject({ REALISATION_INTROUVABLE: 404, VEDETTE_COMPLETE: 409, ORDRE_INVALIDE: 422, MEDIA_INVALIDE: 422, VITRINE_INTROUVABLE: 404 })
  })

  it('should give every error code a message (the S4 code included)', () => {
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...ERROR_CODES].sort())
    expect(ERROR_MESSAGES.REALISATION_INTROUVABLE).toBe('Cette réalisation est introuvable.')
  })

  it('should word VEDETTE_COMPLETE for any list, not for services only (decision #57)', () => {
    const message = ERROR_MESSAGES.VEDETTE_COMPLETE

    expect(message).not.toMatch(/service/i)
    expect(message).toContain(String(VEDETTE_MAX))
    expect(sansTypographie(message)).toBe(`Vous avez déjà ${VEDETTE_MAX} éléments en vedette. Retirez-en un pour en mettre un autre en avant.`)
  })

  it('should word ORDRE_INVALIDE for any list, not for services only (decision #57)', () => {
    const message = ERROR_MESSAGES.ORDRE_INVALIDE

    expect(message).not.toMatch(/service/i)
    expect(sansTypographie(message)).toBe("L'ordre envoyé n'est plus à jour. Rechargez la page et réessayez.")
  })

  it('should use none of the words forbidden to users (CLAUDE.md section 2) in the S4 messages', () => {
    const interdits = /\b(espace|bloc|module|widget|section)s?\b/i

    for (const code of ['REALISATION_INTROUVABLE', 'VEDETTE_COMPLETE', 'ORDRE_INVALIDE', 'MEDIA_INVALIDE'] as const) {
      expect(ERROR_MESSAGES[code]).not.toMatch(interdits)
    }
  })
})
