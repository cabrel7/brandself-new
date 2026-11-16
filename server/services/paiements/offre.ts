import { DEVISES_EXPOSANT } from '../../../shared/paiements'
import type { FournisseurPaiement } from '../../../shared/paiements'
import { calculerMontants, prixPeriodes } from '../../../shared/paiements-montants'
import type { DeviseOffreDTO, MoyenPaiementDTO, OffreDTO, PrixPeriodeDTO } from '../../../shared/dto/abonnement'
import type { GrillePrix } from '../../config/plans'
import { env } from '../../../shared/env'
import { MOYENS_PAIEMENT, paiementVerrouille } from '../../config/paiements'
import type { MoyenPaiementConfig, TableFrais } from '../../config/paiements'
import { appliquerMoyensActifs, instantaneCache, instantaneDuCode } from '../configuration/lecture'
import { fournisseursConfigures } from './fournisseurs'

// S10 (docs/specs/S10-abonnements.md §1 #104, #105, #133) : ce que l'on PEUT vendre aujourd'hui. Une devise est
// payable si un moyen ACTIF, dont le fournisseur est configuré (clés présentes), l'accepte ET si elle a des prix.
// Les prix EUR et USD restent en configuration mais ne sont ni affichés ni proposés tant qu'aucun moyen ne les
// accepte. Calculé côté serveur : aucun drapeau public à part.

export interface ConfigOffre {
  moyens: readonly MoyenPaiementConfig[]
  prix: GrillePrix
  /** Barèmes de frais : le prix affiché (TTC) en dépend (R12). */
  frais: TableFrais
  fournisseurs: readonly FournisseurPaiement[]
  /** Grille de prix provisoire en production : aucune offre (défaut : calculé depuis l'environnement). */
  verrouille: boolean
}

function versDto(moyen: MoyenPaiementConfig): MoyenPaiementDTO {
  return {
    id: moyen.id,
    libelle: moyen.libelle,
    methode: moyen.methode,
    devise: moyen.devise,
    indicatif: moyen.indicatif,
    exemple: moyen.exemple,
  }
}

/**
 * R12 : ajoute à chaque période le montant TTC que le client paiera (frais compris si le client les supporte), calculé
 * comme `initierPaiement` : c'est EXACTEMENT ce que le client renvoie en `prixAffiche`.
 */
function prixAffiches(prix: PrixPeriodeDTO[], frais: TableFrais, moyen: MoyenPaiementConfig): PrixPeriodeDTO[] {
  const bareme = frais[moyen.fournisseur]?.[moyen.methode]
  return prix.map((periode) => {
    if (bareme === undefined) return { ...periode, montantAffiche: periode.montant }
    try {
      const { montant } = calculerMontants({ prixPlan: periode.montant, tauxPb: bareme.tauxPointsBase, supporteur: bareme.supporteur })
      return { ...periode, montantAffiche: montant }
    } catch {
      return { ...periode, montantAffiche: periode.montant }
    }
  })
}

/** Prix par période d'une devise, `undefined` si la devise n'est pas tarifée. */
export function prixDeDevise(prix: GrillePrix, devise: string): GrillePrix[keyof GrillePrix] | undefined {
  return Object.entries(prix).find(([code]) => code === devise)?.[1]
}

/**
 * Offre de paiement. `deviseSouhaitee` (devise du compte ou `?devise=`) est retenue seulement si elle est payable ;
 * sinon la première devise payable est proposée. Aucune devise payable : `paiementDisponible` est faux.
 */
export function construireOffre(
  deviseSouhaitee: string | null | undefined,
  config: Partial<ConfigOffre> = {},
): OffreDTO {
  // A5 (D-A5-04) : sans configuration injectée, l'offre vient des versions ACTIVES (instantané de 5 s au plus), repli sur le code.
  const toutInjecte = config.moyens !== undefined && config.prix !== undefined && config.frais !== undefined && config.verrouille !== undefined
  const instantane = toutInjecte ? instantaneDuCode() : instantaneCache()
  const moyensConfig = config.moyens ?? appliquerMoyensActifs(MOYENS_PAIEMENT, instantane.moyensActifs)
  const prix = config.prix ?? instantane.grille
  const frais = config.frais ?? instantane.frais
  const verrouille = config.verrouille ?? paiementVerrouille(env, instantane.prixValideeLe !== null)
  const fournisseurs = verrouille ? [] : (config.fournisseurs ?? fournisseursConfigures())

  const moyens = moyensConfig.filter((moyen) => moyen.actif && fournisseurs.includes(moyen.fournisseur))
  const devises: DeviseOffreDTO[] = []
  for (const moyen of moyens) {
    if (devises.some((offre) => offre.devise === moyen.devise)) continue
    const parPeriode = prixDeDevise(prix, moyen.devise)
    if (parPeriode === undefined) continue
    const exposant = DEVISES_EXPOSANT[moyen.devise]
    if (exposant === undefined) continue
    devises.push({ devise: moyen.devise, exposant, prix: prixAffiches(prixPeriodes(parPeriode), frais, moyen) })
  }
  const payables = moyens.filter((moyen) => devises.some((offre) => offre.devise === moyen.devise))
  const souhaitee = devises.find((offre) => offre.devise === deviseSouhaitee)
  return {
    paiementDisponible: payables.length > 0,
    devises,
    deviseParDefaut: souhaitee?.devise ?? devises[0]?.devise ?? null,
    moyens: payables.map(versDto),
  }
}
