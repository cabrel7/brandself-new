import type { AmeliorationDTO, GenerationLanceeReponse } from '#shared/dto'
import { AMELIORER_TEXTE_MIN } from '#shared/ia'
import type { AmeliorerChamp } from '#shared/ia'

export interface MessageAmelioration {
  texte: string
  /** `erreur` : annoncé tout de suite (`role="alert"`) ; `info` : repli, annoncé poliment. */
  type: 'erreur' | 'info'
}

export const MESSAGE_AMELIORATION_REPLI =
  'Nous n’avons pas pu proposer une nouvelle version pour le moment. Votre texte est inchangé.'
export const MESSAGE_AMELIORATION_ECHEC =
  'Nous n’avons pas pu rédiger de proposition. Votre texte est inchangé, réessayez dans un instant.'
export const AIDE_AMELIORATION = 'L’IA reformule votre texte, vous validez avant d’enregistrer.'
export const AIDE_AMELIORATION_TROP_COURT =
  'Écrivez au moins quelques mots, puis l’IA vous proposera une version plus claire.'

/** Le serveur retire les espaces autour du texte avant de compter : on fait de même. */
export function texteSuffisant(texte: string): boolean {
  return texte.trim().length >= AMELIORER_TEXTE_MIN
}

/**
 * « Améliorer avec l'IA » : lance `POST /api/studio/ia/ameliorer` puis suit la génération.
 * Rien n'est écrit dans la vitrine : la proposition n'est qu'affichée, c'est l'appelant qui décide de l'utiliser.
 */
export function useAmeliorationIa() {
  const generationId = ref<string | null>(null)
  const lancement = ref(false)
  const erreurLancement = ref('')
  const { generation, termine, enAttente, erreur, amorcer } = useGeneration(generationId)

  const enCours = computed(() => lancement.value || enAttente.value)

  const resultat = computed<AmeliorationDTO | null>(() => {
    const courante = generation.value
    if (!courante || !termine.value || courante.type !== 'ameliorer_texte') return null
    return courante.resultat
  })

  /** Une vraie nouvelle version : ni repli ni texte identique. */
  const proposition = computed<AmeliorationDTO | null>(() => {
    const courant = resultat.value
    if (!courant || generation.value?.repli || !courant.modifie) return null
    return courant
  })

  const message = computed<MessageAmelioration | null>(() => {
    if (erreurLancement.value) return { texte: erreurLancement.value, type: 'erreur' }
    if (erreur.value) return { texte: MESSAGE_AMELIORATION_ECHEC, type: 'erreur' }
    if (termine.value && proposition.value === null) return { texte: MESSAGE_AMELIORATION_REPLI, type: 'info' }
    return null
  })

  function fermer(): void {
    generationId.value = null
    erreurLancement.value = ''
  }

  async function demander(champ: AmeliorerChamp, texte: string): Promise<void> {
    if (enCours.value || !texteSuffisant(texte)) return
    fermer()
    lancement.value = true
    try {
      const reponse = await $fetch<GenerationLanceeReponse>('/api/studio/ia/ameliorer', {
        method: 'POST',
        body: { champ, texte: texte.trim() },
      })
      amorcer(reponse.generation)
      generationId.value = reponse.generation.id
    } catch (e) {
      const echec = lireErreurApi(e)
      erreurLancement.value = echec.code === 'TROP_DE_REQUETES'
        ? messageTropDeDemandes(echec.retryAfter)
        : MESSAGE_AMELIORATION_ECHEC
    } finally {
      lancement.value = false
    }
  }

  return { enCours, proposition, message, demander, fermer }
}
