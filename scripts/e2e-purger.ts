// `pnpm e2e:purger [--garder N] [--appliquer]` : supprime les comptes de test des tests e2e (adresse `e2e-…`) qui se
// sont accumulés dans la base de développement, en gardant les N plus récents comme données de démonstration.
// Par défaut : simulation (aucune suppression), seulement des comptes comptés. `--appliquer` supprime réellement.
// Jamais touchés : les comptes superadmin et ceux qui ont écrit dans le journal d'audit (le service de suppression
// les refuse, COMPTE_ADMIN), ainsi que tout compte dont l'adresse ne commence pas par `e2e-`.
import { and, desc, like, ne } from 'drizzle-orm'
import { z } from 'zod'
import { users } from '../shared/db/schema'
import { db } from '../server/utils/db'
import { supprimerCompteEtFichiers } from '../server/services/utilisateurs'

const PREFIXE_COMPTES_TEST = 'e2e-'
const ROLE_SUPERADMIN = 'superadmin'
const GARDER_PAR_DEFAUT = 20
const GARDER_MAX = 100_000
const USAGE = 'Usage : pnpm e2e:purger [--garder N] [--appliquer]'

const schemaArguments = z.strictObject({
  garder: z.coerce.number().int().min(0).max(GARDER_MAX).default(GARDER_PAR_DEFAUT),
  appliquer: z.boolean().default(false),
})

function lireArguments(argv: readonly string[]): z.infer<typeof schemaArguments> | null {
  const brut: { garder?: string, appliquer?: boolean } = {}
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i]
    if (argument === '--appliquer') brut.appliquer = true
    else if (argument === '--garder') brut.garder = argv[++i]
    else return null
  }
  const lecture = schemaArguments.safeParse(brut)
  return lecture.success ? lecture.data : null
}

const arguments_ = lireArguments(process.argv.slice(2))
if (!arguments_) {
  console.error(`Arguments invalides.\n${USAGE}`)
  process.exit(1)
}

try {
  const candidats = await db
    .select({ id: users.id })
    .from(users)
    .where(and(like(users.email, `${PREFIXE_COMPTES_TEST}%`), ne(users.role, ROLE_SUPERADMIN)))
    .orderBy(desc(users.createdAt))
  const aSupprimer = candidats.slice(arguments_.garder)

  console.info(`Comptes de test : ${candidats.length} ; gardés : ${Math.min(arguments_.garder, candidats.length)} ; à supprimer : ${aSupprimer.length}.`)
  if (!arguments_.appliquer) {
    console.info('Simulation : rien n’a été supprimé. Ajoutez --appliquer pour supprimer.')
    process.exit(0)
  }

  let supprimes = 0
  let refuses = 0
  for (const compte of aSupprimer) {
    try {
      await supprimerCompteEtFichiers(compte.id)
      supprimes++
    } catch {
      // Compte protégé (journal d'audit) ou ligne disparue entre-temps : on le laisse et on continue.
      refuses++
    }
  }
  console.info(`Supprimés : ${supprimes} ; refusés ou déjà absents : ${refuses}.`)
  process.exit(0)
} catch (error) {
  // Ni requête ni adresse : le nom de l'erreur suffit à diagnostiquer.
  console.error(`Échec de la commande (${error instanceof Error ? error.name : 'erreur inconnue'}).`)
  process.exit(1)
}
