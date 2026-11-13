// S16 : idempotence des outils d'écriture (24 h). Un assistant qui rejoue la même clé (nouvel essai après un
// délai dépassé, doublon d'envoi) reçoit le résultat d'origine : aucun second contenu n'est créé.
// Stockage Redis (clé + TTL), sans table. Panne Redis : on laisse passer (fail-open) et on journalise, comme
// le limiteur de débit ; l'effet d'un doublon reste borné (contenu masqué, limite de créations par heure).

import { createHash } from 'node:crypto'
import { MCP_IDEMPOTENCE_EN_COURS_TTL_S, MCP_IDEMPOTENCE_TTL_S } from '../../shared/mcp'
import { redis } from '../utils/redis'

const PREFIXE = 'mcp:idempotence:'
/** Argument qui porte la clé : il ne fait pas partie de la « demande » comparée. */
const ARGUMENT_CLE = 'cle_idempotence'

export type ReservationIdempotence =
  | { etat: 'nouvelle', cle: string, empreinte: string }
  | { etat: 'rejouee', resultat: string }
  | { etat: 'en_cours' }
  /** Même clé, arguments différents : la demande n'est ni rejouée ni exécutée. */
  | { etat: 'conflit' }
  | { etat: 'indisponible' }

/** JSON canonique (clés triées) : deux objets égaux donnent la même chaîne, quel que soit l'ordre des clés. */
function canonique(valeur: unknown): string {
  if (Array.isArray(valeur)) return `[${valeur.map(canonique).join(',')}]`
  if (typeof valeur === 'object' && valeur !== null) {
    const entrees = Object.entries(valeur as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entrees.map(([k, v]) => `${JSON.stringify(k)}:${canonique(v)}`).join(',')}}`
  }
  return JSON.stringify(valeur) ?? 'null'
}

/** Empreinte des arguments d'un appel, hors clé d'idempotence. */
export function empreinteArguments(args: unknown): string {
  const sansCle = typeof args === 'object' && args !== null && !Array.isArray(args)
    ? Object.fromEntries(Object.entries(args).filter(([nom]) => nom !== ARGUMENT_CLE))
    : args
  return createHash('sha256').update(canonique(sansCle)).digest('hex')
}

interface EntreeStockee {
  empreinte: string
  /** `null` : exécution en cours. */
  resultat: string | null
}

function lireEntree(brut: string): EntreeStockee | null {
  try {
    const entree = JSON.parse(brut) as Partial<EntreeStockee>
    if (typeof entree.empreinte !== 'string') return null
    if (entree.resultat !== null && typeof entree.resultat !== 'string') return null
    return { empreinte: entree.empreinte, resultat: entree.resultat }
  } catch {
    return null
  }
}

/** Clé Redis : portée par utilisateur, assistant et outil, la clé du client est hachée (longueur et caractères libres). */
function cleRedis(userId: string, assistantId: string, outil: string, cleClient: string): string {
  const empreinte = createHash('sha256').update(cleClient).digest('hex')
  return `${PREFIXE}${userId}:${assistantId}:${outil}:${empreinte}`
}

export async function reserverIdempotence(
  userId: string,
  assistantId: string,
  outil: string,
  cleClient: string,
  args: unknown,
): Promise<ReservationIdempotence> {
  const cle = cleRedis(userId, assistantId, outil, cleClient)
  const empreinte = empreinteArguments(args)
  try {
    const enCours = JSON.stringify({ empreinte, resultat: null } satisfies EntreeStockee)
    const posee = await redis.set(cle, enCours, 'EX', MCP_IDEMPOTENCE_EN_COURS_TTL_S, 'NX')
    if (posee === 'OK') return { etat: 'nouvelle', cle, empreinte }
    const existant = await redis.get(cle)
    if (existant === null) return { etat: 'en_cours' }
    const entree = lireEntree(existant)
    // Valeur illisible (format inconnu) : on ne devine pas, on laisse passer comme en cas de panne Redis.
    if (entree === null) return { etat: 'indisponible' }
    if (entree.empreinte !== empreinte) return { etat: 'conflit' }
    return entree.resultat === null ? { etat: 'en_cours' } : { etat: 'rejouee', resultat: entree.resultat }
  } catch (erreur) {
    console.error({ source: 'mcp-idempotence', nom: erreur instanceof Error ? erreur.name : typeof erreur })
    return { etat: 'indisponible' }
  }
}

/** Mémorise le résultat d'une exécution réussie (rejeu pendant 24 h). */
export async function memoriserResultat(cle: string, empreinte: string, resultat: string): Promise<void> {
  try {
    await redis.set(cle, JSON.stringify({ empreinte, resultat } satisfies EntreeStockee), 'EX', MCP_IDEMPOTENCE_TTL_S)
  } catch (erreur) {
    console.error({ source: 'mcp-idempotence', nom: erreur instanceof Error ? erreur.name : typeof erreur })
  }
}

/** Libère la clé après un échec : le client peut réessayer avec la même clé. */
export async function liberer(cle: string): Promise<void> {
  try {
    await redis.del(cle)
  } catch (erreur) {
    console.error({ source: 'mcp-idempotence', nom: erreur instanceof Error ? erreur.name : typeof erreur })
  }
}
