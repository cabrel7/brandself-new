const AUTH_CHEMIN_BASE = '/api/auth'

/**
 * Base des appels d'authentification de l'hôte d'administration : TOUJOURS l'origine courante, jamais
 * `runtimeConfig.public.siteUrl` (hôte public). Sans origine lisible, un chemin relatif (même origine).
 */
export function baseUrlAuthAdmin(origine: string | null | undefined): string {
  if (!origine) return AUTH_CHEMIN_BASE
  try {
    return `${new URL(origine).origin}${AUTH_CHEMIN_BASE}`
  } catch {
    return AUTH_CHEMIN_BASE
  }
}
