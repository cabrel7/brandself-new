import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as schemasAdminA1 from '../../../shared/schemas/admin'
import * as schemasAdminA2 from '../../../shared/schemas/admin-a2'
import * as schemasAdminA3 from '../../../shared/schemas/admin-paiements'
import * as schemasAdminA4 from '../../../shared/schemas/admin-a4'
import * as schemasAdminCatalogues from '../../../shared/schemas/admin-catalogues'
import * as schemasAdminVersions from '../../../shared/schemas/admin-versions'
import { AUDIT_CLE_FORMAT, AUDIT_VALEUR_TEXTE_MAX } from '../../../shared/admin'
import { CONTRAT_A2, CONTRAT_A4, CONTRAT_COMPLET as CONTRAT, EXCEPTIONS_CLES_REPONSE } from '../../support/admin-contrat'
import type { EntreeContrat } from '../../support/admin-contrat'
import {
  analyserSchema,
  cheminDeFichier,
  cleCanonique,
  ecartsContrat,
  ecartsSourceRoute,
  listerRoutes,
} from './support/contrat'
import type { SchemaZod } from './support/contrat'

// A1 CA23 : test de confidentialité STRUCTUREL. Il parcourt `server/api/admin/**` avec le système de fichiers et le
// compare à la table CONTRAT (tests/support/admin-contrat.ts) : une route nouvelle ne passe pas sous le radar.
// Chaque schéma de réponse doit être strict (`.strict()`) et sans clé interdite (CLES_AUDIT_INTERDITES).

// A2 : les schémas de réponse de shared/schemas/admin.ts (A1) ET de shared/schemas/admin-a2.ts sont contrôlés ; le
// contrat est CONTRAT_COMPLET (A1 + A2) : une route de n'importe quel lot sans entrée fait échouer le test.
// A4 : `schemaEtatPublicDto` (route PUBLIQUE `GET /api/public/etat`, hors server/api/admin) porte le message de maintenance de
// l'administrateur, pas un message de visiteur : il n'est pas analysé ici (a4-schemas.test.ts le fige à { maintenance, message }).
const { schemaEtatPublicDto: _etatPublic, ...schemasAdminA4Contrat } = schemasAdminA4
void _etatPublic
// A5 : `schemaReferentielsDto` décrit la route PUBLIQUE `GET /api/public/referentiels` (hors server/api/admin) : listes de pays et
// devises du catalogue, sans donnée de compte ; il n'est pas analysé ici.
const { schemaReferentielsDto: _referentiels, ...schemasAdminCataloguesContrat } = schemasAdminCatalogues
void _referentiels
const schemasAdmin: Record<string, unknown> = { ...schemasAdminA1, ...schemasAdminA2, ...schemasAdminA3, ...schemasAdminA4Contrat, ...schemasAdminCataloguesContrat, ...schemasAdminVersions }

/**
 * Entrée du journal : `avant` et `apres` sont des objets PLATS à clés libres (liste noire appliquée à l'ÉCRITURE par le service
 * d'audit, D-A1-09) : l'analyseur structurel refuse tout dictionnaire, ces deux schémas ont donc un contrôle dédié (plus bas).
 */
const SCHEMAS_JOURNAL_A_CLES_LIBRES: readonly string[] = ['schemaJournalEntreeDto', 'schemaListeJournalDto']

const RACINE = path.resolve(import.meta.dirname, '../../..')
const DOSSIER_ROUTES = path.join(RACINE, 'server/api/admin')

const schemaExporte = (nom: string): SchemaZod => {
  const valeur = schemasAdmin[nom]
  if (typeof valeur !== 'object' || valeur === null || !('_zod' in valeur)) throw new Error(`shared/schemas/admin.ts n'exporte pas de schéma Zod (admin.ts, admin-a2.ts ni admin-paiements.ts) « ${nom} ».`)
  return valeur as SchemaZod
}

