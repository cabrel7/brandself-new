export const MOTS_RESERVES = [
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
  'static',
  'media',
  'login',
  'logout',
  'register',
  'error',
  '404',
] as const

export function estReserve(valeur: string): boolean {
  return (MOTS_RESERVES as readonly string[]).includes(valeur.toLowerCase())
}
