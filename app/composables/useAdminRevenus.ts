import { ADMIN_PREFIXE_API } from '#shared/admin'
import type { RevenusDto } from '#shared/schemas/admin-paiements'

/** Revenus du mois par devise (jamais additionnés entre devises). */
export function useAdminRevenus() {
  const { data, status, error, refresh } = useFetch<RevenusDto>(`${ADMIN_PREFIXE_API}/revenus`, {
    key: 'admin-revenus',
    server: false,
    lazy: true,
  })
  useAdminSessionExpiree(error)
  return { data, status, error, refresh }
}
