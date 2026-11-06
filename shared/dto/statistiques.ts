import type { PageStat, PeriodeStat, SourceStat } from '../statistiques'

export interface PageStatDTO {
  type: PageStat
  /** `''` pour une liste ou l'accueil. */
  identifiant: string
  libelle: string
  visites: number
}

export interface SourceStatDTO {
  source: SourceStat
  libelle: string
  visites: number
}

export interface JourStatDTO {
  /** Jour civil `AAAA-MM-JJ` dans le fuseau de la vitrine. */
  jour: string
  visites: number
  visiteursUniques: number
}

export interface StatistiquesDTO {
  periode: PeriodeStat
  /** Limite du plan (7 ou 90) : le client affiche ce qu'il a le droit de demander. */
  joursMax: number
  totaux: { visites: number, visiteursUniques: number, clics: number, reservations: number }
  parJour: JourStatDTO[]
  /** `null` hors plan (#176) — jamais un tableau vide qui ferait croire à « 0 page ». */
  pages: PageStatDTO[] | null
  sources: SourceStatDTO[] | null
}
