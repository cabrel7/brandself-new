import { createHmac, hkdfSync, randomUUID } from 'node:crypto'
import { Temporal } from '@js-temporal/polyfill'
import { and, count, eq, gt, gte, inArray, isNotNull, isNull } from 'drizzle-orm'
import { TEMP_EMAIL_DOMAIN } from '../../shared/compte'
import { abonnements, essais, essaisEmpreintes, users } from '../../shared/db/schema'
import {
  ESSAI_EMAIL_ENTITE_TYPE,
  ESSAI_EMPREINTE_HKDF_INFO,
  ESSAI_STATISTIQUES_JOURS,
} from '../../shared/essai'
import type { EssaiDTO, EssaiEmailType, EssaiEmpreinteNature, RaisonRefusEssai } from '../../shared/essai'
import { env } from '../../shared/env'
import { isValidTimeZone } from '../../shared/fuseau'
import type { EssaisStatistiquesDto } from '../../shared/schemas/admin-paiements'
import { ABONNEMENT_FUSEAU_REPLI, ABONNEMENT_RAPPEL_HEURE_LOCALE } from '../../shared/plans'
import { db } from '../utils/db'
import { readPgError } from '../utils/pg-error'
import { offrirJours, verrouiller } from './abonnements-offrir'
import { lireConfigEssai } from './configuration/lecture'
import { insertScheduledEmailEvents } from './email-outbox'
import type { DbTransaction, ScheduledEmailEvent } from './email-outbox'
import { construireOccurrenceEssai } from './notifications/pertinence'

// E1 (docs/specs/E1-essai-gratuit.md D4, D6, D8, D11) : essai gratuit à la création de la vitrine, un par personne.
// Marqueur anti-abus = empreintes HMAC (aucune donnée en clair, aucune clé étrangère vers `users`), attribution atomique
// par `INSERT ... ON CONFLICT DO NOTHING RETURNING`. Aucun journal ne contient d'adresse, de numéro ni d'empreinte.

/** Longueur (octets) de la clé HMAC dérivée du secret dédié. */
const CLE_HMAC_OCTETS = 32
const MS_PAR_JOUR = 86_400_000
/** Pourcentage : taux de conversion entier de 0 à 100. */
const POURCENT = 100
const LOG_CONTEXTE = 'essai'
const ESSAI_EMAIL_TYPE_SERVICES: EssaiEmailType = 'abonnement_essai_services'
const ESSAI_EMAIL_TYPE_STATISTIQUES: EssaiEmailType = 'abonnement_essai_statistiques'
const CATEGORIE_EMAIL_ESSAI = 'relationnel'
const ORIGINE_ESSAI = 'essai'

/** Une clé d'unicité d'un compte : sa nature et son empreinte (64 caractères hexadécimaux minuscules). */
export interface CleEssai {
  nature: EssaiEmpreinteNature
  empreinte: string
}

/** Ce que `clesEssai` lit d'un compte. */
export interface CompteEssai {
  email: string
  phoneNumber: string | null
  phoneNumberVerified: boolean
}

export type ResultatEssai =
  | { accorde: true, essai: EssaiDTO }
  | { accorde: false, raison: RaisonRefusEssai }

/** Refus levé DANS le savepoint pour l'annuler (rien de ce qui a été écrit n'est conservé) ; jamais vers l'appelant. */
class RefusEssai extends Error {
  readonly raison: RaisonRefusEssai

  constructor(raison: RaisonRefusEssai) {
    super(raison)
    this.name = 'RefusEssai'
    this.raison = raison
  }
}

/** Domaines Gmail : mêmes boîtes (`googlemail.com` est l'ancien nom), points de la partie locale ignorés par Gmail. */
const DOMAINE_GMAIL = 'gmail.com'
const DOMAINES_GMAIL: readonly string[] = [DOMAINE_GMAIL, 'googlemail.com']
const SEPARATEUR_ALIAS = '+'

/**
 * E-mail : `trim().toLowerCase()`, puis les alias qui ne créent pas une autre boîte : `+tag` retiré de la partie locale
 * (tous domaines), et pour Gmail les points retirés et `googlemail.com` ramené à `gmail.com` (anti-abus : une personne ne
 * recrée pas un essai avec `marie+2@…` ou `m.arie@gmail.com`). Idempotente. Limite assumée : un domaine propre qui
 * traiterait `+` autrement est tout de même ramené (un faux refus reste rare, un contournement facile est pire).
 */
function normaliserEmail(valeur: string): string {
  const brut = valeur.trim().toLowerCase()
  const arobase = brut.lastIndexOf('@')
  if (arobase <= 0) return brut
  let local = brut.slice(0, arobase)
  let domaine = brut.slice(arobase + 1)
  const alias = local.indexOf(SEPARATEUR_ALIAS)
  if (alias > 0) local = local.slice(0, alias)
  if (DOMAINES_GMAIL.includes(domaine)) {
    domaine = DOMAINE_GMAIL
    local = local.replaceAll('.', '')
  }
  return `${local}@${domaine}`
}

