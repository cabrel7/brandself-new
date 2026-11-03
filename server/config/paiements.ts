import { PRIX_MAX_MINOR } from '../../shared/devises'
import type { Env } from '../../shared/env'
import {
  DEVISE_FORMAT,
  DEVISES_EXPOSANT,
  FOURNISSEURS_PAIEMENT,
  FRAIS_SUPPORTEURS,
  FRAIS_TAUX_PB_MAX,
  METHODES_PAIEMENT,
  MOYEN_ID_FORMAT,
} from '../../shared/paiements'
import type { FournisseurPaiement, FraisSupporteur, MethodePaiement } from '../../shared/paiements'
import { PERIODES_MOIS } from '../../shared/plans'
import { PRIX_PLANS, PRIX_STATUT } from './plans'
import type { GrillePrix, PrixStatut } from './plans'

// S10 (docs/specs/S10-abonnements.md §1 #104, #106, #107, §3.3) : catalogue des moyens de paiement, frais et
// validation de la configuration au démarrage. Serveur seulement. Tout est réglable (§11) : aucun littéral
// ailleurs.

export interface MoyenPaiementConfig {
  /** `fournisseur:OPERATEUR`, identique à `${fournisseur}:${operateur}`. */
  id: string
  fournisseur: FournisseurPaiement
  methode: MethodePaiement
  /** Code de l'opérateur chez le fournisseur (`provider` K-PAY). */
  operateur: string
  libelle: string
  /** Code pays ISO alpha-3 du portefeuille. */
  pays: string
  /** Indicatif international sans `+`. */
  indicatif: string
  devise: string
  /** Montant minimal accepté par le moyen, en unité mineure de sa devise. */
  montantMin: number
  /** Numéro national valide (sans indicatif). */
  numeroNational: RegExp
  /** Exemple de numéro national affiché dans l'aide à la saisie. */
  exemple: string
  actif: boolean
}

/** Montant minimal par défaut d'un moyen (en unité mineure). */
const MONTANT_MIN_DEFAUT = 100

/**
 * Catalogue. Actifs : Orange Money et MTN MoMo au Cameroun (XAF). Les autres pays sont au catalogue mais
 * INACTIFS : chaque pays alimente son propre portefeuille K-PAY, et retirer l'argent d'un portefeuille
 * étranger exige le plan TopOf (spec §13 question 2). Leur format de numéro est à valider avant activation.
 */
export const MOYENS_PAIEMENT: readonly MoyenPaiementConfig[] = [
  {
    id: 'kpay:MTN_MOMO_CMR',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_CMR',
    libelle: 'MTN MoMo',
    pays: 'CMR',
    indicatif: '237',
    devise: 'XAF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^6\d{8}$/,
    exemple: '6XX XXX XXX',
    actif: true,
  },
  {
    id: 'kpay:ORANGE_CMR',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'ORANGE_CMR',
    libelle: 'Orange Money',
    pays: 'CMR',
    indicatif: '237',
    devise: 'XAF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^6\d{8}$/,
    exemple: '6XX XXX XXX',
    actif: true,
  },
  {
    id: 'kpay:ORANGE_CIV',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'ORANGE_CIV',
    libelle: 'Orange Money',
    pays: 'CIV',
    indicatif: '225',
    devise: 'XOF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^\d{10}$/,
    exemple: '07 XX XX XX XX',
    actif: false,
  },
  {
    id: 'kpay:MTN_MOMO_CIV',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_CIV',
    libelle: 'MTN MoMo',
    pays: 'CIV',
    indicatif: '225',
    devise: 'XOF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^\d{10}$/,
    exemple: '05 XX XX XX XX',
    actif: false,
  },
  {
    id: 'kpay:ORANGE_SEN',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'ORANGE_SEN',
    libelle: 'Orange Money',
    pays: 'SEN',
    indicatif: '221',
    devise: 'XOF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^7\d{8}$/,
    exemple: '77 XXX XX XX',
    actif: false,
  },
  {
    id: 'kpay:MTN_MOMO_BEN',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_BEN',
    libelle: 'MTN MoMo',
    pays: 'BEN',
    indicatif: '229',
    devise: 'XOF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^\d{8,10}$/,
    exemple: '01 XX XX XX XX',
    actif: false,
  },
  {
    id: 'kpay:MTN_MOMO_COG',
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_COG',
    libelle: 'MTN MoMo',
    pays: 'COG',
    indicatif: '242',
    devise: 'XAF',
    montantMin: MONTANT_MIN_DEFAUT,
    numeroNational: /^\d{8,9}$/,
    exemple: '06 XXX XXXX',
    actif: false,
  },
]

