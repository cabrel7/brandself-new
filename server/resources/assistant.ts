import type { AssistantConnecte, AssistantsVue, EntreeJournal } from '../services/assistants'

// S16 : sortie des routes /api/studio/assistants. Jamais de jeton, de secret ni d'identifiant utilisateur.

export interface AssistantDTO {
  id: string
  nom: string
  portees: string[]
  connecteLe: string
  derniereActiviteLe: string | null
}

export interface AssistantsDTO {
  actif: boolean
  adresse: string
  planPayant: boolean
  assistants: AssistantDTO[]
}

export interface EntreeJournalDTO {
  id: string
  assistant: string
  outil: string
  resume: unknown
  erreur: string | null
  avant: unknown
  apres: unknown
  date: string
}

const NOM_ASSISTANT_REPLI = 'Assistant'

function toAssistantResource(assistant: AssistantConnecte): AssistantDTO {
  return {
    id: assistant.id,
    nom: assistant.nom ?? NOM_ASSISTANT_REPLI,
    portees: assistant.portees,
    connecteLe: assistant.connecteLe.toISOString(),
    derniereActiviteLe: assistant.derniereActiviteLe?.toISOString() ?? null,
  }
}

export function toAssistantsResource(vue: AssistantsVue): AssistantsDTO {
  return {
    actif: vue.actif,
    adresse: vue.adresse,
    planPayant: vue.planPayant,
    assistants: vue.assistants.map(toAssistantResource),
  }
}

export function toEntreeJournalResource(entree: EntreeJournal): EntreeJournalDTO {
  return {
    id: entree.id,
    assistant: entree.assistantNom ?? NOM_ASSISTANT_REPLI,
    outil: entree.outil,
    resume: entree.argumentsResume,
    erreur: entree.erreur,
    avant: entree.avant,
    apres: entree.apres,
    date: entree.createdAt.toISOString(),
  }
}
