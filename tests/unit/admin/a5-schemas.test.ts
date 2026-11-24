import { describe, expect, it } from 'vitest'
import { FRAIS_PAIEMENT, MOYENS_PAIEMENT } from '../../../server/config/paiements'
import { PLANS, PRIX_PLANS } from '../../../server/config/plans'
import { ERROR_MESSAGES } from '../../../server/exceptions/http'
import { libelleAction, LIBELLE_ACTION_REPLI } from '../../../server/services/emails/admin-reauth-contenu'
import {
  ADMIN_ACTION_FORMAT,
  ADMIN_ACTIONS,
  ADMIN_CATALOGUES,
  ADMIN_CIBLE_TYPE_FORMAT,
  ADMIN_CIBLES,
  ADMIN_NAV,
  ADMIN_VERSION_TYPES,
  VERSION_CATEGORIE_PAR_TYPE,
  VERSION_CATEGORIES,
  VERSION_STATUTS,
} from '../../../shared/admin'
import { DEVISES } from '../../../shared/compte'
import { ERROR_CODES, ERROR_STATUS } from '../../../shared/erreurs'
import { isValidTimeZone, listerFuseaux } from '../../../shared/fuseau'
import { IA_ESSAI_PROMPT_LIMIT, PROMPT_GABARIT_LONGUEUR_MAX, PROMPT_SYSTEME_LONGUEUR_MAX } from '../../../shared/ia'
import { VERSIONS_APPLIQUER_INTERVALLE_MS } from '../../../shared/jobs'
import { PRIX_MAX_MINOR } from '../../../shared/devises'
import { PERIODES_MOIS } from '../../../shared/plans'
import { PAYS } from '../../../shared/vitrine'
import * as abonnement from '../../../shared/schemas/abonnement'
import * as catalogues from '../../../shared/schemas/admin-catalogues'
import * as versions from '../../../shared/schemas/admin-versions'

const MOTIF = 'Ajustement décidé après revue'
const INSTANT = '2026-11-16T10:00:00.000Z'

/** Valeurs seedées par la migration 0032 (spec A5 §4) : la version 1 doit rester acceptée par les schémas stricts. */
const SEED_PLAN_GRATUIT = {
  services: 3, realisations: 3, temoignages: 3, reservationsParMois: 10, generationsIaParMois: 3,
  badge: true, statistiquesJours: 7, statistiquesDetails: false, capacites: { mcp: false },
}
const SEED_PLAN_PAYANT = {
  services: null, realisations: null, temoignages: null, reservationsParMois: null, generationsIaParMois: null,
  badge: false, statistiquesJours: 90, statistiquesDetails: true, capacites: { mcp: true },
}
const SEED_PRIX = {
  XAF: { 1: 5000, 3: 13500, 12: 48000 },
  EUR: { 1: 800, 3: 2200, 12: 7700 },
  USD: { 1: 900, 3: 2500, 12: 8600 },
}

const PAYS_DTO = {
  code: 'CM',
  libelle: 'Cameroun',
  indicatif: '237',
  actif: true,
  deviseDefaut: 'XAF',
  fuseaux: ['Africa/Douala'],
  canalSms: true,
  canalWhatsapp: false,
  canalEmail: true,
  smsEffectif: false,
  whatsappEffectif: false,
  utilise: true,
  modifieLe: INSTANT,
}

const VERSION_PLAN_DTO = {
  type: 'plans',
  id: 'a5000000-plan-gratuit-1',
  cle: 'gratuit',
  numero: 1,
  statut: 'active',
  effectiveA: '2000-01-01T00:00:00.000Z',
  valideeLe: null,
  motif: 'Valeurs initiales reprises du code (0032)',
  creePar: 'systeme',
  creeLe: INSTANT,
  valeurs: SEED_PLAN_GRATUIT,
}

