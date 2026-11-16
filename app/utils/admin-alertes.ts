// A3 (UI) : lignes d'alerte de la vue d'ensemble, dérivées de `GET /api/admin/alertes` (D-A3-13). Fonction pure.
import { ADMIN_ALERTE_PAIEMENT_OUVERT_MIN, ADMIN_ALERTE_TARDIFS_JOURS } from '#shared/limites'
import type { AlertesDto } from '#shared/schemas/admin-paiements'
import { accorder } from './pluriel'

export interface LigneAlerte {
  id: string
  libelle: string
  /** Page où traiter le point ; absente quand aucune page ne le détaille. */
  to?: string
}

const PAGE_PAIEMENTS = '/admin/paiements'

/** Seules les alertes non nulles sortent : une liste vide veut dire « rien à signaler ». */
export function listerAlertes(alertes: AlertesDto): LigneAlerte[] {
  const lignes: LigneAlerte[] = []
  const { paiementsEnAttente, webhooksRefuses1h, incoherences, encaissementsTardifs } = alertes

  if (paiementsEnAttente.nombre > 0) {
    lignes.push({
      id: 'paiements-en-attente',
      libelle: `${paiementsEnAttente.nombre} ${accorder(paiementsEnAttente.nombre, 'paiement ouvert', 'paiements ouverts')} depuis plus de ${ADMIN_ALERTE_PAIEMENT_OUVERT_MIN} minutes`,
      to: `${PAGE_PAIEMENTS}?statut=en_attente`,
    })
  }
  if (webhooksRefuses1h > 0) {
    lignes.push({
      id: 'webhooks-refuses',
      libelle: `${webhooksRefuses1h} ${accorder(webhooksRefuses1h, 'notification K-PAY refusée', 'notifications K-PAY refusées')} sur la dernière heure`,
    })
  }
  const sansProlongation = incoherences.paiementsSansProlongation
  if (sansProlongation.length > 0) {
    lignes.push({
      id: 'sans-prolongation',
      libelle: `${sansProlongation.length} ${accorder(sansProlongation.length, 'paiement réussi sans prolongation', 'paiements réussis sans prolongation')}`,
      to: `${PAGE_PAIEMENTS}?id=${encodeURIComponent(sansProlongation[0] ?? '')}`,
    })
  }
  const sansPaiement = incoherences.abonnementsSansPaiement
  if (sansPaiement.length > 0) {
    lignes.push({
      id: 'sans-paiement',
      libelle: `${sansPaiement.length} ${accorder(sansPaiement.length, 'abonnement payant sans paiement', 'abonnements payants sans paiement')}`,
    })
  }
  if (encaissementsTardifs > 0) {
    lignes.push({
      id: 'encaissements-tardifs',
      libelle: `${encaissementsTardifs} ${accorder(encaissementsTardifs, 'encaissement tardif ignoré', 'encaissements tardifs ignorés')} sur ${ADMIN_ALERTE_TARDIFS_JOURS} jours`,
    })
  }
  return lignes
}
