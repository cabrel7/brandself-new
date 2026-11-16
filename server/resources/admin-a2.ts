// A2 : sortie de l'API d'administration des utilisateurs, vitrines et assistants. Chaque réponse est construite CHAMP
// PAR CHAMP (jamais de spread d'une ligne de base ni d'un objet ORM) puis validée par un schéma strict
// (shared/schemas/admin-a2.ts) : une clé en trop fait échouer la réponse au lieu de fuiter. Aucune donnée de visiteur,
// aucune adresse IP, aucun jeton.
import {
  schemaActionAdminReponse,
  schemaAssistantDto,
  schemaChangerPlanReponse,
  schemaListeAssistantsDto,
  schemaListeUtilisateursDto,
  schemaListeVitrinesDto,
  schemaOffrirJoursReponse,
  schemaRechercheDto,
  schemaRevocationReponse,
  schemaUtilisateurFicheDto,
  schemaUtilisateurLigneDto,
  schemaVitrineFicheDto,
  schemaVitrineLigneDto,
} from '../../shared/schemas/admin-a2'
import type {
  ActionAdminReponse,
  AssistantDto,
  ChangerPlanReponse,
  ListeAssistantsDto,
  ListeUtilisateursDto,
  ListeVitrinesDto,
  OffrirJoursReponse,
  RechercheDto,
  RevocationReponse,
  UtilisateurFicheDto,
  UtilisateurLigneDto,
  VitrineFicheDto,
  VitrineLigneDto,
} from '../../shared/schemas/admin-a2'
import type { PageAdmin, UtilisateurLigneVue, VitrineLigneVue } from '../services/admin/a2-lignes'
import type { AssistantVue } from '../services/admin/assistants'
import type { ResultatRecherche } from '../services/admin/recherche'
import type { ResultatChangementPlan, ResultatOffreJours, UtilisateurFicheVue } from '../services/admin/utilisateurs'
import type { VitrineFicheVue } from '../services/admin/vitrines'

const enIso = (date: Date): string => date.toISOString()
const enIsoOuNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

function utilisateurLigne(ligne: UtilisateurLigneVue) {
  return {
    id: ligne.id,
    nom: ligne.nom,
    email: ligne.email,
    username: ligne.username,
    plan: ligne.plan,
    etat: ligne.etat,
    suspendu: ligne.suspendu,
    inscritLe: enIso(ligne.inscritLe),
    derniereConnexion: enIsoOuNull(ligne.derniereConnexion),
    vitrine: ligne.vitrine === null ? null : { publiee: ligne.vitrine.publiee, bloquee: ligne.vitrine.bloquee },
  }
}

function vitrineLigne(ligne: VitrineLigneVue) {
  return {
    id: ligne.id,
    utilisateurId: ligne.utilisateurId,
    username: ligne.username,
    nom: ligne.nom,
    metier: ligne.metier,
    plan: ligne.plan,
    publiee: ligne.publiee,
    bloquee: ligne.bloquee,
    blocageMotif: ligne.blocageMotif,
    proprietaireSuspendu: ligne.proprietaireSuspendu,
    creeLe: enIso(ligne.creeLe),
  }
}

function assistant(ligne: AssistantVue) {
  return {
    id: ligne.id,
    client: ligne.client,
    portees: [...ligne.portees],
    dernierUsage: enIsoOuNull(ligne.dernierUsage),
  }
}

export function toUtilisateurLigne(ligne: UtilisateurLigneVue): UtilisateurLigneDto {
  return schemaUtilisateurLigneDto.parse(utilisateurLigne(ligne))
}

export function toListeUtilisateurs(page: PageAdmin<UtilisateurLigneVue>): ListeUtilisateursDto {
  return schemaListeUtilisateursDto.parse({
    elements: page.elements.map((ligne) => utilisateurLigne(ligne)),
    total: page.total,
    page: page.page,
    limite: page.limite,
  })
}

