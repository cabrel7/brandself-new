// A3 : sortie de l'API d'administration des abonnements, paiements, revenus et alertes. Chaque réponse est construite
// CHAMP PAR CHAMP (jamais de spread d'une ligne de base) puis validée par un schéma strict (shared/schemas/admin-paiements.ts) :
// une clé en trop fait échouer la réponse au lieu de fuiter. Aucun téléphone, aucun numéro de payeur, aucun contenu d'événement.
import { EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE } from '../../shared/admin-paiements'
import {
  schemaAlertesDto,
  schemaListeAbonnementsDto,
  schemaListePaiementsDto,
  schemaMarquagePaiementReponse,
  schemaPaiementDetailDto,
  schemaPaiementDto,
  schemaRappelAbonnementReponse,
  schemaRevenusDto,
  schemaVueEnsembleEnrichieDto,
} from '../../shared/schemas/admin-paiements'
import type {
  AlertesDto,
  ListeAbonnementsDto,
  ListePaiementsDto,
  MarquagePaiementReponse,
  PaiementDetailDto,
  PaiementDto,
  RappelAbonnementReponse,
  RevenusDto,
  VueEnsembleEnrichieDto,
} from '../../shared/schemas/admin-paiements'
import type { AbonnementAdmin, ListeAbonnementsAdmin } from '../services/admin/abonnements'
import type { AlertesAdmin } from '../services/admin/alertes'
import { construireCsv } from '../services/admin/export'
import type { ResultatExport } from '../services/admin/export'
import type { DetailPaiementAdmin, ListePaiementsAdmin, PaiementAdmin } from '../services/admin/paiements'
import type { AgregatRevenu, PeriodeRevenu, RevenusAdmin } from '../services/admin/revenus'
import type { VueEnsembleEnrichie } from '../services/admin/revenus-vue-ensemble'
import type { ResultatMarquage } from '../services/paiements/manuel'

const iso = (date: Date): string => date.toISOString()
const isoOuNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

function paiementBrut(p: PaiementAdmin): unknown {
  return {
    id: p.id,
    reference: p.referenceFournisseur ?? p.id,
    fournisseur: p.fournisseur,
    source: p.source,
    methode: p.methode,
    operateur: p.operateur,
    statut: p.statut,
    plan: p.plan,
    periodeMois: p.periodeMois,
    devise: p.devise,
    montant: p.montant,
    fraisReels: p.fraisReels,
    netReel: p.netReel,
    codeEchec: p.codeEchec,
    creeLe: iso(p.creeLe),
    appliqueLe: isoOuNull(p.appliqueLe),
    termineLe: isoOuNull(p.termineLe),
    utilisateur: p.utilisateur === null ? null : { id: p.utilisateur.id, email: p.utilisateur.email },
  }
}

export function toPaiement(p: PaiementAdmin): PaiementDto {
  return schemaPaiementDto.parse(paiementBrut(p))
}

export function toListePaiements(liste: ListePaiementsAdmin): ListePaiementsDto {
  return schemaListePaiementsDto.parse({
    elements: liste.elements.map(paiementBrut),
    total: liste.total,
    page: liste.page,
    limite: liste.limite,
  })
}

export function toPaiementDetail(detail: DetailPaiementAdmin): PaiementDetailDto {
  return schemaPaiementDetailDto.parse({
    paiement: paiementBrut(detail.paiement),
    evenements: detail.evenements.map((e) => ({
      evenement: e.evenement,
      source: e.source,
      traitement: e.traitement,
      motif: e.motif,
      recuLe: iso(e.recuLe),
    })),
    reverifieNonReussiLe: isoOuNull(detail.reverifieNonReussiLe),
  })
}

function abonnementBrut(a: AbonnementAdmin): unknown {
  return {
    id: a.id,
    utilisateur: { id: a.utilisateur.id, email: a.utilisateur.email },
    plan: a.plan,
    devise: a.devise,
    expireLe: iso(a.expireLe),
    etat: a.etat,
    origine: a.origine,
    dernierPaiement: a.dernierPaiement === null
      ? null
      : {
          id: a.dernierPaiement.id,
          statut: a.dernierPaiement.statut,
          montant: a.dernierPaiement.montant,
          devise: a.dernierPaiement.devise,
          creeLe: iso(a.dernierPaiement.creeLe),
        },
  }
}

