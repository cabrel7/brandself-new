// A2 (D-A2-03) : prédicat PUR de visibilité publique d'une vitrine, testé sans base. Jumeau TypeScript de
// `sqlVitrinePublique()` (server/services/visibilite.ts) : les deux doivent rester équivalents.
// Une vitrine est publique si elle est publiée, non bloquée par l'administration et si son titulaire n'est pas suspendu.

export interface VitrineVisibilite {
  publieeLe: Date | null
  blocageAdmin: boolean
}

export interface ProprietaireVisibilite {
  suspendu: boolean
}

export function estVitrinePublique(vitrine: VitrineVisibilite, proprietaire: ProprietaireVisibilite): boolean {
  return vitrine.publieeLe !== null && !vitrine.blocageAdmin && !proprietaire.suspendu
}