export interface ConfigFrais {
  /** Points de base (500 = 5,00 %), entier de 0 à `FRAIS_TAUX_PB_MAX`. */
  tauxPointsBase: number
  /** `marchand` : Brandself absorbe les frais ; `client` : le montant demandé est majoré. */
  supporteur: FraisSupporteur
}

/** Frais par (fournisseur, méthode). Snapshot sur chaque paiement : changer ici ne réécrit jamais l'historique. */
export type TableFrais = Partial<Record<FournisseurPaiement, Partial<Record<MethodePaiement, ConfigFrais>>>>

export const FRAIS_PAIEMENT: TableFrais = {
  kpay: {
    mobile_money: { tauxPointsBase: 500, supporteur: 'marchand' },
  },
}

export function getMoyenPaiement(id: string): MoyenPaiementConfig | undefined {
  return MOYENS_PAIEMENT.find((moyen) => moyen.id === id)
}

export function getFraisPaiement(fournisseur: FournisseurPaiement, methode: MethodePaiement): ConfigFrais | undefined {
  return FRAIS_PAIEMENT[fournisseur]?.[methode]
}

/** Éléments contrôlés au démarrage ; injectables pour les tests. */
export interface ConfigPaiementsVerifiable {
  moyens: readonly MoyenPaiementConfig[]
  frais: TableFrais
  prix: GrillePrix
  prixStatut: PrixStatut
}

export class ConfigPaiementsError extends Error {
  readonly problemes: readonly string[]

  constructor(problemes: readonly string[]) {
    super(`Configuration des paiements invalide :\n  - ${problemes.join('\n  - ')}`)
    this.name = 'ConfigPaiementsError'
    this.problemes = problemes
  }
}

function verifierFrais(frais: TableFrais, problemes: string[]): void {
  for (const [fournisseur, methodes] of Object.entries(frais)) {
    for (const [methode, config] of Object.entries(methodes ?? {})) {
      const cible = `frais ${fournisseur}/${methode}`
      if (!(FOURNISSEURS_PAIEMENT as readonly string[]).includes(fournisseur)) problemes.push(`${cible} : fournisseur inconnu`)
      if (!(METHODES_PAIEMENT as readonly string[]).includes(methode)) problemes.push(`${cible} : méthode inconnue`)
      if (!Number.isSafeInteger(config.tauxPointsBase) || config.tauxPointsBase < 0 || config.tauxPointsBase > FRAIS_TAUX_PB_MAX) {
        problemes.push(`${cible} : le taux doit être un entier de 0 à ${FRAIS_TAUX_PB_MAX} points de base`)
      }
      if (!(FRAIS_SUPPORTEURS as readonly string[]).includes(config.supporteur)) problemes.push(`${cible} : supporteur inconnu`)
    }
  }
}

function verifierPrixDevise(devise: string, prix: GrillePrix, montantMin: number | null, problemes: string[]): void {
  const parPeriode = (prix as Partial<Record<string, Record<number, number>>>)[devise]
  if (parPeriode === undefined) return
  const exposant = DEVISES_EXPOSANT[devise]
  for (const periode of PERIODES_MOIS) {
    const montant = parPeriode[periode]
    const cible = `prix ${devise} ${periode} mois`
    if (montant === undefined || !Number.isSafeInteger(montant) || montant <= 0) {
      problemes.push(`${cible} : doit être un entier strictement positif`)
      continue
    }
    if (montant > PRIX_MAX_MINOR) problemes.push(`${cible} : dépasse le maximum autorisé`)
    if (montantMin !== null && montant < montantMin) problemes.push(`${cible} : inférieur au minimum du moyen (${montantMin})`)
    if (exposant === undefined) problemes.push(`${cible} : exposant de la devise inconnu`)
  }
}

