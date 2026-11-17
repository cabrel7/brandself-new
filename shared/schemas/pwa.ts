import { z } from 'zod'

// S15 : validation du corps d'un evenement d'installation PWA envoye par le client.
// Pas de donnee personnelle : uniquement le type, l'origine et le type d'appareil.
export const schemaPwaInstallEvent = z.object({
  type: z.enum(['proposee', 'installee', 'refusee']),
  origine: z.enum(['studio', 'marketing']),
  deviceType: z.enum(['mobile', 'tablette', 'ordinateur', 'inconnu']),
})
