import type { FournisseurPaiement, PaiementEnvironnement } from '../../../shared/paiements'

// S10 (docs/specs/S10-abonnements.md §5.2) : contrat d'un fournisseur de paiement. Un adaptateur par
// fournisseur (K-PAY aujourd'hui, carte plus tard) ; le reste de l'application ne connaît que cette interface.
// Aucune de ces structures ne porte le numéro du payeur en dehors de `InitiationRequete` (envoi unique).

export interface InitiationRequete {
  /** Identifiant du paiement chez nous (UUID) : l'`externalId` du fournisseur, clé d'idempotence. */
  externalId: string
  /** Unité mineure de la devise (entier). */
  montant: number
  devise: string
  /** Code de l'opérateur chez le fournisseur (ex. `MTN_MOMO_CMR`). */
  operateur: string
  /** Numéro au format international, sans `+` (ex. `237653456789`). Jamais stocké ni journalisé. */
  telephoneInternational: string
  description: string
}

export type InitiationResultat =
  | { issue: 'accepte', idFournisseur: string, referenceFournisseur: string | null, statutFournisseur: string }
  /** Le fournisseur a refusé la requête (400) : rien n'a été créé chez lui. */
  | { issue: 'refuse', code: string }
  /** On ne sait pas si le paiement existe chez le fournisseur : seul le webhook pourra le rapprocher. */
  | { issue: 'incertain', code: 'DELAI' | 'DOUBLON' | 'RESEAU' }
  | { issue: 'indisponible', code: 'AUTH' | 'LIMITE' | 'SERVEUR', retryAfterS?: number }

export type StatutFournisseur = 'en_attente' | 'reussi' | 'echoue' | 'annule' | 'rembourse'

export interface EtatFournisseur {
  idFournisseur: string
  statut: StatutFournisseur
  montant: number
  devise: string | null
  fraisReels: number | null
  netReel: number | null
  codeEchec: string | null
  referenceFournisseur: string | null
  /** Identifiant que nous avons envoyé à l'initiation, s'il est renvoyé (contrôle de cohérence). */
  externalId?: string | null
  /** Statut tel que le fournisseur l'a écrit (audit, colonne `statut_fournisseur`). */
  statutBrut?: string | null
}

export interface EvenementNormalise {
  /** Nom brut de l'événement (`payment.completed`…), journalisé tel quel s'il respecte le format. */
  evenement: string
  idTransaction: string
  externalId: string | null
  statut: StatutFournisseur | 'autre'
  montant: number
  devise: string | null
  referenceFournisseur: string | null
  horodatage: Date | null
  codeEchec: string | null
  /** Statut brut du fournisseur (audit), en majuscules. */
  statutBrut?: string | null
  /** Renseignés seulement par une interrogation (les webhooks ne portent pas les frais). */
  fraisReels?: number | null
  netReel?: number | null
}

export interface PaiementProvider {
  readonly nom: FournisseurPaiement
  readonly environnement: PaiementEnvironnement
  /** Faux si le secret de signature des webhooks est absent (le webhook répond alors 503). Défaut : vrai. */
  readonly webhookConfigure?: boolean
  initier(req: InitiationRequete, signal: AbortSignal): Promise<InitiationResultat>
  /** `null` = transaction inconnue (404). Lève `FournisseurIndisponibleError` sur toute autre panne. */
  consulter(idFournisseur: string, signal: AbortSignal): Promise<EtatFournisseur | null>
  verifierSignature(corpsBrut: Buffer, entetes: Readonly<Record<string, string | undefined>>): boolean
  /** `null` = schéma invalide. Les champs inconnus sont ignorés. */
  interpreterWebhook(corps: unknown): EvenementNormalise | null
}

export type CodeFournisseurIndisponible = 'AUTH' | 'LIMITE' | 'SERVEUR' | 'RESEAU' | 'DELAI'

/** Panne du fournisseur pendant une consultation. Le message ne contient ni clé, ni URL, ni corps de réponse. */
export class FournisseurIndisponibleError extends Error {
  readonly code: CodeFournisseurIndisponible
  readonly retryAfterS: number | null

  constructor(code: CodeFournisseurIndisponible, retryAfterS: number | null = null) {
    super(`FOURNISSEUR_INDISPONIBLE_${code}`)
    this.name = 'FournisseurIndisponibleError'
    this.code = code
    this.retryAfterS = retryAfterS
  }
}
