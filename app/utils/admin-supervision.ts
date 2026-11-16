// A4 (UI) : fonctions pures de la supervision (santé, files, envois de codes, agrégats). Aucune dépendance Vue ni Nuxt :
// testable seule. Les libellés d'erreur ne sont jamais écrits ici : le serveur envoie le texte de `ERROR_MESSAGES`.
import { ADMIN_ENVOIS_JOURS_DEFAUT, ADMIN_SUPERVISION_JOURS_DEFAUT } from '#shared/admin'
import type { SanteEtat, SauvegardeEtat } from '#shared/admin'
import type { GenerationStatut, IaType, MotifRepli } from '#shared/ia'
import {
  FILE_EMAILS_NOTIFICATIONS,
  FILE_IA,
  FILE_IA_FOND,
  FILE_MAINTENANCE,
  FILE_MESSAGES_AUTH,
  FILE_PAIEMENTS,
  FILE_SYSTEM,
} from '#shared/jobs'
import type { EnvoiCodeCanal, FileSupervisee } from '#shared/jobs'
import type { AgregatsPwaDto, EtatFilesDto, SanteDto } from '#shared/schemas/admin-a4'

const LOCALE = 'fr-FR'
const TIRET = '—'
const LONGUEUR_ID_AFFICHE = 8
const MS_PAR_SECONDE = 1_000
const HEURES_PAR_JOUR = 24
const OCTETS_PAR_UNITE = 1_024
const UNITES_OCTETS = ['o', 'Ko', 'Mo', 'Go', 'To'] as const

/** Périodes proposées (en jours) : envois jusqu'à 90 jours, agrégats jusqu'à 30 jours (D-A4-15, D-A4-17). */
export const PERIODES_ENVOIS: readonly number[] = [ADMIN_ENVOIS_JOURS_DEFAUT, 30, 90]
export const PERIODES_AGREGATS: readonly number[] = [ADMIN_ENVOIS_JOURS_DEFAUT, 14, ADMIN_SUPERVISION_JOURS_DEFAUT]

export function optionsPeriodes(jours: readonly number[]): Array<{ label: string, value: number }> {
  return jours.map((nombre) => ({ label: `${nombre} derniers jours`, value: nombre }))
}

// --- Libellés ---

export const LIBELLES_FILES_SUPERVISION: Record<FileSupervisee, string> = {
  [FILE_SYSTEM]: 'Système',
  [FILE_MAINTENANCE]: 'Entretien planifié',
  [FILE_MESSAGES_AUTH]: 'Codes de connexion',
  [FILE_EMAILS_NOTIFICATIONS]: 'E-mails de notification',
  [FILE_IA]: 'Propositions d’IA',
  [FILE_IA_FOND]: 'IA en arrière-plan',
  [FILE_PAIEMENTS]: 'Paiements',
}

export const MESSAGE_FILE_NON_RELANCABLE =
  'Les tâches de cette file portent des codes de connexion : elles ne sont jamais relancées depuis l’administration.'

export interface EtiquetteSupervision {
  libelle: string
  /** La couleur ne porte jamais seule le sens : libellé et icône suivent toujours. */
  couleur: 'primary' | 'neutral' | 'error'
  icone: string
}

export const ETIQUETTES_SANTE: Record<SanteEtat, EtiquetteSupervision> = {
  ok: { libelle: 'En service', couleur: 'primary', icone: 'i-ph-check-circle' },
  degrade: { libelle: 'Dégradé', couleur: 'neutral', icone: 'i-ph-warning' },
  indisponible: { libelle: 'Indisponible', couleur: 'error', icone: 'i-ph-x-circle' },
}

/** `inconnue` n'est JAMAIS présentée comme bonne (D-A4-16) : icône et libellé neutres. */
export const ETIQUETTES_SAUVEGARDE: Record<SauvegardeEtat, EtiquetteSupervision> = {
  ok: { libelle: 'À jour', couleur: 'primary', icone: 'i-ph-check-circle' },
  ancienne: { libelle: 'Ancienne', couleur: 'neutral', icone: 'i-ph-warning' },
  inconnue: { libelle: 'Inconnue', couleur: 'neutral', icone: 'i-ph-question' },
}

export const LIBELLES_CANAL: Record<EnvoiCodeCanal, string> = { sms: 'SMS', email: 'E-mail', whatsapp: 'WhatsApp' }
export const ICONES_CANAL: Record<EnvoiCodeCanal, string> = {
  sms: 'i-ph-chat-text',
  email: 'i-ph-envelope-simple',
  whatsapp: 'i-ph-whatsapp-logo',
}

export const LIBELLES_STATUT_IA: Record<GenerationStatut, string> = {
  en_attente: 'En attente',
  en_cours: 'En cours',
  terminee: 'Terminées',
  repli: 'Repli sans IA',
  expiree: 'Expirées',
}

export const LIBELLES_MOTIF_REPLI: Record<MotifRepli, string> = {
  echec_fournisseur: 'Échec du fournisseur',
  delai_depasse: 'Délai dépassé',
  sortie_invalide: 'Réponse invalide',
  injection: 'Injection suspectée',
  sans_fournisseur: 'Aucun fournisseur',
  sans_prompt: 'Aucune consigne',
  file_indisponible: 'File indisponible',
  limiteur_indisponible: 'Limiteur indisponible',
  plafond_global: 'Plafond quotidien atteint',
  quota_atteint: 'Quota du plan atteint',
  ia_coupee: 'IA coupée par l’administration',
}

