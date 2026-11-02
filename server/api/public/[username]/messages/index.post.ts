import { setResponseStatus } from 'h3'
import { defineApiHandler } from '#server/utils/api'
import { getClientIp } from '#server/utils/client-ip'
import { readBodyImmediateWith, readParamsWith } from '#server/utils/validation'
import { toMessageCreatedResource } from '#server/resources/message'
import { enforceLimit } from '#server/services/limiteur'
import { enforceContactLimit } from '#server/services/contact-limiteur'
import { createMessage } from '#server/services/messages'
import { MESSAGE_PUBLIC_LIMIT } from '#shared/limites'
import { schemaPublicUsernameParams } from '#shared/schemas/agenda'
import { schemaMessageCreate } from '#shared/schemas/message'

// S7-bis §4.4 : route fine, ordre imposé :
//   limite IP (fail-closed) → Zod strict → limite contact (fail-closed) → service → resource.
// Le corps d'un formulaire est un petit JSON déjà reçu avec les en-têtes : il est validé
// immédiatement (repli asynchrone s'il est partiellement arrivé) pour que la limite de
// contact s'enchaîne dès que la limite IP aboutit.
export default defineApiHandler(async (event) => {
  const { username } = readParamsWith(event, schemaPublicUsernameParams)
  const ip = getClientIp(event)
  await enforceLimit(`message-publique:${ip}`, MESSAGE_PUBLIC_LIMIT.limit, MESSAGE_PUBLIC_LIMIT.windowS, {
    failClosed: true,
  })
  const recu = readBodyImmediateWith(event, schemaMessageCreate)
  const input = recu instanceof Promise ? await recu : recu
  await enforceContactLimit('message-contact', username, input.email, input.telephone ?? null)
  const { item } = await createMessage(username, {
    nom: input.nom,
    email: input.email,
    telephone: input.telephone ?? null,
    sujet: input.sujet,
    message: input.message,
  })
  setResponseStatus(event, 201)
  return toMessageCreatedResource(item)
})
