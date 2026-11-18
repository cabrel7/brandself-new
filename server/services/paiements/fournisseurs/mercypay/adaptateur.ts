import {
  CODE_ECHEC_FORMAT,
  CODE_ECHEC_REQUETE_REFUSEE,
  DEVISE_FORMAT,
} from '../../../../../shared/paiements'
import type { PaiementEnvironnement } from '../../../../../shared/paiements'
import { FournisseurIndisponibleError } from '../../types'
import type {
  EtatFournisseur,
  EvenementNormalise,
  InitiationRequete,
  InitiationResultat,
  PaiementProvider,
  StatutFournisseur,
} from '../../types'
import { MercyTransportError, creerClientMercy } from './client'
import type { OptionsClientMercy, ReponseMercy } from './client'
import {
  MERCY_CHEMIN_PAIEMENTS,
  MERCY_CODE_ECHEC_FORMAT,
  MERCY_CODES_ECHEC,
  MERCY_DELAI_CONSULTATION_MS,
  MERCY_DELAI_INITIATION_MS,
  MERCY_DESCRIPTION,
  MERCY_DESCRIPTION_MARQUEUR,
  MERCY_DESCRIPTION_MAX,
  MERCY_EVENEMENT_PREFIXE_PAIEMENT,
  MERCY_EVENEMENTS,
  MERCY_HTTP,
  MERCY_METADATA_PAIEMENT_ID,
  MERCY_METHODE_MOBILE_MONEY,
  MERCY_OPERATEUR_PAYS_FORMAT,
  MERCY_RECHERCHE_LIMITE,
  MERCY_RECHERCHE_PAGES_MAX,
  MERCY_STATUTS,
  MERCY_TELEPHONE_FORMAT,
} from './constantes'
import type { MercyObjetPaiement } from './schemas'
import {
  schemaMercyEvenement,
  schemaMercyListePaiements,
  schemaMercyPaiementEvenement,
  schemaMercyReponsePaiement,
} from './schemas'
import { lireEnteteSignatureMercy, verifierSignatureMercy } from './signature'

// P1 (docs/specs/P1-mercypay.md §4.2) : adaptateur Mercy Pay de l'interface `PaiementProvider` (mobile money push, MTN et
// Orange). Il ne journalise JAMAIS : ni clé, ni numéro, ni corps de réponse. Les codes d'issue suffisent à l'appelant. Les
// textes de Mercy Pay ne sont jamais relayés à l'utilisateur.

export interface OptionsMercyPayProvider extends Pick<OptionsClientMercy, 'baseUrl' | 'cleApi' | 'fetch'> {
  environnement: PaiementEnvironnement
  /** Secret de signature des webhooks ; absent = tout webhook est refusé (401 côté route). */
  secretWebhook?: string
  /** Réglages de délai (tests) ; défaut : constantes Mercy Pay. */
  delaiInitiationMs?: number
  delaiConsultationMs?: number
}

/** Statut Mercy Pay -> statut normalisé ; `null` si le statut n'est pas connu (traité comme non terminal par l'appelant). */
export function normaliserStatutMercy(statut: string): StatutFournisseur | null {
  switch (statut.toLowerCase()) {
    case MERCY_STATUTS.reussi:
      return 'reussi'
    case MERCY_STATUTS.echoue:
      return 'echoue'
    case MERCY_STATUTS.rembourse:
      return 'rembourse'
    case MERCY_STATUTS.enAttente:
      return 'en_attente'
    default:
      return null
  }
}

/** `failure_code` Mercy Pay -> notre code (table puis MAJUSCULES) ; `null` si absent ou de forme inattendue (message par défaut). */
export function assainirCodeEchecMercy(valeur: string | null | undefined): string | null {
  if (valeur === null || valeur === undefined || !MERCY_CODE_ECHEC_FORMAT.test(valeur)) return null
  // `hasOwn` : un code venu du fournisseur ne doit jamais atteindre le prototype (`__proto__`).
  const code = Object.hasOwn(MERCY_CODES_ECHEC, valeur) ? (MERCY_CODES_ECHEC[valeur] ?? '') : valeur.toUpperCase()
  return CODE_ECHEC_FORMAT.test(code) ? code : null
}

