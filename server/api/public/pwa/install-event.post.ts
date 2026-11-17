import { defineApiHandler } from '#server/utils/api'
import { readBodyWith } from '#server/utils/validation'
import { db } from '#server/utils/db'
import { pwaInstallEvents } from '#shared/db/schema'
import { schemaPwaInstallEvent } from '#shared/schemas/pwa'
import { randomUUID } from 'node:crypto'

// S15 : reception d'un evenement d'installation PWA (proposee / installee / refusee).
// Route publique sans session : appelee depuis le navigateur (studio et pages marketing).
// Pas de donnee personnelle : type, origine, type d'appareil uniquement.
// Les statistiques ne sont pas critiques : en cas d'echec (base non encore migree, etc.),
// on repond quand même ok pour ne jamais casser l'UX.
export default defineApiHandler(async (event) => {
  const { type, origine, deviceType } = await readBodyWith(event, schemaPwaInstallEvent)
  try {
    await db.insert(pwaInstallEvents).values({
      id: randomUUID(),
      type,
      origine,
      deviceType,
    })
  } catch {
    // Statistique non critique : on ignore l'echec et on repond ok.
  }
  return { ok: true }
})
