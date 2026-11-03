import type { DeviseOffreDTO, PlanTarifDTO, PrixPeriodeDTO, TarifsDTO } from '#shared/dto'
import { PERIODE_MISE_EN_AVANT } from '#shared/plans'
import type { PeriodeMois } from '#shared/plans'

/**
 * Page publique /tarifs : `GET /api/public/tarifs` (rendu serveur). Les plans, les limites et les prix viennent de
 * la configuration serveur ; seules les devises payables sont proposées, et le sélecteur de devise n'apparaît que
 * s'il y en a plusieurs.
 */
export async function useTarifs() {
  const { data, error, refresh } = await useAsyncData('tarifs-publics', () => $fetch<TarifsDTO>('/api/public/tarifs'))

  const tarifs = computed(() => data.value ?? null)
  const periodeChoisie = ref<PeriodeMois | null>(null)
  const deviseChoisie = ref<string | null>(null)

  const gratuit = computed<PlanTarifDTO | null>(() => tarifs.value?.plans.find((p) => p.id === 'gratuit') ?? null)
  const payant = computed<PlanTarifDTO | null>(() => tarifs.value?.plans.find((p) => p.id === 'payant') ?? null)
  const paiementDisponible = computed(() => tarifs.value?.offre.paiementDisponible === true)
  const devises = computed(() => tarifs.value?.offre.devises ?? [])
  const devise = computed(() => deviseChoisie.value ?? tarifs.value?.offre.deviseParDefaut ?? null)
  const deviseOffre = computed<DeviseOffreDTO | null>(() => devises.value.find((d) => d.devise === devise.value) ?? null)
  const prixPeriodes = computed<PrixPeriodeDTO[]>(() => deviseOffre.value?.prix ?? [])

  const periode = computed<PeriodeMois | null>({
    get: () => {
      const liste = prixPeriodes.value
      if (periodeChoisie.value !== null && liste.some((p) => p.periodeMois === periodeChoisie.value)) return periodeChoisie.value
      return liste.find((p) => p.periodeMois === PERIODE_MISE_EN_AVANT)?.periodeMois ?? liste[0]?.periodeMois ?? null
    },
    set: (valeur) => {
      periodeChoisie.value = valeur
    },
  })
  const prixChoisi = computed(() => prixPeriodes.value.find((p) => p.periodeMois === periode.value) ?? null)
  const moyensLibelles = computed(() => tarifs.value?.offre.moyens.map((m) => m.libelle) ?? [])

  return {
    tarifs, erreur: error, refresh,
    gratuit, payant, paiementDisponible, devises, devise, deviseChoisie, deviseOffre,
    prixPeriodes, periode, prixChoisi, moyensLibelles,
  }
}