describe('actions, cibles et navigation de l’A5', () => {
  it.each([
    ['catalogueCreer', 'catalogue.creer'],
    ['catalogueModifier', 'catalogue.modifier'],
    ['catalogueSupprimer', 'catalogue.supprimer'],
    ['versionCreer', 'version.creer'],
    ['versionProgrammer', 'version.programmer'],
    ['versionActiver', 'version.activer'],
    ['versionRetour', 'version.retour'],
    ['versionValiderPrix', 'version.valider_prix'],
    ['promptEssai', 'prompt.essai'],
  ] as const)('should declare %s as %s, in the journal format, with a readable e-mail label', (cle, action) => {
    expect(ADMIN_ACTIONS[cle]).toBe(action)
    expect(action).toMatch(ADMIN_ACTION_FORMAT)
    expect(libelleAction(action)).not.toBe(LIBELLE_ACTION_REPLI)
  })

  it('should keep every action unique across A1 to A5', () => {
    const actions = Object.values(ADMIN_ACTIONS)
    expect(new Set(actions).size).toBe(actions.length)
  })

  it('should declare the target types of A5 in the journal format', () => {
    for (const cible of [ADMIN_CIBLES.catalogue, ADMIN_CIBLES.version]) expect(cible).toMatch(ADMIN_CIBLE_TYPE_FORMAT)
  })

  it('should add « Catalogues » and « Versions » to the sidebar, before the journal, with Phosphor icons and sober vocabulary', () => {
    const ids = ADMIN_NAV.map((entree) => entree.id)
    expect(ids).toEqual(['vue-ensemble', 'utilisateurs', 'vitrines', 'abonnements', 'systemes', 'reglages', 'catalogues', 'versions', 'journal'])
    expect(ADMIN_NAV.find((entree) => entree.id === 'catalogues')).toMatchObject({ libelle: 'Catalogues', to: '/admin/catalogues' })
    expect(ADMIN_NAV.find((entree) => entree.id === 'versions')).toMatchObject({ libelle: 'Versions', to: '/admin/versions' })
    for (const entree of ADMIN_NAV) expect(entree.icone, entree.id).toMatch(/^i-ph-[a-z-]+$/)
    expect(new Set(ADMIN_NAV.map((entree) => entree.to)).size).toBe(ADMIN_NAV.length)
  })

  it('should name the catalogues and the version types of the routes', () => {
    expect([...ADMIN_CATALOGUES]).toEqual(['pays', 'devises', 'noms-bloques'])
    expect([...ADMIN_VERSION_TYPES]).toEqual(['plans', 'prix', 'frais', 'moyens', 'essai', 'prompts'])
    expect([...VERSION_CATEGORIES]).toEqual(['plan', 'prix', 'frais', 'moyens', 'essai'])
    expect([...VERSION_STATUTS]).toEqual(['brouillon', 'programmee', 'active', 'remplacee'])
    expect(VERSION_CATEGORIE_PAR_TYPE).toEqual({ plans: 'plan', prix: 'prix', frais: 'frais', moyens: 'moyens', essai: 'essai' })
  })

  it('should apply the scheduled versions every 60 seconds and cap the prompt trial at 10 per hour', () => {
    expect(VERSIONS_APPLIQUER_INTERVALLE_MS).toBe(60_000)
    expect(IA_ESSAI_PROMPT_LIMIT).toEqual({ limit: 10, windowS: 3600 })
  })
})

describe('erreurs de l’A5', () => {
  it.each([
    ['CATALOGUE_ENTREE_UTILISEE', 409],
    ['PRIX_CHANGE', 409],
    ['IMPACT_CHANGE', 409],
    ['CANAL_INDISPONIBLE', 422],
    ['VERSION_NON_ACTIVABLE', 422],
    ['VARIABLE_INCONNUE', 422],
    ['ESSAI_LIMITE', 429],
    ['NOM_BLOQUE', 422],
    ['FUSEAU_INCONNU', 422],
  ] as const)('should declare %s with status %i and a French message', (code, statut) => {
    expect(ERROR_CODES).toContain(code)
    expect(ERROR_STATUS[code]).toBe(statut)
    expect(ERROR_MESSAGES[code].trim().length).toBeGreaterThan(10)
  })

  it('should not tell whether an address is reserved or blocked, nor repeat a value', () => {
    expect(ERROR_MESSAGES.NOM_BLOQUE).not.toMatch(/réservé|bloqué|interdit/i)
  })

  it('should use the user-facing vocabulary only (no « espace », « bloc », « module », « widget », « section »)', () => {
    for (const code of ['CATALOGUE_ENTREE_UTILISEE', 'PRIX_CHANGE', 'IMPACT_CHANGE', 'CANAL_INDISPONIBLE', 'NOM_BLOQUE'] as const) {
      expect(ERROR_MESSAGES[code], code).not.toMatch(/\b(espace|bloc|module|widget|section)\b/i)
    }
  })
})

describe('fuseaux (D-A5-12)', () => {
  it('should list the IANA zones of the engine, without duplicate, and every one is valid', () => {
    const fuseaux = listerFuseaux()
    expect(fuseaux.length).toBeGreaterThan(300)
    expect(new Set(fuseaux).size).toBe(fuseaux.length)
    expect(fuseaux.every((fuseau) => isValidTimeZone(fuseau))).toBe(true)
  })

  it('should know every zone proposed by the spec seed for the 30 countries', () => {
    const graine = [
      'Africa/Douala', 'Africa/Dakar', 'Africa/Abidjan', 'Africa/Libreville', 'Africa/Brazzaville', 'Africa/Kinshasa',
      'Africa/Lubumbashi', 'Africa/Porto-Novo', 'Africa/Lome', 'Africa/Ouagadougou', 'Africa/Bamako', 'Africa/Niamey',
      'Africa/Ndjamena', 'Africa/Bangui', 'Africa/Conakry', 'Indian/Antananarivo', 'Africa/Kigali', 'Africa/Bujumbura',
      'Africa/Djibouti', 'Indian/Comoro', 'Europe/Paris', 'Europe/Brussels', 'Europe/Zurich', 'America/Toronto',
      'Europe/Luxembourg', 'Africa/Casablanca', 'Africa/Tunis', 'Africa/Algiers', 'America/New_York', 'Europe/London', 'Europe/Berlin',
    ]
    const connus = new Set(listerFuseaux())
    for (const fuseau of graine) expect(connus.has(fuseau), fuseau).toBe(true)
    expect(PAYS).toHaveLength(30)
  })

  it('should keep `UTC` valid for the engine although it is not in the list (existing values stay valid)', () => {
    expect(isValidTimeZone('UTC')).toBe(true)
    expect(listerFuseaux()).not.toContain('UTC')
  })

  it('should accept a known zone and refuse a malformed or unknown one in the country schemas', () => {
    expect(catalogues.schemaFuseau.safeParse('Africa/Douala').success).toBe(true)
    expect(catalogues.schemaFuseau.safeParse('America/Argentina/Buenos_Aires').success).toBe(true)
    for (const mauvais of ['', 'Douala', 'Africa/Atlantide', '../etc/passwd', 'Africa//Douala', 'Africa/Douala; DROP', 'Africa\\Douala', 'a'.repeat(65)]) {
      expect(catalogues.schemaFuseau.safeParse(mauvais).success, mauvais).toBe(false)
    }
  })
})

