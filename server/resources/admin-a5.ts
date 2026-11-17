// A5 : sortie de l'API d'administration des catalogues et des versions. Chaque réponse est construite CHAMP PAR CHAMP
// (jamais de spread d'une ligne ni d'un objet ORM) puis validée par un schéma strict (shared/schemas/admin-catalogues.ts
// et admin-versions.ts) : une clé en trop fait échouer la réponse au lieu de fuiter.
import {
  schemaDeviseReponse,
  schemaListeCatalogueDto,
  schemaNomBloqueReponse,
  schemaPaysReponse,
  schemaReferentielsDto,
} from '../../shared/schemas/admin-catalogues'
import type {
  DeviseReponse,
  ListeCatalogueDto,
  NomBloqueReponse,
  PaysReponse,
  ReferentielsDto,
} from '../../shared/schemas/admin-catalogues'
import {
  schemaEssaiPromptDto,
  schemaImpactPlanDto,
  schemaListeVersionsDto,
  schemaVersionReponse,
} from '../../shared/schemas/admin-versions'
import type { EssaiPromptDto, ImpactPlan, ImpactPlanDto, ListeVersionsDto, VersionReponse } from '../../shared/schemas/admin-versions'
import { VERSION_IMPACT_MENTION } from '../../shared/admin'
import type { AdminCatalogue } from '../../shared/admin'
import type {
  ContenuCatalogue,
  DeviseVue,
  NomBloqueVue,
  PaysVue,
  ReferentielsLus,
  ResultatCatalogue,
} from '../services/configuration/catalogues'
import type { PageVersions, ResultatVersion, VersionLue } from '../services/configuration/versions'

const enIso = (date: Date): string => date.toISOString()
const enIsoOuNull = (date: Date | null): string | null => (date === null ? null : date.toISOString())

function pays(ligne: PaysVue) {
  return {
    code: ligne.code,
    libelle: ligne.libelle,
    indicatif: ligne.indicatif,
    actif: ligne.actif,
    deviseDefaut: ligne.deviseDefaut,
    fuseaux: [...ligne.fuseaux],
    canalSms: ligne.canalSms,
    canalWhatsapp: ligne.canalWhatsapp,
    canalEmail: ligne.canalEmail,
    smsEffectif: ligne.smsEffectif,
    whatsappEffectif: ligne.whatsappEffectif,
    utilise: ligne.utilise,
    modifieLe: enIso(ligne.modifieLe),
  }
}

function devise(ligne: DeviseVue) {
  return { code: ligne.code, actif: ligne.actif, payable: ligne.payable, modifieLe: enIso(ligne.modifieLe) }
}

function nomBloque(ligne: NomBloqueVue) {
  return { valeur: ligne.valeur, motif: ligne.motif, creePar: ligne.creePar, creeLe: enIso(ligne.creeLe) }
}

export function toListeCatalogue(nom: AdminCatalogue, contenu: ContenuCatalogue): ListeCatalogueDto {
  const base = { total: contenu.total, page: contenu.page, limite: contenu.limite }
  if (nom === 'pays') return schemaListeCatalogueDto.parse({ nom, ...base, elements: (contenu.elements as PaysVue[]).map(pays) })
  if (nom === 'devises') return schemaListeCatalogueDto.parse({ nom, ...base, elements: (contenu.elements as DeviseVue[]).map(devise) })
  return schemaListeCatalogueDto.parse({ nom, ...base, elements: (contenu.elements as NomBloqueVue[]).map(nomBloque) })
}

export function toPaysReponse(resultat: ResultatCatalogue<PaysVue>): PaysReponse {
  return schemaPaysReponse.parse({ entree: pays(resultat.entree), rejoue: resultat.rejoue })
}

export function toDeviseReponse(resultat: ResultatCatalogue<DeviseVue>): DeviseReponse {
  return schemaDeviseReponse.parse({ entree: devise(resultat.entree), rejoue: resultat.rejoue })
}

export function toNomBloqueReponse(resultat: ResultatCatalogue<NomBloqueVue>): NomBloqueReponse {
  return schemaNomBloqueReponse.parse({ entree: nomBloque(resultat.entree), rejoue: resultat.rejoue })
}

export function toReferentiels(lus: ReferentielsLus): ReferentielsDto {
  return schemaReferentielsDto.parse({
    pays: lus.pays.map((p) => ({
      code: p.code,
      libelle: p.libelle,
      indicatif: p.indicatif,
      deviseDefaut: p.deviseDefaut,
      fuseaux: [...p.fuseaux],
      canaux: { sms: p.canaux.sms, whatsapp: p.canaux.whatsapp, email: p.canaux.email },
    })),
    devises: [...lus.devises],
  })
}

function version(ligne: VersionLue) {
  if (ligne.type === 'prompts') {
    return {
      type: ligne.type,
      id: ligne.id,
      cle: ligne.cle,
      numero: ligne.numero,
      statut: ligne.statut,
      motif: ligne.motif,
      creePar: ligne.creePar,
      creeLe: enIso(ligne.creeLe),
      valeurs: {
        systeme: ligne.valeurs.systeme,
        gabarit: ligne.valeurs.gabarit,
        variables: [...ligne.valeurs.variables],
        parametres: ligne.valeurs.parametres,
        schemaSortie: ligne.valeurs.schemaSortie,
      },
    }
  }
  return {
    type: ligne.type,
    id: ligne.id,
    cle: ligne.cle,
    numero: ligne.numero,
    statut: ligne.statut,
    effectiveA: enIsoOuNull(ligne.effectiveA),
    valideeLe: enIsoOuNull(ligne.valideeLe),
    motif: ligne.motif,
    creePar: ligne.creePar,
    creeLe: enIso(ligne.creeLe),
    valeurs: ligne.valeurs,
  }
}

export function toListeVersions(page: PageVersions): ListeVersionsDto {
  return schemaListeVersionsDto.parse({
    type: page.type,
    elements: page.elements.map(version),
    total: page.total,
    page: page.page,
    limite: page.limite,
  })
}

export function toVersionReponse(resultat: ResultatVersion): VersionReponse {
  return schemaVersionReponse.parse({ version: version(resultat.version), rejoue: resultat.rejoue })
}

export function toImpactPlan(impact: ImpactPlan, genereLe: Date = new Date()): ImpactPlanDto {
  return schemaImpactPlanDto.parse({
    impact: {
      services: { comptes: impact.services.comptes, elementsMasques: impact.services.elementsMasques },
      realisations: { comptes: impact.realisations.comptes, elementsMasques: impact.realisations.elementsMasques },
      temoignages: { comptes: impact.temoignages.comptes, elementsMasques: impact.temoignages.elementsMasques },
      reservationsMois: { comptes: impact.reservationsMois.comptes },
      generationsIaMois: { comptes: impact.generationsIaMois.comptes },
    },
    mention: VERSION_IMPACT_MENTION,
    genereLe: genereLe.toISOString(),
  })
}

export function toEssaiPrompt(essai: EssaiPromptDto): EssaiPromptDto {
  return schemaEssaiPromptDto.parse({
    valide: essai.valide,
    sortie: essai.sortie,
    erreurCode: essai.erreurCode,
    dureeMs: essai.dureeMs,
    essaisRestants: essai.essaisRestants,
  })
}
