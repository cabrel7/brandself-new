export const RESERVED_USERNAMES = [
  'api',
  'studio',
  'connexion',
  'inscription',
  'onboarding',
  'tarifs',
  'l',
  'admin',
  'www',
  'app',
  'aide',
  'contact',
  'cgu',
  'confidentialite',
  'sitemap',
  'robots',
  'assets',
  '_nuxt',
  'medias',
  'compte',
  'brandself',
  'jesuis',
  'jesuispro',
  'support',
  'blog',
  'mentions-legales',
  'services',
  'desabonnement',
  // Route serveur du protocole MCP (S16) : /mcp ne doit jamais être une vitrine.
  'mcp',
  // Dossier public/landing/ (photos de la page d'accueil) : servi avant la route [username].
  'landing',
]

export function isReserved(value: string): boolean {
  return RESERVED_USERNAMES.includes(value)
}
