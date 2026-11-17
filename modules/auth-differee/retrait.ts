/** Retrait du plugin client et du middleware global de `@nuxtjs/better-auth` (logique pure, testée seule ; voir `modules/auth-differee.ts`). */
const MODULE_AUTH = '@nuxtjs/better-auth'
const MOTIF_PLUGIN = '/runtime/app/plugins/session.client'
const MOTIF_MIDDLEWARE = '/runtime/app/middleware/auth.global'
export const NOM_MIDDLEWARE = 'auth'

interface ElementApp {
  src?: string
  path?: string
  name?: string
  mode?: string
  global?: boolean
}

export interface AppResolue {
  plugins: ElementApp[]
  middleware: ElementApp[]
}

function sansExtension(chemin: string): string {
  return chemin.replaceAll('\\', '/').replace(/\.(?:[cm]?[jt]s)$/, '')
}

function correspond(chemin: string | undefined, motif: string): boolean {
  if (!chemin) return false
  const normalise = sansExtension(chemin)
  return normalise.includes(`/${MODULE_AUTH}/`) && normalise.endsWith(motif)
}

/**
 * Retire le plugin client et le middleware global du module de `app` (modifié sur place) et renvoie le chemin
 * du middleware retiré. Lève une erreur explicite si l'un des deux est introuvable.
 */
export function retirerAuthGlobale(app: AppResolue): string {
  const indexPlugin = app.plugins.findIndex((plugin) => correspond(plugin.src, MOTIF_PLUGIN))
  const indexMiddleware = app.middleware.findIndex((m) => m.name === NOM_MIDDLEWARE && correspond(m.path, MOTIF_MIDDLEWARE))
  const manquants = [
    indexPlugin < 0 ? `le plugin client « ${MOTIF_PLUGIN} »` : null,
    indexMiddleware < 0 ? `le middleware global « ${NOM_MIDDLEWARE} » (${MOTIF_MIDDLEWARE})` : null,
  ].filter((m): m is string => m !== null)
  if (manquants.length > 0) {
    throw new Error(
      `[auth-differee] ${manquants.join(' et ')} de ${MODULE_AUTH} est introuvable : la structure interne du module a changé `
      + '(version épinglée 0.3.12). Le build est arrêté pour ne pas livrer une garde du studio absente : '
      + 'adapter modules/auth-differee.ts à la nouvelle version.',
    )
  }
  const cheminGarde = app.middleware[indexMiddleware]?.path
  if (!cheminGarde) throw new Error('[auth-differee] chemin du middleware global introuvable.')
  app.plugins.splice(indexPlugin, 1)
  app.middleware.splice(indexMiddleware, 1)
  return cheminGarde
}

