// S15 : règles pures de la fenêtre d'installation (aucune dépendance Vue, testables hors navigateur).
// Règle : jamais à la 1re visite, jamais pendant une saisie, jamais si un autre message s'affiche,
// « Plus tard » = 30 jours, deux refus = plus jamais. Mêmes limites sur tous les appareils.

export const CLE_STOCKAGE_INSTALLATION = 'pwa_install_stats'
export const DELAI_REPORT_JOURS = 30
export const REFUS_MAX = 2
/** Première visite exclue : la fenêtre n'apparaît qu'à partir de la 2e. */
export const VISITES_MIN = 2

const MS_PAR_JOUR = 24 * 60 * 60 * 1000

/** Routes où la fenêtre n'apparaît jamais (parcours de connexion et consentement d'un assistant). */
const PREFIXES_EXCLUS = ['/connexion', '/studio/assistants/autorisation']

export type TypeAppareil = 'mobile' | 'tablette' | 'ordinateur' | 'inconnu'
export type OrigineInstallation = 'studio' | 'marketing'

export interface EtatInstallation {
  visites: number
  refus: number
  /** Horodatage (ms) avant lequel la fenêtre ne revient pas ; null si aucun report. */
  reportJusqua: number | null
  /** Horodatage (ms) posé AU MOMENT où la fenêtre est affichée. */
  dernierAffichage: number | null
}

export interface ContexteAffichage {
  chemin: string
  maintenant: number
  dejaInstalle: boolean
  /** Le navigateur sait installer (événement natif reçu) ou iOS Safari (instructions manuelles). */
  installable: boolean
  saisieEnCours: boolean
  messageOuvert: boolean
  /** Déjà proposée pendant cette session : une seule fois par session. */
  dejaProposeSession: boolean
}

export const ETAT_INITIAL: EtatInstallation = { visites: 0, refus: 0, reportJusqua: null, dernierAffichage: null }

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null
}

function entierPositif(valeur: unknown): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? Math.floor(valeur) : 0
}

/** Lit un état stocké sans jamais lever : valeur absente, corrompue ou d'un ancien format = état initial. */
export function lireEtat(brut: string | null): EtatInstallation {
  if (!brut) return { ...ETAT_INITIAL }
  try {
    const donnees: unknown = JSON.parse(brut)
    if (typeof donnees !== 'object' || donnees === null) return { ...ETAT_INITIAL }
    const d = donnees as Record<string, unknown>
    return {
      visites: entierPositif(d.visites),
      refus: entierPositif(d.refus),
      reportJusqua: nombreOuNull(d.reportJusqua),
      dernierAffichage: nombreOuNull(d.dernierAffichage),
    }
  }
  catch {
    return { ...ETAT_INITIAL }
  }
}

export function avecVisite(etat: EtatInstallation): EtatInstallation {
  return { ...etat, visites: etat.visites + 1 }
}

export function avecAffichage(etat: EtatInstallation, maintenant: number): EtatInstallation {
  return { ...etat, dernierAffichage: maintenant }
}

/** « Plus tard » (bouton, Échap, croix) : la fenêtre revient dans 30 jours, sans compter comme un refus. */
export function avecPlusTard(etat: EtatInstallation, maintenant: number): EtatInstallation {
  return { ...etat, reportJusqua: maintenant + DELAI_REPORT_JOURS * MS_PAR_JOUR }
}

/** Refus explicite (« Non merci », fermeture de la fenêtre native) : compte pour un refus, et 30 jours d'attente. */
export function avecRefus(etat: EtatInstallation, maintenant: number): EtatInstallation {
  return { ...avecPlusTard(etat, maintenant), refus: etat.refus + 1 }
}

export function cheminAutorise(chemin: string): boolean {
  if (PREFIXES_EXCLUS.some((prefixe) => chemin === prefixe || chemin.startsWith(`${prefixe}/`))) return false
  return chemin === '/' || chemin === '/tarifs' || chemin.startsWith('/studio/')
}

/**
 * Pages où le code PWA (invite, comptage des visites, service worker) est chargé : les pages où l'invite peut s'afficher,
 * plus `/studio` seul, la page d'arrivée après la connexion (l'invite n'y est pas proposée mais la visite y est comptée
 * et le service worker enregistré, comme avant S13-A). Jamais une vitrine, ni l'administration, ni `/connexion`.
 */
export function cheminPwa(chemin: string): boolean {
  return cheminAutorise(chemin) || chemin === '/studio'
}

export function origineDuChemin(chemin: string): OrigineInstallation {
  return chemin.startsWith('/studio/') ? 'studio' : 'marketing'
}

export function peutAfficher(etat: EtatInstallation, contexte: ContexteAffichage): boolean {
  if (contexte.dejaInstalle || !contexte.installable) return false
  if (contexte.dejaProposeSession || contexte.saisieEnCours || contexte.messageOuvert) return false
  if (!cheminAutorise(contexte.chemin)) return false
  if (etat.visites < VISITES_MIN) return false
  if (etat.refus >= REFUS_MAX) return false
  if (etat.reportJusqua !== null && contexte.maintenant < etat.reportJusqua) return false
  if (etat.dernierAffichage !== null && contexte.maintenant - etat.dernierAffichage < DELAI_REPORT_JOURS * MS_PAR_JOUR) return false
  return true
}

/** Détection de l'appareil depuis le user-agent (insensible à la casse : « iPhone », « Android », « Mobile »…). */
export function typeAppareil(userAgent: string): TypeAppareil {
  if (!userAgent) return 'inconnu'
  const ua = userAgent.toLowerCase()
  if (/ipad|tablet/.test(ua) || (/android/.test(ua) && !/mobile/.test(ua))) return 'tablette'
  if (/iphone|ipod|android|mobile/.test(ua)) return 'mobile'
  return 'ordinateur'
}

const LIBELLES_APPAREIL_INSTALLATION: Record<TypeAppareil, string> = {
  mobile: 'sur votre téléphone',
  tablette: 'sur votre tablette',
  ordinateur: 'sur cet ordinateur',
  inconnu: 'sur votre appareil',
}

export function libelleAppareilInstallation(appareil: TypeAppareil): string {
  return LIBELLES_APPAREIL_INSTALLATION[appareil]
}
