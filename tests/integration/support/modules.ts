// Imports paresseux des modules de production : un module absent (phase RED) fait échouer
// UNIQUEMENT les tests qui en ont besoin, au lieu de vider tout le fichier de test.
// Chaque test fait `const { fonction } = await vitrinesService()`.
export const vitrinesService = () => import('../../../server/services/vitrines')
export const mediasService = () => import('../../../server/services/medias')
export const utilisateursService = () => import('../../../server/services/utilisateurs')
export const limiteurService = () => import('../../../server/services/limiteur')
export const ressourceVitrine = () => import('../../../server/resources/vitrine')
export const ressourceMedia = () => import('../../../server/resources/media')
export const ressourceUtilisateur = () => import('../../../server/resources/utilisateur')
export const servicesService = () => import('../../../server/services/services')
export const servicesRegles = () => import('../../../server/services/services-regles')
export const ressourceService = () => import('../../../server/resources/service')
// S4 : modules à créer en GREEN (L3). Jamais d'import statique ici.
export const realisationsService = () => import('../../../server/services/realisations')
export const realisationsRegles = () => import('../../../server/services/realisations-regles')
export const listesRegles = () => import('../../../server/services/listes-regles')
export const vitrineAcces = () => import('../../../server/services/vitrine-acces')
export const ressourceRealisation = () => import('../../../server/resources/realisation')
export const ressourceSeo = () => import('../../../server/resources/seo')
// S6 : liens (même patron que les autres listes).
export const liensService = () => import('../../../server/services/liens')
export const ressourceLien = () => import('../../../server/resources/lien')
// S7 : imports paresseux pour conserver une collecte RED lisible tant que les modules n'existent pas.
export const agendaService = () => import('../../../server/services/agenda')
export const creneauxService = () => import('../../../server/services/creneaux')
export const reservationsService = () => import('../../../server/services/reservations')
export const demandesService = () => import('../../../server/services/demandes')
export const ressourceReservation = () => import('../../../server/resources/agenda')