describe('catalogues : entrées', () => {
  it('should accept the three catalogue names and refuse any other', () => {
    for (const nom of ADMIN_CATALOGUES) expect(catalogues.schemaCatalogueNomParam.safeParse({ nom }).success, nom).toBe(true)
    expect(catalogues.schemaCatalogueNomParam.safeParse({ nom: 'plans' }).success).toBe(false)
    expect(catalogues.schemaCatalogueEntreeParam.safeParse({ nom: 'pays', id: 'TD' }).success).toBe(true)
    expect(catalogues.schemaCatalogueEntreeParam.safeParse({ nom: 'pays', id: '' }).success).toBe(false)
    expect(catalogues.schemaCatalogueEntreeParam.safeParse({ nom: 'pays', id: 'x'.repeat(65) }).success).toBe(false)
  })

  it('should paginate a catalogue with page and limit like A2 and A3', () => {
    expect(catalogues.schemaListeCatalogueQuery.parse({})).toEqual({ page: 1, limite: 25 })
    expect(catalogues.schemaListeCatalogueQuery.safeParse({ limite: '101' }).success).toBe(false)
    expect(catalogues.schemaListeCatalogueQuery.safeParse({ q: 'x' }).success).toBe(false)
  })

  it('should accept a partial country update with a motive, and refuse an empty one', () => {
    expect(catalogues.schemaModifierPays.safeParse({ actif: false, motif: MOTIF }).success).toBe(true)
    expect(catalogues.schemaModifierPays.safeParse({ canalSms: false, motif: MOTIF }).success).toBe(true)
    expect(catalogues.schemaModifierPays.safeParse({ fuseaux: ['Africa/Douala'], deviseDefaut: 'EUR', motif: MOTIF }).success).toBe(true)
    expect(catalogues.schemaModifierPays.safeParse({ motif: MOTIF }).success).toBe(false)
    expect(catalogues.schemaModifierPays.safeParse({ actif: false }).success).toBe(false)
  })

  it.each([
    ['devise inconnue', { deviseDefaut: 'XOF' }],
    ['indicatif commençant par 0', { indicatif: '0237' }],
    ['indicatif avec plus', { indicatif: '+237' }],
    ['indicatif de 5 chiffres', { indicatif: '23712' }],
    ['libellé d’un caractère', { libelle: 'C' }],
    ['libellé de 81 caractères', { libelle: 'a'.repeat(81) }],
    ['aucun fuseau', { fuseaux: [] }],
    ['fuseau en double', { fuseaux: ['Africa/Douala', 'Africa/Douala'] }],
    ['onze fuseaux', { fuseaux: Array.from({ length: 11 }, (_, i) => `Etc/GMT+${i}`) }],
    ['code de pays modifié', { code: 'XX' }],
    ['interrupteur non booléen', { actif: 'oui' }],
  ])('should refuse a country update with %s', (_nom, corps) => {
    expect(catalogues.schemaModifierPays.safeParse({ ...corps, motif: MOTIF }).success).toBe(false)
  })

  it('should only let the `actif` flag of a currency change (D-A5-10, D-A5-11)', () => {
    expect(catalogues.schemaModifierDevise.safeParse({ actif: false, motif: MOTIF }).success).toBe(true)
    expect(catalogues.schemaModifierDevise.safeParse({ actif: false }).success).toBe(false)
    expect(catalogues.schemaModifierDevise.safeParse({ actif: false, motif: MOTIF, code: 'XOF' }).success).toBe(false)
    expect(catalogues.schemaModifierDevise.safeParse({ motif: MOTIF }).success).toBe(false)
  })

  it('should create a blocked name in lowercase, with a motive of 5 to 200 characters', () => {
    expect(catalogues.schemaCreerNomBloque.parse({ valeur: '  Marque-X ', motif: MOTIF })).toEqual({ valeur: 'marque-x', motif: MOTIF })
    expect(catalogues.schemaCreerNomBloque.safeParse({ valeur: 'ab', motif: MOTIF }).success).toBe(true)
    for (const valeur of ['a', '-abc', 'a b', 'a/b', 'a.b', 'é', 'x'.repeat(41), '']) {
      expect(catalogues.schemaCreerNomBloque.safeParse({ valeur, motif: MOTIF }).success, valeur).toBe(false)
    }
    expect(catalogues.schemaCreerNomBloque.safeParse({ valeur: 'marque', motif: 'abc' }).success).toBe(false)
    expect(catalogues.schemaCreerNomBloque.safeParse({ valeur: 'marque', motif: 'a'.repeat(201) }).success).toBe(false)
    expect(catalogues.schemaCreerNomBloque.safeParse({ valeur: 'marque', motif: 'a'.repeat(200) }).success).toBe(true)
    expect(catalogues.schemaCreerNomBloque.safeParse({ valeur: 'marque' }).success).toBe(false)
  })
})

