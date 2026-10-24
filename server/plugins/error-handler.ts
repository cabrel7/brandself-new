import type { H3Error } from 'h3'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('error', (error, { event }) => {
    const statut = (error as H3Error).statusCode ?? 500
    if (statut >= 500) {
      console.error({ chemin: event?.path, statut, message: error.message })
    }
  })
})
