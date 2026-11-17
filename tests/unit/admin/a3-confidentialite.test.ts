import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as schemasA3 from '../../../shared/schemas/admin-paiements'
import { CONTRAT } from '../../support/admin-contrat'
import { analyserSchema, ecartsSourceRoute, listerRoutes } from './support/contrat'
import type { SchemaZod } from './support/contrat'

// A3 CA13 : confidentialité des sorties d'administration de ce sprint. Mêmes règles que le contrat d'A1
// (tests/unit/admin/contrat-confidentialite.test.ts) : chaque schéma de RÉPONSE est strict, sans clé de `CLES_AUDIT_INTERDITES`
// (téléphone, contenu, message, champ de visiteur…), sauf les exceptions ci-dessous, justifiées une à une. Ce fichier ne modifie
// ni `tests/support/admin-contrat.ts` ni le test d'A1 : il importe leur mécanique en lecture seule.
//
// EXCEPTIONS DEMANDÉES PAR LA SPEC (`email`, titulaire du compte ; `nom`, l'administrateur lui-même) + deux schémas de LISTE
// qui IMBRIQUENT un schéma à exception (`elements[].utilisateur.email`) : sans elles le contrôle échoue, la liste porte la même
// donnée que l'élément. Écart signalé dans le rapport.

const EXCEPTIONS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  schemaPaiementDto: { email: 'adresse du titulaire du compte qui a payé (utilisateur.email, null si le compte est supprimé), jamais celle d\'un visiteur' },
  schemaPaiementDetailDto: { email: 'adresse du titulaire du compte (paiement.utilisateur.email), la même que dans la liste des paiements' },
  schemaListePaiementsDto: { email: 'liste de schemaPaiementDto : adresse du titulaire du compte (elements[].utilisateur.email)' },
  schemaAbonnementAdminDto: { email: 'adresse du titulaire de l\'abonnement (utilisateur.email), compte de l\'application, pas un visiteur' },
  schemaListeAbonnementsDto: { email: 'liste de schemaAbonnementAdminDto : adresse du titulaire de l\'abonnement (elements[].utilisateur.email)' },
  schemaVueEnsembleEnrichieDto: { nom: 'nom de l\'administrateur connecté (lui-même) pour l\'accueil de la vue d\'ensemble' },
}

/** Routes de A3 : fichier sous `server/api/admin/`, schéma de réponse (`null` : corps CSV, hors du modèle Zod), statut de succès. */
const ROUTES_A3: ReadonlyArray<{ fichier: string, schema: string | null, statut: 200 | 202 }> = [
  { fichier: 'abonnements/index.get.ts', schema: 'schemaListeAbonnementsDto', statut: 200 },
  { fichier: 'abonnements/[id]/rappel.post.ts', schema: 'schemaRappelAbonnementReponse', statut: 202 },
  { fichier: 'paiements/index.get.ts', schema: 'schemaListePaiementsDto', statut: 200 },
  { fichier: 'paiements/[id].get.ts', schema: 'schemaPaiementDetailDto', statut: 200 },
  { fichier: 'paiements/[id]/reverifier.post.ts', schema: 'schemaReverificationReponse', statut: 200 },
  { fichier: 'paiements/[id]/marquer-paye.post.ts', schema: 'schemaMarquagePaiementReponse', statut: 200 },
  { fichier: 'revenus.get.ts', schema: 'schemaRevenusDto', statut: 200 },
  { fichier: 'alertes.get.ts', schema: 'schemaAlertesDto', statut: 200 },
  { fichier: 'export/paiements.post.ts', schema: null, statut: 200 },
  { fichier: 'vue-ensemble.get.ts', schema: 'schemaVueEnsembleEnrichieDto', statut: 200 },
]

const RACINE = path.resolve(import.meta.dirname, '../../..')
const DOSSIER_ROUTES = path.join(RACINE, 'server/api/admin')

const schemaExporte = (nom: string): SchemaZod => {
  const valeur = (schemasA3 as Record<string, unknown>)[nom]
  if (typeof valeur !== 'object' || valeur === null || !('_zod' in valeur)) throw new Error(`shared/schemas/admin-paiements.ts n'exporte pas de schéma Zod « ${nom} ».`)
  return valeur as SchemaZod
}

const NOMS_REPONSE = Object.keys(schemasA3).filter((nom) => /^schema.*(Dto|Reponse)$/.test(nom))

