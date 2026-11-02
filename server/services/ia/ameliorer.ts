import { eq } from 'drizzle-orm'
import { vitrines } from '../../../shared/db/schema'
import type { AmeliorerInput } from '../../../shared/schemas/ia'
import { NotFoundError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { createGeneration } from './generations'
import type { CreationResultat } from './generations'
import { detecterInjection, entreeAmelioration } from './nettoyage'

// S8 §6 : « Améliorer avec l'IA » du Profil. Le texte proposé n'est JAMAIS écrit dans la vitrine ici : il est
// affiché à l'utilisateur, qui l'accepte ou non puis enregistre lui-même. Données envoyées au fournisseur :
// le texte et un contexte minimal (titre, métier, ville, pays), jamais le prénom, le nom ni les contacts.

export async function ameliorer(userId: string, input: AmeliorerInput, now: Date = new Date()): Promise<CreationResultat> {
  const [vitrine] = await db
    .select({ titre: vitrines.titre, metier: vitrines.metier, ville: vitrines.ville, pays: vitrines.pays })
    .from(vitrines)
    .where(eq(vitrines.userId, userId))
    .limit(1)
  if (!vitrine) throw new NotFoundError('VITRINE_INTROUVABLE')

  const entree = entreeAmelioration(input, vitrine)
  const injection = [entree.texte, entree.contexte.metier, entree.contexte.ville].some(
    (valeur) => valeur !== null && detecterInjection(valeur),
  )
  return createGeneration(userId, 'ameliorer_texte', entree, { injection }, now)
}
