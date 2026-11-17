// A5 (UI) : fonctions pures de l'administration des catalogues (pays, devises, noms bloqués). Aucune dépendance Vue
// ni Nuxt : testable seule. Libellés au vocabulaire du produit (CLAUDE.md §2), vouvoiement. Le serveur reste la seule
// autorité : ces fonctions ne décident de rien, elles préparent l'affichage et le corps de la requête.
import { ADMIN_ACTIONS, ADMIN_CIBLES, NOM_BLOQUE_FORMAT, PAYS_FUSEAUX_MAX } from '#shared/admin'
import type { AdminAction, AdminCatalogue, AdminCible } from '#shared/admin'
import { isValidTimeZone } from '#shared/fuseau'
import { FUSEAU_FORMAT } from '#shared/schemas/admin-catalogues'
import type { ModifierPays, PaysDto } from '#shared/schemas/admin-catalogues'

export interface OngletCatalogue {
  valeur: AdminCatalogue
  libelle: string
  /** Phrase d'aide affichée sous les onglets. */
  aide: string
  /** Phrase affichée quand le catalogue est vide. */
  vide: string
}

export const ONGLETS_CATALOGUE: readonly OngletCatalogue[] = [
  {
    valeur: 'pays',
    libelle: 'Pays',
    aide: 'Pays proposés à l’inscription, avec leur indicatif et les canaux de connexion ouverts.',
    vide: 'Aucun pays dans le catalogue.',
  },
  {
    valeur: 'devises',
    libelle: 'Devises',
    aide: 'Devises que les comptes peuvent choisir. Une devise active n’est pas forcément payable.',
    vide: 'Aucune devise dans le catalogue.',
  },
  {
    valeur: 'noms-bloques',
    libelle: 'Noms bloqués',
    aide: 'Adresses refusées pour une vitrine, en plus des mots réservés du produit. Les vitrines existantes ne changent pas.',
    vide: 'Aucun nom bloqué pour le moment.',
  },
]

export const ONGLET_CATALOGUE_DEFAUT: AdminCatalogue = 'pays'

export function lireOngletCatalogue(valeur: unknown): AdminCatalogue {
  const brut = Array.isArray(valeur) ? valeur[0] : valeur
  return ONGLETS_CATALOGUE.find((onglet) => onglet.valeur === brut)?.valeur ?? ONGLET_CATALOGUE_DEFAUT
}

// --- Réauthentification : cible du code ---

/**
 * Cible du code de réauthentification : l'identifiant de la route (`[id]` : code du pays, code de la devise, valeur du
 * nom bloqué ; pour une création, la valeur saisie). À confirmer avec le backend : un seul endroit à changer.
 */
export function cibleReauthCatalogue(action: AdminAction, id: string): { action: AdminAction, cibleType: AdminCible, cibleId: string } {
  return { action, cibleType: ADMIN_CIBLES.catalogue, cibleId: id }
}

export const ACTIONS_CATALOGUE = {
  creer: ADMIN_ACTIONS.catalogueCreer,
  modifier: ADMIN_ACTIONS.catalogueModifier,
  supprimer: ADMIN_ACTIONS.catalogueSupprimer,
} as const

// --- Pays ---

/** Saisie du formulaire d'un pays : mêmes champs que la modification (hors motif). */
export interface SaisiePays {
  libelle: string
  indicatif: string
  deviseDefaut: PaysDto['deviseDefaut']
  fuseaux: string[]
  actif: boolean
  canalSms: boolean
  canalWhatsapp: boolean
  canalEmail: boolean
}

export function saisieDepuisPays(pays: PaysDto): SaisiePays {
  return {
    libelle: pays.libelle,
    indicatif: pays.indicatif,
    deviseDefaut: pays.deviseDefaut,
    fuseaux: [...pays.fuseaux],
    actif: pays.actif,
    canalSms: pays.canalSms,
    canalWhatsapp: pays.canalWhatsapp,
    canalEmail: pays.canalEmail,
  }
}

type ChampsPays = Omit<ModifierPays, 'motif'>

