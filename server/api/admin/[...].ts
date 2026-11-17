import { defineApiHandler } from '#server/utils/api'
import { requireSuperadmin } from '#server/utils/admin'
import { introuvableAdmin } from '#server/utils/introuvable'

// Toute route `/api/admin/**` inconnue : la garde passe d'abord, puis le MÊME 404 uniforme. Sans cela, un appelant
// non autorisé verrait un 404 sur une route absente et un 404 identique sur une route existante, mais un 405/autre
// sur une méthode inattendue : aucune différence observable ne doit révéler quelles routes existent.
export default defineApiHandler(async (event) => {
  await requireSuperadmin(event)
  throw introuvableAdmin()
})
