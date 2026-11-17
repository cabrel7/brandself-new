import { ADMIN_PREFIXE_API, ADMIN_REAUTH_ENTETE, ADMIN_ACTIONS, ADMIN_CIBLES } from '#shared/admin'
import type { DemandeReauth, ReauthReponse } from '#shared/schemas/admin'
import type {
  ActionPaiement,
  MarquagePaiementReponse,
  PaiementDetailDto,
  ReverificationReponse,
} from '#shared/schemas/admin-paiements'
import {
  LIBELLES_RESULTAT_REVERIFICATION,
  MESSAGE_REJOUE,
  messageErreurAdmin,
} from '~/utils/admin-paiements'

/** Détail d'un paiement et ses deux actions d'écriture (revérifier, marquer comme payé). L'identifiant vient de l'URL. */
export function useAdminPaiementDetail(id: Ref<string | null>) {
  const { data, status, error, refresh } = useAsyncData(
    () => `admin-paiement-${id.value ?? 'aucun'}`,
    () =>
      id.value
        ? $fetch<PaiementDetailDto>(`${ADMIN_PREFIXE_API}/paiements/${encodeURIComponent(id.value)}`)
        : Promise.resolve(null),
    { watch: [id], server: false, lazy: true },
  )
  useAdminSessionExpiree(error)

  const actionEnCours = ref(false)
  const erreurAction = ref('')
  /** Résultat de la dernière action, affiché dans le tiroir (un seul message à la fois avec `erreurAction`). */
  const confirmation = ref('')

  function reinitialiserMessages(): void {
    erreurAction.value = ''
    confirmation.value = ''
  }

  async function executer<T>(travail: () => Promise<T>): Promise<T | null> {
    if (actionEnCours.value) return null
    actionEnCours.value = true
    reinitialiserMessages()
    try {
      return await travail()
    } catch (e) {
      erreurAction.value = messageErreurAdmin(lireErreurApi(e).code)
      return null
    } finally {
      actionEnCours.value = false
    }
  }

  const url = (action: string): string => `${ADMIN_PREFIXE_API}/paiements/${encodeURIComponent(id.value ?? '')}/${action}`

  /** Revérifie auprès de K-PAY. Vrai si la demande a abouti (même si le fournisseur ne signale aucun encaissement). */
  async function reverifier(motif: string, cleIdempotence: string): Promise<boolean> {
    const corps: ActionPaiement = { motif: motif.trim(), cleIdempotence }
    const reponse = await executer(() =>
      $fetch<ReverificationReponse>(url('reverifier'), { method: 'POST', body: corps }),
    )
    if (!reponse) return false
    const resultat = LIBELLES_RESULTAT_REVERIFICATION[reponse.resultat]
    confirmation.value = reponse.rejoue ? `${resultat} ${MESSAGE_REJOUE}` : resultat
    await refresh()
    return true
  }

  /** Demande le code de réauthentification, lié à cette action et à ce paiement. Vrai si le code est parti. */
  async function demanderCode(): Promise<boolean> {
    const corps: DemandeReauth = {
      action: ADMIN_ACTIONS.paiementMarquerPaye,
      cibleType: ADMIN_CIBLES.paiement,
      cibleId: id.value ?? undefined,
    }
    // Chemin typé `string` : sans cela Nuxt compare le corps à tous les types de routes (« Excessive stack depth »).
    const chemin: string = `${ADMIN_PREFIXE_API}/reauth/code`
    const reponse = await executer(() => $fetch<ReauthReponse>(chemin, { method: 'POST', body: corps }))
    return reponse !== null
  }

  /** Marque comme payé : motif, clé d'idempotence en corps, code de réauthentification en en-tête. */
  async function marquerPaye(motif: string, cleIdempotence: string, code: string): Promise<boolean> {
    const corps: ActionPaiement = { motif: motif.trim(), cleIdempotence }
    const reponse = await executer(() =>
      $fetch<MarquagePaiementReponse>(url('marquer-paye'), {
        method: 'POST',
        body: corps,
        headers: { [ADMIN_REAUTH_ENTETE]: code },
      }),
    )
    if (!reponse) return false
    confirmation.value = reponse.rejoue
      ? `Le paiement est marqué comme payé. ${MESSAGE_REJOUE}`
      : 'Le paiement est marqué comme payé et l’abonnement est prolongé.'
    await refresh()
    return true
  }

  return {
    data, status, error, refresh,
    actionEnCours, erreurAction, confirmation, reinitialiserMessages,
    reverifier, demanderCode, marquerPaye,
  }
}
