import Anthropic from '@anthropic-ai/sdk'
import { IaErreur } from '../types'
import type { IaErreurFournisseurCode, IaProvider, IaReponse, IaRequete } from '../types'

// S8 §4.2 : adaptateur Anthropic (SDK officiel). Un appel = un message, la sortie est forcée par un outil
// (tool_choice) puis validée par Zod par l'appelant. Aucune nouvelle tentative ici (maxRetries: 0) : les
// tentatives et le délai global sont gérés par l'exécuteur. Rien n'est journalisé hormis un code et le
// statut HTTP : ni la clé, ni l'entrée, ni la sortie, ni le message d'erreur du SDK.

export interface OptionsAnthropic {
  cleApi: string
  modele: string
}

function coder(erreur: unknown, signal: AbortSignal): IaErreurFournisseurCode {
  if (erreur instanceof IaErreur) return erreur.code
  if (erreur instanceof Anthropic.APIConnectionTimeoutError) return 'delai'
  if (erreur instanceof Anthropic.APIUserAbortError) return signal.aborted ? 'delai' : 'fournisseur'
  return 'fournisseur'
}

function statutHttp(erreur: unknown): number | undefined {
  return erreur instanceof Anthropic.APIError ? erreur.status : undefined
}

export function creerAnthropicProvider({ cleApi, modele }: OptionsAnthropic): IaProvider {
  const client = new Anthropic({ apiKey: cleApi, maxRetries: 0 })

  return {
    nom: 'anthropic',
    async generer(requete: IaRequete): Promise<IaReponse> {
      try {
        const reponse = await client.messages.create(
          {
            model: modele,
            max_tokens: requete.parametres.maxTokens,
            // `temperature` n'est pas transmise : les paramètres d'échantillonnage ont disparu de l'API
            // Messages du SDK 1.x (types et API). Le réglage reste en base pour les autres fournisseurs.
            system: requete.systeme,
            messages: [{ role: 'user', content: requete.message }],
            tools: [
              {
                name: requete.outil.nom,
                description: requete.outil.description,
                input_schema: { ...requete.outil.schema, type: 'object' },
              },
            ],
            tool_choice: { type: 'tool', name: requete.outil.nom },
          },
          { timeout: requete.delaiMs, signal: requete.signal },
        )
        const bloc = reponse.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
        if (!bloc) throw new IaErreur('reponse_vide')
        return {
          donnees: bloc.input,
          tokensEntree: reponse.usage.input_tokens,
          tokensSortie: reponse.usage.output_tokens,
          modele: reponse.model,
        }
      } catch (erreur) {
        const code = coder(erreur, requete.signal)
        console.error({ ia: 'fournisseur', fournisseur: 'anthropic', code, statut: statutHttp(erreur) })
        throw new IaErreur(code)
      }
    },
  }
}