/** Schémas de RÉPONSE exportés (convention de nommage : …Dto, …Reponse). Les schémas de requête n'en font pas partie. */
/** Routes de `server/api/admin/` qui ne renvoient jamais de donnée et n'ont donc pas de schéma de réponse. */
const ROUTES_HORS_CONTRAT: readonly string[] = ['[...].ts']

const NOMS_SCHEMAS_REPONSE = Object.keys(schemasAdmin).filter((nom) => /^schema.*(Dto|Reponse)$/.test(nom))
const NOMS_SCHEMAS_ANALYSES = NOMS_SCHEMAS_REPONSE.filter((nom) => !SCHEMAS_JOURNAL_A_CLES_LIBRES.includes(nom))

describe('contrat de confidentialité : routes de server/api/admin/** (CA23)', () => {
  // La route attrape-tout `[...].ts` est VOLONTAIREMENT hors contrat : elle ne renvoie aucune donnée (404 uniforme).
  const toutes = listerRoutes(DOSSIER_ROUTES)
  const fichiers = toutes.filter((f) => !ROUTES_HORS_CONTRAT.includes(f))

  it('should find the administration routes on disk (the folder exists and is not empty)', () => {
    expect(fichiers.length).toBeGreaterThan(0)
  })

  it('should cover every route file with an entry of CONTRAT, and every entry with a file', () => {
    expect(ecartsContrat(fichiers, CONTRAT)).toEqual([])
  })

  it('should exclude only the catch-all, which guards first then throws the uniform 404 and returns no data', () => {
    expect(toutes.filter((f) => !fichiers.includes(f))).toEqual(['[...].ts'])
    const source = readFileSync(path.join(DOSSIER_ROUTES, '[...].ts'), 'utf-8')

    expect(ecartsSourceRoute('[...].ts', source)).toEqual([])
    expect(source.indexOf('requireSuperadmin(')).toBeLessThan(source.indexOf('introuvableAdmin()'))
    expect(source).not.toMatch(/return\s/)
  })

  it('should declare the four routes of A1, the sixteen routes of A2 (spec A2 §5) and the fifteen routes of A4 (spec A4 §4)', () => {
    for (const fichier of ['deconnexion.post.ts', 'reauth/code.post.ts', 'session.get.ts', 'vue-ensemble.get.ts']) expect(fichiers).toContain(fichier)
    expect(Object.keys(CONTRAT_A2)).toHaveLength(16)
    for (const fichier of Object.keys(CONTRAT_A2)) expect(fichiers, fichier).toContain(fichier)
    expect(Object.keys(CONTRAT_A4)).toHaveLength(15)
    for (const fichier of Object.keys(CONTRAT_A4)) expect(fichiers, fichier).toContain(fichier)
  })

  it.each(Object.entries(CONTRAT))('should have route %s guard first, wrap errors, and never touch the database directly', (fichier) => {
    const source = readFileSync(path.join(DOSSIER_ROUTES, fichier), 'utf-8')

    expect(ecartsSourceRoute(fichier, source)).toEqual([])
  })

  it.each(Object.entries(CONTRAT))('should describe the response of %s with a strict schema without sensitive key', (_fichier, entree: EntreeContrat) => {
    if (entree.schema === null) {
      expect(entree.statutSucces).toBe(entree.corpsNonJson === true ? 200 : 204)
      return
    }
    if (SCHEMAS_JOURNAL_A_CLES_LIBRES.includes(entree.schema)) return
    const exceptions = EXCEPTIONS_CLES_REPONSE[entree.schema] ?? {}

    const { violations } = analyserSchema(schemaExporte(entree.schema), exceptions)

    expect(violations).toEqual([])
  })

  it('should check EVERY response schema exported by shared/schemas/admin.ts, covered by a route or not', () => {
    expect(NOMS_SCHEMAS_REPONSE.length).toBeGreaterThan(0)
    for (const nom of NOMS_SCHEMAS_ANALYSES) {
      const { violations } = analyserSchema(schemaExporte(nom), EXCEPTIONS_CLES_REPONSE[nom] ?? {})
      expect(violations, nom).toEqual([])
    }
  })

  it('should have a schema in the contract that is exported by shared/schemas/admin.ts', () => {
    for (const entree of Object.values(CONTRAT)) {
      if (entree.schema !== null) expect(NOMS_SCHEMAS_REPONSE, entree.chemin).toContain(entree.schema)
    }
  })

  it('should keep every declared exception in use, and justified (a stale exception would hide a future leak)', () => {
    for (const [nomSchema, exceptions] of Object.entries(EXCEPTIONS_CLES_REPONSE)) {
      const { exceptionsUtilisees } = analyserSchema(schemaExporte(nomSchema), exceptions)
      for (const [cle, raison] of Object.entries(exceptions)) {
        expect(exceptionsUtilisees, `${nomSchema}.${cle} n'est plus utilisée`).toContain(cle)
        expect(raison.trim().length, `${nomSchema}.${cle} sans justification`).toBeGreaterThan(20)
      }
    }
  })

  it('should limit the exceptions to the identity of the administrator or of the account holder (name, e-mail, phone) and, for A4, to the registry key of a setting and the technical name of a job, nothing about a visitor', () => {
    const cles = new Set(Object.values(EXCEPTIONS_CLES_REPONSE).flatMap((e) => Object.keys(e)))

    expect([...cles].sort()).toEqual(['cle', 'code', 'email', 'nom', 'sortie', 'telephone'])
    const avecCle = Object.entries(EXCEPTIONS_CLES_REPONSE).filter(([, e]) => 'cle' in e).map(([nom]) => nom)
    expect(avecCle.sort()).toEqual(['schemaListeReglagesDto', 'schemaListeVersionsDto', 'schemaModifierReglageReponse', 'schemaReglageDto', 'schemaVersionDto', 'schemaVersionPromptDto', 'schemaVersionReponse'])
    // A5 : `code` = code ISO d'un catalogue seulement ; `sortie` = sortie opaque d'un essai de prompt, rien d'autre.
    const avecCode = Object.entries(EXCEPTIONS_CLES_REPONSE).filter(([, e]) => 'code' in e).map(([nom]) => nom)
    expect(avecCode.sort()).toEqual(['schemaDeviseDto', 'schemaDeviseReponse', 'schemaListeCatalogueDto', 'schemaPaysDto', 'schemaPaysReponse'])
    const avecSortie = Object.entries(EXCEPTIONS_CLES_REPONSE).filter(([, e]) => 'sortie' in e).map(([nom]) => nom)
    expect(avecSortie).toEqual(['schemaEssaiPromptDto'])
  })

  it('should keep the journal entry whitelisted: flat objects with lowercase keys and short values only, no IP address, no idempotency key', () => {
    const entree = {
      id: 'e1', numero: 1, adminId: 'a1', action: 'reglage.modifier', cibleType: 'reglage', cibleId: 'ia.active', motif: 'Motif valide',
      avant: { valeur: true }, apres: { valeur: false }, creeLe: new Date().toISOString(), empreinte: 'a'.repeat(64),
    }
    const schema = schemasAdminA4.schemaJournalEntreeDto

    expect(schema.safeParse(entree).success).toBe(true)
    for (const extra of [{ ip: '203.0.113.9' }, { cleIdempotence: 'cle-secrete-001' }, { ipAddress: '203.0.113.9' }]) expect(schema.safeParse({ ...entree, ...extra }).success, JSON.stringify(extra)).toBe(false)
    expect(schema.safeParse({ ...entree, avant: { Majuscule: 1 } }).success).toBe(false)
    expect(schema.safeParse({ ...entree, avant: { texte_long: 'x'.repeat(AUDIT_VALEUR_TEXTE_MAX + 1) } }).success).toBe(false)
    expect(schema.safeParse({ ...entree, avant: { imbrique: { a: 1 } } }).success).toBe(false)
    expect(AUDIT_CLE_FORMAT.test('longueur')).toBe(true)
  })

  it('should tolerate the phone number only in the account sheet (schemaUtilisateurFicheDto), where it is the holder\'s own', () => {
    const avecTelephone = Object.entries(EXCEPTIONS_CLES_REPONSE).filter(([, e]) => 'telephone' in e).map(([nom]) => nom)

    expect(avecTelephone).toEqual(['schemaUtilisateurFicheDto'])
  })

  it('should not tolerate the sensitive keys of a visitor in any exception', () => {
    // A5 : `code` n'est toléré que pour le code ISO d'un pays ou d'une devise du catalogue (liste fermée vérifiée plus haut).
    const SCHEMAS_CODE_ISO = ['schemaDeviseDto', 'schemaDeviseReponse', 'schemaListeCatalogueDto', 'schemaPaysDto', 'schemaPaysReponse']
    for (const [nomSchema, exceptions] of Object.entries(EXCEPTIONS_CLES_REPONSE)) {
      for (const cle of ['message', 'contenu', 'motif_visiteur', 'sujet', 'visiteur', 'ip', 'token', 'jeton', 'code']) {
        if (cle === 'code' && SCHEMAS_CODE_ISO.includes(nomSchema)) continue
        expect(exceptions).not.toHaveProperty(cle)
      }
    }
  })

  it('should justify every A2 exception by the account HOLDER (a professional), never by a visitor', () => {
    for (const nom of Object.keys(CONTRAT_A2).map((f) => CONTRAT_A2[f]!.schema).filter((n): n is string => n !== null)) {
      for (const [cle, raison] of Object.entries(EXCEPTIONS_CLES_REPONSE[nom] ?? {})) {
        expect(raison, `${nom}.${cle}`).toMatch(/professionnel|titulaire/)
        expect(raison, `${nom}.${cle}`).toMatch(/jamais/)
      }
    }
  })

  it('should not expose a request schema as a response schema (naming convention)', () => {
    expect(NOMS_SCHEMAS_REPONSE).not.toContain('schemaDemandeReauth')
    expect(NOMS_SCHEMAS_REPONSE).not.toContain('schemaMotifAdmin')
  })
})