/** Numéro : chiffres seuls (`+237 6 12 34 56 78` et `237612345678` sont la même clé). */
function normaliserTelephone(valeur: string): string {
  return valeur.replace(/\D/g, '')
}

/** Clés HKDF déjà dérivées, par secret (le secret ne change pas pendant la vie du processus : une entrée en pratique). */
const clesHmacMemo = new Map<string, Buffer>()

function cleHmac(secret: string): Buffer {
  const connue = clesHmacMemo.get(secret)
  if (connue !== undefined) return connue
  const cle = Buffer.from(hkdfSync('sha256', secret, '', ESSAI_EMPREINTE_HKDF_INFO, CLE_HMAC_OCTETS))
  clesHmacMemo.set(secret, cle)
  return cle
}

function normaliser(nature: EssaiEmpreinteNature, valeur: string): string {
  return nature === 'email' ? normaliserEmail(valeur) : normaliserTelephone(valeur)
}

/**
 * Empreinte d'une clé : HMAC-SHA256 (hexadécimal minuscule) de `<nature>:<valeur normalisée>` sur une clé HKDF dérivée du
 * secret DÉDIÉ (`ESSAI_EMPREINTE_SECRET`, jamais le secret d'authentification). PURE : le secret est un argument.
 * La valeur est normalisée ici (casse, espaces, alias d'e-mail, non-chiffres) : deux écritures de la même clé donnent la même empreinte.
 */
export function empreinteEssai(nature: EssaiEmpreinteNature, valeur: string, secret: string = env.ESSAI_EMPREINTE_SECRET): string {
  return createHmac('sha256', cleHmac(secret)).update(`${nature}:${normaliser(nature, valeur)}`).digest('hex')
}

/**
 * Clés d'unicité d'un compte (PURE) : l'e-mail, sauf s'il est temporaire (compte créé par téléphone : `@TEMP_EMAIL_DOMAIN`),
 * et le numéro, seulement s'il est VÉRIFIÉ (un numéro non vérifié n'est pas une preuve d'identité) et non vide.
 * Sans doublon ; au moins zéro, au plus deux clés.
 */
export function clesEssai(compte: CompteEssai, secret: string = env.ESSAI_EMPREINTE_SECRET): CleEssai[] {
  const cles: CleEssai[] = []
  const email = normaliserEmail(compte.email)
  if (email !== '' && !email.endsWith(`@${TEMP_EMAIL_DOMAIN}`)) {
    cles.push({ nature: 'email', empreinte: empreinteEssai('email', email, secret) })
  }
  if (compte.phoneNumberVerified && compte.phoneNumber !== null && normaliserTelephone(compte.phoneNumber) !== '') {
    cles.push({ nature: 'telephone', empreinte: empreinteEssai('telephone', compte.phoneNumber, secret) })
  }
  return cles
}

/**
 * Instant d'envoi d'une relance : `jour` jours civils après `now`, à 9 h dans le fuseau du compte (repli Africa/Douala si
 * le fuseau est invalide). PURE.
 */
export function instantRelance(now: Date, jour: number, fuseau: string): Date {
  const zone = isValidTimeZone(fuseau) ? fuseau : ABONNEMENT_FUSEAU_REPLI
  const date = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(zone).toPlainDate().add({ days: jour })
  const neuf = date.toZonedDateTime({ timeZone: zone, plainTime: Temporal.PlainTime.from({ hour: ABONNEMENT_RAPPEL_HEURE_LOCALE }) })
  return new Date(neuf.epochMilliseconds)
}

function evenementsRelance(abonnementId: string, finLe: Date, now: Date, fuseau: string, jours: { services: number, statistiques: number }): ScheduledEmailEvent[] {
  const commun = {
    entiteType: ESSAI_EMAIL_ENTITE_TYPE,
    entiteId: abonnementId,
    occurrence: construireOccurrenceEssai(finLe),
    categorie: CATEGORIE_EMAIL_ESSAI,
    creeLe: now,
  } as const
  return [
    { ...commun, type: ESSAI_EMAIL_TYPE_SERVICES, prochaineTentative: instantRelance(now, jours.services, fuseau) },
    { ...commun, type: ESSAI_EMAIL_TYPE_STATISTIQUES, prochaineTentative: instantRelance(now, jours.statistiques, fuseau) },
  ]
}

