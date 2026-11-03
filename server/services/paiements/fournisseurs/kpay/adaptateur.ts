import {
  CODE_ECHEC_FORMAT,
  CODE_ECHEC_REQUETE_REFUSEE,
  DEVISES_EXPOSANT,
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
import { KpayTransportError, creerClientKpay } from './client'
import type { OptionsClientKpay, ReponseKpay } from './client'
import {
  KPAY_CHEMIN_INIT,
  KPAY_CHEMIN_TRANSACTION,
  KPAY_DELAI_CONSULTATION_MS,
  KPAY_DELAI_INITIATION_MS,
  KPAY_DESCRIPTION,
  KPAY_DESCRIPTION_MARQUEUR,
  KPAY_HTTP,
  KPAY_STATUTS_NON_TERMINAUX,
} from './constantes'
import { schemaKpayInit, schemaKpayTransaction, schemaKpayWebhook } from './schemas'
import { lireEnteteSignature, verifierSignatureHmac } from './signature'

// S10 (docs/specs/S10-abonnements.md §5.2) : adaptateur K-PAY de l'interface `PaiementProvider` (USSD Mobile
// Money, Orange et MTN). Il ne journalise JAMAIS : ni clé, ni numéro, ni corps de réponse. Les codes d'issue
// suffisent à l'appelant. Les messages de K-PAY ne sont jamais relayés à l'utilisateur.

export interface OptionsKpayProvider extends Pick<OptionsClientKpay, 'baseUrl' | 'cleApi' | 'cleSecrete' | 'fetch'> {
  environnement: PaiementEnvironnement
  /** Secret de signature des webhooks ; absent = tout webhook est refusé (503 côté route). */
  secretWebhook?: string
  /** Réglages de délai (tests) ; défaut : constantes K-PAY. */
  delaiInitiationMs?: number
  delaiConsultationMs?: number
}

const PREFIXE_EVENEMENT_PAIEMENT = 'payment.'

/** Statut K-PAY -> statut normalisé ; `null` si le statut n'est pas connu. */
export function normaliserStatutKpay(statut: string): StatutFournisseur | null {
  switch (statut.toUpperCase()) {
    case 'COMPLETED':
      return 'reussi'
    case 'FAILED':
      return 'echoue'
    case 'CANCELLED':
    case 'CANCELED':
      return 'annule'
    case 'REFUNDED':
      return 'rembourse'
    default:
      return (KPAY_STATUTS_NON_TERMINAUX as readonly string[]).includes(statut.toUpperCase()) ? 'en_attente' : null
  }
}

/** Un code d'échec K-PAY n'est conservé que s'il a la forme d'un code ; sinon `null` (message par défaut). */
function assainirCodeEchec(valeur: string | null | undefined): string | null {
  return valeur !== null && valeur !== undefined && CODE_ECHEC_FORMAT.test(valeur) ? valeur : null
}

/** Libellé envoyé à K-PAY pour une période d'abonnement (le registre des fournisseurs l'expose à l'initiation). */
export function decrireAbonnementKpay(periodeMois: number): string {
  return KPAY_DESCRIPTION.replace(KPAY_DESCRIPTION_MARQUEUR, String(periodeMois))
}

/** Le délai propre à l'appel s'ajoute au signal de l'appelant : le premier des deux qui expire interrompt la requête. */
function combinerDelai(signal: AbortSignal, delaiMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(delaiMs)])
}

function resultatIndisponible(reponse: ReponseKpay): InitiationResultat | null {
  if (reponse.statut === KPAY_HTTP.nonAutorise || reponse.statut === KPAY_HTTP.interdit) {
    return { issue: 'indisponible', code: 'AUTH' }
  }
  if (reponse.statut === KPAY_HTTP.limite) {
    return {
      issue: 'indisponible',
      code: 'LIMITE',
      ...(reponse.retryAfterS === null ? {} : { retryAfterS: reponse.retryAfterS }),
    }
  }
  if (reponse.statut >= KPAY_HTTP.erreurServeur) return { issue: 'indisponible', code: 'SERVEUR' }
  return null
}

function erreurConsultation(reponse: ReponseKpay): FournisseurIndisponibleError {
  if (reponse.statut === KPAY_HTTP.nonAutorise || reponse.statut === KPAY_HTTP.interdit) return new FournisseurIndisponibleError('AUTH')
  if (reponse.statut === KPAY_HTTP.limite) return new FournisseurIndisponibleError('LIMITE', reponse.retryAfterS)
  if (reponse.statut >= KPAY_HTTP.erreurServeur) return new FournisseurIndisponibleError('SERVEUR')
  return new FournisseurIndisponibleError('RESEAU')
}