export function toUtilisateurFiche(fiche: UtilisateurFicheVue): UtilisateurFicheDto {
  return schemaUtilisateurFicheDto.parse({
    ...utilisateurLigne(fiche),
    telephone: fiche.telephone,
    pays: fiche.pays,
    devise: fiche.devise,
    fuseau: fiche.fuseau,
    motifSuspension: fiche.motifSuspension,
    abonnement: fiche.abonnement === null
      ? null
      : {
          origine: fiche.abonnement.origine,
          expireLe: enIso(fiche.abonnement.expireLe),
          premiereActivationLe: enIso(fiche.abonnement.premiereActivationLe),
        },
    compteurs: {
      services: fiche.compteurs.services,
      realisations: fiche.compteurs.realisations,
      temoignages: fiche.compteurs.temoignages,
      liens: fiche.compteurs.liens,
    },
    activite30j: {
      vues: fiche.activite30j.vues,
      reservations: fiche.activite30j.reservations,
      demandes: fiche.activite30j.demandes,
      messages: fiche.activite30j.messages,
    },
    iaMois: fiche.iaMois,
    sessionsActives: fiche.sessionsActives.map((session) => ({
      id: session.id,
      creeLe: enIso(session.creeLe),
      expireLe: enIso(session.expireLe),
    })),
    assistants: fiche.assistants.map((ligne) => assistant(ligne)),
    capacites: [...fiche.capacites],
  })
}

export function toListeVitrines(page: PageAdmin<VitrineLigneVue>): ListeVitrinesDto {
  return schemaListeVitrinesDto.parse({
    elements: page.elements.map((ligne) => vitrineLigne(ligne)),
    total: page.total,
    page: page.page,
    limite: page.limite,
  })
}

export function toVitrineLigne(ligne: VitrineLigneVue): VitrineLigneDto {
  return schemaVitrineLigneDto.parse(vitrineLigne(ligne))
}

export function toVitrineFiche(fiche: VitrineFicheVue): VitrineFicheDto {
  return schemaVitrineFicheDto.parse({
    ...vitrineLigne(fiche),
    publieeLe: enIsoOuNull(fiche.publieeLe),
    compteurs: {
      services: fiche.compteurs.services,
      realisations: fiche.compteurs.realisations,
      temoignages: fiche.compteurs.temoignages,
      liens: fiche.compteurs.liens,
    },
  })
}

export function toRecherche(resultat: ResultatRecherche): RechercheDto {
  return schemaRechercheDto.parse({
    utilisateurs: resultat.utilisateurs.map((ligne) => utilisateurLigne(ligne)),
    vitrines: resultat.vitrines.map((ligne) => vitrineLigne(ligne)),
  })
}

export function toAssistant(ligne: AssistantVue): AssistantDto {
  return schemaAssistantDto.parse(assistant(ligne))
}

export function toListeAssistants(lignes: readonly AssistantVue[]): ListeAssistantsDto {
  return schemaListeAssistantsDto.parse({ elements: lignes.map((ligne) => assistant(ligne)) })
}

/** Action sans résultat propre (suspendre, réactiver, dépublier, republier, supprimer, retirer). */
export function toActionEffectuee(rejoue = false): ActionAdminReponse {
  return schemaActionAdminReponse.parse({ effectue: true, rejoue })
}

export function toOffrirJours(resultat: ResultatOffreJours): OffrirJoursReponse {
  return schemaOffrirJoursReponse.parse({ expireLe: enIso(resultat.expireLe), rejoue: resultat.rejoue })
}

export function toChangerPlan(resultat: ResultatChangementPlan): ChangerPlanReponse {
  return schemaChangerPlanReponse.parse({
    plan: resultat.plan,
    expireLe: enIsoOuNull(resultat.expireLe),
    rejoue: resultat.rejoue,
  })
}

export function toRevocation(revoques: number): RevocationReponse {
  return schemaRevocationReponse.parse({ revoques })
}
