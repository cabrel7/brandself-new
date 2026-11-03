import { DEVISES_EXPOSANT } from '../../../shared/paiements'
import type { FournisseurPaiement } from '../../../shared/paiements'
import { prixPeriodes } from '../../../shared/paiements-montants'
import type { DeviseOffreDTO, MoyenPaiementDTO, OffreDTO } from '../../../shared/dto/abonnement'
import { PRIX_PLANS } from '../../config/plans'
import type { GrillePrix } from '../../config/plans'
import { MOYENS_PAIEMENT } from '../../config/paiements'
import type { MoyenPaiementConfig } from '../../config/paiements'
import { fournisseursConfigures } from './fournisseurs'

// S10 (docs/specs/S10-abonnements.md §1 #104, #105, #133) : ce que l'on PEUT vendre aujourd'hui. Une devise est
// payable si un moyen ACTIF, dont le fournisseur est configuré (clés présentes), l'accepte ET si elle a des prix.
// Les prix EUR et USD restent en configuration mais ne sont ni affichés ni proposés tant qu'aucun moyen ne les
// accepte. Calculé côté serveur : aucun drapeau public à part.

export interface ConfigOffre {
  moyens: readonly MoyenPaiementConfig[]
  prix: GrillePrix
  fournisseurs: readonly FournisseurPaiement[]
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
  const moyensConfig = config.moyens ?? MOYENS_PAIEMENT
  const prix = config.prix ?? PRIX_PLANS.payant
  const fournisseurs = config.fournisseurs ?? fournisseursConfigures()

  const moyens = moyensConfig.filter((moyen) => moyen.actif && fournisseurs.includes(moyen.fournisseur))
  const devises: DeviseOffreDTO[] = []
  for (const moyen of moyens) {
    if (devises.some((offre) => offre.devise === moyen.devise)) continue
    const parPeriode = prixDeDevise(prix, moyen.devise)
    if (parPeriode === undefined) continue
    const exposant = DEVISES_EXPOSANT[moyen.devise]
    if (exposant === undefined) continue
    devises.push({ devise: moyen.devise, exposant, prix: prixPeriodes(parPeriode) })
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
