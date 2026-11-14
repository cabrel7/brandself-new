import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { EntreeContrat } from '../../../support/admin-contrat'
import { CLES_AUDIT_INTERDITES } from '../../../../shared/admin'

// Mécanique du test de confidentialité (CA23). Elle est elle-même testée (contrat-confidentialite.test.ts) sur des
// fixtures : un contrôle qui ne sait pas échouer ne prouve rien.

/** Fichiers `.ts` sous `dossier`, chemins relatifs en `/`, triés. Dossier absent : liste vide. */
export function listerRoutes(dossier: string, sousDossier = ''): string[] {
  let entrees
  try {
    entrees = readdirSync(path.join(dossier, sousDossier), { withFileTypes: true })
  } catch {
    return []
  }
  const fichiers: string[] = []
  for (const entree of entrees) {
    const relatif = sousDossier === '' ? entree.name : `${sousDossier}/${entree.name}`
    if (entree.isDirectory()) fichiers.push(...listerRoutes(dossier, relatif))
    else fichiers.push(relatif)
  }
  return fichiers.sort()
}

const NOM_DE_ROUTE = /^(?<base>.+)\.(?<methode>get|post|put|patch|delete)\.ts$/

/** Chemin HTTP déduit du nom d'un fichier de route (`reauth/code.post.ts` → `/api/admin/reauth/code`). */
export function cheminDeFichier(fichier: string, prefixe = '/api/admin'): string | null {
  const trouve = NOM_DE_ROUTE.exec(fichier)
  const base = trouve?.groups?.base
  if (base === undefined) return null
  const segments = base.split('/').map((s) => (s === 'index' ? '' : s.replace(/^\[(\.\.\.)?(.+)\]$/, ':$2')))
  return `${prefixe}/${segments.filter((s) => s !== '').join('/')}`.replace(/\/$/, '')
}

export function methodeDeFichier(fichier: string): string | null {
  return NOM_DE_ROUTE.exec(fichier)?.groups?.methode?.toUpperCase() ?? null
}

/** Écarts entre les fichiers présents et la table : une route absente de la table, ou une entrée sans fichier. */
export function ecartsContrat(fichiers: readonly string[], contrat: Readonly<Record<string, EntreeContrat>>): string[] {
  const ecarts: string[] = []
  for (const fichier of fichiers) {
    if (!NOM_DE_ROUTE.test(fichier)) ecarts.push(`${fichier} : nom de route inattendu (attendu <chemin>.<methode>.ts)`)
    else if (!(fichier in contrat)) ecarts.push(`${fichier} : route absente du contrat de confidentialité`)
  }
  for (const [fichier, entree] of Object.entries(contrat)) {
    if (!fichiers.includes(fichier)) ecarts.push(`${fichier} : entrée du contrat sans fichier de route`)
    if (cheminDeFichier(fichier) !== entree.chemin) ecarts.push(`${fichier} : chemin du contrat (${entree.chemin}) différent de celui du fichier (${cheminDeFichier(fichier) ?? 'illisible'})`)
    if (methodeDeFichier(fichier) !== entree.methode) ecarts.push(`${fichier} : méthode du contrat (${entree.methode}) différente de celle du fichier`)
  }
  return ecarts
}

// Vue minimale d'un schéma Zod 4 (`_zod.def`). Un type non reconnu est signalé : jamais d'angle mort silencieux.
interface DefZod {
  type: string
  shape?: Record<string, SchemaZod>
  catchall?: SchemaZod
  element?: SchemaZod
  innerType?: SchemaZod
  options?: SchemaZod[]
  items?: SchemaZod[]
  in?: SchemaZod
  out?: SchemaZod
  left?: SchemaZod
  right?: SchemaZod
  getter?: () => SchemaZod
}
export interface SchemaZod {
  _zod: { def: DefZod }
}

const TYPES_SIMPLES = new Set(['string', 'number', 'int', 'boolean', 'null', 'undefined', 'literal', 'enum', 'date', 'bigint', 'nan', 'never', 'void'])
const TYPES_ENVELOPPES = new Set(['optional', 'nullable', 'default', 'prefault', 'readonly', 'nonoptional', 'catch'])