describe('catalogues : sorties', () => {
  it('should accept a country with its effective channels and the « used » flag', () => {
    expect(catalogues.schemaPaysDto.safeParse(PAYS_DTO).success).toBe(true)
    expect(catalogues.schemaPaysDto.safeParse({ ...PAYS_DTO, utilise: undefined }).success).toBe(false)
    expect(catalogues.schemaPaysDto.safeParse({ ...PAYS_DTO, adminId: 'admin-1' }).success).toBe(false)
    expect(catalogues.schemaPaysDto.safeParse({ ...PAYS_DTO, deviseDefaut: 'XOF' }).success).toBe(false)
  })

  it('should tell « payable » from « active » for a currency (D-A5-11)', () => {
    expect(catalogues.schemaDeviseDto.safeParse({ code: 'EUR', actif: true, payable: false, modifieLe: INSTANT }).success).toBe(true)
    expect(catalogues.schemaDeviseDto.safeParse({ code: 'EUR', actif: true, modifieLe: INSTANT }).success).toBe(false)
    expect(catalogues.schemaDeviseDto.safeParse({ code: 'XOF', actif: true, payable: false, modifieLe: INSTANT }).success).toBe(false)
  })

  it('should list a catalogue under its own name, with the matching entries only', () => {
    const page = { total: 1, page: 1, limite: 25 }
    expect(catalogues.schemaListeCatalogueDto.safeParse({ nom: 'pays', elements: [PAYS_DTO], ...page }).success).toBe(true)
    expect(catalogues.schemaListeCatalogueDto.safeParse({ nom: 'devises', elements: [PAYS_DTO], ...page }).success).toBe(false)
    expect(catalogues.schemaListeCatalogueDto.safeParse({
      nom: 'noms-bloques',
      elements: [{ valeur: 'marque', motif: MOTIF, creePar: 'admin-1', creeLe: INSTANT }],
      ...page,
    }).success).toBe(true)
    expect(catalogues.schemaListeCatalogueDto.safeParse({ nom: 'plans', elements: [], ...page }).success).toBe(false)
    expect(catalogues.schemaListeCatalogueDto.safeParse({ nom: 'pays', elements: Array.from({ length: 101 }, () => PAYS_DTO), total: 101, page: 1, limite: 100 }).success).toBe(false)
  })

  it('should return the written entry with the replay flag', () => {
    expect(catalogues.schemaPaysReponse.safeParse({ entree: PAYS_DTO, rejoue: false }).success).toBe(true)
    expect(catalogues.schemaPaysReponse.safeParse({ entree: PAYS_DTO }).success).toBe(false)
    expect(catalogues.schemaDeviseReponse.safeParse({ entree: { code: 'USD', actif: false, payable: false, modifieLe: INSTANT }, rejoue: true }).success).toBe(true)
    expect(catalogues.schemaNomBloqueReponse.safeParse({ entree: { valeur: 'marque', motif: MOTIF, creePar: 'admin-1', creeLe: INSTANT }, rejoue: false }).success).toBe(true)
  })

  it('should expose to the public only what the sign-in and onboarding pages need (D-A5-15)', () => {
    const pays = { code: 'CM', libelle: 'Cameroun', indicatif: '237', deviseDefaut: 'XAF', fuseaux: ['Africa/Douala'], canaux: { sms: false, whatsapp: false, email: true } }
    expect(catalogues.schemaReferentielsDto.safeParse({ pays: [pays], devises: ['XAF', 'EUR'] }).success).toBe(true)
    for (const intrus of ['actif', 'utilise', 'modifieLe', 'canalSms', 'creePar', 'motif']) {
      expect(catalogues.schemaReferentielsDto.safeParse({ pays: [{ ...pays, [intrus]: true }], devises: [] }).success, intrus).toBe(false)
    }
    expect(catalogues.schemaReferentielsDto.safeParse({ pays: [], devises: ['XOF'] }).success).toBe(false)
    expect(catalogues.schemaReferentielsDto.safeParse({ pays: [], devises: [], admin: {} }).success).toBe(false)
  })
})

