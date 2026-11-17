// `pnpm admin:demo` : jeu de données de DÉMONSTRATION de l'administration, FIXE et IDEMPOTENT, pour tester à la main
// chaque écran (utilisateurs, vitrines, abonnements, paiements, alertes) sans dépendre des restes d'anciens tests.
// 18 comptes `demo-admin-<cas>@exemple.test` : un par cas. Le préfixe `demo-admin-` n'est JAMAIS `e2e-` : `pnpm e2e:purger`
// ne les touche pas. Relancer le script supprime puis recrée ces comptes (cascade du service de suppression ; leurs
// paiements, qui survivent au compte, sont supprimés avec eux), une transaction par compte. Aucun autre compte n'est
// touché, jamais un superadmin. Aucune ligne n'est écrite dans `journal_admin` (ajout seul, réservé aux actions réelles).
// Aucun mot de passe : l'application n'en a pas. Aucune donnée personnelle réelle : adresses en `.test`, numéros
// inventés (`+2376000000…`), noms de visiteurs génériques. Refusé en production.
// Les dates sont relatives à l'instant du lancement : relancer le script « rafraîchit » les échéances.
import { createHash } from 'node:crypto'
import { and, eq, like, ne } from 'drizzle-orm'
import { z } from 'zod'
import { PRIX_PLANS } from '../server/config/plans'
import { ABONNEMENT_ORIGINES } from '../shared/admin-a2'
import type { AbonnementOrigine } from '../shared/admin-a2'
import { CODE_ANOMALIE_REMPLACE_PAR_MANUEL, PAIEMENT_REFERENCE_MANUEL_PREFIXE } from '../shared/admin-paiements'
import type { PaiementSource } from '../shared/admin-paiements'
import { SUPERADMIN } from '../shared/admin'
import type { Devise } from '../shared/compte'
import {
  abonnements,
  demandes,
  evenementsPaiement,
  journalAssistant,
  messages,
  oauthClients,
  oauthConsents,
  paiements,
  reservations,
  services,
  users,
  vitrines,
  vues,
} from '../shared/db/schema'
import { env } from '../shared/env'
import { calculerMontants } from '../shared/paiements-montants'
import { PALETTES } from '../shared/palettes'
import type { PeriodeMois } from '../shared/plans'
import { JOUR_MS } from '../shared/temps'
import { METIER_MAX, NOM_MAX, PRENOM_MAX, VILLE_MAX } from '../shared/vitrine'
import { db } from '../server/utils/db'
import { supprimerCompteDansTransaction, supprimerFichiersDuCompte } from '../server/services/utilisateurs'
import type { TransactionCompte } from '../server/services/utilisateurs'

// ---------------------------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------------------------

const USAGE = 'Usage : pnpm admin:demo (aucun argument)'
const PREFIXE_DEMO = 'demo-admin-'
const DOMAINE_DEMO = 'exemple.test'
/** Motif LIKE des comptes de démonstration. */
const MOTIF_EMAIL_DEMO = `${PREFIXE_DEMO}%@${DOMAINE_DEMO}`
const MOTIF_ID_DEMO = `${PREFIXE_DEMO}%`
const USERNAME_MAX = 30

const MINUTE_MS = 60_000
const DEPOT_CREATION_JOURS = 200
const PAS_CREATION_JOURS = 5
const DELAI_APPLICATION_MS = 2 * MINUTE_MS
const DELAI_ECHEC_MS = 3 * MINUTE_MS
const PAIEMENT_ATTENTE_AGE_MS = 5 * MINUTE_MS
const PAIEMENT_ATTENTE_VALIDITE_MS = JOUR_MS
const OFFERT_JOURS = 14

const FRAIS_TAUX_PB = 500
const FRAIS_SUPPORTEUR = 'marchand'
const ENVIRONNEMENT_PAIEMENT = 'test'
const FOURNISSEUR_KPAY = 'kpay'
const FOURNISSEUR_MANUEL = 'manuel'
const METHODE_MOBILE = 'mobile_money'
const METHODE_CARTE = 'carte'
const METHODE_MANUEL = 'manuel'
const OPERATEUR_MTN = 'MTN_MOMO_CMR'
const TELEPHONE_PAYEUR_MASQUE = '+237 6•• ••• •00'
const CODE_ECHEC_SOLDE = 'SOLDE_INSUFFISANT'
const CODE_ANOMALIE_MONTANT = 'MONTANT_INCOHERENT'
const STATUT_FOURNISSEUR_REUSSI = 'SUCCESS'
const STATUT_FOURNISSEUR_ECHEC = 'FAILED'
const EVENEMENT_REUSSI = 'payment.completed'
const EVENEMENT_ECHEC = 'payment.failed'

const TELEPHONE_BASE = 237_600_000_000
const PRIX_SEANCE_XAF = 15_000
const DUREE_PREMIER_ECHANGE_MIN = 30
const DUREE_SEANCE_MIN = 45
const HEURE_RESERVATION_UTC = 9

