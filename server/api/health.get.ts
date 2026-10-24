import { verifierSante } from '../services/health'

export default defineEventHandler(async (event) => {
  const { version } = useRuntimeConfig(event).public
  return verifierSante(version)
})
