// A4 (D-A4-16) : enregistre le battement « dernière sauvegarde réussie ». À appeler par le script de sauvegarde
// APRÈS un `pg_dump` réussi (jamais avant, jamais si la sauvegarde a échoué) :
//   pg_dump … && pnpm sauvegarde:battement
// Sans ce battement, l'indicateur de l'administration reste « inconnu » ; au-delà de 26 h, il passe à « ancienne ».
// Code de sortie 0 si le battement est écrit, 1 sinon (aucune donnée dans le message).
import { sql } from 'drizzle-orm'
import { BATTEMENT_SAUVEGARDE } from '../shared/jobs'
import { db } from '../server/utils/db'

try {
  await db.execute(sql`
    INSERT INTO battements_systeme (cle, horodatage, ecrit_le)
    VALUES (${BATTEMENT_SAUVEGARDE}, now(), now())
    ON CONFLICT (cle) DO UPDATE SET horodatage = EXCLUDED.horodatage, ecrit_le = EXCLUDED.ecrit_le`)
  console.info(`Battement « ${BATTEMENT_SAUVEGARDE} » enregistré.`)
  process.exit(0)
} catch {
  console.error('Battement de sauvegarde non enregistré (BATTEMENT_ECRITURE_ECHEC).')
  process.exit(1)
}