const CLIENT_OAUTH_ID = `${PREFIXE_DEMO}assistant`
const CLIENT_OAUTH_LIGNE_ID = `${PREFIXE_DEMO}oauth-client`
const CONSENTEMENT_ID = `${PREFIXE_DEMO}oauth-consentement`
const PORTEES_ASSISTANT = ['vitrine:lecture', 'contenu:ecriture', 'offline_access']

const UUID_VERSION = '4'
const UUID_VARIANTE = '8'

// ---------------------------------------------------------------------------------------------
// Description des cas
// ---------------------------------------------------------------------------------------------

type Titre = 'dr' | 'pr' | 'me' | 'm' | 'mme'
type StatutPaiementDemo = 'reussi' | 'echoue' | 'en_attente' | 'anomalie'
type Extra = 'assistant' | 'visiteurs'

interface PaiementDemo {
  /** Fin de l'identifiant : `demo-admin-pay-<cas>-<suffixe>`. */
  suffixe: string
  statut: StatutPaiementDemo
  source: PaiementSource
  periodeMois: PeriodeMois
  /** Ancienneté de la CRÉATION du paiement, en millisecondes. */
  ageMs: number
  codeEchec?: string
}

interface AbonnementDemo {
  origine: AbonnementOrigine
  /** Échéance (exclusive) relative à maintenant, en jours : négative = échu. */
  expireDansJours: number
}

interface VitrineDemo {
  metier: string
  ville: string
  pays: string
  accroche: string
  publiee: boolean
  /** Motif de blocage par l'administration (la vitrine reste publiée côté `publiee_le`). */
  blocageMotif?: string
  sansContact?: boolean
}

interface CasDemo {
  slug: string
  libelle: string
  /** Écran et onglet où le cas doit apparaître (vérifié par les services d'administration, voir docs). */
  ou: string
  prenom: string
  nom: string
  titre: Titre | null
  devise: Devise
  fuseau: string
  vitrine: VitrineDemo | null
  suspension?: string
  abonnement?: AbonnementDemo
  paiements?: PaiementDemo[]
  extra?: Extra
}

const FUSEAU_DOUALA = 'Africa/Douala'
const jours = (nombre: number): number => nombre * JOUR_MS

