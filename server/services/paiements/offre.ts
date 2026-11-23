import { DEVISES_EXPOSANT, libellePays } from '../../../shared/paiements'
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
    pays: moyen.pays,
    paysLibelle: libellePays(moyen.pays),
    indicatif: moyen.indicatif,
    exemple: moyen.exemple,
  }
}

/** Montant TTC d'une période pour UN moyen, calculé comme `initierPaiement` ; repli sur le prix du plan (jamais d'exception). */
function montantAffichePourMoyen(montantPlan: number, frais: TableFrais, moyen: MoyenPaiementConfig): number {
  const bareme = frais[moyen.fournisseur]?.[moyen.methode]
  if (bareme === undefined) return montantPlan
  try {
    return calculerMontants({ prixPlan: montantPlan, tauxPb: bareme.tauxPointsBase, supporteur: bareme.supporteur }).montant
  } catch {
    return montantPlan
  }
}

/**
 * R12 : ajoute à chaque période le montant TTC que le client paiera (frais compris si le client les supporte), calculé
 * comme `initierPaiement` : c'est EXACTEMENT ce que le client renvoie en `prixAffiche`. Les frais dépendent du moyen :
 * `montantAfficheParMoyen` donne le montant de chacun des moyens de la devise ; `montantAffiche` est celui du premier.
 */
function prixAffiches(prix: PrixPeriodeDTO[], frais: TableFrais, moyensDeLaDevise: readonly MoyenPaiementConfig[]): PrixPeriodeDTO[] {
  const [premier] = moyensDeLaDevise
  if (premier === undefined) return prix
  return prix.map((periode) => ({
    ...periode,
    montantAffiche: montantAffichePourMoyen(periode.montant, frais, premier),
    montantAfficheParMoyen: Object.fromEntries(
      moyensDeLaDevise.map((moyen) => [moyen.id, montantAffichePourMoyen(periode.montant, frais, moyen)]),
    ),
  }))
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
    devises.push({
      devise: moyen.devise,
      exposant,
      prix: prixAffiches(prixPeriodes(parPeriode), frais, moyens.filter((candidat) => candidat.devise === moyen.devise)),
    })
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
