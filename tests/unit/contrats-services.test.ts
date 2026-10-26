import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEVISES } from '../../shared/compte'
import { PRIX_MAX_MINOR } from '../../shared/devises'
import { ERROR_CODES, ERROR_STATUS } from '../../shared/erreurs'
import {
  DUREE_MIN_MAX,
  DUREE_MIN_MIN,
  INCLUS_MAX,
  PAIEMENT_MODES,
  RYTHMES,
  SEANCES_MAX,
  SEANCES_MIN,
  SERVICE_SLUG_MAX,
  SERVICE_SLUG_REGEX,
  SERVICE_TYPES,
  TARIFS,
} from '../../shared/services'

// Synchronisation base / code pour S3 : les listes des CHECK de la migration 0010 sont recopiées en dur
// (comme celles de 0009 dans contrats.test.ts). Si l'un change sans l'autre, ce test échoue.

const MIGRATION_0010 = readFileSync(path.resolve(import.meta.dirname, '../../server/db/migrations/0010_s3_services.sql'), 'utf-8')

function valeursDeLaContrainte(nom: string): string[] {
  const motif = new RegExp(`${nom}\\s+CHECK\\s*\\([^;]*?\\bIN\\s*\\(([^)]*)\\)`, 'i')
  const correspondance = MIGRATION_0010.match(motif)
  if (!correspondance) throw new Error(`Contrainte ${nom} introuvable dans la migration 0010.`)
  return [...correspondance[1].matchAll(/'([^']*)'/g)].map((m) => m[1])
}

function bornesDeLaContrainte(nom: string): [number, number] {
  const motif = new RegExp(`${nom}\\s+CHECK\\s*\\([^;]*?BETWEEN\\s+(\\d+)\\s+AND\\s+(\\d+)`, 'i')
  const correspondance = MIGRATION_0010.match(motif)
  if (!correspondance) throw new Error(`Bornes de ${nom} introuvables dans la migration 0010.`)
  return [Number(correspondance[1]), Number(correspondance[2])]
}

describe('contrats S3 : synchronisation base / code', () => {
  it.each([
    ['services_type_check', SERVICE_TYPES],
    ['services_tarif_check', TARIFS],
    ['services_paiement_mode_check', PAIEMENT_MODES],
    ['services_rythme_check', RYTHMES],
    ['services_prix_devise_check', DEVISES],
  ] as const)('should keep the %s list of migration 0010 identical to the shared constant', (contrainte, liste) => {
    expect(valeursDeLaContrainte(contrainte)).toEqual([...liste])
  })

  it.each([
    ['services_duree_min_check', [DUREE_MIN_MIN, DUREE_MIN_MAX]],
    ['services_nb_seances_check', [SEANCES_MIN, SEANCES_MAX]],
    ['services_prix_montant_check', [1, PRIX_MAX_MINOR]],
  ] as const)('should keep the bounds of %s identical to the shared constants', (contrainte, bornes) => {
    expect(bornesDeLaContrainte(contrainte)).toEqual([...bornes])
  })

  it('should keep the slug bounds and the inclus cap of migration 0010 identical to the shared constants', () => {
    expect(bornesDeLaContrainte('services_slug_format_check')).toEqual([1, SERVICE_SLUG_MAX])
    expect(MIGRATION_0010).toContain(`'${SERVICE_SLUG_REGEX.source}'`)
    expect(MIGRATION_0010).toMatch(new RegExp(`services_inclus_check CHECK \\(cardinality\\(inclus\\) <= ${INCLUS_MAX}\\)`))
  })
})

describe('contrats S3 : erreurs', () => {
  it('should map the four S3 error codes to the statuses of the specification', () => {
    expect(ERROR_STATUS).toMatchObject({
      SERVICE_INTROUVABLE: 404,
      VEDETTE_COMPLETE: 409,
      ORDRE_INVALIDE: 422,
      PAIEMENT_EN_LIGNE_INDISPONIBLE: 422,
    })
    for (const code of ['SERVICE_INTROUVABLE', 'VEDETTE_COMPLETE', 'ORDRE_INVALIDE', 'PAIEMENT_EN_LIGNE_INDISPONIBLE']) {
      expect(ERROR_CODES).toContain(code)
    }
  })
})
