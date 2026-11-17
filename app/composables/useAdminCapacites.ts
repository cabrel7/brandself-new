import { ADMIN_ACTIONS, ADMIN_CIBLES, ADMIN_PREFIXE_API } from '#shared/admin'
import type { AdminAction } from '#shared/admin'
import type { CapaciteReponse } from '#shared/schemas/admin-a4'
import { MESSAGE_REJOUE } from '~/utils/admin-paiements'
import type { DialogueSupervision } from './useAdminSupervision'

type ModeCapacite = 'accorder' | 'revoquer'

const CAPACITE_MCP = 'mcp'

const DEFINITIONS: Record<ModeCapacite, { titre: string, description: string, libelleAction: string, reauth: boolean, action: AdminAction, succes: string }> = {
  accorder: {
    titre: 'Accorder la connexion des assistants',
    description: 'Ce compte pourra connecter des assistants à sa vitrine, quel que soit son plan. Le motif est conservé dans le journal.',
    libelleAction: 'Accorder',
    reauth: true,
    action: ADMIN_ACTIONS.capaciteAccorder,
    succes: 'La capacité est accordée.',
  },
  revoquer: {
    titre: 'Révoquer la connexion des assistants',
    description: 'Les assistants de ce compte perdent leur accès dès la prochaine requête, sauf si son plan l’inclut. Le motif est conservé dans le journal.',
    libelleAction: 'Révoquer',
    reauth: false,
    action: ADMIN_ACTIONS.capaciteRevoquer,
    succes: 'La capacité est révoquée.',
  },
}

/**
 * Capacité « assistants » (MCP) d'un compte (A4) : accorder (code de confirmation) ou révoquer, avec motif. L'état
 * courant vient de la fiche ; `apresAction` demande son rechargement.
 */
export function useAdminCapacites(utilisateurId: MaybeRefOrGetter<string>, apresAction: () => void) {
  const toast = useToast()
  const { ecrireAvecVerbe } = useAdminEcritureVerbe()

  const mode = ref<ModeCapacite>('accorder')
  const dialogueOuvert = ref(false)
  const enCours = ref(false)
  const erreur = ref('')
  /** Dernière capacité écrite pendant cette visite (`revoqueLe` renseigné = révoquée). */
  const derniere = ref<CapaciteReponse['capacite'] | null>(null)

  const dialogue = computed<DialogueSupervision>(() => {
    const definition = DEFINITIONS[mode.value]
    return {
      titre: definition.titre,
      description: definition.description,
      libelleAction: definition.libelleAction,
      reauth: definition.reauth,
      action: definition.action,
      cibleType: ADMIN_CIBLES.utilisateur,
      cibleId: toValue(utilisateurId),
      destructive: mode.value === 'revoquer',
    }
  })

  function ouvrir(valeur: ModeCapacite): void {
    mode.value = valeur
    erreur.value = ''
    dialogueOuvert.value = true
  }

  async function confirmer(saisie: { motif: string, code: string, cle: string }): Promise<void> {
    if (enCours.value) return
    enCours.value = true
    erreur.value = ''
    const base = `${ADMIN_PREFIXE_API}/utilisateurs/${encodeURIComponent(toValue(utilisateurId))}/capacites`
    const motif = saisie.motif.trim()
    const resultat = mode.value === 'accorder'
      ? await ecrireAvecVerbe<CapaciteReponse>('POST', base, { capacite: CAPACITE_MCP, motif }, { cle: saisie.cle, code: saisie.code })
      : await ecrireAvecVerbe<CapaciteReponse>('DELETE', `${base}/${CAPACITE_MCP}`, { motif }, { cle: saisie.cle })
    enCours.value = false
    if (!resultat.ok) {
      erreur.value = resultat.message
      return
    }
    derniere.value = resultat.donnees.capacite
    toast.add({
      title: resultat.donnees.rejoue ? MESSAGE_REJOUE : DEFINITIONS[mode.value].succes,
      color: 'success',
      icon: 'i-ph-check-circle',
    })
    dialogueOuvert.value = false
    apresAction()
  }

  return { dialogue, dialogueOuvert, enCours, erreur, derniere, ouvrir, confirmer }
}
