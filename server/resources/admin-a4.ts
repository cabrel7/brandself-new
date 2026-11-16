// A4 : sortie de l'API de supervision et des réglages. Chaque réponse est construite CHAMP PAR CHAMP (jamais de spread
// d'une ligne de base ni d'un objet ORM) puis validée par un schéma strict (shared/schemas/admin-a4.ts) : une clé en
// trop fait échouer la réponse. Aucune donnée de visiteur, aucune adresse IP, aucune valeur de secret, aucun `job.data`.
import {
  schemaAgregatsAssistantsDto,
  schemaAgregatsIaDto,
  schemaAgregatsPwaDto,
  schemaCapaciteReponse,
  schemaEnvoisDto,
  schemaEtatFilesDto,
  schemaEtatPublicDto,
  schemaJournalVerificationDto,
  schemaListeJournalDto,
  schemaListeReglagesDto,
  schemaModifierReglageReponse,
  schemaPurgeFilesReponse,
  schemaSanteDto,
} from '../../shared/schemas/admin-a4'
import type {
  AgregatsAssistantsDto,
  AgregatsIaDto,
  AgregatsPwaDto,
  CapaciteReponse,
  EnvoisDto,
  EtatFilesDto,
  EtatPublicDto,
  JournalVerificationDto,
  ListeJournalDto,
  ListeReglagesDto,
  ModifierReglageReponse,
  PurgeFilesReponse,
  SanteDto,
} from '../../shared/schemas/admin-a4'
import type { ReglageDefinition } from '../../shared/reglages'
import type { AgregatsAssistantsVue } from '../services/admin/agregats-assistants'
import type { AgregatsIaVue } from '../services/admin/agregats-ia'
import type { AgregatsPwaVue } from '../services/admin/agregats-pwa'
import type { PageAdmin } from '../services/admin/a2-lignes'
import type { VerificationChaine } from '../services/admin/audit'
import type { ResultatCapacite } from '../services/admin/capacites'
import type { JournalEntreeVue } from '../services/admin/journal'
import type { ReglageVue, ResultatModifierReglage } from '../services/admin/reglages'
import type { SanteVue } from '../services/admin/sante'
import type { EtatFilesVue } from '../services/admin/supervision-files'
import type { AgregatEnvois } from '../services/envois-codes'

const enIso = (date: Date): string => date.toISOString()
const enIsoOuNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

function bornes(definition: ReglageDefinition) {
  return {
    min: definition.type === 'entier' ? definition.min : null,
    max: definition.type === 'entier' ? definition.max : null,
    longueurMax: definition.type === 'texte' ? definition.longueurMax : null,
  }
}

function reglage(vue: ReglageVue) {
  const { definition } = vue
  return {
    cle: definition.cle,
    type: definition.type,
    libelle: definition.libelle,
    aide: definition.aide,
    categorie: definition.categorie,
    reauth: definition.reauth,
    modifiable: definition.modifiable,
    securite: definition.securite,
    valeur: vue.valeur,
    defaut: vue.defaut,
    surcharge: vue.surcharge,
    ...bornes(definition),
    modifieLe: enIsoOuNull(vue.modifieLe),
    modifiePar: vue.modifiePar,
  }
}

export function toListeReglages(vues: readonly ReglageVue[]): ListeReglagesDto {
  return schemaListeReglagesDto.parse({ elements: vues.map(reglage) })
}

export function toModifierReglage(resultat: ResultatModifierReglage): ModifierReglageReponse {
  return schemaModifierReglageReponse.parse({ reglage: reglage(resultat.reglage), rejoue: resultat.rejoue })
}

export function toEtatPublic(etat: { maintenance: boolean, message: string | null, inscriptions: boolean }): EtatPublicDto {
  return schemaEtatPublicDto.parse({ maintenance: etat.maintenance, message: etat.maintenance ? etat.message : null, inscriptions: etat.inscriptions })
}

export function toEtatFiles(etat: EtatFilesVue): EtatFilesDto {
  return schemaEtatFilesDto.parse({
    files: etat.files.map((file) => ({
      file: file.file,
      compteurs: {
        attente: file.compteurs.attente,
        actifs: file.compteurs.actifs,
        differes: file.compteurs.differes,
        echoues: file.compteurs.echoues,
        termines: file.compteurs.termines,
      },
      echecs15Min: file.echecs15Min,
      relancable: file.relancable,
      echecs: file.echecs.map((echec) => ({
        id: echec.id,
        nom: echec.nom,
        echecLe: enIsoOuNull(echec.echecLe),
        tentatives: echec.tentatives,
        motif: echec.motif,
      })),
    })),
    seuilEchecs15Min: etat.seuilEchecs15Min,
    genereLe: enIso(etat.genereLe),
  })
}

export function toPurgeFiles(purges: number): PurgeFilesReponse {
  return schemaPurgeFilesReponse.parse({ purges })
}