/** `phoneNumber` → `phone_number` : la liste noire est en minuscules avec `_`. */
export function cleCanonique(cle: string): string {
  return cle.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}

export interface ResultatSchema {
  violations: string[]
  /** Exceptions réellement utilisées (pour détecter celles qui ne servent plus). */
  exceptionsUtilisees: string[]
}

/** Parcourt un schéma de réponse : tout objet doit être strict, aucune clé sensible hors exception. */
export function analyserSchema(schema: SchemaZod, exceptions: Readonly<Record<string, string>> = {}): ResultatSchema {
  const violations: string[] = []
  const utilisees = new Set<string>()
  const interdites = new Set(CLES_AUDIT_INTERDITES)

  const visiter = (courant: SchemaZod, chemin: string): void => {
    const def = courant._zod.def
    if (TYPES_SIMPLES.has(def.type)) return
    if (TYPES_ENVELOPPES.has(def.type) && def.innerType) return visiter(def.innerType, chemin)
    switch (def.type) {
      case 'object': {
        if (def.catchall?._zod.def.type !== 'never') violations.push(`${chemin || '(racine)'} : objet non strict (utiliser z.strictObject)`)
        for (const [cle, enfant] of Object.entries(def.shape ?? {})) {
          const emplacement = chemin === '' ? cle : `${chemin}.${cle}`
          if (interdites.has(cleCanonique(cle)) || interdites.has(cle)) {
            if (cle in exceptions) utilisees.add(cle)
            else violations.push(`${emplacement} : clé interdite dans une réponse d'administration`)
          }
          visiter(enfant, emplacement)
        }
        return
      }
      case 'array':
        if (def.element) visiter(def.element, `${chemin}[]`)
        return
      case 'tuple':
        for (const [i, item] of (def.items ?? []).entries()) visiter(item, `${chemin}[${i}]`)
        return
      case 'union':
        for (const option of def.options ?? []) visiter(option, chemin)
        return
      case 'intersection':
        if (def.left) visiter(def.left, chemin)
        if (def.right) visiter(def.right, chemin)
        return
      case 'pipe':
        if (def.in) visiter(def.in, chemin)
        if (def.out) visiter(def.out, chemin)
        return
      case 'lazy':
        if (def.getter) visiter(def.getter(), chemin)
        return
      case 'record':
        violations.push(`${chemin || '(racine)'} : dictionnaire à clés libres (pas une liste blanche)`)
        return
      default:
        violations.push(`${chemin || '(racine)'} : type de schéma non pris en charge par le contrôle (${def.type})`)
    }
  }

  visiter(schema, '')
  return { violations, exceptionsUtilisees: [...utilisees] }
}

/** Structure d'une route : garde d'abord, enveloppe d'erreur, aucune base ni environnement en direct. */
export function ecartsSourceRoute(fichier: string, source: string): string[] {
  const ecarts: string[] = []
  const garde = source.indexOf('requireSuperadmin(')
  if (garde === -1) ecarts.push(`${fichier} : n'appelle pas requireSuperadmin`)
  const lectures = ['readValidatedBody(', 'readBody(', 'getValidatedQuery(', 'getQuery(', 'getValidatedRouterParams(', 'getRouterParam']
  for (const lecture of lectures) {
    const position = source.indexOf(lecture)
    if (position !== -1 && garde !== -1 && position < garde) ecarts.push(`${fichier} : lit la requête (${lecture}) avant requireSuperadmin`)
  }
  if (!source.includes('defineApiHandler(')) ecarts.push(`${fichier} : n'utilise pas defineApiHandler`)
  if (/from\s+['"][^'"]*(utils\/db|shared\/db\/schema|drizzle-orm)/.test(source)) ecarts.push(`${fichier} : accède à la base depuis une route`)
  if (source.includes('process.env')) ecarts.push(`${fichier} : lit process.env`)
  return ecarts
}
