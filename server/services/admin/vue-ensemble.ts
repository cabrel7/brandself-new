// A1 (D-A1-13) : la vue d'ensemble ne renvoie aucun compteur (ils arrivent en A2) : le nom de l'administrateur et
// l'instant de génération. Un service (et non la route) pour que A2 y ajoute ses agrégats sans toucher la route.
export interface VueEnsemble {
  adminNom: string
  genereLe: Date
}

export function lireVueEnsemble(admin: { nom: string }, maintenant: Date = new Date()): VueEnsemble {
  return { adminNom: admin.nom, genereLe: maintenant }
}
