// S7-bis §4.6/§4.7 : DTO des messages. Le studio reçoit les coordonnées du visiteur
// (l'email au professionnel les porte déjà) ; aucune clé technique d'ORM n'est exposée.

export interface MessageCreatedDTO {
  message: {
    id: string
    sujet: string
    creeLe: string
  }
}

export interface MessageStudioDTO {
  id: string
  nom: string
  email: string
  telephone: string | null
  sujet: string
  message: string
  luLe: string | null
  creeLe: string
}

export interface MessagesStudioReponse {
  items: MessageStudioDTO[]
  nonLus: number
}
