// A5 : pays d'un numéro international. Fonction pure partagée par le service de catalogues et par la configuration
// d'authentification (qui ne peut importer que `node_modules` et `shared/`).
import { env } from './env'

/** Aucun fournisseur SMS en production (`SenderOtpSms`) ; hors production, la boîte de développement fait office. */
export function smsFournisseurConfigure(): boolean {
  return env.NODE_ENV !== 'production'
}

/**
 * Pays les plus précis d'un numéro international (`+2376…` ou `2376…`) : ceux dont l'indicatif est le plus long
 * préfixe. Plusieurs pays peuvent partager un indicatif (`+1`). Aucun pays connu : liste vide.
 */
export function paysDuNumero<T extends { readonly indicatif: string }>(numero: string, catalogue: readonly T[]): T[] {
  const chiffres = numero.replace(/\D/g, '')
  const candidats = catalogue.filter((p) => chiffres.startsWith(p.indicatif))
  const plusLong = Math.max(0, ...candidats.map((p) => p.indicatif.length))
  return candidats.filter((p) => p.indicatif.length === plusLong)
}
