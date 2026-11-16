// A4 (D-A4-08) : un chemin et une méthode sont-ils suspendus pendant la maintenance ? Décision PURE (testable) sur le
// chemin NORMALISÉ (`//`, `%2e`, casse, `./`, query : même normalisation que les gardes MCP). `/api/studio/**` : tout
// sauf `GET` ; connexion et inscription (`/api/auth/{sign-in,email-otp,phone-number}`) : toutes méthodes. Le reste
// (vitrines publiques, `/api/public/etat`, administration, lecture de session) reste ouvert.
import { MAINTENANCE_PREFIXES_AUTH, MAINTENANCE_PREFIXES_STUDIO } from '../../shared/admin'
import { estSousChemin, normaliserChemin } from '../mcp/chemin'

const METHODE_LECTURE = 'GET'

export function maintenanceApplique(methode: string, cheminBrut: string): boolean {
  const chemin = normaliserChemin(cheminBrut)
  if (MAINTENANCE_PREFIXES_AUTH.some((prefixe) => estSousChemin(chemin, prefixe))) return true
  return methode.toUpperCase() !== METHODE_LECTURE && MAINTENANCE_PREFIXES_STUDIO.some((prefixe) => estSousChemin(chemin, prefixe))
}