export function toEnvois(jours: number, agregat: AgregatEnvois, genereLe: Date): EnvoisDto {
  return schemaEnvoisDto.parse({
    jours,
    total: { envoyes: agregat.total.envoyes, echecs: agregat.total.echecs },
    lignes: agregat.lignes.map((ligne) => ({ canal: ligne.canal, pays: ligne.pays, envoyes: ligne.envoyes, echecs: ligne.echecs })),
    erreurs: agregat.erreurs.map((erreur) => ({ codeErreur: erreur.codeErreur, nombre: erreur.nombre })),
    genereLe: enIso(genereLe),
  })
}

export function toAgregatsIa(vue: AgregatsIaVue): AgregatsIaDto {
  return schemaAgregatsIaDto.parse({
    jours: vue.jours,
    total: vue.total,
    parStatut: vue.parStatut.map((l) => ({ statut: l.statut, nombre: l.nombre })),
    parMotifRepli: vue.parMotifRepli.map((l) => ({ motif: l.motif, nombre: l.nombre })),
    parType: vue.parType.map((l) => ({ type: l.type, nombre: l.nombre })),
    parFournisseur: vue.parFournisseur.map((l) => ({ fournisseur: l.fournisseur, nombre: l.nombre })),
    tokensEntree: vue.tokensEntree,
    tokensSortie: vue.tokensSortie,
    dureeMoyenneMs: vue.dureeMoyenneMs,
    injectionsSuspectees: vue.injectionsSuspectees,
    quotaGratuitMois: vue.quotaGratuitMois,
    consommateurs: vue.consommateurs.map((l) => ({ utilisateurId: l.utilisateurId, nombre: l.nombre })),
    genereLe: enIso(vue.genereLe),
  })
}

export function toAgregatsPwa(vue: AgregatsPwaVue): AgregatsPwaDto {
  return schemaAgregatsPwaDto.parse({
    jours: vue.jours,
    total: vue.total,
    lignes: vue.lignes.map((l) => ({ type: l.type, origine: l.origine, deviceType: l.deviceType, nombre: l.nombre })),
    genereLe: enIso(vue.genereLe),
  })
}

export function toAgregatsAssistants(vue: AgregatsAssistantsVue): AgregatsAssistantsDto {
  return schemaAgregatsAssistantsDto.parse({
    jours: vue.jours,
    total: vue.total,
    comptesActifs: vue.comptesActifs,
    capacitesActives: vue.capacitesActives,
    parOutil: vue.parOutil.map((l) => ({ outil: l.outil, nombre: l.nombre })),
    parAssistant: vue.parAssistant.map((l) => ({ assistantId: l.assistantId, nombre: l.nombre })),
    genereLe: enIso(vue.genereLe),
  })
}

export function toSante(vue: SanteVue): SanteDto {
  return schemaSanteDto.parse({
    base: { etat: vue.base.etat, latenceMs: vue.base.latenceMs },
    redis: { etat: vue.redis.etat, latenceMs: vue.redis.latenceMs },
    disque: {
      etat: vue.disque.etat,
      libreOctets: vue.disque.libreOctets,
      totalOctets: vue.disque.totalOctets,
      libresPct: vue.disque.libresPct,
    },
    sauvegarde: {
      etat: vue.sauvegarde.etat,
      derniereReussiteLe: enIsoOuNull(vue.sauvegarde.derniereReussiteLe),
      ageHeures: vue.sauvegarde.ageHeures,
    },
    version: vue.version,
    genereLe: enIso(vue.genereLe),
  })
}

export function toCapacite(resultat: ResultatCapacite): CapaciteReponse {
  const c = resultat.capacite
  return schemaCapaciteReponse.parse({
    capacite: {
      id: c.id,
      utilisateurId: c.utilisateurId,
      capacite: c.capacite,
      motif: c.motif,
      accordePar: c.accordePar,
      accordeLe: enIso(c.accordeLe),
      revoqueLe: enIsoOuNull(c.revoqueLe),
    },
    rejoue: resultat.rejoue,
  })
}

export function toListeJournal(page: PageAdmin<JournalEntreeVue>): ListeJournalDto {
  return schemaListeJournalDto.parse({
    elements: page.elements.map((e) => ({
      id: e.id,
      numero: e.numero,
      adminId: e.adminId,
      action: e.action,
      cibleType: e.cibleType,
      cibleId: e.cibleId,
      motif: e.motif,
      avant: e.avant,
      apres: e.apres,
      creeLe: enIso(e.creeLe),
      empreinte: e.empreinte,
    })),
    total: page.total,
    page: page.page,
    limite: page.limite,
  })
}

export function toVerificationJournal(verification: VerificationChaine): JournalVerificationDto {
  return schemaJournalVerificationDto.parse({ intacte: verification.intacte, premiereRupture: verification.premiereRupture })
}