describe('versions : valeurs d’un plan (D-A5-05)', () => {
  it('should accept the seeded version 1 of both plans', () => {
    expect(versions.schemaValeursPlan.safeParse(SEED_PLAN_GRATUIT).success).toBe(true)
    expect(versions.schemaValeursPlan.safeParse(SEED_PLAN_PAYANT).success).toBe(true)
  })

  it('should accept exactly the values the code holds today, plus the capabilities (the fallback equals version 1)', () => {
    for (const [plan, capaciteMcp] of [['gratuit', false], ['payant', true]] as const) {
      expect(versions.schemaValeursPlan.safeParse({ ...PLANS[plan], capacites: { mcp: capaciteMcp } }).success, plan).toBe(true)
    }
  })

  it('should bound a limit from 0 to 10 000, or null for unlimited', () => {
    const avec = (limite: unknown) => versions.schemaValeursPlan.safeParse({ ...SEED_PLAN_PAYANT, services: limite }).success
    expect(avec(0)).toBe(true)
    expect(avec(10_000)).toBe(true)
    expect(avec(null)).toBe(true)
    expect(avec(-1)).toBe(false)
    expect(avec(10_001)).toBe(false)
    expect(avec(1.5)).toBe(false)
    expect(avec('3')).toBe(false)
    expect(avec(undefined)).toBe(false)
  })

  it('should refuse an unknown key, a missing key and a capability other than mcp', () => {
    expect(versions.schemaValeursPlan.safeParse({ ...SEED_PLAN_GRATUIT, couleur: 'rouge' }).success).toBe(false)
    expect(versions.schemaValeursPlan.safeParse({ ...SEED_PLAN_GRATUIT, capacites: { mcp: false, admin: true } }).success).toBe(false)
    const { badge: _badge, ...sansBadge } = SEED_PLAN_GRATUIT
    expect(versions.schemaValeursPlan.safeParse(sansBadge).success).toBe(false)
    expect(versions.schemaValeursPlan.safeParse({ ...SEED_PLAN_GRATUIT, statistiquesJours: 0 }).success).toBe(false)
    expect(versions.schemaValeursPlan.safeParse({ ...SEED_PLAN_GRATUIT, statistiquesJours: 181 }).success).toBe(false)
  })

  it('should never let the free plan be unlimited, whatever the field (a draft or an impact preview)', () => {
    for (const cle of versions.VERSION_PLAN_LIMITES_CLES) {
      const corps = { cle: 'gratuit', valeurs: { ...SEED_PLAN_GRATUIT, [cle]: null }, motif: MOTIF }
      expect(versions.schemaCreerVersionPlan.safeParse(corps).success, cle).toBe(false)
      expect(versions.schemaImpactPlanRequete.safeParse({ cle: corps.cle, valeurs: corps.valeurs }).success, cle).toBe(false)
    }
    const payantIllimite = { cle: 'payant', valeurs: SEED_PLAN_PAYANT, motif: MOTIF }
    expect(versions.schemaCreerVersionPlan.safeParse(payantIllimite).success).toBe(true)
    expect(versions.schemaCreerVersionPlan.safeParse({ cle: 'gratuit', valeurs: SEED_PLAN_GRATUIT, motif: MOTIF }).success).toBe(true)
  })

  it('should not create a plan: the key is one of the existing plans', () => {
    expect(versions.schemaCreerVersionPlan.safeParse({ cle: 'premium', valeurs: SEED_PLAN_PAYANT, motif: MOTIF }).success).toBe(false)
    expect(versions.schemaCreerVersionPlan.safeParse({ cle: 'payant', valeurs: SEED_PLAN_PAYANT }).success).toBe(false)
  })
})

