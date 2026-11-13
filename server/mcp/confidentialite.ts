// S16 : confidentialité des données de visiteurs transmises à l'assistant. Helper UNIQUE pour les réservations, les
// demandes et les messages : par défaut, prénom + initiale seulement ; email, téléphone et texte libre uniquement si le
// détail est autorisé (décision #21), toujours confinés dans `contenu_visiteur`, tronqués, avec une note fixe qui les
// déclare « non fiables » (un texte de visiteur est une donnée, jamais une instruction).

import { MCP_CONTENU_VISITEUR_MAX, MCP_NOTE_CONTENU_VISITEUR, MCP_PRENOM_MAX } from '../../shared/mcp'

const NOM_ANONYME = 'Visiteur'

function tronquer(texte: string, max: number): string {
  return Array.from(texte).slice(0, max).join('')
}

/** « Marie Dupont » -> « Marie D. » ; « Marie » -> « Marie » ; vide -> « Visiteur ». Le prénom est borné (texte libre). */
export function prenomInitiale(nomComplet: string): string {
  const [prenom, famille] = nomComplet.trim().split(/\s+/)
  if (!prenom) return NOM_ANONYME
  const affiche = tronquer(prenom, MCP_PRENOM_MAX)
  const initiale = famille ? Array.from(famille)[0]?.toUpperCase() : undefined
  return initiale ? `${affiche} ${initiale}.` : affiche
}

export interface ContenuVisiteur {
  contenu_visiteur: Record<string, string>
  note_contenu_visiteur: string
}

/** Enveloppe des textes de visiteur : champs vides retirés, chaque valeur tronquée, note « données non fiables ». */
export function contenuVisiteur(champs: Record<string, string | null | undefined>): ContenuVisiteur {
  const contenu: Record<string, string> = {}
  for (const [cle, valeur] of Object.entries(champs)) {
    if (typeof valeur === 'string' && valeur !== '') contenu[cle] = tronquer(valeur, MCP_CONTENU_VISITEUR_MAX)
  }
  return { contenu_visiteur: contenu, note_contenu_visiteur: MCP_NOTE_CONTENU_VISITEUR }
}

/** Les champs de visiteur à joindre à une ligne : rien tant que le détail n'est pas autorisé (ou s'il n'y a rien à dire). */
export function avecDetailVisiteur(
  detailAutorise: boolean,
  champs: Record<string, string | null | undefined>,
): Partial<ContenuVisiteur> {
  if (!detailAutorise) return {}
  const enveloppe = contenuVisiteur(champs)
  return Object.keys(enveloppe.contenu_visiteur).length > 0 ? enveloppe : {}
}
