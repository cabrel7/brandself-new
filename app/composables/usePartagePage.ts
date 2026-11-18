const DUREE_MESSAGE_MS = 3000

export const ANNONCE_ADRESSE_COPIEE = 'Adresse copiée'
export const ANNONCE_PARTAGE_IMPOSSIBLE = 'Copie impossible. Copiez l’adresse depuis la barre du navigateur.'

interface UsePartagePageOptions {
  url: MaybeRefOrGetter<string>
  titre: MaybeRefOrGetter<string>
}

/**
 * Partage de l’adresse d’une page publique : partage natif si le navigateur le propose,
 * sinon copie de l’adresse. Le résultat est annoncé dans `message` (zone `role="status"`),
 * puis effacé. Aucune donnée personnelle n’est envoyée : seule l’adresse de la page l’est.
 */
export function usePartagePage(options: UsePartagePageOptions) {
  const message = ref('')
  let minuteur: ReturnType<typeof setTimeout> | undefined

  function annoncer(texte: string): void {
    clearTimeout(minuteur)
    message.value = texte
    minuteur = setTimeout(() => {
      message.value = ''
    }, DUREE_MESSAGE_MS)
  }

  async function copier(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url)
      annoncer(ANNONCE_ADRESSE_COPIEE)
    } catch {
      annoncer(ANNONCE_PARTAGE_IMPOSSIBLE)
    }
  }

  async function partager(): Promise<void> {
    const url = toValue(options.url)
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: toValue(options.titre), url })
        return
      } catch (erreur) {
        // Feuille de partage fermée par la personne : rien à signaler.
        if (erreur instanceof DOMException && erreur.name === 'AbortError') return
      }
    }
    await copier(url)
  }

  onBeforeUnmount(() => clearTimeout(minuteur))

  return { message, partager }
}