/** Statut brut tel que journalisé (`^[A-Z_]{1,30}$`) ; `null` s'il n'a pas cette forme. */
function statutBrutMajuscules(statut: string | null | undefined): string | null {
  const brut = statut?.toUpperCase() ?? null
  return brut !== null && /^[A-Z_]{1,30}$/.test(brut) ? brut : null
}

/** Libellé envoyé à Mercy Pay pour une période d'abonnement (le registre des fournisseurs l'expose à l'initiation). */
export function decrireAbonnementMercy(periodeMois: number): string {
  return MERCY_DESCRIPTION.replace(MERCY_DESCRIPTION_MARQUEUR, String(periodeMois))
}

/** Le délai propre à l'appel s'ajoute au signal de l'appelant : le premier des deux qui expire interrompt la requête. */
function combinerDelai(signal: AbortSignal, delaiMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(delaiMs)])
}

function resultatIndisponible(reponse: ReponseMercy): InitiationResultat | null {
  if (reponse.statut === MERCY_HTTP.nonAutorise || reponse.statut === MERCY_HTTP.interdit) {
    return { issue: 'indisponible', code: 'AUTH' }
  }
  if (reponse.statut === MERCY_HTTP.limite) {
    return {
      issue: 'indisponible',
      code: 'LIMITE',
      ...(reponse.retryAfterS === null ? {} : { retryAfterS: reponse.retryAfterS }),
    }
  }
  if (reponse.statut >= MERCY_HTTP.erreurServeur) return { issue: 'indisponible', code: 'SERVEUR' }
  return null
}

function erreurConsultation(reponse: ReponseMercy): FournisseurIndisponibleError {
  if (reponse.statut === MERCY_HTTP.nonAutorise || reponse.statut === MERCY_HTTP.interdit) return new FournisseurIndisponibleError('AUTH')
  if (reponse.statut === MERCY_HTTP.limite) return new FournisseurIndisponibleError('LIMITE', reponse.retryAfterS)
  if (reponse.statut >= MERCY_HTTP.erreurServeur) return new FournisseurIndisponibleError('SERVEUR')
  return new FournisseurIndisponibleError('RESEAU')
}

/** Corps d'initiation, à l'ordre de clés FIXE : le même paiement donne le même corps octet pour octet (rejeu idempotent). */
function construireCorps(req: InitiationRequete, pays: string, telephone: string): string {
  return JSON.stringify({
    amount: req.montant,
    currency: req.devise,
    payment_method: MERCY_METHODE_MOBILE_MONEY,
    country: pays,
    provider: req.operateur,
    phone: telephone,
    description: req.description.slice(0, MERCY_DESCRIPTION_MAX),
    metadata: { [MERCY_METADATA_PAIEMENT_ID]: req.externalId },
  })
}

const MS_PAR_SECONDE = 1_000

/** `created` : date ISO 8601 (documentation) ou entier Unix en secondes ; illisible → `null`. */
function lireHorodatageMercy(created: string | number | null | undefined): Date | null {
  if (created === null || created === undefined) return null
  const date = typeof created === 'number' ? new Date(created * MS_PAR_SECONDE) : new Date(created)
  return Number.isNaN(date.getTime()) ? null : date
}

function paiementIdEnMetadata(data: MercyObjetPaiement): string | null {
  return data.metadata?.paiement_id ?? null
}

/** Objet paiement Mercy -> état normalisé. Statut inconnu : non terminal (le rapprochement réessaiera, rien n'est appliqué à tort). */
function versEtat(data: MercyObjetPaiement): EtatFournisseur {
  return {
    idFournisseur: data.id,
    statut: data.status === null || data.status === undefined ? 'en_attente' : (normaliserStatutMercy(data.status) ?? 'en_attente'),
    montant: data.amount,
    devise: data.currency ?? null,
    fraisReels: data.fee_amount ?? null,
    netReel: data.net_amount ?? null,
    codeEchec: assainirCodeEchecMercy(data.failure_code),
    referenceFournisseur: null,
    externalId: paiementIdEnMetadata(data),
    statutBrut: statutBrutMajuscules(data.status),
  }
}