describe('mécanique du contrôle : il échoue quand il doit (CA23)', () => {
  const racines: string[] = []
  afterAll(() => {
    for (const racine of racines) rmSync(racine, { recursive: true, force: true })
  })

  function dossierAvec(fichiers: readonly string[]): string {
    const racine = mkdtempSync(path.join(tmpdir(), 'contrat-admin-'))
    racines.push(racine)
    for (const fichier of fichiers) {
      mkdirSync(path.dirname(path.join(racine, fichier)), { recursive: true })
      writeFileSync(path.join(racine, fichier), '// route de fixture\n')
    }
    return racine
  }

  const entree = (chemin: string, methode: EntreeContrat['methode'] = 'GET'): EntreeContrat => ({ methode, chemin, schema: null, statutSucces: 204 })

  it('should report a new route x.get.ts that is absent from the contract', () => {
    const racine = dossierAvec(['session.get.ts', 'x.get.ts'])

    const ecarts = ecartsContrat(listerRoutes(racine), { 'session.get.ts': entree('/api/admin/session') })

    expect(ecarts).toEqual(['x.get.ts : route absente du contrat de confidentialité'])
  })

  it('should report a nested new route and an unexpected file name', () => {
    const racine = dossierAvec(['session.get.ts', 'export/utilisateurs.get.ts', 'notes.md'])

    const ecarts = ecartsContrat(listerRoutes(racine), { 'session.get.ts': entree('/api/admin/session') })

    expect(ecarts).toContain('export/utilisateurs.get.ts : route absente du contrat de confidentialité')
    expect(ecarts.some((e) => e.startsWith('notes.md : nom de route inattendu'))).toBe(true)
  })

  it('should report a contract entry whose route file disappeared', () => {
    const racine = dossierAvec(['session.get.ts'])

    const ecarts = ecartsContrat(listerRoutes(racine), { 'session.get.ts': entree('/api/admin/session'), 'vieille.get.ts': entree('/api/admin/vieille') })

    expect(ecarts).toEqual(['vieille.get.ts : entrée du contrat sans fichier de route'])
  })

  it('should report a contract entry whose path or method drifted from its file name', () => {
    const racine = dossierAvec(['session.get.ts'])

    expect(ecartsContrat(listerRoutes(racine), { 'session.get.ts': entree('/api/admin/autre') }).some((e) => e.includes('chemin du contrat'))).toBe(true)
    expect(ecartsContrat(listerRoutes(racine), { 'session.get.ts': entree('/api/admin/session', 'POST') }).some((e) => e.includes('méthode du contrat'))).toBe(true)
  })

  it('should accept a folder that matches the contract exactly', () => {
    const racine = dossierAvec(['session.get.ts', 'reauth/code.post.ts'])

    expect(ecartsContrat(listerRoutes(racine), {
      'session.get.ts': entree('/api/admin/session'),
      'reauth/code.post.ts': entree('/api/admin/reauth/code', 'POST'),
    })).toEqual([])
  })

  it('should treat a missing folder as empty, never as covered', () => {
    expect(listerRoutes(path.join(tmpdir(), 'dossier-qui-nexiste-pas-jamais'))).toEqual([])
  })

  it('should derive the HTTP path from the file name, including dynamic segments and index files', () => {
    expect(cheminDeFichier('session.get.ts')).toBe('/api/admin/session')
    expect(cheminDeFichier('reauth/code.post.ts')).toBe('/api/admin/reauth/code')
    expect(cheminDeFichier('utilisateurs/[id].get.ts')).toBe('/api/admin/utilisateurs/:id')
    expect(cheminDeFichier('utilisateurs/index.get.ts')).toBe('/api/admin/utilisateurs')
    expect(cheminDeFichier('notes.md')).toBeNull()
  })

  it.each([
    ['email', 'email'],
    ['phoneNumber', 'phone_number'],
    ['motifVisiteur', 'motif_visiteur'],
    ['fullName', 'full_name'],
    ['nom', 'nom'],
  ])('should canonicalise the key %s as %s', (cle, attendu) => {
    expect(cleCanonique(cle)).toBe(attendu)
  })

  it('should flag a response schema that contains the key email', () => {
    const schema = z.strictObject({ id: z.string(), email: z.string() })

    expect(analyserSchema(schema as unknown as SchemaZod).violations).toEqual(['email : clé interdite dans une réponse d\'administration'])
  })

  it.each(['telephone', 'nom', 'name', 'message', 'contenu', 'motif_visiteur', 'sujet', 'motifVisiteur', 'phoneNumber', 'ip', 'token'])(
    'should flag the sensitive key %s, even nested in an array of objects',
    (cle) => {
      const schema = z.strictObject({ lignes: z.array(z.strictObject({ id: z.string(), [cle]: z.string() })) })

      const { violations } = analyserSchema(schema as unknown as SchemaZod)

      expect(violations).toHaveLength(1)
      expect(violations[0]).toContain(`lignes[].${cle}`)
    },
  )

  it('should flag a sensitive key hidden in an optional, nullable, union or piped branch', () => {
    const cache = z.strictObject({ email: z.string() })
    for (const schema of [
      z.strictObject({ a: cache.optional() }),
      z.strictObject({ a: cache.nullable() }),
      z.strictObject({ a: z.union([z.string(), cache]) }),
      z.strictObject({ a: z.string().pipe(z.string()).or(cache) }),
      z.strictObject({ a: z.array(cache).default([]) }),
    ]) {
      expect(analyserSchema(schema as unknown as SchemaZod).violations.length).toBeGreaterThan(0)
    }
  })

  it('should flag a response schema that is not strict (the default object strips unknown keys silently)', () => {
    const schema = z.object({ id: z.string() })

    expect(analyserSchema(schema as unknown as SchemaZod).violations).toEqual(['(racine) : objet non strict (utiliser z.strictObject)'])
  })

  it('should flag a non strict object nested in an array, and a loose object', () => {
    expect(analyserSchema(z.strictObject({ lignes: z.array(z.object({ id: z.string() })) }) as unknown as SchemaZod).violations)
      .toEqual(['lignes[] : objet non strict (utiliser z.strictObject)'])
    expect(analyserSchema(z.looseObject({ id: z.string() }) as unknown as SchemaZod).violations)
      .toEqual(['(racine) : objet non strict (utiliser z.strictObject)'])
  })

  it('should accept an object made strict with .strict()', () => {
    expect(analyserSchema(z.object({ id: z.string() }).strict() as unknown as SchemaZod).violations).toEqual([])
  })

  it('should flag an open dictionary: it is not a whitelist', () => {
    expect(analyserSchema(z.strictObject({ donnees: z.record(z.string(), z.string()) }) as unknown as SchemaZod).violations)
      .toEqual(['donnees : dictionnaire à clés libres (pas une liste blanche)'])
  })

  it('should accept a strict schema with neutral keys and counters', () => {
    const schema = z.strictObject({ id: z.string(), total: z.number(), actif: z.boolean(), genereLe: z.iso.datetime(), plan: z.enum(['gratuit', 'payant']) })

    expect(analyserSchema(schema as unknown as SchemaZod).violations).toEqual([])
  })

  it('should tolerate a sensitive key only when it is declared as an exception, and report that it was used', () => {
    const schema = z.strictObject({ id: z.string(), nom: z.string() })

    const resultat = analyserSchema(schema as unknown as SchemaZod, { nom: 'nom de l\'administrateur lui-même' })

    expect(resultat.violations).toEqual([])
    expect(resultat.exceptionsUtilisees).toEqual(['nom'])
    expect(analyserSchema(schema as unknown as SchemaZod, { email: 'autre clé' }).violations).toHaveLength(1)
  })

  it('should report an exception that no longer matches any key', () => {
    const schema = z.strictObject({ id: z.string() })

    expect(analyserSchema(schema as unknown as SchemaZod, { nom: 'plus utilisée' }).exceptionsUtilisees).toEqual([])
  })

  it('should flag a route that reads the body before the guard, skips the guard, or touches the database', () => {
    const sain = 'export default defineApiHandler(async (event) => {\n  const admin = await requireSuperadmin(event)\n  const corps = await readValidatedBody(event, schema.parse)\n  return toX(await service(admin, corps))\n})\n'
    expect(ecartsSourceRoute('a.post.ts', sain)).toEqual([])

    expect(ecartsSourceRoute('a.post.ts', sain.replace('requireSuperadmin(event)', 'rien(event)'))).toContain('a.post.ts : n\'appelle pas requireSuperadmin')
    const corpsAvantGarde = 'export default defineApiHandler(async (event) => {\n  const corps = await readValidatedBody(event, schema.parse)\n  await requireSuperadmin(event)\n})\n'
    expect(ecartsSourceRoute('a.post.ts', corpsAvantGarde).some((e) => e.includes('avant requireSuperadmin'))).toBe(true)
    expect(ecartsSourceRoute('a.get.ts', `import { db } from '../../utils/db'\n${sain}`).some((e) => e.includes('accède à la base'))).toBe(true)
    expect(ecartsSourceRoute('a.get.ts', `import { eq } from 'drizzle-orm'\n${sain}`).some((e) => e.includes('accède à la base'))).toBe(true)
    expect(ecartsSourceRoute('a.get.ts', sain.replace('defineApiHandler(', 'defineEventHandler(')).some((e) => e.includes('defineApiHandler'))).toBe(true)
    expect(ecartsSourceRoute('a.get.ts', `${sain}const x = process.env.SECRET\n`).some((e) => e.includes('process.env'))).toBe(true)
  })
})
