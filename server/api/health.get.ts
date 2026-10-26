import { codeHttpSante, verifierSante } from '../services/health'

export default defineEventHandler(async (event) => {
  const { version } = useRuntimeConfig(event).public
  const etat = await verifierSante(version)
  setResponseStatus(event, codeHttpSante(etat))
  return etat
})
