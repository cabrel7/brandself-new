// A5 (D-A5-01) : un adaptateur par type de version. Chacun fixe la catégorie, valide la clé et la COHÉRENCE des valeurs
// (le schéma Zod strict de `shared/schemas/admin-versions.ts` a déjà validé la forme). Pas de moteur générique.
import type { z } from 'zod'
import type { VersionCategorie } from '../../../../shared/admin'
import type { TransactionAdmin } from '../../admin/audit'

export interface AdaptateurVersion<V = unknown> {
  type: 'plans' | 'prix' | 'frais' | 'moyens'
  categorie: VersionCategorie
  schemaValeurs: z.ZodType<V>
  /** Refuse (422 `VALIDATION`) une valeur incohérente avec le reste de la configuration. Lit dans la transaction. */
  validerCoherence: (tx: TransactionAdmin, cle: string, valeurs: V) => Promise<void>
}
