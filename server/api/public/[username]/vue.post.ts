// S11 §4.5 : collecte d'une vue publique. Modèle de `clic.post.ts` : validation + délégation + réponse.
import { setResponseHeader, setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { readBodyWith, readParamsWith } from '#server/utils/validation'
import { getClientIp } from '#server/utils/client-ip'
import { enregistrerVue } from '#server/services/statistiques'
import { schemaPublicUsernameParams } from '#shared/schemas/agenda'
import { schemaVuePublic } from '#shared/schemas/statistiques'

export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  const body = await readBodyWith(event, schemaVuePublic)
  await enregistrerVue({
    username,
    chemin: body.chemin,
    origine: body.origine ?? null,
    ip: getClientIp(event),
    userAgent: getHeader(event, 'user-agent') ?? null,
    headers: event.node.req.headers,
    now: new Date(),
  })
  setResponseStatus(event, 204)
  setResponseHeader(event, 'Cache-Control', 'no-store')
  return null
})

function getHeader(event: { node: { req: { headers: Record<string, string | string[] | undefined> } } }, nom: string): string | null {
  const valeur = event.node.req.headers[nom]
  if (typeof valeur === 'string') return valeur
  if (Array.isArray(valeur) && valeur.length > 0) return valeur[0] ?? null
  return null
}
