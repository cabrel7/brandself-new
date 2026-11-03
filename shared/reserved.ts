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
  'support',
  'blog',
  'mentions-legales',
  'services',
  'desabonnement',
]

export function isReserved(value: string): boolean {
  return RESERVED_USERNAMES.includes(value)
}
