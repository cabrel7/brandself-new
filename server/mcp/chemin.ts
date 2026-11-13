// S16 : normalisation d'un chemin de requête avant comparaison à une liste de chemins protégés.
// `event.path` est le chemin BRUT : `//api/auth/oauth2/register`, `/api/auth/%6fauth2/…`, `/API/Auth/…` ou
// `/api/auth/./oauth2/…` désignent la même route pour le routeur, pas pour un `startsWith`. On ramène donc
// le chemin à une forme canonique (sans query, décodé, `/` fusionnés, segments `.`/`..` résolus, minuscules).
// Le décodage ne lève jamais d'exception : une séquence `%` invalide est conservée telle quelle.

const DECODAGE_PASSES_MAX = 3
const SEQUENCE_POURCENT = /%([0-9a-f]{2})/gi
const OCTET_ASCII_MAX = 0x7f

function decoderSansErreur(valeur: string): string {
  try {
    return decodeURIComponent(valeur)
  } catch {
    // Séquence invalide (ex. `%zz`, UTF-8 tronqué) : on décode seulement les octets ASCII valides.
    return valeur.replace(SEQUENCE_POURCENT, (sequence, hex: string) => {
      const octet = Number.parseInt(hex, 16)
      return octet <= OCTET_ASCII_MAX ? String.fromCharCode(octet) : sequence
    })
  }
}

export function normaliserChemin(brut: string): string {
  let chemin = brut.split(/[?#]/)[0] ?? ''
  // Double encodage (`%256f`) : on décode jusqu'à stabilité, borné.
  for (let passe = 0; passe < DECODAGE_PASSES_MAX; passe++) {
    const decode = decoderSansErreur(chemin)
    if (decode === chemin) break
    chemin = decode
  }
  const segments: string[] = []
  for (const segment of chemin.replaceAll('\\', '/').toLowerCase().split('/')) {
    // Paramètre de chemin (`;x=y`) : ignoré par certains routeurs.
    const propre = segment.split(';')[0] ?? ''
    if (propre === '' || propre === '.') continue
    if (propre === '..') segments.pop()
    else segments.push(propre)
  }
  return `/${segments.join('/')}`
}

/** Vrai si `chemin` (déjà normalisé) est `prefixe` ou se trouve dessous (`prefixe` sans `/` final, en minuscules). */
export function estSousChemin(chemin: string, prefixe: string): boolean {
  return chemin === prefixe || chemin.startsWith(`${prefixe}/`)
}