/** Seuls les champs modifiés partent au serveur (`PATCH` exige au moins un changement). Vide : rien à enregistrer. */
export function modificationsPays(initial: PaysDto, saisie: SaisiePays): ChampsPays {
  const corps: ChampsPays = {}
  if (saisie.libelle.trim() !== initial.libelle) corps.libelle = saisie.libelle.trim()
  if (saisie.indicatif !== initial.indicatif) corps.indicatif = saisie.indicatif
  if (saisie.deviseDefaut !== initial.deviseDefaut) corps.deviseDefaut = saisie.deviseDefaut
  if (saisie.fuseaux.join('|') !== initial.fuseaux.join('|')) corps.fuseaux = saisie.fuseaux
  if (saisie.actif !== initial.actif) corps.actif = saisie.actif
  if (saisie.canalSms !== initial.canalSms) corps.canalSms = saisie.canalSms
  if (saisie.canalWhatsapp !== initial.canalWhatsapp) corps.canalWhatsapp = saisie.canalWhatsapp
  if (saisie.canalEmail !== initial.canalEmail) corps.canalEmail = saisie.canalEmail
  return corps
}

/** Fuseau saisi : forme IANA ET connu du navigateur. Le serveur contrôle aussi l'appartenance à la liste, au changement. */
export function fuseauSaisiValide(fuseau: string): boolean {
  return FUSEAU_FORMAT.test(fuseau) && isValidTimeZone(fuseau)
}

export const MESSAGE_FUSEAUX = `Indiquez de 1 à ${PAYS_FUSEAUX_MAX} fuseaux horaires valides (par exemple Africa/Douala).`

/** Message sous le champ des fuseaux, ou chaîne vide si la saisie est correcte. */
export function erreurFuseaux(fuseaux: readonly string[]): string {
  if (fuseaux.length < 1 || fuseaux.length > PAYS_FUSEAUX_MAX) return MESSAGE_FUSEAUX
  const inconnus = fuseaux.filter((fuseau) => !fuseauSaisiValide(fuseau))
  if (inconnus.length > 0) return `Fuseau horaire inconnu : ${inconnus.join(', ')}.`
  if (new Set(fuseaux).size !== fuseaux.length) return 'Un fuseau ne peut figurer qu’une fois.'
  return ''
}

export const MESSAGE_LIBELLE_PAYS = 'Le nom du pays doit comporter de 2 à 80 caractères.'
export const MESSAGE_INDICATIF = 'L’indicatif comporte de 1 à 4 chiffres, sans le signe +.'

/** Canal activé par l'administrateur mais sans fournisseur : le drapeau n'a alors aucun effet (D-A5-13, R5). */
export function noteCanal(canal: 'sms' | 'whatsapp', actif: boolean, effectif: boolean): string {
  if (!actif || effectif) return ''
  return canal === 'sms'
    ? 'Ouvert, mais aucun fournisseur de SMS n’est branché : aucun code n’est envoyé.'
    : 'Ouvert, mais aucun fournisseur WhatsApp n’est branché : aucun code n’est envoyé.'
}

export const NOTE_CANAL_EMAIL = 'Pour information : la connexion par email ne dépend pas du pays.'

/** Libellés des canaux ouverts d'un pays, pour la ligne de liste (état effectif, jamais le seul drapeau). */
export function resumeCanaux(pays: Pick<PaysDto, 'smsEffectif' | 'whatsappEffectif' | 'canalEmail'>): string {
  const canaux: string[] = []
  if (pays.smsEffectif) canaux.push('SMS')
  if (pays.whatsappEffectif) canaux.push('WhatsApp')
  if (pays.canalEmail) canaux.push('Email')
  return canaux.length > 0 ? canaux.join(', ') : 'Aucun canal ouvert'
}

// --- Noms bloqués ---

export const MESSAGE_NOM_BLOQUE = 'Utilisez de 2 à 40 caractères : lettres minuscules, chiffres, tiret et tiret bas.'

/** Même normalisation que le schéma serveur (rogné, minuscules) ; le serveur revalide. */
export function normaliserNomBloque(saisie: string): string {
  return saisie.trim().toLowerCase()
}

export function nomBloqueValide(saisie: string): boolean {
  return NOM_BLOQUE_FORMAT.test(normaliserNomBloque(saisie))
}

/** Devise : « Désactiver » ou « Activer » selon l'état courant (jamais de suppression). */
export function libelleBasculeActif(actif: boolean): string {
  return actif ? 'Désactiver' : 'Activer'
}
