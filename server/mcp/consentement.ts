// S16 : le consentement OAuth (POST /api/auth/oauth2/consent) est le point d'entrée du serveur MCP : c'est lui qui
// délivre le code d'autorisation. Le serveur MCP est réservé au plan payant ; on refuse donc l'ACCEPTATION d'un
// compte gratuit dès ici (sinon l'assistant obtient un jeton qui ne servirait qu'à échouer à chaque appel).
// Le REFUS reste toujours permis. Aucune règle de plan dans auth.config.ts (projet tsconfig.node).

import { DomainError } from '../exceptions/http'
import { aCapaciteMcp } from '../services/plans'

export const CHEMIN_CONSENTEMENT = '/api/auth/oauth2/consent'

export const MESSAGE_PLAN_PAYANT_CONSENTEMENT =
  'Votre assistant est réservé au plan payant. Passez au plan payant depuis votre studio pour autoriser un assistant.'

/**
 * Vrai si le corps demande autre chose qu'un refus explicite. Fermé par défaut : un corps illisible, un type de
 * contenu inattendu ou une valeur ambiguë sont traités comme une acceptation (Better Auth lit JSON et formulaire).
 */
export function corpsAccepte(corps: string | undefined, contentType: string | undefined): boolean {
  if (!corps) return true
  let accept: unknown
  try {
    if ((contentType ?? '').toLowerCase().includes('application/x-www-form-urlencoded')) {
      accept = new URLSearchParams(corps).get('accept') ?? undefined
    } else {
      accept = (JSON.parse(corps) as Record<string, unknown> | null)?.accept
    }
  } catch {
    return true
  }
  return !(accept === false || accept === 'false')
}

/** 403 `PLAN_PAYANT_REQUIS` si l'utilisateur n'a pas le plan payant (actif ou en grâce, comme à chaque appel MCP). */
export async function exigerPlanPayantPourConsentement(userId: string): Promise<void> {
  // A4 (D-A4-11) : plan payant OU capacité `mcp` accordée par l'administration.
  if (!(await aCapaciteMcp(userId))) {
    throw new DomainError('PLAN_PAYANT_REQUIS', MESSAGE_PLAN_PAYANT_CONSENTEMENT, 403)
  }
}