describe('versions : prix, frais, moyens', () => {
  it('should accept the seeded price grid and the one the code holds (3 currencies x 3 periods)', () => {
    expect(versions.schemaValeursPrix.safeParse(SEED_PRIX).success).toBe(true)
    expect(versions.schemaValeursPrix.safeParse(PRIX_PLANS.payant).success).toBe(true)
    expect(DEVISES.every((devise) => devise in SEED_PRIX)).toBe(true)
    expect(PERIODES_MOIS.every((periode) => periode in SEED_PRIX.XAF)).toBe(true)
  })

  it('should require the COMPLETE grid with whole positive amounts (never a float, never zero)', () => {
    const { USD: _usd, ...sansUsd } = SEED_PRIX
    expect(versions.schemaValeursPrix.safeParse(sansUsd).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XOF: SEED_PRIX.XAF }).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XAF: { 1: 5000, 3: 13500 } }).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XAF: { ...SEED_PRIX.XAF, 6: 25000 } }).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XAF: { ...SEED_PRIX.XAF, 1: 0 } }).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XAF: { ...SEED_PRIX.XAF, 1: 49.5 } }).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XAF: { ...SEED_PRIX.XAF, 1: PRIX_MAX_MINOR + 1 } }).success).toBe(false)
    expect(versions.schemaValeursPrix.safeParse({ ...SEED_PRIX, XAF: { ...SEED_PRIX.XAF, 1: '5000' } }).success).toBe(false)
  })

  it('should create a price draft only for the sold plan', () => {
    expect(versions.schemaCreerVersionPrix.safeParse({ cle: 'payant', valeurs: SEED_PRIX, motif: MOTIF }).success).toBe(true)
    expect(versions.schemaCreerVersionPrix.safeParse({ cle: 'gratuit', valeurs: SEED_PRIX, motif: MOTIF }).success).toBe(false)
  })

  it('should accept the seeded fees and the ones the code holds, and bound the rate to 50 %', () => {
    const frais = { tauxPointsBase: 500, supporteur: 'marchand' }
    expect(versions.schemaValeursFrais.safeParse(frais).success).toBe(true)
    expect(versions.schemaValeursFrais.safeParse(FRAIS_PAIEMENT.kpay?.mobile_money).success).toBe(true)
    expect(versions.schemaValeursFrais.safeParse({ ...frais, tauxPointsBase: 5000 }).success).toBe(true)
    expect(versions.schemaValeursFrais.safeParse({ ...frais, tauxPointsBase: 5001 }).success).toBe(false)
    expect(versions.schemaValeursFrais.safeParse({ ...frais, tauxPointsBase: -1 }).success).toBe(false)
    expect(versions.schemaValeursFrais.safeParse({ ...frais, tauxPointsBase: 2.5 }).success).toBe(false)
    expect(versions.schemaValeursFrais.safeParse({ ...frais, supporteur: 'etat' }).success).toBe(false)
    expect(versions.schemaCreerVersionFrais.safeParse({ cle: 'kpay:mobile_money', valeurs: frais, motif: MOTIF }).success).toBe(true)
    expect(versions.schemaCreerVersionFrais.safeParse({ cle: 'kpay', valeurs: frais, motif: MOTIF }).success).toBe(false)
  })

  it('should accept the seeded active methods and the ones the code holds, without duplicate', () => {
    const actifs = MOYENS_PAIEMENT.filter((moyen) => moyen.actif).map((moyen) => moyen.id)
    expect([...actifs].sort()).toEqual([
      'kpay:MTN_MOMO_CMR', 'kpay:ORANGE_CMR',
      'mercypay:AIRTEL_COG', 'mercypay:AIRTEL_GAB', 'mercypay:MOOV_GAB', 'mercypay:MTN_MOMO_CMR', 'mercypay:MTN_MOMO_COG', 'mercypay:ORANGE_CMR',
    ])
    expect(versions.schemaValeursMoyens.safeParse({ actifs }).success).toBe(true)
    expect(versions.schemaValeursMoyens.safeParse({ actifs: [] }).success).toBe(true)
    expect(versions.schemaValeursMoyens.safeParse({ actifs: ['kpay:ORANGE_CMR', 'kpay:ORANGE_CMR'] }).success).toBe(false)
    expect(versions.schemaValeursMoyens.safeParse({ actifs: ['orange'] }).success).toBe(false)
    expect(versions.schemaValeursMoyens.safeParse({ actifs: Array.from({ length: 51 }, (_, i) => `kpay:OP_${String(i).padStart(2, '0')}`) }).success).toBe(false)
    expect(versions.schemaValeursMoyens.safeParse({ actifs, libelle: 'x' }).success).toBe(false)
    expect(versions.schemaCreerVersionMoyens.safeParse({ cle: 'kpay', valeurs: { actifs }, motif: MOTIF }).success).toBe(true)
  })
})

describe('versions : prompts (D-A5-09)', () => {
  const valeurs = { systeme: 'Tu rédiges une vitrine.', gabarit: 'Données : {{donnees}}', parametres: { temperature: 0.4, maxTokens: 1200 } }

  it('should accept a prompt body: type, system text, template, settings, motive', () => {
    expect(versions.schemaCreerVersionPrompt.safeParse({ cle: 'onboarding_vitrine', valeurs, motif: MOTIF }).success).toBe(true)
  })

  it('should never take the variables nor the output schema from the client', () => {
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, variables: ['donnees'] }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, schemaSortie: 'x' }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, actif: true }).success).toBe(false)
  })

  it('should bound the texts like the table CHECKs and the settings like the existing prompt schema', () => {
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, systeme: 'a'.repeat(PROMPT_SYSTEME_LONGUEUR_MAX) }).success).toBe(true)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, systeme: 'a'.repeat(PROMPT_SYSTEME_LONGUEUR_MAX + 1) }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, gabarit: 'a'.repeat(PROMPT_GABARIT_LONGUEUR_MAX) }).success).toBe(true)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, gabarit: 'a'.repeat(PROMPT_GABARIT_LONGUEUR_MAX + 1) }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, gabarit: '   ' }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, systeme: '' }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, parametres: { temperature: 1.5, maxTokens: 1200 } }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, parametres: { temperature: 0.4, maxTokens: 99 } }).success).toBe(false)
    expect(versions.schemaValeursPrompt.safeParse({ ...valeurs, parametres: { temperature: 0.4 } }).success).toBe(false)
  })

  it('should keep the template text untouched (no trimming: a version is frozen as written)', () => {
    expect(versions.schemaValeursPrompt.parse({ ...valeurs, gabarit: '  {{donnees}}  ' }).gabarit).toBe('  {{donnees}}  ')
  })

  it('should refuse a user datum in a dry run: the strict schema carries the prompt content only (CA10)', () => {
    const essai = { cle: 'onboarding_vitrine', valeurs }
    expect(versions.schemaEssaiPrompt.safeParse(essai).success).toBe(true)
    for (const intrus of ['donnees', 'entree', 'texte', 'utilisateurId', 'prenom']) {
      expect(versions.schemaEssaiPrompt.safeParse({ ...essai, [intrus]: 'Marie' }).success, intrus).toBe(false)
      expect(versions.schemaEssaiPrompt.safeParse({ ...essai, valeurs: { ...valeurs, [intrus]: 'Marie' } }).success, intrus).toBe(false)
    }
    expect(versions.schemaEssaiPrompt.safeParse({ cle: 'autre', valeurs }).success).toBe(false)
  })

  it('should return a dry run result without anything persisted: validity, output, error code, duration, remaining trials', () => {
    const resultat = { valide: true, sortie: { accroches: ['a'] }, erreurCode: null, dureeMs: 800, essaisRestants: 9 }
    expect(versions.schemaEssaiPromptDto.safeParse(resultat).success).toBe(true)
    expect(versions.schemaEssaiPromptDto.safeParse({ ...resultat, valide: false, sortie: null, erreurCode: 'sortie_invalide' }).success).toBe(true)
    expect(versions.schemaEssaiPromptDto.safeParse({ ...resultat, erreurCode: 'boom' }).success).toBe(false)
    expect(versions.schemaEssaiPromptDto.safeParse({ ...resultat, generationId: 'x' }).success).toBe(false)
  })
})