/**
 * Valide la configuration des paiements ; lève `ConfigPaiementsError` listant tous les problèmes (sans secret).
 * Appelée au démarrage du serveur (plugin Nitro) et du worker. En production, `PRIX_STATUT = 'a_valider'`
 * fait échouer le démarrage (#106).
 */
export function assertConfigPaiements(
  env: Pick<Env, 'NODE_ENV'>,
  config: ConfigPaiementsVerifiable = { moyens: MOYENS_PAIEMENT, frais: FRAIS_PAIEMENT, prix: PRIX_PLANS.payant, prixStatut: PRIX_STATUT },
): void {
  const problemes: string[] = []

  verifierFrais(config.frais, problemes)

  const ids = new Set<string>()
  for (const moyen of config.moyens) {
    const cible = `moyen ${moyen.id}`
    if (ids.has(moyen.id)) problemes.push(`${cible} : identifiant en double`)
    ids.add(moyen.id)
    if (!MOYEN_ID_FORMAT.test(moyen.id) || moyen.id !== `${moyen.fournisseur}:${moyen.operateur}`) {
      problemes.push(`${cible} : l'identifiant doit valoir fournisseur:OPERATEUR`)
    }
    if (!(FOURNISSEURS_PAIEMENT as readonly string[]).includes(moyen.fournisseur)) problemes.push(`${cible} : fournisseur inconnu`)
    if (!(METHODES_PAIEMENT as readonly string[]).includes(moyen.methode)) problemes.push(`${cible} : méthode inconnue`)
    if (!DEVISE_FORMAT.test(moyen.devise) || DEVISES_EXPOSANT[moyen.devise] === undefined) problemes.push(`${cible} : devise inconnue`)
    if (!Number.isSafeInteger(moyen.montantMin) || moyen.montantMin <= 0) problemes.push(`${cible} : montant minimal invalide`)
    if (!/^\d{1,4}$/.test(moyen.indicatif)) problemes.push(`${cible} : indicatif invalide`)
    if (getFraisParConfig(config.frais, moyen) === undefined) problemes.push(`${cible} : aucun frais configuré pour ${moyen.fournisseur}/${moyen.methode}`)
    if (!moyen.actif) continue
    // L'adaptateur K-PAY refuse les devises à décimales : un moyen K-PAY actif exige l'exposant 0.
    if (moyen.fournisseur === 'kpay' && DEVISES_EXPOSANT[moyen.devise] !== 0) {
      problemes.push(`${cible} : un moyen K-PAY actif exige une devise sans décimales`)
    }
    verifierPrixDevise(moyen.devise, config.prix, moyen.montantMin, problemes)
  }

  // Toute devise tarifée (payable ou non) a des prix entiers, positifs et bornés.
  for (const devise of Object.keys(config.prix)) {
    const dejaVerifiee = config.moyens.some((moyen) => moyen.actif && moyen.devise === devise)
    if (!dejaVerifiee) verifierPrixDevise(devise, config.prix, null, problemes)
  }

  if (env.NODE_ENV === 'production' && config.prixStatut === 'a_valider') {
    problemes.push('PRIX_STATUT vaut a_valider : la grille de prix est provisoire et interdite en production')
  }

  if (problemes.length > 0) throw new ConfigPaiementsError(problemes)
}

function getFraisParConfig(frais: TableFrais, moyen: MoyenPaiementConfig): ConfigFrais | undefined {
  return frais[moyen.fournisseur]?.[moyen.methode]
}
