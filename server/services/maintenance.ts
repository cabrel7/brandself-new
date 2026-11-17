// A4 (D-A4-08) : état de la maintenance (réglages `maintenance.active` et `maintenance.message`). Lecture seule, par
// `Reglages.lire` (cache 5 s, jamais d'exception : table illisible = pas de maintenance, la vitrine reste servie).
import { REGLAGE_CLES } from '../../shared/reglages'
import { Reglages } from './reglages'

export interface EtatMaintenance {
  maintenance: boolean
  /** Texte brut de l'administrateur ; `null` hors maintenance ou s'il est vide. */
  message: string | null
  /** Faux quand les inscriptions sont fermées (repli fermé si le réglage est illisible) ; ne révèle rien d'un compte. */
  inscriptions: boolean
}

export async function lireEtatMaintenance(): Promise<EtatMaintenance> {
  const [maintenance, inscriptions] = await Promise.all([
    Reglages.lire(REGLAGE_CLES.maintenanceActive),
    Reglages.lire(REGLAGE_CLES.inscriptionsOuvertes),
  ])
  if (!maintenance) return { maintenance: false, message: null, inscriptions }
  const message = (await Reglages.lire(REGLAGE_CLES.maintenanceMessage)).trim()
  return { maintenance: true, message: message === '' ? null : message, inscriptions }
}
