// A4 (D-A4-08) : pendant la maintenance, 503 `MAINTENANCE` (`Retry-After: 300`, message de l'administrateur) sur
// `/api/studio/**` (hors GET) et sur la connexion. Passe après `00-hote.ts`. L'hôte d'administration n'est JAMAIS
// concerné (le superadmin doit pouvoir se connecter pour lever la maintenance). La lecture est celle des réglages
// (cache 5 s) : le studio est rétabli sans redémarrage (CA03) ; une table illisible ne déclenche jamais la maintenance.
import { MAINTENANCE_RETRY_AFTER_S } from '../../shared/admin'
import { ServiceUnavailableError } from '../exceptions/http'
import { lireEtatMaintenance } from '../services/maintenance'
import { defineApiHandler } from '../utils/api'
import { maintenanceApplique } from '../utils/maintenance'

export default defineApiHandler(async (event) => {
  if (event.context.hoteAdmin === true) return
  if (!maintenanceApplique(event.method, event.path)) return
  const etat = await lireEtatMaintenance()
  if (!etat.maintenance) return
  throw new ServiceUnavailableError('MAINTENANCE', {
    retryAfter: MAINTENANCE_RETRY_AFTER_S,
    ...(etat.message === null ? {} : { messageMaintenance: etat.message }),
  })
})
