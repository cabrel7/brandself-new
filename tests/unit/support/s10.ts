import { vi } from 'vitest'
import type { MockInstance } from 'vitest'

// Aides communes des tests unitaires S10. Imports PARESSEUX des modules de production (lots B1, B2, B3) : un module
// absent (phase RED) fait échouer le seul test qui en a besoin. Le contrat attendu (signatures, HYPOTHÈSES là où la spec
// §3/§5 ne les fige pas) est documenté dans tests/integration/support/abonnements.ts ; ce fichier-ci ne contient
// que ce que les tests unitaires partagent.

export const modulePlans = () => import('../../../server/services/plans')
export const modulePlansRegles = () => import('../../../server/services/plans-regles')
export const moduleAbonnementsRegles = () => import('../../../server/services/abonnements-regles')
export const moduleTransitions = () => import('../../../server/services/paiements/transitions')
export const moduleTelephone = () => import('../../../server/services/paiements/telephone')
export const moduleKpay = () => import('../../../server/services/paiements/fournisseurs/kpay/adaptateur')
export const moduleKpayConstantes = () => import('../../../server/services/paiements/fournisseurs/kpay/constantes')
export const moduleConfigPaiements = () => import('../../../server/config/paiements')

export const JOUR_MS = 86_400_000

/** Millisecondes d'une date ou d'une chaîne ISO (le contrat peut renvoyer l'une ou l'autre). */
export function ms(valeur: Date | string | null | undefined): number | null {
  if (valeur === null || valeur === undefined) return null
  return valeur instanceof Date ? valeur.getTime() : new Date(valeur).getTime()
}

export function iso(valeur: Date | string | null | undefined): string | null {
  const t = ms(valeur)
  return t === null ? null : new Date(t).toISOString()
}

export interface EspionConsole {
  /** Tout ce qui a été écrit sur la console, sérialisé. */
  contenu: () => string
  restaurer: () => void
}

/** Capture console.log/info/warn/error/debug (rien ne sort) ; sert aux assertions « aucune donnée sensible journalisée ». */
export function espionnerConsole(): EspionConsole {
  const espions: MockInstance[] = []
  const lignes: string[] = []
  for (const niveau of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    espions.push(vi.spyOn(console, niveau).mockImplementation((...args: unknown[]) => {
      lignes.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, (_k, v: unknown) => (v instanceof Error ? `${v.name}:${v.message}` : v)))).join(' '))
    }))
  }
  return {
    contenu: () => lignes.join('\n'),
    restaurer: () => {
      for (const espion of espions) espion.mockRestore()
    },
  }
}

/** Erreur capturée : statut et code métier (DomainError), sans dépendre de la classe exacte. */
export interface ErreurVue {
  code: string | undefined
  status: number | undefined
  message: string
}

const MODULE_ABSENT = /Cannot find module|Failed to load url|Failed to resolve import|ERR_MODULE_NOT_FOUND/

export function lire(valeur: unknown, cle: string): unknown {
  return typeof valeur === 'object' && valeur !== null ? (valeur as Record<string, unknown>)[cle] : undefined
}

/** Attend un rejet et le décrit. Un module absent (RED) remonte tel quel au lieu d'être pris pour l'erreur attendue. */
export async function echec(action: () => unknown): Promise<ErreurVue> {
  try {
    await action()
  } catch (erreur) {
    if (erreur instanceof Error && MODULE_ABSENT.test(erreur.message)) throw erreur
    const code = lire(erreur, 'code')
    const status = lire(erreur, 'status') ?? lire(erreur, 'statusCode')
    return {
      code: typeof code === 'string' ? code : undefined,
      status: typeof status === 'number' ? status : undefined,
      message: erreur instanceof Error ? erreur.message : String(erreur),
    }
  }
  throw new Error('L’action devait échouer mais elle a abouti.')
}