describe('schémas de réponse de A3 : stricts, sans clé interdite (CA13)', () => {
  it('should find the response schemas of A3', () => {
    expect(NOMS_REPONSE.length).toBeGreaterThanOrEqual(10)
    for (const nom of ['schemaPaiementDto', 'schemaListePaiementsDto', 'schemaPaiementDetailDto', 'schemaAbonnementAdminDto', 'schemaRevenusDto', 'schemaAlertesDto', 'schemaVueEnsembleEnrichieDto']) {
      expect(NOMS_REPONSE).toContain(nom)
    }
  })

  it.each(NOMS_REPONSE)('should accept %s only if it is strict and free of sensitive keys (exceptions apart)', (nom) => {
    const { violations } = analyserSchema(schemaExporte(nom), EXCEPTIONS[nom] ?? {})

    expect(violations).toEqual([])
  })

  it('should flag the e-mail of the holder in the schemas that carry it when no exception is granted (the control is not blind)', () => {
    for (const nom of ['schemaPaiementDto', 'schemaPaiementDetailDto', 'schemaListePaiementsDto', 'schemaAbonnementAdminDto', 'schemaListeAbonnementsDto']) {
      expect(analyserSchema(schemaExporte(nom)).violations.some((v) => v.includes('email')), nom).toBe(true)
    }
    expect(analyserSchema(schemaExporte('schemaVueEnsembleEnrichieDto')).violations.some((v) => v.includes('nom'))).toBe(true)
  })

  it('should keep every exception in use and justified, and limit them to the account holder e-mail and the administrator\'s own name', () => {
    for (const [nom, exceptions] of Object.entries(EXCEPTIONS)) {
      const { exceptionsUtilisees } = analyserSchema(schemaExporte(nom), exceptions)
      for (const [cle, raison] of Object.entries(exceptions)) {
        expect(exceptionsUtilisees, `${nom}.${cle} n'est plus utilisée`).toContain(cle)
        expect(raison.trim().length, `${nom}.${cle} sans justification`).toBeGreaterThan(20)
      }
    }
    expect([...new Set(Object.values(EXCEPTIONS).flatMap((e) => Object.keys(e)))].sort()).toEqual(['email', 'nom'])
  })

  it('should not tolerate the keys of a visitor, a phone number or a content in any exception', () => {
    for (const exceptions of Object.values(EXCEPTIONS)) {
      for (const cle of ['telephone', 'phone_number', 'message', 'contenu', 'motif_visiteur', 'sujet', 'visiteur', 'ip', 'token']) expect(exceptions).not.toHaveProperty(cle)
    }
  })

  it('should never expose a phone number or a payer number in ANY nested key of the A3 responses', () => {
    const cles = (valeur: unknown, acc: string[] = []): string[] => {
      const def = (valeur as { _zod?: { def?: { shape?: Record<string, unknown>, element?: unknown, innerType?: unknown } } })._zod?.def
      if (def === undefined) return acc
      for (const [cle, enfant] of Object.entries(def.shape ?? {})) {
        acc.push(cle)
        cles(enfant, acc)
      }
      if (def.element !== undefined) cles(def.element, acc)
      if (def.innerType !== undefined) cles(def.innerType, acc)
      return acc
    }

    const toutes = NOMS_REPONSE.flatMap((nom) => cles(schemaExporte(nom)))

    expect(toutes.filter((cle) => /telephone|phone|numero|empreinte|msisdn|payload|corps|contenu|message/i.test(cle))).toEqual([])
  })
})

describe('routes de A3 : présentes, gardées, déclarées dans le contrat (CA13)', () => {
  const sur = listerRoutes(DOSSIER_ROUTES)

  it.each(ROUTES_A3)('should have the route file $fichier', ({ fichier }) => {
    expect(sur).toContain(fichier)
  })

  it.each(ROUTES_A3)('should have $fichier guard first with requireSuperadmin, wrap errors with defineApiHandler and never touch the database', ({ fichier }) => {
    const source = readFileSync(path.join(DOSSIER_ROUTES, fichier), 'utf-8')

    expect(ecartsSourceRoute(fichier, source)).toEqual([])
  })

  it.each(ROUTES_A3.filter((r) => r.schema !== null))('should declare $fichier in tests/support/admin-contrat.ts with the schema $schema', ({ fichier, schema, statut }) => {
    const entree = CONTRAT[fichier]

    expect(entree, `${fichier} absent de CONTRAT (le test d'A1 le détecterait aussi)`).toBeDefined()
    expect(entree?.schema).toBe(schema)
    expect(entree?.statutSucces).toBe(statut)
  })

  it('should declare the export route in CONTRAT too (its body is a CSV file, so the contract needs a way to say so)', () => {
    expect(CONTRAT['export/paiements.post.ts'], 'export/paiements.post.ts absent de CONTRAT').toBeDefined()
    expect(CONTRAT['export/paiements.post.ts']?.chemin).toBe('/api/admin/export/paiements')
  })

  it('should have an A3 route file only for the routes listed here (a new route must be declared, never slip under the radar)', () => {
    const connues = new Set(['[...].ts', 'session.get.ts', 'vue-ensemble.get.ts', 'deconnexion.post.ts', 'reauth/code.post.ts', ...ROUTES_A3.map((r) => r.fichier)])
    const dossiersA3 = ['abonnements/', 'paiements/', 'export/', 'revenus', 'alertes']

    const inconnues = sur.filter((f) => dossiersA3.some((d) => f.startsWith(d)) && !connues.has(f))

    expect(inconnues).toEqual([])
  })

  it('should not expose a request schema as a response schema (naming convention)', () => {
    for (const nom of ['schemaFiltresPaiements', 'schemaListePaiementsQuery', 'schemaListeAbonnementsQuery', 'schemaRappelAbonnement', 'schemaActionPaiement', 'schemaExportPaiements']) {
      expect(NOMS_REPONSE).not.toContain(nom)
    }
  })
})