const CAS: readonly CasDemo[] = [
  {
    slug: 'sans-vitrine',
    libelle: '1. Gratuit, sans vitrine',
    ou: 'Utilisateurs (vitrine : aucune, plan gratuit)',
    prenom: 'Aurélie',
    nom: 'Tchoupo',
    titre: null,
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: null,
  },
  {
    slug: 'gratuit-publiee',
    libelle: '2. Gratuit, vitrine publiée',
    ou: 'Utilisateurs et Vitrines (publiée, plan gratuit)',
    prenom: 'Serge',
    nom: 'Nkeng',
    titre: 'm',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Photographe de mariage et de portrait',
      ville: 'Douala',
      pays: 'CM',
      accroche: 'Des images qui racontent votre histoire, à Douala et partout au Cameroun.',
      publiee: true,
    },
  },
  {
    slug: 'gratuit-brouillon',
    libelle: '3. Gratuit, vitrine NON publiée',
    ou: 'Vitrines (non publiée)',
    prenom: 'Mireille',
    nom: 'Atangana',
    titre: 'mme',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Coiffeuse et styliste',
      ville: 'Yaoundé',
      pays: 'CM',
      accroche: 'Tresses, tissages et coiffures de cérémonie.',
      publiee: false,
    },
  },
  {
    slug: 'payant-3-mois',
    libelle: '4. Payant actif (3 mois, K-PAY réussi)',
    ou: 'Utilisateurs (plan payant, actif) ; Paiements (réussi)',
    prenom: 'Boris',
    nom: 'Fotso',
    titre: 'dr',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Chirurgien-dentiste',
      ville: 'Douala',
      pays: 'CM',
      accroche: 'Soins dentaires pour toute la famille, sur rendez-vous à Bonapriso.',
      publiee: true,
    },
    abonnement: { origine: 'paiement', expireDansJours: 70 },
    paiements: [{ suffixe: '1', statut: 'reussi', source: 'kpay', periodeMois: 3, ageMs: jours(20) }],
  },
  {
    slug: 'payant-12-mois',
    libelle: '5. Payant actif (12 mois, 2 paiements dont 1 échoué)',
    ou: 'Utilisateurs (payant, actif) ; Paiements (réussi + échoué)',
    prenom: 'Carine',
    nom: 'Mbarga',
    titre: 'me',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Avocate en droit des affaires',
      ville: 'Yaoundé',
      pays: 'CM',
      accroche: 'Création d’entreprise, contrats et conseil juridique aux PME.',
      publiee: true,
    },
    abonnement: { origine: 'paiement', expireDansJours: 325 },
    paiements: [
      { suffixe: '1', statut: 'echoue', source: 'kpay', periodeMois: 12, ageMs: jours(40) + MINUTE_MS * 20, codeEchec: CODE_ECHEC_SOLDE },
      { suffixe: '2', statut: 'reussi', source: 'kpay', periodeMois: 12, ageMs: jours(40) },
    ],
  },
  {
    slug: 'grace-eur',
    libelle: '6. En période de grâce (échu depuis 2 jours, EUR)',
    ou: 'Abonnements > Grâce ; Utilisateurs (état grâce) ; Paiements (EUR)',
    prenom: 'Patrick',
    nom: 'Ndzana',
    titre: 'm',
    devise: 'EUR',
    fuseau: 'Europe/Paris',
    vitrine: {
      metier: 'Architecte d’intérieur',
      ville: 'Paris',
      pays: 'FR',
      accroche: 'Des intérieurs sobres et chaleureux, inspirés de l’Afrique centrale.',
      publiee: true,
    },
    abonnement: { origine: 'paiement', expireDansJours: -2 },
    paiements: [{ suffixe: '1', statut: 'reussi', source: 'kpay', periodeMois: 3, ageMs: jours(92) }],
  },
  {
    slug: 'expire-recent',
    libelle: '7. Expiré récemment (échu depuis 15 jours)',
    ou: 'Abonnements > Expirés ; Utilisateurs (plan gratuit)',
    prenom: 'Sandrine',
    nom: 'Kamga',
    titre: 'mme',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Nutritionniste',
      ville: 'Bafoussam',
      pays: 'CM',
      accroche: 'Un accompagnement alimentaire adapté à vos habitudes et à votre budget.',
      publiee: true,
    },
    abonnement: { origine: 'paiement', expireDansJours: -15 },
    paiements: [{ suffixe: '1', statut: 'reussi', source: 'kpay', periodeMois: 1, ageMs: jours(45) }],
  },
  {
    slug: 'renouveler-usd',
    libelle: '8. À renouveler sous 7 jours (échéance dans 4 jours, USD)',
    ou: 'Abonnements > À renouveler ; Paiements (USD)',
    prenom: 'Rodrigue',
    nom: 'Essomba',
    titre: 'm',
    devise: 'USD',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Consultant en gestion de projet',
      ville: 'Douala',
      pays: 'CM',
      accroche: 'Cadrage, planning et suivi de vos projets, du devis à la livraison.',
      publiee: true,
    },
    abonnement: { origine: 'paiement', expireDansJours: 4 },
    paiements: [{ suffixe: '1', statut: 'reussi', source: 'kpay', periodeMois: 1, ageMs: jours(26) }],
  },
  {
    slug: 'offert',
    libelle: '9. Abonnement OFFERT (14 jours)',
    ou: 'Utilisateurs (payant, origine offert) ; aucune alerte « sans paiement »',
    prenom: 'Nadège',
    nom: 'Fokou',
    titre: 'mme',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Coach de vie et de carrière',
      ville: 'Dschang',
      pays: 'CM',
      accroche: 'Retrouvez de la clarté dans votre parcours professionnel.',
      publiee: true,
    },
    abonnement: { origine: 'offert', expireDansJours: OFFERT_JOURS },
  },
  {
    slug: 'suspendu',
    libelle: '10. Compte SUSPENDU (avec vitrine)',
    ou: 'Utilisateurs (suspendus) ; Vitrines',
    prenom: 'Hervé',
    nom: 'Mvondo',
    titre: 'm',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Plombier et installateur sanitaire',
      ville: 'Garoua',
      pays: 'CM',
      accroche: 'Dépannage et installation sanitaire, devis gratuit.',
      publiee: true,
    },
    suspension: 'Signalements répétés de contenu trompeur (données de démonstration).',
  },
  {
    slug: 'bloquee',
    libelle: '11. Vitrine BLOQUÉE par l’administration (compte actif)',
    ou: 'Vitrines (bloquées) ; Utilisateurs (vitrine : bloquée)',
    prenom: 'Léopold',
    nom: 'Njoya',
    titre: 'm',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Conseiller en placements financiers',
      ville: 'Bamenda',
      pays: 'CM',
      accroche: 'Faites fructifier votre épargne en toute simplicité.',
      publiee: true,
      blocageMotif: 'Promesses de rendement garanti non conformes aux conditions d’utilisation (démonstration).',
    },
  },
  {
    slug: 'attente',
    libelle: '12. Paiement en attente (ouvert, récent)',
    ou: 'Paiements (en attente, il y a 5 minutes) ; pas d’alerte avant 60 min',
    prenom: 'Estelle',
    nom: 'Biyong',
    titre: 'mme',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Esthéticienne',
      ville: 'Kribi',
      pays: 'CM',
      accroche: 'Soins du visage et du corps face à l’océan.',
      publiee: true,
    },
    paiements: [{ suffixe: '1', statut: 'en_attente', source: 'kpay', periodeMois: 1, ageMs: PAIEMENT_ATTENTE_AGE_MS }],
  },
  {
    slug: 'anomalie',
    libelle: '13. Paiement en ANOMALIE (montant incohérent)',
    ou: 'Paiements (anomalie, MONTANT_INCOHERENT) ; détail avec événement',
    prenom: 'Yannick',
    nom: 'Tagne',
    titre: 'm',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Développeur web indépendant',
      ville: 'Douala',
      pays: 'CM',
      accroche: 'Sites vitrines et boutiques en ligne pour les entrepreneurs.',
      publiee: true,
    },
    paiements: [
      { suffixe: '1', statut: 'anomalie', source: 'kpay', periodeMois: 1, ageMs: jours(3), codeEchec: CODE_ANOMALIE_MONTANT },
    ],
  },
  {
    slug: 'manuel',
    libelle: '14. Paiement marqué manuellement (remplace une anomalie)',
    ou: 'Paiements (source manuel + original anomalie REMPLACE_PAR_MANUEL) ; Utilisateurs (payant)',
    prenom: 'Flore',
    nom: 'Ebogo',
    titre: 'mme',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Traductrice français-anglais',
      ville: 'Yaoundé',
      pays: 'CM',
      accroche: 'Traductions certifiées et relecture de documents professionnels.',
      publiee: true,
    },
    abonnement: { origine: 'paiement', expireDansJours: 28 },
    paiements: [
      { suffixe: '1', statut: 'anomalie', source: 'kpay', periodeMois: 1, ageMs: jours(5), codeEchec: CODE_ANOMALIE_REMPLACE_PAR_MANUEL },
      { suffixe: '2', statut: 'reussi', source: 'manuel', periodeMois: 1, ageMs: jours(2) },
    ],
  },
  {
    slug: 'assistant',
    libelle: '15. Assistant connecté (consentement OAuth)',
    ou: 'Fiche utilisateur (assistants connectés)',
    prenom: 'Aïcha',
    nom: 'Hamadou',
    titre: 'dr',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Pédiatre',
      ville: 'Maroua',
      pays: 'CM',
      accroche: 'Le suivi de la santé de vos enfants, de la naissance à l’adolescence.',
      publiee: true,
    },
    extra: 'assistant',
  },
  {
    slug: 'visiteurs',
    libelle: '16. Réservations, demandes et messages reçus',
    ou: 'Fiche utilisateur (activité 30 jours : nombres seulement)',
    prenom: 'Christian',
    nom: 'Owona',
    titre: 'm',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Kinésithérapeute',
      ville: 'Douala',
      pays: 'CM',
      accroche: 'Rééducation, massages thérapeutiques et soins du dos.',
      publiee: true,
    },
    extra: 'visiteurs',
  },
  {
    slug: 'sans-contact',
    libelle: '17. Sans e-mail de contact ni téléphone',
    ou: 'Fiche utilisateur et vitrine (champs de contact vides)',
    prenom: 'Pauline',
    nom: 'Meka',
    titre: 'mme',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Couturière',
      ville: 'Limbé',
      pays: 'CM',
      accroche: 'Robes, pagnes et tenues sur mesure.',
      publiee: true,
      sansContact: true,
    },
  },
  {
    slug: 'nom-tres-long',
    libelle: '18. Nom, métier et ville très longs (troncature à 390 px)',
    ou: 'Toutes les listes (test de troncature mobile)',
    prenom: 'Jean-Baptiste Emmanuel Alexandre',
    nom: 'Nkouandou-Mbarga Tchoumi Etoundi Ngah-Ondoua',
    titre: 'pr',
    devise: 'XAF',
    fuseau: FUSEAU_DOUALA,
    vitrine: {
      metier: 'Consultant en transformation numérique des PME et coopératives',
      ville: 'Saint-Pierre de Nkolbisson, Yaoundé VII, région du Centre',
      pays: 'CM',
      accroche: 'Accompagnement des petites entreprises et des coopératives agricoles de l’Ouest vers le numérique.',
      publiee: true,
    },
  },
]

