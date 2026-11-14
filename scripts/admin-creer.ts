// A1 : `pnpm admin:creer <adresse>` — crée ou promeut un compte superadmin (adresse vérifiée, rôle superadmin) et
// journalise `superadmin.creer` (motif « commande serveur », IP `cli`). Une seule transaction. Commande serveur
// seulement : aucune route HTTP ne fait cela.
import { z } from 'zod'
import { creerSuperadmin } from '../server/services/admin/superadmin'

const schemaArguments = z.tuple([z.email('Adresse e-mail invalide.').max(254)])
const USAGE = 'Usage : pnpm admin:creer <adresse e-mail>'

const lecture = schemaArguments.safeParse(process.argv.slice(2))
if (!lecture.success) {
  console.error(`${lecture.error.issues[0]?.message ?? 'Arguments invalides.'}\n${USAGE}`)
  process.exit(1)
}

try {
  const { adminId, cree } = await creerSuperadmin(lecture.data[0])
  console.info(`${cree ? 'Compte superadmin créé' : 'Compte promu superadmin'} (identifiant ${adminId}).`)
  process.exit(0)
} catch (error) {
  // Ni l'adresse ni la requête : le nom de l'erreur suffit à diagnostiquer.
  console.error(`Échec de la commande (${error instanceof Error ? error.name : 'erreur inconnue'}).`)
  process.exit(1)
}
