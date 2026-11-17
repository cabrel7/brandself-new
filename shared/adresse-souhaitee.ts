// Adresse choisie sur la page d'accueil, mémorisée le temps de l'inscription (connexion par code ou Google
// comprise), puis reprise à l'étape « Votre adresse » de l'onboarding. Donnée publique, jamais personnelle.

export const COOKIE_ADRESSE_SOUHAITEE = 'adresse_souhaitee'

/** Une heure : de quoi recevoir un code ou passer par Google, pas plus. */
export const ADRESSE_SOUHAITEE_DUREE_SECONDES = 60 * 60