export function creerMercyPayProvider(options: OptionsMercyPayProvider): PaiementProvider {
  const client = creerClientMercy(options)
  const delaiInitiation = options.delaiInitiationMs ?? MERCY_DELAI_INITIATION_MS
  const delaiConsultation = options.delaiConsultationMs ?? MERCY_DELAI_CONSULTATION_MS

  return {
    nom: 'mercypay',
    environnement: options.environnement,
    webhookConfigure: Boolean(options.secretWebhook),
    // Un secret non encore déclaré ne doit pas faire répondre 5xx : Mercy désactiverait l'endpoint (spec §4.4).
    webhookSansSecret: 'signature_invalide',

    async initier(req: InitiationRequete, signal: AbortSignal): Promise<InitiationResultat> {
      const pays = MERCY_OPERATEUR_PAYS_FORMAT.exec(req.operateur)?.[1]
      const telephone = req.telephoneInternational.replace(/[\s+]/g, '')
      // Montant entier strictement positif, devise, opérateur et numéro bien formés : sinon refus ICI, avant tout appel.
      if (
        !Number.isSafeInteger(req.montant)
        || req.montant <= 0
        || !DEVISE_FORMAT.test(req.devise)
        || pays === undefined
        || !MERCY_TELEPHONE_FORMAT.test(telephone)
      ) {
        return { issue: 'refuse', code: CODE_ECHEC_REQUETE_REFUSEE }
      }
      let reponse: ReponseMercy
      try {
        reponse = await client.post(
          MERCY_CHEMIN_PAIEMENTS,
          construireCorps(req, pays, telephone),
          req.externalId,
          combinerDelai(signal, delaiInitiation),
        )
      } catch (erreur) {
        return { issue: 'incertain', code: erreur instanceof MercyTransportError ? erreur.code : 'RESEAU' }
      }
      const panne = resultatIndisponible(reponse)
      if (panne) return panne
      // 409 (`idempotency_key_in_use`, ou clé déjà utilisée) : un paiement existe peut-être chez Mercy Pay.
      if (reponse.statut === MERCY_HTTP.doublon) return { issue: 'incertain', code: 'DOUBLON' }
      if (reponse.statut === MERCY_HTTP.requeteInvalide || reponse.statut === MERCY_HTTP.nonTraitable) {
        return { issue: 'refuse', code: CODE_ECHEC_REQUETE_REFUSEE }
      }
      if (reponse.statut < 200 || reponse.statut >= 300) return { issue: 'indisponible', code: 'SERVEUR' }
      const lue = schemaMercyReponsePaiement.safeParse(reponse.corps)
      if (!lue.success) return { issue: 'incertain', code: 'RESEAU' }
      const data = lue.data.data
      // Réponse incohérente avec ce que nous avons envoyé : on n'associe PAS cet identifiant à notre paiement.
      // Journal sans identifiant ni montant : le code seul.
      const idRenvoye = paiementIdEnMetadata(data)
      const incoherente = data.amount !== req.montant
        || (data.currency !== null && data.currency !== undefined && data.currency !== req.devise)
        || (idRenvoye !== null && idRenvoye !== req.externalId)
      if (incoherente) {
        console.error({ paiement: 'mercypay_initiation_reponse_incoherente', code: 'REPONSE_INCOHERENTE' })
        return { issue: 'incertain', code: 'RESEAU' }
      }
      return { issue: 'accepte', idFournisseur: data.id, referenceFournisseur: null, statutFournisseur: data.status }
    },

    async consulter(idFournisseur: string, signal: AbortSignal): Promise<EtatFournisseur | null> {
      let reponse: ReponseMercy
      try {
        reponse = await client.get(
          `${MERCY_CHEMIN_PAIEMENTS}/${encodeURIComponent(idFournisseur)}`,
          combinerDelai(signal, delaiConsultation),
        )
      } catch (erreur) {
        throw new FournisseurIndisponibleError(erreur instanceof MercyTransportError ? erreur.code : 'RESEAU')
      }
      if (reponse.statut === MERCY_HTTP.introuvable) return null
      if (reponse.statut < 200 || reponse.statut >= 300) throw erreurConsultation(reponse)
      const lue = schemaMercyReponsePaiement.safeParse(reponse.corps)
      if (!lue.success) throw new FournisseurIndisponibleError('RESEAU')
      const data = lue.data.data
      return versEtat(data)
    },

    async retrouver(externalId: string, depuis: Date, signal: AbortSignal): Promise<EtatFournisseur | null> {
      // Horodatage Unix (secondes) : le `+` d'un fuseau ISO 8601 aurait dû être encodé dans l'URL.
      const depuisS = Math.max(0, Math.floor(depuis.getTime() / MS_PAR_SECONDE))
      let curseur: string | null = null
      for (let page = 0; page < MERCY_RECHERCHE_PAGES_MAX; page += 1) {
        const requete: string = `${MERCY_CHEMIN_PAIEMENTS}?limit=${MERCY_RECHERCHE_LIMITE}&created[gte]=${depuisS}`
          + (curseur === null ? '' : `&starting_after=${encodeURIComponent(curseur)}`)
        let reponse: ReponseMercy
        try {
          reponse = await client.get(requete, combinerDelai(signal, delaiConsultation))
        } catch (erreur) {
          throw new FournisseurIndisponibleError(erreur instanceof MercyTransportError ? erreur.code : 'RESEAU')
        }
        if (reponse.statut < 200 || reponse.statut >= 300) throw erreurConsultation(reponse)
        const lue = schemaMercyListePaiements.safeParse(reponse.corps)
        if (!lue.success) throw new FournisseurIndisponibleError('RESEAU')
        // Rattachement par NOTRE identifiant seulement (jamais par montant ni par numéro de téléphone).
        const trouve = lue.data.data.find((p) => paiementIdEnMetadata(p) === externalId)
        if (trouve) return versEtat(trouve)
        if (lue.data.has_more !== true || !lue.data.next_cursor) return null
        curseur = lue.data.next_cursor
      }
      return null
    },

    verifierSignature(corpsBrut: Buffer, entetes: Readonly<Record<string, string | undefined>>, now: Date): boolean {
      return verifierSignatureMercy(corpsBrut, lireEnteteSignatureMercy(entetes), options.secretWebhook, now)
    },

    interpreterWebhook(corps: unknown): EvenementNormalise | null {
      const enveloppe = schemaMercyEvenement.safeParse(corps)
      if (!enveloppe.success) return null
      const { id, type, livemode, data } = enveloppe.data
      const environnement: PaiementEnvironnement = livemode ? 'live' : 'test'
      // Type hors paiement (`webhook.test`, `account.updated`, `provider_status.changed`…) : « autre », jamais `null`
      // (la route répondrait 503 et Mercy désactiverait l'endpoint). Il est identifié par son `evt_…`.
      if (!type.startsWith(MERCY_EVENEMENT_PREFIXE_PAIEMENT)) {
        return {
          evenement: type,
          idTransaction: id,
          externalId: null,
          statut: 'autre',
          montant: 0,
          devise: null,
          referenceFournisseur: null,
          horodatage: null,
          codeEchec: null,
          environnement,
        }
      }
      const paiement = schemaMercyPaiementEvenement.safeParse(data)
      if (!paiement.success) return null
      const p = paiement.data
      const statutPaiement = p.status === null || p.status === undefined ? null : normaliserStatutMercy(p.status)
      // Seuls `payment.succeeded` / `payment.failed` portant un statut COHÉRENT (ou aucun) sont des résultats ;
      // `payment.refunded` est journalisé en anomalie `REMBOURSE` ; tout le reste (statut contradictoire, autre `payment.*`) est « autre ».
      let statut: EvenementNormalise['statut'] = 'autre'
      if (type === MERCY_EVENEMENTS.reussi && (statutPaiement === 'reussi' || statutPaiement === null)) statut = 'reussi'
      else if (type === MERCY_EVENEMENTS.echoue && (statutPaiement === 'echoue' || statutPaiement === null)) statut = 'echoue'
      else if (type === MERCY_EVENEMENTS.rembourse) statut = 'rembourse'
      return {
        evenement: type,
        idTransaction: p.id,
        externalId: paiementIdEnMetadata(p),
        statut,
        montant: p.amount,
        devise: p.currency ?? null,
        referenceFournisseur: null,
        horodatage: lireHorodatageMercy(p.created),
        codeEchec: assainirCodeEchecMercy(p.failure_code),
        statutBrut: statutBrutMajuscules(p.status),
        fraisReels: p.fee_amount ?? null,
        netReel: p.net_amount ?? null,
        environnement,
      }
    },
  }
}