/** Écrit l'essai dans le savepoint ; lève `RefusEssai` pour tout refus (D6, dans l'ordre de contrôle). */
async function accorder(tx: DbTransaction, userId: string, now: Date): Promise<EssaiDTO> {
  await verrouiller(tx, userId)

  const config = await lireConfigEssai({ sansCache: true, lecteur: tx })
  if (!config.actif) throw new RefusEssai('desactive')

  const [abonnement] = await tx.select({ id: abonnements.id }).from(abonnements).where(eq(abonnements.userId, userId)).limit(1)
  if (abonnement !== undefined) throw new RefusEssai('abonnement_existant')

  const [dejaEssai] = await tx.select({ id: essais.id }).from(essais).where(eq(essais.userId, userId)).limit(1)
  if (dejaEssai !== undefined) throw new RefusEssai('essai_existant')

  const [compte] = await tx
    .select({ email: users.email, phoneNumber: users.phoneNumber, phoneNumberVerified: users.phoneNumberVerified, fuseau: users.fuseau })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (compte === undefined) throw new RefusEssai('aucune_cle')
  // Triées : deux comptes concurrents posent leurs clés dans le même ordre (pas d'interblocage sur l'index unique).
  const cles = clesEssai(compte).sort((a, b) => (a.empreinte < b.empreinte ? -1 : a.empreinte > b.empreinte ? 1 : 0))
  if (cles.length === 0) throw new RefusEssai('aucune_cle')

  const [existante] = await tx
    .select({ empreinte: essaisEmpreintes.empreinte })
    .from(essaisEmpreintes)
    .where(inArray(essaisEmpreintes.empreinte, cles.map((cle) => cle.empreinte)))
    .limit(1)
  if (existante !== undefined) throw new RefusEssai('deja_consomme')

  const offre = await offrirJours(tx, userId, config.dureeJours, now, ORIGINE_ESSAI)
  const finLe = offre.apres.expireLe
  const essaiId = randomUUID()
  await tx.insert(essais).values({
    id: essaiId,
    userId,
    debutLe: now,
    finLe,
    dureeJours: config.dureeJours,
    versionId: config.versionId,
  })
  // Atomique : une clé prise entre-temps par un compte concurrent (même numéro) manque dans RETURNING, et le savepoint
  // entier (abonnement, essai, clés déjà posées) est annulé : aucune empreinte orpheline.
  const posees = await tx
    .insert(essaisEmpreintes)
    .values(cles.map((cle) => ({ empreinte: cle.empreinte, nature: cle.nature, essaiId })))
    .onConflictDoNothing({ target: essaisEmpreintes.empreinte })
    .returning({ empreinte: essaisEmpreintes.empreinte })
  if (posees.length < cles.length) throw new RefusEssai('deja_consomme')

  await insertScheduledEmailEvents(
    tx,
    evenementsRelance(offre.abonnementId, finLe, now, compte.fuseau, {
      services: config.relanceServicesJour,
      statistiques: config.relanceStatistiquesJour,
    }),
  )
  return { finLe: finLe.toISOString(), dureeJours: config.dureeJours }
}

/**
 * Accorde l'essai gratuit à la création de la vitrine (D1, D6), dans la transaction de l'appelant. S'exécute dans un
 * SAVEPOINT : un refus ou une panne annule seulement l'essai, jamais la vitrine ni ses services. NE LÈVE JAMAIS vers
 * l'appelant (`raison = 'erreur'` en cas de panne, journalisée sans donnée personnelle).
 */
export async function accorderEssaiSiEligible(tx: DbTransaction, userId: string, now: Date): Promise<ResultatEssai> {
  try {
    const essai = await tx.transaction((savepoint) => accorder(savepoint, userId, now))
    return { accorde: true, essai }
  } catch (erreur) {
    if (erreur instanceof RefusEssai) return { accorde: false, raison: erreur.raison }
    // Ni message ni cause : une erreur de base peut citer une valeur (adresse, empreinte). Seuls le code SQLSTATE et le
    // nom de la contrainte (identifiants du schéma, jamais une valeur) sont ajoutés, pour diagnostiquer une panne.
    const pg = readPgError(erreur)
    console.error({ contexte: LOG_CONTEXTE, evenement: 'octroi_impossible', code: pg.code ?? null, contrainte: pg.constraint ?? null })
    return { accorde: false, raison: 'erreur' }
  }
}

/**
 * Indicateur de conversions de l'administration (D11) sur `jours` jours glissants : essais accordés dans la fenêtre,
 * parmi eux ceux encore en cours et ceux convertis (`converti_le` renseigné, même si le compte a été supprimé depuis).
 * `tauxPct` = convertis / accordés, entier arrondi de 0 à 100 ; `null` si aucun essai accordé.
 */
export async function statistiquesEssais(now: Date, jours: number = ESSAI_STATISTIQUES_JOURS): Promise<EssaisStatistiquesDto> {
  const depuis = new Date(now.getTime() - jours * MS_PAR_JOUR)
  const dansFenetre = gte(essais.debutLe, depuis)
  const [accordes, enCours, convertis] = await Promise.all([
    db.select({ total: count() }).from(essais).where(dansFenetre),
    db.select({ total: count() }).from(essais).where(and(dansFenetre, gt(essais.finLe, now), isNull(essais.convertiLe))),
    db.select({ total: count() }).from(essais).where(and(dansFenetre, isNotNull(essais.convertiLe))),
  ])
  const nbAccordes = accordes[0]?.total ?? 0
  const nbConvertis = convertis[0]?.total ?? 0
  return {
    jours,
    accordes: nbAccordes,
    enCours: enCours[0]?.total ?? 0,
    convertis: nbConvertis,
    tauxPct: nbAccordes === 0 ? null : Math.round((nbConvertis * POURCENT) / nbAccordes),
  }
}
