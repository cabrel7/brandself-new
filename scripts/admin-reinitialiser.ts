// A1 : `pnpm admin:reinitialiser <adresse>` — récupération d'un accès : lève la suspension,
// supprime les sessions et les réauthentifications ouvertes du compte, journalise `superadmin.reinitialiser`
// (motif « commande serveur », IP `cli`). Une seule transaction. Le compte doit DÉJÀ être superadmin (sinon rien
// n'est modifié) ; la promotion d'un compte ordinaire reste réservée à `pnpm admin:creer`.
import { z } from 'zod'
import { CompteIntrouvableError, reinitialiserSuperadmin } from '../server/services/admin/superadmin'

const schemaArguments = z.tuple([z.email('Adresse e-mail invalide.').max(254)])
const USAGE = 'Usage : pnpm admin:reinitialiser <adresse e-mail d’un superadmin existant>'

const lecture = schemaArguments.safeParse(process.argv.slice(2))
if (!lecture.success) {
  console.error(`${lecture.error.issues[0]?.message ?? 'Arguments invalides.'}\n${USAGE}`)
  process.exit(1)
}

try {
  const { adminId } = await reinitialiserSuperadmin(lecture.data[0])
  console.info(`Compte réinitialisé (identifiant ${adminId}) : suspension levée, sessions supprimées.`)
  process.exit(0)
} catch (error) {
  console.error(
    error instanceof CompteIntrouvableError
      ? error.message
      : `Échec de la commande (${error instanceof Error ? error.name : 'erreur inconnue'}).`,
  )
  process.exit(1)
}