export function creerKpayProvider(options: OptionsKpayProvider): PaiementProvider {
  const client = creerClientKpay(options)
  const delaiInitiation = options.delaiInitiationMs ?? KPAY_DELAI_INITIATION_MS
  const delaiConsultation = options.delaiConsultationMs ?? KPAY_DELAI_CONSULTATION_MS

  return {
    nom: 'kpay',
    environnement: options.environnement,
    webhookConfigure: Boolean(options.secretWebhook),

    async initier(req: InitiationRequete, signal: AbortSignal): Promise<InitiationResultat> {
      // K-PAY n'accepte en USSD que des montants entiers dans la devise de l'opérateur : une devise à décimales
      // ou un montant non entier est refusé ici, avant tout appel.
      if (DEVISES_EXPOSANT[req.devise] !== 0 || !Number.isSafeInteger(req.montant) || req.montant <= 0) {
        return { issue: 'refuse', code: CODE_ECHEC_REQUETE_REFUSEE }
      }
      const corps = {
        amount: req.montant,
        provider: req.operateur,
        phoneNumber: req.telephoneInternational,
        externalId: req.externalId,
        currency: req.devise,
        description: req.description,
      }
      let reponse: ReponseKpay
      try {
        reponse = await client.post(KPAY_CHEMIN_INIT, corps, combinerDelai(signal, delaiInitiation))
      } catch (erreur) {
        return { issue: 'incertain', code: erreur instanceof KpayTransportError ? erreur.code : 'RESEAU' }
      }
      const panne = resultatIndisponible(reponse)
      if (panne) return panne
      if (reponse.statut === KPAY_HTTP.refuse) return { issue: 'refuse', code: CODE_ECHEC_REQUETE_REFUSEE }
      if (reponse.statut === KPAY_HTTP.doublon) return { issue: 'incertain', code: 'DOUBLON' }
      if (reponse.statut < 200 || reponse.statut >= 300) return { issue: 'indisponible', code: 'SERVEUR' }
      const lue = schemaKpayInit.safeParse(reponse.corps)
      if (!lue.success) return { issue: 'incertain', code: 'RESEAU' }
      return {
        issue: 'accepte',
        idFournisseur: lue.data.id,
        referenceFournisseur: lue.data.reference ?? null,
        statutFournisseur: lue.data.status,
      }
    },

    async consulter(idFournisseur: string, signal: AbortSignal): Promise<EtatFournisseur | null> {
      let reponse: ReponseKpay
      try {
        reponse = await client.get(
          `${KPAY_CHEMIN_TRANSACTION}${encodeURIComponent(idFournisseur)}`,
          combinerDelai(signal, delaiConsultation),
        )
      } catch (erreur) {
        throw new FournisseurIndisponibleError(erreur instanceof KpayTransportError ? erreur.code : 'RESEAU')
      }
      if (reponse.statut === KPAY_HTTP.introuvable) return null
      if (reponse.statut < 200 || reponse.statut >= 300) throw erreurConsultation(reponse)
      const lue = schemaKpayTransaction.safeParse(reponse.corps)
      if (!lue.success) throw new FournisseurIndisponibleError('RESEAU')
      // Statut inconnu : traité comme non terminal (le rapprochement réessaiera, rien n'est appliqué à tort).
      const statut = normaliserStatutKpay(lue.data.status) ?? 'en_attente'
      return {
        idFournisseur: lue.data.id,
        statut,
        montant: lue.data.amount,
        devise: lue.data.currency ?? null,
        fraisReels: lue.data.feeAmount ?? null,
        netReel: lue.data.netAmount ?? null,
        codeEchec: assainirCodeEchec(lue.data.failureReason),
        referenceFournisseur: lue.data.reference ?? null,
        externalId: lue.data.externalId ?? null,
      }
    },

    verifierSignature(corpsBrut: Buffer, entetes: Readonly<Record<string, string | undefined>>): boolean {
      return verifierSignatureHmac(corpsBrut, lireEnteteSignature(entetes), options.secretWebhook)
    },

    interpreterWebhook(corps: unknown): EvenementNormalise | null {
      const lu = schemaKpayWebhook.safeParse(corps)
      if (!lu.success) return null
      const data = lu.data
      const statutPaiement = data.event.startsWith(PREFIXE_EVENEMENT_PAIEMENT) ? normaliserStatutKpay(data.status) : null
      // Seuls `payment.completed`, `payment.failed` et `payment.cancelled` portant un statut COHÉRENT sont des
      // résultats ; tout le reste (virements, remboursements, statut contradictoire) est « autre ».
      const coherent = statutPaiement !== null && (
        (data.event === 'payment.completed' && statutPaiement === 'reussi')
        || (data.event === 'payment.failed' && statutPaiement === 'echoue')
        || (data.event === 'payment.cancelled' && statutPaiement === 'annule')
        || statutPaiement === 'rembourse'
        || statutPaiement === 'en_attente'
      )
      const horodatage = data.timestamp ? new Date(data.timestamp) : null
      return {
        evenement: data.event,
        idTransaction: data.paymentId,
        externalId: data.externalId ?? null,
        statut: coherent && statutPaiement !== null ? statutPaiement : 'autre',
        montant: data.amount,
        devise: data.currency ?? null,
        referenceFournisseur: data.reference ?? null,
        horodatage: horodatage && !Number.isNaN(horodatage.getTime()) ? horodatage : null,
        codeEchec: assainirCodeEchec(data.failureReason),
      }
    },
  }
}
