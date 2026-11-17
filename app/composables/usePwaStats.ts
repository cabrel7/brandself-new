// S15 : envoi d'un evenement d'installation PWA vers l'API publique.
// Aucune donnee personnelle : type, origine, type d'appareil uniquement.
// Les echecs sont avalles : le statistiques ne doivent jamais casser l'affichage.
export function usePwaStats() {
  async function enregistrerEvenement(type: 'proposee' | 'installee' | 'refusee', origine: 'studio' | 'marketing', deviceType: 'mobile' | 'tablette' | 'ordinateur' | 'inconnu'): Promise<void> {
    try {
      await $fetch('/api/public/pwa/install-event', {
        method: 'POST',
        body: { type, origine, deviceType },
      })
    } catch {
      // Statistique non critique : on ignore l'echec.
    }
  }
  return { enregistrerEvenement }
}
