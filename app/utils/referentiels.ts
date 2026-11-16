// A5 (UI) : listes de pays et d'indicatifs lues sur les référentiels publics (catalogue géré par l'administration).
// Fonctions pures. Si la lecture échoue, les listes du code servent de repli : l'inscription et la connexion ne
// restent jamais sans liste. Le serveur reste l'autorité (il refuse un pays inactif et un canal fermé).
import type { ReferentielsDto } from '#shared/schemas/admin-catalogues'
import { PAYS } from '#shared/vitrine'

export const REFERENTIELS_CHEMIN = '/api/public/referentiels'

export interface OptionListe {
  label: string
  value: string
  description?: string
}

/** Pays proposés à l'inscription : ceux du catalogue (actifs), sinon la liste du code. */
export function optionsPays(referentiels: ReferentielsDto | null): OptionListe[] {
  const pays = referentiels?.pays ?? []
  if (pays.length === 0) return PAYS.map((p) => ({ label: p.label, value: p.code }))
  return pays.map((p) => ({ label: p.libelle, value: p.code }))
}

/** Indicatifs du code, utilisés seulement si les référentiels ne répondent pas (liste historique de la connexion). */
const INDICATIFS_REPLI: readonly OptionListe[] = [
  { label: '+237', value: '+237', description: 'Cameroun' },
  { label: '+229', value: '+229', description: 'Bénin' },
  { label: '+225', value: '+225', description: 'Côte d’Ivoire' },
  { label: '+221', value: '+221', description: 'Sénégal' },
  { label: '+241', value: '+241', description: 'Gabon' },
  { label: '+243', value: '+243', description: 'RD Congo' },
  { label: '+226', value: '+226', description: 'Burkina Faso' },
  { label: '+223', value: '+223', description: 'Mali' },
  { label: '+228', value: '+228', description: 'Togo' },
  { label: '+33', value: '+33', description: 'France' },
  { label: '+32', value: '+32', description: 'Belgique' },
  { label: '+41', value: '+41', description: 'Suisse' },
  { label: '+1', value: '+1', description: 'Canada / États-Unis' },
]

/**
 * Indicatifs proposés pour recevoir un code par SMS : pays dont le canal est EFFECTIVEMENT ouvert. Un indicatif partagé
 * (+1) n'apparaît qu'une fois, avec les noms de ses pays. Liste vide : aucun pays n'accepte le SMS pour le moment.
 */
export function optionsIndicatifsSms(referentiels: ReferentielsDto | null): OptionListe[] {
  if (referentiels === null) return [...INDICATIFS_REPLI]
  const parIndicatif = new Map<string, string[]>()
  for (const pays of referentiels.pays) {
    if (!pays.canaux.sms) continue
    parIndicatif.set(pays.indicatif, [...(parIndicatif.get(pays.indicatif) ?? []), pays.libelle])
  }
  return [...parIndicatif].map(([indicatif, noms]) => ({ label: `+${indicatif}`, value: `+${indicatif}`, description: noms.join(' / ') }))
}
