// A1 (D-A1-01, D-A1-06, D-A1-07) : séparation des hôtes. Passe EN PREMIER (préfixe 00-).
// La décision est pure et testée (shared/admin.ts `decisionHote`) ; la logique commune est dans server/utils/hote.ts.
// Les fichiers de `public/` sont servis AVANT ce middleware : le plugin `server/plugins/hote-admin.ts` les couvre.
import { defineEventHandler } from 'h3'
import type { H3Event } from 'h3'
import { evaluerHote, poserEntetesAdmin } from '../utils/hote'
import { introuvableAdmin } from '../utils/introuvable'

export default defineEventHandler((event: H3Event): void => {
  const { hoteAdmin, refuser } = evaluerHote(event)
  event.context.hoteAdmin = hoteAdmin
  if (hoteAdmin) poserEntetesAdmin(event)
  if (refuser) throw introuvableAdmin()
})
