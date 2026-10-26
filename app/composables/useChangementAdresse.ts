const ERREUR_PRISE = 'Cette adresse est déjà prise. Essayez-en une autre.'
const ERREUR_GENERIQUE = 'Nous n’avons pas pu changer votre adresse. Réessayez dans un instant.'

/** Changement du username : `PUT /api/studio/vitrine/username`. */
export function useChangementAdresse(apresChangement: () => Promise<void>) {
  const enCours = ref(false)
  const erreur = ref('')

  async function changer(username: string): Promise<boolean> {
    erreur.value = ''
    enCours.value = true
    try {
      await $fetch('/api/studio/vitrine/username', { method: 'PUT', body: { username } })
      await apresChangement()
      return true
    } catch (e) {
      const { code, champs } = lireErreurApi(e)
      if (code === 'USERNAME_PRIS') {
        erreur.value = ERREUR_PRISE
      } else if (code === 'VALIDATION') {
        const detail = champs.username?.[0]
        erreur.value = detail ? `Adresse invalide : ${detail}.` : ERREUR_GENERIQUE
      } else {
        erreur.value = ERREUR_GENERIQUE
      }
      return false
    } finally {
      enCours.value = false
    }
  }

  return { enCours, erreur, changer }
}