export function toListeAbonnements(liste: ListeAbonnementsAdmin): ListeAbonnementsDto {
  return schemaListeAbonnementsDto.parse({
    onglet: liste.onglet,
    elements: liste.elements.map(abonnementBrut),
    total: liste.total,
    page: liste.page,
    limite: liste.limite,
  })
}

const agregatBrut = (a: AgregatRevenu): unknown => ({
  brut: a.brut,
  nombre: a.nombre,
  fraisReels: a.fraisReels,
  nombreSansFrais: a.nombreSansFrais,
})

const periodeBrute = (p: PeriodeRevenu): unknown => ({
  debut: iso(p.debut),
  fin: iso(p.fin),
  kpay: agregatBrut(p.kpay),
  manuel: agregatBrut(p.manuel),
})

export function toRevenus(revenus: RevenusAdmin): RevenusDto {
  return schemaRevenusDto.parse({
    devises: revenus.devises.map((carte) => ({
      devise: carte.devise,
      mois: { courant: periodeBrute(carte.mois.courant), precedent: periodeBrute(carte.mois.precedent) },
      abonnesActifs: carte.abonnesActifs,
      repartition: carte.repartition.map((r) => ({ periodeMois: r.periodeMois, nombre: r.nombre, brut: r.brut })),
    })),
    offerts: { jours: revenus.offerts.jours, nombre: revenus.offerts.nombre },
    mention: revenus.mention,
    genereLe: iso(revenus.genereLe),
  })
}

const alertesBrutes = (a: AlertesAdmin): unknown => ({
  paiementsEnAttente: { nombre: a.paiementsEnAttente.nombre, ids: [...a.paiementsEnAttente.ids] },
  webhooksRefuses1h: a.webhooksRefuses1h,
  incoherences: {
    paiementsSansProlongation: [...a.incoherences.paiementsSansProlongation],
    abonnementsSansPaiement: [...a.incoherences.abonnementsSansPaiement],
  },
  encaissementsTardifs: a.encaissementsTardifs,
  genereLe: iso(a.genereLe),
})

export function toAlertes(alertes: AlertesAdmin): AlertesDto {
  return schemaAlertesDto.parse(alertesBrutes(alertes))
}

export function toVueEnsembleEnrichie(vue: VueEnsembleEnrichie): VueEnsembleEnrichieDto {
  return schemaVueEnsembleEnrichieDto.parse({
    admin: { nom: vue.adminNom },
    compteurs: {
      inscrits: vue.compteurs.inscrits,
      vitrinesPubliees: vue.compteurs.vitrinesPubliees,
      abonnesPayants: vue.compteurs.abonnesPayants,
    },
    revenus: vue.revenus.map((r) => ({ devise: r.devise, encaisseMoisCourant: r.encaisseMoisCourant, nombre: r.nombre })),
    indicateurReussite: {
      vitrinesActives: vue.indicateurReussite.vitrinesActives,
      vitrinesPubliees: vue.indicateurReussite.vitrinesPubliees,
    },
    mention: vue.mention,
    alertes: alertesBrutes(vue.alertes),
    essais: {
      jours: vue.essais.jours,
      accordes: vue.essais.accordes,
      enCours: vue.essais.enCours,
      convertis: vue.essais.convertis,
      tauxPct: vue.essais.tauxPct,
    },
    genereLe: iso(vue.genereLe),
  })
}

export function toMarquage(resultat: ResultatMarquage): MarquagePaiementReponse {
  return schemaMarquagePaiementReponse.parse({
    paiementId: resultat.paiementId,
    expireLe: iso(resultat.expireLe),
    rejoue: resultat.rejoue,
  })
}

export function toRappelReponse(): RappelAbonnementReponse {
  return schemaRappelAbonnementReponse.parse({ planifie: true })
}

export interface FichierExport {
  contenu: string
  nomFichier: string
}

/** Fichier CSV : colonnes de `EXPORT_PAIEMENTS_COLONNES`, cellules neutralisées. Le nom ne porte que la date du jour (UTC). */
export function toFichierExport(resultat: ResultatExport, maintenant: Date = new Date()): FichierExport {
  return {
    contenu: construireCsv(resultat.lignes),
    nomFichier: `${EXPORT_PAIEMENTS_NOM_FICHIER_PREFIXE}${maintenant.toISOString().slice(0, 10)}.csv`,
  }
}