describe('versions : entrées communes', () => {
  it('should pick a creation schema for each version type of the route', () => {
    expect(Object.keys(versions.schemasCreationVersion).sort()).toEqual([...ADMIN_VERSION_TYPES].sort())
  })

  it('should paginate a history, optionally by key', () => {
    expect(versions.schemaHistoriqueVersionsQuery.parse({})).toEqual({ page: 1, limite: 25 })
    expect(versions.schemaHistoriqueVersionsQuery.parse({ cle: 'kpay:mobile_money', page: '2' })).toEqual({ cle: 'kpay:mobile_money', page: 2, limite: 25 })
    expect(versions.schemaHistoriqueVersionsQuery.safeParse({ cle: 'Majuscules' }).success).toBe(false)
    expect(versions.schemaHistoriqueVersionsQuery.safeParse({ cle: 'a'.repeat(61) }).success).toBe(false)
  })

  it('should accept the six version types in a route (E1 adds `essai`) and refuse any other', () => {
    for (const type of ADMIN_VERSION_TYPES) expect(versions.schemaVersionTypeParam.safeParse({ type }).success, type).toBe(true)
    expect(versions.schemaVersionTypeParam.safeParse({ type: 'pays' }).success).toBe(false)
    expect(versions.schemaVersionEntreeParam.safeParse({ type: 'prix', id: 'a5000000-prix-payant-1' }).success).toBe(true)
    expect(versions.schemaVersionEntreeParam.safeParse({ type: 'prix', id: '' }).success).toBe(false)
  })

  it('should activate now (null) or at a date, with a motive, and carry the acknowledged impact (D-A5-06)', () => {
    const impact = {
      services: { comptes: 1, elementsMasques: 2 },
      realisations: { comptes: 0, elementsMasques: 0 },
      temoignages: { comptes: 0, elementsMasques: 0 },
      reservationsMois: { comptes: 0 },
      generationsIaMois: { comptes: 0 },
    }
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: null, motif: MOTIF }).success).toBe(true)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: INSTANT, motif: MOTIF }).success).toBe(true)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: null, motif: MOTIF, impactAcquitte: impact }).success).toBe(true)
    expect(versions.schemaActiverVersion.safeParse({ motif: MOTIF }).success).toBe(false)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: 'demain', motif: MOTIF }).success).toBe(false)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: null }).success).toBe(false)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: null, motif: MOTIF, impactAcquitte: { ...impact, services: { comptes: -1, elementsMasques: 0 } } }).success).toBe(false)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: null, motif: MOTIF, impactAcquitte: { services: impact.services } }).success).toBe(false)
    expect(versions.schemaActiverVersion.safeParse({ programmeePour: null, motif: MOTIF, validee: true }).success).toBe(false)
  })

  it('should take a motive only for a rollback and a price validation', () => {
    expect(versions.schemaRetourVersion.safeParse({ motif: MOTIF }).success).toBe(true)
    expect(versions.schemaValiderPrix.safeParse({ motif: MOTIF }).success).toBe(true)
    expect(versions.schemaRetourVersion.safeParse({}).success).toBe(false)
    expect(versions.schemaValiderPrix.safeParse({ motif: MOTIF, grille: SEED_PRIX }).success).toBe(false)
  })

  it('should describe an impact preview with its approximation note', () => {
    const impact = {
      services: { comptes: 1, elementsMasques: 2 },
      realisations: { comptes: 0, elementsMasques: 0 },
      temoignages: { comptes: 0, elementsMasques: 0 },
      reservationsMois: { comptes: 4 },
      generationsIaMois: { comptes: 0 },
    }
    expect(versions.schemaImpactPlanDto.safeParse({ impact, mention: 'Estimation à une journée près.', genereLe: INSTANT }).success).toBe(true)
    expect(versions.schemaImpactPlanDto.safeParse({ impact, genereLe: INSTANT }).success).toBe(false)
    expect(versions.schemaImpactPlanDto.safeParse({ impact: { ...impact, reservationsMois: { comptes: 4, elementsMasques: 1 } }, mention: 'x', genereLe: INSTANT }).success).toBe(false)
  })
})

