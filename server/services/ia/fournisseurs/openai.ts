import OpenAI from 'openai'
import { IA_BASE_URL_DEFAUT } from '../../../../shared/ia'
import { IaErreur } from '../types'
import type { IaErreurFournisseurCode, IaProvider, IaReponse, IaRequete } from '../types'

// S8 §4.2 : adaptateur « compatible OpenAI » (SDK officiel `openai`). Il sert OpenAI comme tout fournisseur
// qui expose le même protocole : Gemini, Groq, Mistral, DeepSeek, OpenRouter, Ollama… (choix par `baseUrl`).
// Un appel = un message, la sortie est forcée par un outil (`tool_choice`) puis validée par Zod par l'appelant.
// Aucune nouvelle tentative ici (maxRetries: 0) : tentatives et délai global sont gérés par l'exécuteur.
// Rien n'est journalisé hormis un code et le statut HTTP : ni la clé, ni l'URL, ni l'entrée, ni la sortie,
// ni le message d'erreur du SDK.

export interface OptionsOpenAi {
  cleApi: string
  modele: string
  /** Endpoint compatible OpenAI (validé par `loadEnv`). Défaut : endpoint public d'OpenAI. */
  baseUrl?: string
  /** Transport injectable (tests : aucun appel réseau). */
  fetch?: typeof fetch
}

const STATUT_DELAI = 408
const FENCE_CODE = /^```(?:json)?\s*([\s\S]*?)\s*```$/i

function coder(erreur: unknown, signal: AbortSignal): IaErreurFournisseurCode {
  if (erreur instanceof IaErreur) return erreur.code
  if (erreur instanceof OpenAI.APIConnectionTimeoutError) return 'delai'
  if (erreur instanceof OpenAI.APIUserAbortError) return signal.aborted ? 'delai' : 'fournisseur'
  if (erreur instanceof OpenAI.APIError && erreur.status === STATUT_DELAI) return 'delai'
  return 'fournisseur'
}

function statutHttp(erreur: unknown): number | undefined {
  return erreur instanceof OpenAI.APIError ? erreur.status : undefined
}

function estObjet(valeur: unknown): valeur is Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur)
}

/** Analyse du texte seulement (JSON.parse) : jamais d'évaluation ni d'exécution. */
function parserObjetJson(texte: string): Record<string, unknown> | null {
  const brut = texte.trim()
  const clos = FENCE_CODE.exec(brut)?.[1] ?? brut
  const debut = clos.indexOf('{')
  const fin = clos.lastIndexOf('}')
  if (debut === -1 || fin <= debut) return null
  try {
    const valeur: unknown = JSON.parse(clos.slice(debut, fin + 1))
    return estObjet(valeur) ? valeur : null
  } catch {
    return null
  }
}

function extraireDonnees(message: OpenAI.Chat.Completions.ChatCompletionMessage, nomOutil: string): unknown {
  const appels = (message.tool_calls ?? []).filter((a) => 'function' in a)
  const appel = appels.find((a) => a.function.name === nomOutil) ?? appels[0]
  if (appel) {
    try {
      return JSON.parse(appel.function.arguments) as unknown
    } catch {
      // Arguments illisibles : dernier recours, un objet JSON dans le texte.
    }
  }
  // Repli : certains fournisseurs ignorent `tool_choice` et répondent en texte.
  const repli = typeof message.content === 'string' ? parserObjetJson(message.content) : null
  if (repli) return repli
  throw new IaErreur('reponse_vide')
}

export function creerOpenAiProvider({ cleApi, modele, baseUrl = IA_BASE_URL_DEFAUT, fetch: transport }: OptionsOpenAi): IaProvider {
  // `baseURL` toujours explicite : le SDK lirait sinon OPENAI_BASE_URL dans l'environnement ambiant.
  const client = new OpenAI({
    apiKey: cleApi,
    baseURL: baseUrl,
    maxRetries: 0,
    ...(transport ? { fetch: transport } : {}),
  })

  return {
    nom: 'openai',
    async generer(requete: IaRequete): Promise<IaReponse> {
      try {
        const reponse = await client.chat.completions.create(
          {
            model: modele,
            messages: [
              { role: 'system', content: requete.systeme },
              { role: 'user', content: requete.message },
            ],
            tools: [
              {
                type: 'function',
                function: {
                  name: requete.outil.nom,
                  description: requete.outil.description,
                  parameters: { ...requete.outil.schema, type: 'object' },
                },
              },
            ],
            tool_choice: { type: 'function', function: { name: requete.outil.nom } },
            temperature: requete.parametres.temperature,
            // `max_tokens` (et non `max_completion_tokens`) : accepté par Gemini, Groq, Mistral, Ollama…
            max_tokens: requete.parametres.maxTokens,
          },
          { timeout: requete.delaiMs, signal: requete.signal },
        )
        const message = reponse.choices[0]?.message
        if (!message) throw new IaErreur('reponse_vide')
        return {
          donnees: extraireDonnees(message, requete.outil.nom),
          tokensEntree: reponse.usage?.prompt_tokens ?? 0,
          tokensSortie: reponse.usage?.completion_tokens ?? 0,
          modele: reponse.model || modele,
        }
      } catch (erreur) {
        const code = coder(erreur, requete.signal)
        console.error({ ia: 'fournisseur', fournisseur: 'openai', code, statut: statutHttp(erreur) })
        throw new IaErreur(code)
      }
    },
  }
}
