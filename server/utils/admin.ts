// A1 (D-A1-05) : garde de TOUTE route d'administration. Une seule réponse à toute anomalie : 404 au corps
// identique (hôte, origine, session, rôle, suspension, `session.admin`, dépassement des 8 h). Aucune cause ne fuit.
import { appendResponseHeader, getRequestHeader } from 'h3'
import type { H3Event } from 'h3'
import { ADMIN_HOST_DEV_DEFAUT, estHoteAdmin, normaliserHote } from '../../shared/admin'
import { env } from '../../shared/env'
import { lireSessionAdmin, supprimerSessionAdmin } from '../services/admin/session'
import { getClientIp } from './client-ip'
import { introuvableAdmin } from './introuvable'

export interface ContexteAdmin {
  adminId: string
  nom: string
  email: string
  sessionId: string
  sessionCreeeLe: Date
  expireLe: Date
  ip: string
}

const METHODES_SANS_ECRITURE = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Port du serveur de développement : seul cas d'origine HTTP admise (jamais en production). */
const PORT_DEV = '3000'

/** Origines (schéma, hôte ET port) autorisées pour une écriture : l'hôte d'administration en HTTPS, et hors production le serveur local. */
export function originesAdminAutorisees(adminHost: string, production: boolean): ReadonlySet<string> {
  const hote = normaliserHote(adminHost)
  return new Set([
    `https://${hote}`,
    ...(production ? [] : [`http://${ADMIN_HOST_DEV_DEFAUT}:${PORT_DEV}`, `http://${hote}:${PORT_DEV}`]),
  ])
}

/**
 * Une écriture venue d'une autre origine (page d'un autre hôte du même site : SameSite n'y suffit pas) est refusée :
 * `Origin` doit être EXACTEMENT une origine de confiance (schéma et port compris) et `Sec-Fetch-Site` ne doit pas
 * valoir `cross-site`. `Origin` absent est toléré (appel hors navigateur) : un navigateur l'envoie sur tout POST inter-origine.
 */
function origineAutorisee(event: H3Event): boolean {
  if (METHODES_SANS_ECRITURE.has(event.method)) return true
  if (getRequestHeader(event, 'sec-fetch-site') === 'cross-site') return false
  const origine = getRequestHeader(event, 'origin')
  if (origine === undefined) return true
  try {
    return originesAdminAutorisees(env.ADMIN_HOST, env.NODE_ENV === 'production').has(new URL(origine).origin)
  } catch {
    return false
  }
}

/**
 * Exige un superadmin sur l'hôte d'administration, avec une session d'administration (`admin = true`) de moins de
 * 8 heures. Relit la base : le jeton ne fait pas foi.
 */
export async function requireSuperadmin(event: H3Event): Promise<ContexteAdmin> {
  if (!estHoteAdmin(event.node.req.headers.host, env.ADMIN_HOST)) throw introuvableAdmin()
  if (!origineAutorisee(event)) throw introuvableAdmin()

  let identifiantSession: string | undefined
  try {
    identifiantSession = (await getRequestSession(event))?.session.id
  } catch {
    throw introuvableAdmin()
  }
  if (identifiantSession === undefined) throw introuvableAdmin()

  const session = await lireSessionAdmin(identifiantSession)
  if (session === null) throw introuvableAdmin()
  return {
    adminId: session.adminId,
    nom: session.nom,
    email: session.email,
    sessionId: session.sessionId,
    sessionCreeeLe: session.sessionCreeeLe,
    expireLe: session.expireLe,
    ip: getClientIp(event),
  }
}

/**
 * Déconnexion : Better Auth supprime la session et expire le cookie (en-têtes `Set-Cookie` repris tels quels), puis
 * la ligne est supprimée une seconde fois par identifiant (idempotent) : aucun cookie résiduel ne rouvre la session.
 */
export async function deconnecterAdmin(event: H3Event, admin: ContexteAdmin): Promise<void> {
  try {
    const reponse = await serverAuth(event).api.signOut({ headers: event.headers, asResponse: true })
    for (const cookie of reponse.headers.getSetCookie()) appendResponseHeader(event, 'set-cookie', cookie)
  } finally {
    await supprimerSessionAdmin(admin.sessionId)
  }
}
