import { getRequestURL, readRawBody } from 'h3'
import { defineApiHandler } from '../utils/api'
import { CHEMIN_CONSENTEMENT, corpsAccepte, exigerPlanPayantPourConsentement } from '../mcp/consentement'
import { normaliserChemin } from '../mcp/chemin'

// S16 : refuse côté serveur l'acceptation d'un assistant par un compte gratuit (voir server/mcp/consentement.ts).
// Ne s'applique qu'à POST /api/auth/oauth2/consent : toutes les autres routes /api/auth/* passent sans lecture.
// (Nommé après `mcp-inactif` : serveur désactivé = 404 en premier.)

interface EventWithWeb {
  web?: { request?: Request, [key: string]: unknown }
}

export default defineApiHandler(async (event) => {
  if (event.method !== 'POST' || normaliserChemin(event.path) !== CHEMIN_CONSENTEMENT) return

  const session = await getUserSession(event)
  // Sans session, Better Auth répond lui-même 401 : rien à protéger ici.
  if (!session) return

  // Le corps est lu une seule fois puis republié pour Better Auth (même méthode que otp-limiteur.ts).
  const corps = await readRawBody(event, 'utf8').catch(() => undefined)
  const entetes = new Headers()
  for (const [nom, valeur] of Object.entries(event.node.req.headers)) {
    if (valeur === undefined) continue
    if (Array.isArray(valeur)) for (const element of valeur) entetes.append(nom, element)
    else entetes.set(nom, valeur)
  }
  const ev = event as unknown as EventWithWeb
  ev.web = {
    ...ev.web,
    request: new Request(getRequestURL(event), { method: 'POST', headers: entetes, body: corps ?? null }),
  }

  if (!corpsAccepte(corps ?? undefined, event.node.req.headers['content-type'])) return
  await exigerPlanPayantPourConsentement(session.user.id)
})
