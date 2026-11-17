// A4 : écriture et lecture ADMIN des réglages (D-A4-19). Une écriture = une transaction : idempotence (avant la
// réauthentification : un rejeu ne consomme pas de nouveau code), réauthentification si le registre l'exige, puis
// `Reglages.ecrire` (verrou, validation par le registre, journal). Le cache du processus est vidé après le commit.
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import { REGLAGES, REGLAGES_LISTE, estCleReglage } from '../../../shared/reglages'
import type { ReglageCle, ReglageDefinition, ReglageValeur } from '../../../shared/reglages'
import { schemaValeurReglage } from '../../../shared/schemas/admin-a4'
import { valeurDuCode } from '../../config/reglages-code'
import { NotFoundError, UnprocessableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { Reglages } from '../reglages'
import type { ReglageCourant } from '../reglages'
import { rejouerSiDejaFait } from './a2-support'
import type { DepsEcriture } from './a2-support'

export interface ReglageVue extends ReglageCourant {
  definition: ReglageDefinition
  /** Valeur du code, rétablie par « Rétablir le défaut ». */
  defaut: ReglageValeur
}

export interface EntreeModifierReglage {
  valeur: ReglageValeur | null
  motif: string
  cleIdempotence: string
}

export interface ResultatModifierReglage {
  reglage: ReglageVue
  rejoue: boolean
}

function vue(cle: ReglageCle, courant: ReglageCourant): ReglageVue {
  return { ...courant, definition: REGLAGES[cle], defaut: valeurDuCode(cle) }
}

/** Les 19 réglages dans l'ordre d'affichage (lecture directe de la table, sans cache). */
export async function listerReglages(): Promise<ReglageVue[]> {
  const tout = await Reglages.lireTout()
  return REGLAGES_LISTE.map((definition) => vue(definition.cle, tout[definition.cle]))
}

/** Clé hors registre (secret compris) : 404, jamais une écriture. */
export function exigerCleReglage(cle: string): ReglageCle {
  if (!estCleReglage(cle)) throw new NotFoundError('REGLAGE_INCONNUE')
  return cle
}

/** Paramètres qui identifient la demande dans le journal, pour le rejeu (un texte n'y figure que par sa longueur, D-A4-20). */
function parametresJournal(valeur: ReglageValeur | null): Record<string, string | number | boolean> {
  if (valeur === null) return { defaut: true }
  return typeof valeur === 'string' ? { longueur: valeur.length } : { valeur }
}

/** Réglage qui exige une réauthentification : `deps.reauth` est alors OBLIGATOIRE à l'exécution (fail closed). */
export async function modifierReglage(
  adminId: string,
  cle: ReglageCle,
  entree: EntreeModifierReglage,
  ip: string,
  deps: DepsEcriture,
): Promise<ResultatModifierReglage> {
  const definition: ReglageDefinition = REGLAGES[cle]
  if (!definition.modifiable) throw new UnprocessableError('REGLAGE_LECTURE_SEULE')
  if (entree.valeur !== null && !schemaValeurReglage(cle).safeParse(entree.valeur).success) {
    throw new UnprocessableError('REGLAGE_INVALIDE')
  }

  const resultat = await db.transaction(async (tx) => {
    const rejeu = await rejouerSiDejaFait(tx, adminId, entree.cleIdempotence, {
      action: ADMIN_ACTIONS.reglageModifier,
      cibleType: ADMIN_CIBLES.reglage,
      cibleId: cle,
      motif: entree.motif,
      parametres: parametresJournal(entree.valeur),
    })
    if (rejeu) return { rejoue: true, ecrit: null }

    if (definition.reauth) {
      if (!deps.reauth) throw new Error('REAUTH_MANQUANTE')
      await deps.reauth(tx)
    }
    const ecrit = await Reglages.ecrire(tx, {
      cle,
      valeur: entree.valeur,
      adminId,
      motif: entree.motif,
      cleIdempotence: entree.cleIdempotence,
      ip,
    })
    return { rejoue: false, ecrit }
  })

  // Après le commit : la prochaine lecture de CE processus voit la nouvelle valeur (les autres : 5 s au plus).
  Reglages._viderCache()
  const courant = resultat.ecrit ?? (await Reglages.lireTout())[cle]
  return { reglage: vue(cle, courant), rejoue: resultat.rejoue }
}