// ---------------------------------------------------------------------------------------------
// Identifiants et petits utilitaires
// ---------------------------------------------------------------------------------------------

const emailDe = (slug: string): string => `${PREFIXE_DEMO}${slug}@${DOMAINE_DEMO}`
const userIdDe = (slug: string): string => `${PREFIXE_DEMO}${slug}`
const usernameDe = (slug: string): string => `${PREFIXE_DEMO}${slug}`
const paiementIdDe = (slug: string, suffixe: string): string => `${PREFIXE_DEMO}pay-${slug}-${suffixe}`
const transactionDe = (slug: string, suffixe: string): string => `${PREFIXE_DEMO}tx-${slug}-${suffixe}`
const apres = (date: Date, ms: number): Date => new Date(date.getTime() + ms)

function empreinte(cle: string): string {
  return createHash('sha256').update(`${PREFIXE_DEMO}${cle}`).digest('hex')
}

/** UUID v4 STABLE dérivé d'une clé : le studio valide les `[id]` en uuid, et le jeu reste identique d'un lancement à l'autre. */
function idStable(cle: string): string {
  const h = empreinte(cle)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${UUID_VERSION}${h.slice(13, 16)}-${UUID_VARIANTE}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

/** Numéro INVENTÉ (non attribuable : zéros) et distinct par rang. */
function telephoneInvente(rang: number): string {
  return `+${TELEPHONE_BASE + rang}`
}

const jourIso = (date: Date): string => date.toISOString().slice(0, 10)
const minuitUtc = (date: Date): Date => new Date(`${jourIso(date)}T00:00:00.000Z`)

/** Garde-fous sur le jeu lui-même : bornes de l'application et unicité, vérifiées AVANT toute écriture. */
function verifierJeu(): void {
  const slugs = new Set<string>()
  for (const cas of CAS) {
    if (slugs.has(cas.slug)) throw new RangeError(`cas en double : ${cas.slug}`)
    slugs.add(cas.slug)
    if (cas.prenom.length > PRENOM_MAX || cas.nom.length > NOM_MAX) throw new RangeError(`nom trop long : ${cas.slug}`)
    if (cas.vitrine !== null) {
      if (usernameDe(cas.slug).length > USERNAME_MAX) throw new RangeError(`username trop long : ${cas.slug}`)
      if (cas.vitrine.metier.length > METIER_MAX || cas.vitrine.ville.length > VILLE_MAX) throw new RangeError(`champ trop long : ${cas.slug}`)
    }
    for (const paiement of cas.paiements ?? []) {
      if (cas.abonnement?.origine === 'offert') throw new RangeError(`un abonnement offert n'a pas de paiement : ${cas.slug}`)
      if (paiement.statut === 'reussi' && cas.abonnement === undefined) throw new RangeError(`paiement réussi sans abonnement : ${cas.slug}`)
    }
    if (cas.abonnement !== undefined && !ABONNEMENT_ORIGINES.includes(cas.abonnement.origine)) {
      throw new RangeError(`origine inconnue : ${cas.slug}`)
    }
    const aReussi = (cas.paiements ?? []).some((paiement) => paiement.statut === 'reussi')
    if (cas.abonnement?.origine === 'paiement' && !aReussi) throw new RangeError(`abonnement payé sans paiement réussi : ${cas.slug}`)
  }
}

// ---------------------------------------------------------------------------------------------
// Nettoyage (supprimer puis recréer)
// ---------------------------------------------------------------------------------------------

/**
 * Supprime les comptes de démonstration NON superadmin (un par transaction), leurs paiements (qui survivent au compte :
 * `user_id` passe à NULL, y compris les paiements manuels créés par l'administration pendant les essais) et les restes
 * orphelins identifiés par le préfixe. Retourne le nombre de comptes supprimés.
 */
async function supprimerDonneesDemo(): Promise<number> {
  const protegees = await db
    .select({ email: users.email })
    .from(users)
    .where(and(like(users.email, MOTIF_EMAIL_DEMO), eq(users.role, SUPERADMIN)))
  const reservees = new Set(CAS.map((cas) => emailDe(cas.slug)))
  if (protegees.some((ligne) => reservees.has(ligne.email))) {
    throw new Error('Un compte superadmin porte l’adresse d’un cas de démonstration : renommez-le avant de relancer.')
  }

  const existants = await db
    .select({ id: users.id })
    .from(users)
    .where(and(like(users.email, MOTIF_EMAIL_DEMO), ne(users.role, SUPERADMIN)))
  for (const compte of existants) {
    await db.transaction(async (tx: TransactionCompte) => {
      await tx.delete(paiements).where(eq(paiements.userId, compte.id))
      await supprimerCompteDansTransaction(tx, compte.id)
    })
    await supprimerFichiersDuCompte(compte.id)
  }

  await db.transaction(async (tx) => {
    await tx.delete(evenementsPaiement).where(like(evenementsPaiement.idTransaction, MOTIF_ID_DEMO))
    await tx.delete(paiements).where(like(paiements.id, MOTIF_ID_DEMO))
    await tx.delete(oauthClients).where(like(oauthClients.clientId, MOTIF_ID_DEMO))
  })
  return existants.length
}

// ---------------------------------------------------------------------------------------------
// Création d'un compte (une transaction)
// ---------------------------------------------------------------------------------------------

type PaiementInsert = typeof paiements.$inferInsert
type EvenementInsert = typeof evenementsPaiement.$inferInsert

interface PaiementConstruit {
  paiement: PaiementInsert
  evenement: EvenementInsert | null
  appliqueLe: Date | null
}

function construirePaiement(
  cas: CasDemo,
  demo: PaiementDemo,
  maintenant: Date,
  expireLe: Date | null,
): PaiementConstruit {
  const id = paiementIdDe(cas.slug, demo.suffixe)
  const creeLe = new Date(maintenant.getTime() - demo.ageMs)
  const manuel = demo.source === 'manuel'
  const ouvert = demo.statut === 'en_attente'
  const reussi = demo.statut === 'reussi'
  const montantPlan = PRIX_PLANS.payant[cas.devise][demo.periodeMois]
  const taux = manuel ? 0 : FRAIS_TAUX_PB
  const { montant, frais, net } = calculerMontants({ prixPlan: montantPlan, tauxPb: taux, supporteur: FRAIS_SUPPORTEUR })
  const appliqueLe = reussi ? apres(creeLe, DELAI_APPLICATION_MS) : null
  const termineLe = ouvert ? null : (appliqueLe ?? apres(creeLe, DELAI_ECHEC_MS))
  const mobile = cas.devise === 'XAF'
  const idTransaction = transactionDe(cas.slug, demo.suffixe)

  const paiement: PaiementInsert = {
    id,
    userId: userIdDe(cas.slug),
    fournisseur: manuel ? FOURNISSEUR_MANUEL : FOURNISSEUR_KPAY,
    methode: manuel ? METHODE_MANUEL : (mobile ? METHODE_MOBILE : METHODE_CARTE),
    operateur: !manuel && mobile ? OPERATEUR_MTN : null,
    environnement: ENVIRONNEMENT_PAIEMENT,
    idFournisseur: manuel ? null : idTransaction,
    referenceFournisseur: manuel ? `${PAIEMENT_REFERENCE_MANUEL_PREFIXE}${id}` : `${PREFIXE_DEMO}ref-${cas.slug}-${demo.suffixe}`,
    statut: demo.statut,
    plan: 'payant',
    periodeMois: demo.periodeMois,
    devise: cas.devise,
    montantPlan,
    montant,
    fraisTauxPb: taux,
    fraisSupporteur: FRAIS_SUPPORTEUR,
    fraisEstimes: frais,
    netEstime: net,
    telephoneMasque: !manuel && mobile ? TELEPHONE_PAYEUR_MASQUE : null,
    codeEchec: demo.codeEchec ?? null,
    initiationIncertaine: false,
    // Un paiement ouvert reste valide un jour et n'est PAS planifié pour la vérification du worker : il ne bouge pas seul.
    expireAvant: ouvert ? apres(maintenant, PAIEMENT_ATTENTE_VALIDITE_MS) : apres(creeLe, DELAI_APPLICATION_MS),
    prochaineVerification: null,
    appliqueLe,
    abonnementExpireAvant: null,
    abonnementExpireApres: reussi ? expireLe : null,
    termineLe,
    source: demo.source,
    createdAt: creeLe,
    updatedAt: termineLe ?? creeLe,
  }

  // Journal du fournisseur : un événement pour les paiements K-PAY terminés (sauf l'original remplacé, écrit par l'administration).
  const aEvenement = !manuel && !ouvert && demo.codeEchec !== CODE_ANOMALIE_REMPLACE_PAR_MANUEL
  const anomalie = demo.statut === 'anomalie'
  const evenement: EvenementInsert | null = aEvenement
    ? {
        id: idStable(`${cas.slug}:evt:${demo.suffixe}`),
        fournisseur: FOURNISSEUR_KPAY,
        evenement: demo.statut === 'echoue' ? EVENEMENT_ECHEC : EVENEMENT_REUSSI,
        source: 'webhook',
        idTransaction,
        paiementId: id,
        statutFournisseur: demo.statut === 'echoue' ? STATUT_FOURNISSEUR_ECHEC : STATUT_FOURNISSEUR_REUSSI,
        // Anomalie : le fournisseur annonce la moitié du montant attendu.
        montant: anomalie ? Math.floor(montant / 2) : montant,
        traitement: anomalie ? 'anomalie' : 'applique',
        motif: anomalie ? CODE_ANOMALIE_MONTANT : null,
        horodatageFournisseur: termineLe,
        recuLe: termineLe ?? creeLe,
      }
    : null
  return { paiement, evenement, appliqueLe }
}

async function creerAbonnementEtPaiements(tx: TransactionCompte, cas: CasDemo, maintenant: Date): Promise<void> {
  const expireLe = cas.abonnement === undefined ? null : apres(maintenant, jours(cas.abonnement.expireDansJours))
  const construits = (cas.paiements ?? []).map((demo) => construirePaiement(cas, demo, maintenant, expireLe))
  for (const { paiement, evenement } of construits) {
    await tx.insert(paiements).values(paiement)
    if (evenement !== null) await tx.insert(evenementsPaiement).values(evenement)
  }
  if (cas.abonnement === undefined || expireLe === null) return

  const reussis = construits.filter((c) => c.paiement.statut === 'reussi' && c.appliqueLe !== null)
  const premier = reussis[0]?.appliqueLe ?? null
  const dernier = reussis.at(-1)?.paiement.id ?? null
  await tx.insert(abonnements).values({
    id: `${PREFIXE_DEMO}abo-${cas.slug}`,
    userId: userIdDe(cas.slug),
    plan: 'payant',
    expireLe,
    premiereActivationLe: premier ?? maintenant,
    dernierPaiementId: dernier,
    origine: cas.abonnement.origine,
    createdAt: premier ?? maintenant,
    updatedAt: maintenant,
  })
}

async function creerVitrine(tx: TransactionCompte, cas: CasDemo, vitrine: VitrineDemo, rang: number, maintenant: Date): Promise<string> {
  const vitrineId = `${PREFIXE_DEMO}vitrine-${cas.slug}`
  const contact = vitrine.sansContact !== true
  const creeLe = apres(maintenant, -jours(DEPOT_CREATION_JOURS - rang * PAS_CREATION_JOURS))
  await tx.insert(vitrines).values({
    id: vitrineId,
    userId: userIdDe(cas.slug),
    username: usernameDe(cas.slug),
    titre: cas.titre,
    prenom: cas.prenom,
    nom: cas.nom,
    metier: vitrine.metier,
    ville: vitrine.ville,
    pays: vitrine.pays,
    accroche: vitrine.accroche,
    bio: `Vitrine de démonstration de l’administration (${cas.libelle}).`,
    emailContact: contact ? `${PREFIXE_DEMO}contact-${cas.slug}@${DOMAINE_DEMO}` : null,
    telephone: contact ? telephoneInvente(rang + 1) : null,
    whatsapp: contact ? telephoneInvente(rang + 1) : null,
    palette: PALETTES[rang % PALETTES.length],
    fuseau: cas.fuseau,
    publieeLe: vitrine.publiee ? apres(creeLe, jours(1)) : null,
    blocageAdmin: vitrine.blocageMotif !== undefined,
    blocageMotif: vitrine.blocageMotif ?? null,
    createdAt: creeLe,
    updatedAt: maintenant,
  })
  return vitrineId
}

interface ServicesCrees {
  gratuit: string
  seance: string | null
}

async function creerServices(tx: TransactionCompte, cas: CasDemo, vitrineId: string): Promise<ServicesCrees> {
  const gratuit = idStable(`${cas.slug}:svc:1`)
  await tx.insert(services).values({
    id: gratuit,
    vitrineId,
    slug: 'premier-echange',
    titre: 'Premier échange',
    description: 'Un premier contact pour faire connaissance et cerner votre besoin.',
    type: 'rdv',
    dureeMin: DUREE_PREMIER_ECHANGE_MIN,
    tarif: 'gratuit',
    ordre: 0,
  })
  if (cas.extra !== 'visiteurs') return { gratuit, seance: null }
  const seance = idStable(`${cas.slug}:svc:2`)
  await tx.insert(services).values({
    id: seance,
    vitrineId,
    slug: 'seance-de-readaptation',
    titre: 'Séance de rééducation',
    description: 'Une séance individuelle de rééducation, au cabinet.',
    type: 'rdv',
    dureeMin: DUREE_SEANCE_MIN,
    tarif: 'payant',
    prixMontant: PRIX_SEANCE_XAF,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    ordre: 1,
  })
  return { gratuit, seance }
}

/** Réservations (jamais deux actives sur un même créneau : la contrainte d'exclusion les refuserait), demande, messages, vues. */
async function creerActiviteVisiteurs(tx: TransactionCompte, cas: CasDemo, vitrineId: string, svc: ServicesCrees, maintenant: Date): Promise<void> {
  const serviceSeance = svc.seance ?? svc.gratuit
  const base = minuitUtc(maintenant).getTime() + HEURE_RESERVATION_UTC * 60 * MINUTE_MS
  const modeles = [
    { cle: 'a', decalage: 1, statut: 'en_attente', motif: null },
    { cle: 'b', decalage: 2, statut: 'confirmee', motif: null },
    { cle: 'c', decalage: 3, statut: 'annulee', motif: 'Annulée par le visiteur (donnée de démonstration).' },
    { cle: 'd', decalage: -3, statut: 'terminee', motif: null },
  ] as const
  for (const [index, modele] of modeles.entries()) {
    const debut = new Date(base + jours(modele.decalage))
    await tx.insert(reservations).values({
      id: idStable(`${cas.slug}:resa:${modele.cle}`),
      vitrineId,
      serviceId: serviceSeance,
      nom: `Visiteur Démonstration ${modele.cle.toUpperCase()}`,
      email: `visiteur-demo-${modele.cle}@${DOMAINE_DEMO}`,
      telephone: telephoneInvente(100 + index),
      motifAnnulation: modele.motif,
      debut,
      fin: apres(debut, DUREE_SEANCE_MIN * MINUTE_MS),
      statut: modele.statut,
      confirmationTokenHash: empreinte(`${cas.slug}:resa-jeton:${modele.cle}`),
      confirmationExpireLe: debut,
    })
  }
  await tx.insert(demandes).values({
    id: idStable(`${cas.slug}:demande:a`),
    vitrineId,
    serviceId: svc.gratuit,
    nom: 'Visiteur Démonstration E',
    email: `visiteur-demo-e@${DOMAINE_DEMO}`,
    telephone: telephoneInvente(110),
    message: 'Demande de démonstration : texte générique, aucune donnée réelle.',
  })
  const sujets = ['question_avant_reservation', 'demande_information', 'autre'] as const
  for (const [index, sujet] of sujets.entries()) {
    await tx.insert(messages).values({
      id: idStable(`${cas.slug}:message:${index}`),
      vitrineId,
      nom: `Visiteur Démonstration ${String.fromCharCode('F'.charCodeAt(0) + index)}`,
      email: `visiteur-demo-${String.fromCharCode('f'.charCodeAt(0) + index)}@${DOMAINE_DEMO}`,
      telephone: index === 0 ? null : telephoneInvente(120 + index),
      sujet,
      message: 'Message de démonstration : texte générique, aucune donnée réelle.',
      luLe: index === sujets.length - 1 ? apres(maintenant, -JOUR_MS) : null,
    })
  }
  const sources = ['google', 'direct', 'whatsapp', 'google', 'direct', 'facebook'] as const
  for (const [index, source] of sources.entries()) {
    await tx.insert(vues).values({
      id: idStable(`${cas.slug}:vue:${index}`),
      vitrineId,
      jour: jourIso(apres(maintenant, -jours(index))),
      empreinte: empreinte(`${cas.slug}:vue-visiteur:${index}`),
      pageType: 'accueil',
      source,
      appareil: 'mobile',
      pays: 'CM',
    })
  }
}

async function creerAssistant(tx: TransactionCompte, cas: CasDemo, maintenant: Date): Promise<void> {
  const userId = userIdDe(cas.slug)
  await tx.insert(oauthClients).values({
    id: CLIENT_OAUTH_LIGNE_ID,
    clientId: CLIENT_OAUTH_ID,
    name: 'Assistant de démonstration',
    redirectUris: [`https://${DOMAINE_DEMO}/rappel`],
    tokenEndpointAuthMethod: 'none',
    grantTypes: ['authorization_code', 'refresh_token'],
    responseTypes: ['code'],
    disabled: false,
  })
  await tx.insert(oauthConsents).values({
    id: CONSENTEMENT_ID,
    clientId: CLIENT_OAUTH_ID,
    userId,
    scopes: PORTEES_ASSISTANT,
    createdAt: apres(maintenant, -jours(7)),
    updatedAt: apres(maintenant, -jours(7)),
  })
  await tx.insert(journalAssistant).values({
    id: idStable(`${cas.slug}:journal:1`),
    userId,
    assistantId: CLIENT_OAUTH_ID,
    outil: 'lire_vitrine',
    argumentsResume: {},
    resultat: { ok: true },
    createdAt: apres(maintenant, -jours(2)),
  })
}

async function creerCompte(cas: CasDemo, rang: number, maintenant: Date): Promise<void> {
  await db.transaction(async (tx: TransactionCompte) => {
    const userId = userIdDe(cas.slug)
    const creeLe = apres(maintenant, -jours(DEPOT_CREATION_JOURS - rang * PAS_CREATION_JOURS))
    const contact = cas.vitrine?.sansContact !== true
    await tx.insert(users).values({
      id: userId,
      name: `${cas.prenom} ${cas.nom}`,
      email: emailDe(cas.slug),
      emailVerified: true,
      phoneNumber: contact ? telephoneInvente(rang + 1) : null,
      phoneNumberVerified: contact,
      nom: cas.nom,
      locale: 'fr',
      devise: cas.devise,
      fuseau: cas.fuseau,
      role: 'user',
      banned: cas.suspension !== undefined,
      banReason: cas.suspension ?? null,
      createdAt: creeLe,
      updatedAt: maintenant,
    })
    // Paiements puis abonnement (la clé étrangère `dernier_paiement_id` exige que le paiement existe).
    await creerAbonnementEtPaiements(tx, cas, maintenant)
    if (cas.vitrine === null) return
    const vitrineId = await creerVitrine(tx, cas, cas.vitrine, rang, maintenant)
    const svc = await creerServices(tx, cas, vitrineId)
    if (cas.extra === 'visiteurs') await creerActiviteVisiteurs(tx, cas, vitrineId, svc, maintenant)
    if (cas.extra === 'assistant') await creerAssistant(tx, cas, maintenant)
  })
}

// ---------------------------------------------------------------------------------------------
// Programme
// ---------------------------------------------------------------------------------------------

/** Nom de l'erreur, et pour une erreur PostgreSQL le code et la contrainte (jamais la requête ni ses valeurs). */
function decrire(error: unknown): string {
  const nom = error instanceof Error ? error.name : 'erreur inconnue'
  const cause: unknown = error instanceof Error ? error.cause : undefined
  if (typeof cause === 'object' && cause !== null) {
    const code = 'code' in cause && typeof cause.code === 'string' ? ` code ${cause.code}` : ''
    const contrainte = 'constraint' in cause && typeof cause.constraint === 'string' ? ` contrainte ${cause.constraint}` : ''
    return `${nom}${code}${contrainte}`
  }
  return error instanceof Error && error.message.startsWith('Un compte superadmin') ? error.message : nom
}

const lecture = z.tuple([]).safeParse(process.argv.slice(2))
if (!lecture.success) {
  console.error(`Arguments invalides.\n${USAGE}`)
  process.exit(1)
}
if (env.NODE_ENV === 'production') {
  console.error('Refusé : les données de démonstration ne se créent jamais en production.')
  process.exit(1)
}

try {
  verifierJeu()
  const maintenant = new Date()
  const supprimes = await supprimerDonneesDemo()
  for (const [rang, cas] of CAS.entries()) {
    await creerCompte(cas, rang, maintenant)
  }
  console.info(`Données de démonstration : ${supprimes} compte(s) remplacé(s), ${CAS.length} créé(s). Aucun mot de passe (connexion par code).`)
  console.info(`${'Cas'.padEnd(66)} Compte`)
  for (const cas of CAS) console.info(`${cas.libelle.padEnd(66)} ${emailDe(cas.slug)}`)
  process.exit(0)
} catch (error) {
  console.error(`Échec de la commande (${decrire(error)}).`)
  process.exit(1)
}
