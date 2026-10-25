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
]

export function isReserved(value: string): boolean {
  return RESERVED_USERNAMES.includes(value)
}
