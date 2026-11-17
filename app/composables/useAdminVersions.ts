import { ADMIN_IDEMPOTENCE_ENTETE, ADMIN_LISTE_LIMITE_DEFAUT, ADMIN_PREFIXE_API, ADMIN_REAUTH_ENTETE } from '#shared/admin'
import type { AdminVersionType } from '#shared/admin'
import type {
  ActiverVersion,
  EssaiPromptDto,
  ImpactPlan,
  ImpactPlanDto,
  ListeVersionsDto,
  ValeursPlan,
  ValeursPrompt,
  VersionReponse,
} from '#shared/schemas/admin-versions'
import { cheminActionVersion, clesDuTypeVersion, lireTypeVersion } from '~/utils/admin-versions'
import type { ActionVersion } from '~/utils/admin-versions'
import { lirePage, messageErreurAdmin } from '~/utils/admin-paiements'
import { messageDepuisErreurApi } from '~/utils/admin-a2'

const STATUT_SESSION_REFUSEE = 404

/** Résultat d'une écriture de version : succès, ou message du serveur (et impact recalculé sur `IMPACT_CHANGE`). */
export type ResultatVersion<T> = { ok: true, donnees: T } | { ok: false, message: string, impact: ImpactPlan | null }

function impactDepuis(valeur: unknown): ImpactPlan | null {
  if (typeof valeur !== 'object' || valeur === null) return null
  const brut = valeur as Record<string, unknown>
  const compte = (cle: string): { comptes: number, elementsMasques?: number } | null => {
    const ligne = brut[cle]
    if (typeof ligne !== 'object' || ligne === null) return null
    const { comptes, elementsMasques } = ligne as Record<string, unknown>
    if (typeof comptes !== 'number') return null
    return typeof elementsMasques === 'number' ? { comptes, elementsMasques } : { comptes }
  }
  const services = compte('services')
  const realisations = compte('realisations')
  const temoignages = compte('temoignages')
  const reservationsMois = compte('reservationsMois')
  const generationsIaMois = compte('generationsIaMois')
  if (!services || !realisations || !temoignages || !reservationsMois || !generationsIaMois) return null
  const masque = (ligne: { comptes: number, elementsMasques?: number }): { comptes: number, elementsMasques: number } => ({
    comptes: ligne.comptes,
    elementsMasques: ligne.elementsMasques ?? 0,
  })
  return {
    services: masque(services),
    realisations: masque(realisations),
    temoignages: masque(temoignages),
    reservationsMois: { comptes: reservationsMois.comptes },
    generationsIaMois: { comptes: generationsIaMois.comptes },
  }
}

/**
 * Versions d'administration (A5) : type, clé et page dans l'URL, historique par type, écritures avec clé
 * d'idempotence en en-tête. Aucune règle métier : le serveur valide, calcule l'impact et décide.
 */
export function useAdminVersions() {
  const route = useRoute()
  const router = useRouter()

  const type = computed<AdminVersionType>(() => lireTypeVersion(route.query.type))
  const cles = computed(() => clesDuTypeVersion(type.value))
  const cle = computed<string | undefined>(() => {
    const demandee = Array.isArray(route.query.cle) ? route.query.cle[0] : route.query.cle
    return cles.value.find((valeur) => valeur === demandee) ?? cles.value[0]
  })
  const page = computed(() => lirePage(route.query.page))

  const { data, error, refresh } = useFetch<ListeVersionsDto>(
    () => `${ADMIN_PREFIXE_API}/versions/${type.value}`,
    {
      server: false,
      lazy: true,
      query: computed(() => ({ ...(cle.value ? { cle: cle.value } : {}), page: page.value, limite: ADMIN_LISTE_LIMITE_DEFAUT })),
    },
  )
  surveillerSessionAdmin(error)

  /** Seule une réponse du type affiché est exposée (pas de contenu d'un autre type pendant un changement d'onglet). */
  const liste = computed(() => (data.value && data.value.type === type.value ? data.value : null))
  const enChargement = computed(() => !liste.value && !error.value)

  async function naviguer(query: Record<string, string>): Promise<void> {
    await router.replace({ query })
  }
  const changerType = (valeur: AdminVersionType): Promise<void> => naviguer(valeur === lireTypeVersion(undefined) ? {} : { type: valeur })
  function changerCle(valeur: string): Promise<void> {
    return naviguer({ type: type.value, cle: valeur })
  }
  function changerPage(numero: number): Promise<void> {
    const query: Record<string, string> = { type: type.value }
    if (cle.value) query.cle = cle.value
    if (numero > 1) query.page = String(numero)
    return naviguer(query)
  }

  return { type, cles, cle, page, liste, error, enChargement, refresh, changerType, changerCle, changerPage }
}