export const LIBELLES_TYPE_IA: Record<IaType, string> = {
  onboarding_vitrine: 'Création de la vitrine',
  ameliorer_texte: 'Amélioration de texte',
  seo_vitrine: 'Référencement',
}

export const LIBELLE_SANS_FOURNISSEUR = 'Sans appel (repli)'

type LignePwa = AgregatsPwaDto['lignes'][number]
export const LIBELLES_PWA_TYPE: Record<LignePwa['type'], string> = {
  proposee: 'Proposée',
  installee: 'Installée',
  refusee: 'Refusée',
}
export const LIBELLES_PWA_ORIGINE: Record<LignePwa['origine'], string> = {
  studio: 'Studio',
  marketing: 'Pages publiques',
}
export const LIBELLES_PWA_APPAREIL: Record<LignePwa['deviceType'], string> = {
  mobile: 'Mobile',
  tablette: 'Tablette',
  ordinateur: 'Ordinateur',
  inconnu: 'Appareil inconnu',
}

// --- Formats ---

export function formaterOctetsSupervision(octets: number | null): string {
  if (octets === null) return TIRET
  let valeur = octets
  let indice = 0
  while (valeur >= OCTETS_PAR_UNITE && indice < UNITES_OCTETS.length - 1) {
    valeur /= OCTETS_PAR_UNITE
    indice += 1
  }
  const nombre = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: indice === 0 ? 0 : 1 }).format(valeur)
  return `${nombre} ${UNITES_OCTETS[indice]}`
}

export function formaterDureeSupervision(ms: number | null): string {
  if (ms === null) return TIRET
  if (ms < MS_PAR_SECONDE) return `${ms} ms`
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format(ms / MS_PAR_SECONDE)} s`
}

/** Part en pourcentage ; un tiret quand il n'y a rien à comparer (jamais « NaN % »). */
export function formaterTauxSupervision(part: number, total: number): string {
  if (total <= 0) return TIRET
  return `${new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 1 }).format((part / total) * 100)} %`
}

export function formaterAgeSupervision(heures: number | null): string {
  if (heures === null) return TIRET
  if (heures < 1) return 'moins d’une heure'
  if (heures < HEURES_PAR_JOUR * 2) return `${Math.floor(heures)} h`
  return `${Math.floor(heures / HEURES_PAR_JOUR)} jours`
}

/** Identifiant de compte tronqué : lisible sans exposer plus que nécessaire (le lien mène à la fiche). */
export function tronquerIdentifiant(id: string): string {
  return id.length > LONGUEUR_ID_AFFICHE ? `${id.slice(0, LONGUEUR_ID_AFFICHE)}…` : id
}

/** Nom du pays d'après son code alpha-2 ; `—` pour l'e-mail (aucun pays), le code brut si le navigateur ne le connaît pas. */
export function nomPaysSupervision(code: string | null): string {
  if (code === null) return TIRET
  try {
    return new Intl.DisplayNames([LOCALE], { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

// --- Points à examiner (un seul message d'alerte à l'écran) ---

export interface PointSupervision {
  id: string
  libelle: string
  /** Ancre de la partie concernée. */
  ancre: string
}

export const ANCRES_SUPERVISION = { sante: 'sante', files: 'files' } as const

export function fileEnAlerte(echecs15Min: number, seuil: number): boolean {
  return echecs15Min >= seuil
}

export function listerPointsSupervision(sante: SanteDto | undefined, files: EtatFilesDto | undefined): PointSupervision[] {
  const points: PointSupervision[] = []
  if (sante) {
    if (sante.base.etat !== 'ok') points.push({ id: 'base', libelle: `Base de données : ${ETIQUETTES_SANTE[sante.base.etat].libelle.toLowerCase()}`, ancre: ANCRES_SUPERVISION.sante })
    if (sante.redis.etat !== 'ok') points.push({ id: 'redis', libelle: `Redis : ${ETIQUETTES_SANTE[sante.redis.etat].libelle.toLowerCase()}`, ancre: ANCRES_SUPERVISION.sante })
    if (sante.disque.etat !== 'ok') points.push({ id: 'disque', libelle: `Stockage : ${ETIQUETTES_SANTE[sante.disque.etat].libelle.toLowerCase()}`, ancre: ANCRES_SUPERVISION.sante })
    if (sante.sauvegarde.etat !== 'ok') points.push({ id: 'sauvegarde', libelle: `Dernière sauvegarde : ${ETIQUETTES_SAUVEGARDE[sante.sauvegarde.etat].libelle.toLowerCase()}`, ancre: ANCRES_SUPERVISION.sante })
  }
  if (files) {
    for (const file of files.files) {
      if (fileEnAlerte(file.echecs15Min, files.seuilEchecs15Min)) {
        points.push({
          id: `file-${file.file}`,
          libelle: `File « ${LIBELLES_FILES_SUPERVISION[file.file]} » : ${file.echecs15Min} échecs en 15 minutes`,
          ancre: ANCRES_SUPERVISION.files,
        })
      }
    }
  }
  return points
}