describe('versions : sorties', () => {
  it('should accept a plan version and refuse a values shape that belongs to another type', () => {
    expect(versions.schemaVersionDto.safeParse(VERSION_PLAN_DTO).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, valeurs: SEED_PRIX }).success).toBe(false)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, type: 'prix' }).success).toBe(false)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, statut: 'archivee' }).success).toBe(false)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, ip: '203.0.113.7' }).success).toBe(false)
  })

  it('should accept the seeded versions of the five categories (E1 adds `essai`), a draft without effect date, and an unvalidated price', () => {
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, type: 'prix', id: 'a5000000-prix-payant-1', cle: 'payant', valeurs: SEED_PRIX }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, type: 'frais', id: 'a5000000-frais-kpay-1', cle: 'kpay:mobile_money', valeurs: { tauxPointsBase: 500, supporteur: 'marchand' } }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, type: 'moyens', id: 'a5000000-moyens-kpay-1', cle: 'kpay', valeurs: { actifs: ['kpay:MTN_MOMO_CMR'] } }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, type: 'essai', id: 'e1000000-essai-inscription-1', cle: 'inscription', valeurs: { actif: true, dureeJours: 14, relanceServicesJour: 2, relanceStatistiquesJour: 7 } }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, type: 'essai', id: 'e1000000-essai-inscription-1', cle: 'inscription', valeurs: { actif: true, dureeJours: 14 } }).success).toBe(false)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, statut: 'brouillon', effectiveA: null, numero: 2 }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...VERSION_PLAN_DTO, numero: 0 }).success).toBe(false)
  })

  it('should accept a prompt version with a read-only output schema, active or inactive, and tolerate partial legacy settings', () => {
    const prompt = {
      type: 'prompts',
      id: 'prompt-onboarding-v2',
      cle: 'onboarding_vitrine',
      numero: 2,
      statut: 'active',
      motif: null,
      creePar: null,
      creeLe: INSTANT,
      valeurs: { systeme: 'Tu rédiges.', gabarit: '{{donnees}}', variables: ['donnees'], parametres: { temperature: 0.4, maxTokens: 1200 }, schemaSortie: 'proposition_onboarding_v2' },
    }
    expect(versions.schemaVersionDto.safeParse(prompt).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...prompt, statut: 'inactive' }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...prompt, statut: 'brouillon' }).success).toBe(false)
    expect(versions.schemaVersionDto.safeParse({ ...prompt, valeurs: { ...prompt.valeurs, parametres: {} } }).success).toBe(true)
    expect(versions.schemaVersionDto.safeParse({ ...prompt, valeurs: { ...prompt.valeurs, variables: ['donnees', 'a b'] } }).success).toBe(false)
    expect(versions.schemaVersionDto.safeParse({ ...prompt, effectiveA: INSTANT }).success).toBe(false)
  })

  it('should list a history page and return the resulting version with the replay flag', () => {
    expect(versions.schemaListeVersionsDto.safeParse({ type: 'plans', elements: [VERSION_PLAN_DTO], total: 1, page: 1, limite: 25 }).success).toBe(true)
    expect(versions.schemaListeVersionsDto.safeParse({ type: 'plans', elements: Array.from({ length: 101 }, () => VERSION_PLAN_DTO), total: 101, page: 1, limite: 100 }).success).toBe(false)
    expect(versions.schemaVersionReponse.safeParse({ version: VERSION_PLAN_DTO, rejoue: false }).success).toBe(true)
    expect(versions.schemaVersionReponse.safeParse({ version: VERSION_PLAN_DTO }).success).toBe(false)
  })
})

describe('abonnement : prix affiché (D-A5-07)', () => {
  const valide = { periodeMois: 1, devise: 'XAF', moyen: 'kpay:MTN_MOMO_CMR', telephone: '6 70 00 00 00', prixAffiche: 5000 }

  it('should require the displayed price as a whole positive amount of the minor unit', () => {
    expect(abonnement.schemaPaiementInitier.safeParse(valide).success).toBe(true)
    const { prixAffiche: _prix, ...sansPrix } = valide
    expect(abonnement.schemaPaiementInitier.safeParse(sansPrix).success).toBe(false)
    for (const mauvais of [0, -5000, 49.5, '5000', null, Number.NaN, PRIX_MAX_MINOR + 1]) {
      expect(abonnement.schemaPaiementInitier.safeParse({ ...valide, prixAffiche: mauvais }).success, String(mauvais)).toBe(false)
    }
    expect(abonnement.schemaPaiementInitier.safeParse({ ...valide, prixAffiche: PRIX_MAX_MINOR }).success).toBe(true)
  })

  it('should stay strict: no amount other than the displayed one', () => {
    expect(abonnement.schemaPaiementInitier.safeParse({ ...valide, montant: 5000 }).success).toBe(false)
  })

  it('should keep the other fields unchanged', () => {
    expect(abonnement.schemaPaiementInitier.safeParse({ ...valide, periodeMois: 2 }).success).toBe(false)
    expect(abonnement.schemaPaiementInitier.safeParse({ ...valide, devise: 'xaf' }).success).toBe(false)
    expect(abonnement.schemaPaiementInitier.safeParse({ ...valide, moyen: 'orange' }).success).toBe(false)
  })
})
