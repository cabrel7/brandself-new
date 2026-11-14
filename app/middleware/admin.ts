import { CHEMIN_CONNEXION_ADMIN } from '../composables/useAdminSession'

// Garde de route de l'administration : la session est relue à chaque navigation (durée absolue de 8 h imposée par
// le serveur). Toute erreur, 404 uniforme comprise, renvoie vers la connexion.
export default defineNuxtRouteMiddleware(async () => {
  const { charger } = useAdminSession()
  if (!(await charger())) return navigateTo(CHEMIN_CONNEXION_ADMIN)
})