/**
 * Écritures des versions : brouillon, activation, retour arrière, validation des prix, aperçu d'impact et essai à
 * blanc. Séparé de la lecture : les composants qui écrivent ne doublent pas la requête de l'historique.
 */
export function useAdminVersionsEcritures() {
  const { expirer } = useAdminSession()

  async function envoyer<T>(chemin: string, corps: unknown, options: { cle: string, code?: string }): Promise<ResultatVersion<T>> {
    const entetes: Record<string, string> = { [ADMIN_IDEMPOTENCE_ENTETE]: options.cle }
    if (options.code) entetes[ADMIN_REAUTH_ENTETE] = options.code
    try {
      const donnees = await $fetch<T>(chemin, { method: 'POST', body: corps as Record<string, unknown>, headers: entetes })
      return { ok: true, donnees }
    } catch (e) {
      const lue = lireErreurApi(e)
      if (lue.statut === STATUT_SESSION_REFUSEE && lue.code === null) void expirer()
      const impact = lue.code === 'IMPACT_CHANGE' ? impactDepuis(lue.donnees.impact) : null
      const message = messageDepuisErreurApi(e)
      return { ok: false, message: message === '' ? messageErreurAdmin(lue.code) : message, impact }
    }
  }

  const base = (): string => `${ADMIN_PREFIXE_API}/versions`

  /** Crée un brouillon : aucun effet sur le produit, donc pas de code de réauthentification. */
  function creerBrouillon(typeVersion: AdminVersionType, corps: { cle: string, valeurs: unknown, motif: string }, cleIdempotence: string): Promise<ResultatVersion<VersionReponse>> {
    return envoyer<VersionReponse>(`${base()}/${typeVersion}`, corps, { cle: cleIdempotence })
  }

  /** Activer, programmer, revenir en arrière ou valider un prix : code de réauthentification obligatoire. */
  function agir(
    typeVersion: AdminVersionType,
    id: string,
    action: ActionVersion,
    corps: ActiverVersion | { motif: string },
    confirmation: { code: string, cle: string },
  ): Promise<ResultatVersion<VersionReponse>> {
    return envoyer<VersionReponse>(cheminActionVersion(typeVersion, id, action), corps, confirmation)
  }

  /** Aperçu d'impact (lecture seule) : valeurs candidates d'un plan. */
  function apercuImpact(planCle: string, valeurs: ValeursPlan): Promise<ResultatVersion<ImpactPlanDto>> {
    return envoyer<ImpactPlanDto>(`${base()}/plans/impact`, { cle: planCle, valeurs }, { cle: `ui-impact-${crypto.randomUUID()}` })
  }

  /** Essai à blanc d'un prompt (lecture seule, 10 par heure) : jamais de donnée d'utilisateur dans le corps. */
  function essaiPrompt(promptCle: string, valeurs: ValeursPrompt): Promise<ResultatVersion<EssaiPromptDto>> {
    return envoyer<EssaiPromptDto>(`${base()}/prompts/essai`, { cle: promptCle, valeurs }, { cle: `ui-essai-${crypto.randomUUID()}` })
  }

  return { creerBrouillon, agir, apercuImpact, essaiPrompt }
}
