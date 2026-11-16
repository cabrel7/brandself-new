// A2 (D-A2-11) : recherche globale de l'administration. Deux groupes de 10 résultats au plus : comptes et vitrines.
// Adresse e-mail : égalité insensible à la casse. Téléphone : égalité sur le numéro international. Adresse de
// vitrine : préfixe. Nom : « contient » (`ILIKE` échappé). Aucune recherche dans le contenu des visiteurs.
import { desc } from 'drizzle-orm'
import { ADMIN_RECHERCHE_PAR_GROUPE } from '../../../shared/admin-a2'
import { users, vitrines } from '../../../shared/db/schema'
import { UnprocessableError } from '../../exceptions/http'
import {
  baseUtilisateurs,
  baseVitrines,
  normaliserRecherche,
  rechercheValide,
  sqlRechercheUtilisateur,
  sqlRechercheVitrine,
  versLigneUtilisateur,
  versLigneVitrine,
} from './a2-lignes'
import type { UtilisateurLigneVue, VitrineLigneVue } from './a2-lignes'

export interface ResultatRecherche {
  utilisateurs: UtilisateurLigneVue[]
  vitrines: VitrineLigneVue[]
}

export { normaliserRecherche } from './a2-lignes'

/** Recherche globale. Saisie trop courte ou trop longue (garde de défense, la route valide déjà) : 422 `VALIDATION`. */
export async function rechercher(saisie: string, now: Date = new Date()): Promise<ResultatRecherche> {
  if (!rechercheValide(saisie)) throw new UnprocessableError('VALIDATION', { champs: { q: ['Saisissez entre 3 et 100 caractères.'] } })
  const recherche = normaliserRecherche(saisie)
  const [comptes, lesVitrines] = await Promise.all([
    baseUtilisateurs()
      .where(sqlRechercheUtilisateur(recherche))
      .orderBy(desc(users.createdAt), users.id)
      .limit(ADMIN_RECHERCHE_PAR_GROUPE),
    baseVitrines()
      .where(sqlRechercheVitrine(recherche))
      .orderBy(desc(vitrines.createdAt), vitrines.id)
      .limit(ADMIN_RECHERCHE_PAR_GROUPE),
  ])
  return {
    utilisateurs: comptes.map((ligne) => versLigneUtilisateur(ligne, now)),
    vitrines: lesVitrines.map((ligne) => versLigneVitrine(ligne, now)),
  }
}
