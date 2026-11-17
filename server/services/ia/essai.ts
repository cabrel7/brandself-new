// A5 (D-A5-09, CA10) : essai à blanc d'un prompt depuis l'administration. LECTURE SEULE : entrées synthétiques figées
// (`essai-fixtures.ts`), aucune ligne persistée (ni `generations_ia`, ni journal), aucun compteur de quota consommé.
// Limite : 10 essais par heure et par administrateur (Redis, fail-closed) : 429 `ESSAI_LIMITE`.
import {
  IA_ESSAI_PROMPT_CLE_PREFIXE,
  IA_ESSAI_PROMPT_LIMIT,
  IA_DELAI_TENTATIVE_MS,
} from '../../../shared/ia'
import type { IaErreurCode, IaType } from '../../../shared/ia'
import { env } from '../../../shared/env'
import type { EssaiPromptDto, ValeursPrompt } from '../../../shared/schemas/admin-versions'
import { schemaPromptParametres } from '../../../shared/schemas/ia'
import { DomainError, ERROR_MESSAGES } from '../../exceptions/http'
import { hitLimit } from '../limiteur'
import { ESSAI_FIXTURES } from './essai-fixtures'
import { createIaProvider } from './fournisseurs'
import { outilPour } from './outils'
import { renderGabarit, serialiserDonnees, variablesAutoriseesDuGabarit } from './prompts'
import { IaErreur } from './types'
import type { IaProvider } from './types'
import { validerSortie } from './verification'

export interface DepsEssai {
  /** Fournisseur injecté (tests) ; défaut : celui de l'environnement. `null` = aucun fournisseur. */
  provider?: IaProvider | null
  now?: () => number
}

const HTTP_TROP_DE_REQUETES = 429

function limiteAtteinte(retryAfter: number): DomainError {
  return new DomainError('ESSAI_LIMITE', ERROR_MESSAGES.ESSAI_LIMITE, HTTP_TROP_DE_REQUETES, { retryAfter })
}

/**
 * Joue le prompt proposé sur la fixture de son type. Le contenu est validé comme une version (variables autorisées,
 * réglages bornés) AVANT le décompte d'un essai : un contenu refusé ne consomme rien. Une seule tentative, sans nouvel essai.
 */
export async function essaiPrompt(
  adminId: string,
  entree: { cle: IaType, valeurs: ValeursPrompt },
  deps: DepsEssai = {},
): Promise<EssaiPromptDto> {
  variablesAutoriseesDuGabarit(entree.valeurs.gabarit)
  const parametres = schemaPromptParametres.parse(entree.valeurs.parametres)
  const statut = await hitLimit(
    `${IA_ESSAI_PROMPT_CLE_PREFIXE}${adminId}`,
    IA_ESSAI_PROMPT_LIMIT.limit,
    IA_ESSAI_PROMPT_LIMIT.windowS,
    { failClosed: true },
  )
  if (!statut.allowed) throw limiteAtteinte(statut.retryAfter)
  const essaisRestants = Math.max(0, IA_ESSAI_PROMPT_LIMIT.limit - statut.count)

  const provider = deps.provider === undefined ? createIaProvider(env) : deps.provider
  if (provider === null) return { valide: false, sortie: null, erreurCode: 'fournisseur', dureeMs: null, essaisRestants }

  const fixture = ESSAI_FIXTURES[entree.cle]
  const maintenant = deps.now ?? Date.now
  const debut = maintenant()
  try {
    const reponse = await provider.generer({
      systeme: entree.valeurs.systeme,
      message: renderGabarit(entree.valeurs.gabarit, { donnees: serialiserDonnees(fixture) }),
      outil: outilPour(entree.cle),
      parametres,
      delaiMs: IA_DELAI_TENTATIVE_MS,
      signal: AbortSignal.timeout(IA_DELAI_TENTATIVE_MS),
    })
    const dureeMs = Math.max(0, maintenant() - debut)
    const verdict = validerSortie(entree.cle, reponse.donnees, fixture)
    return verdict.ok
      ? { valide: true, sortie: JSON.parse(JSON.stringify(verdict.valeur)) as EssaiPromptDto['sortie'], erreurCode: null, dureeMs, essaisRestants }
      : { valide: false, sortie: null, erreurCode: verdict.code satisfies IaErreurCode, dureeMs, essaisRestants }
  } catch (erreur) {
    const code: IaErreurCode = erreur instanceof IaErreur ? erreur.code : 'fournisseur'
    return { valide: false, sortie: null, erreurCode: code, dureeMs: Math.max(0, maintenant() - debut), essaisRestants }
  }
}
