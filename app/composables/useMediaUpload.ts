import type { MediaDTO } from '#shared/dto'
import { MEDIA_ACCEPTED_MIME, MEDIA_FORM_FIELD, MEDIA_MAX_BYTES } from '#shared/medias'

const MO = 1024 * 1024
const LIMITE_MO = MEDIA_MAX_BYTES / MO

const MESSAGES: Record<string, string> = {
  FICHIER_TROP_LOURD: `Cette photo est trop lourde. Choisissez une photo de ${LIMITE_MO} Mo au maximum.`,
  TYPE_NON_SUPPORTE: 'Ce format n’est pas accepté. Choisissez une photo JPEG, PNG ou WebP.',
  IMAGE_ILLISIBLE: 'Nous n’avons pas pu lire cette photo. Essayez-en une autre.',
  IMAGE_TROP_GRANDE: 'Cette photo est trop grande. Choisissez-en une plus petite.',
  TROP_DE_REQUETES: 'Vous avez envoyé beaucoup de photos. Réessayez dans quelques minutes.',
}
const MESSAGE_PAR_DEFAUT = 'Nous n’avons pas pu envoyer votre photo. Réessayez dans un instant.'

function messagePourStatut(statut: number | null): string | null {
  if (statut === 413) return MESSAGES.FICHIER_TROP_LOURD ?? null
  if (statut === 415) return MESSAGES.TYPE_NON_SUPPORTE ?? null
  if (statut === 422) return MESSAGES.IMAGE_ILLISIBLE ?? null
  return null
}

/** Envoi d'une photo : `POST /api/studio/medias` (multipart, partie `fichier`). */
export function useMediaUpload() {
  const enCours = ref(false)
  const erreur = ref('')

  async function televerser(fichier: File): Promise<MediaDTO | null> {
    erreur.value = ''
    if (!(MEDIA_ACCEPTED_MIME as readonly string[]).includes(fichier.type)) {
      erreur.value = MESSAGES.TYPE_NON_SUPPORTE ?? MESSAGE_PAR_DEFAUT
      return null
    }
    if (fichier.size > MEDIA_MAX_BYTES) {
      erreur.value = MESSAGES.FICHIER_TROP_LOURD ?? MESSAGE_PAR_DEFAUT
      return null
    }
    const corps = new FormData()
    corps.append(MEDIA_FORM_FIELD, fichier)
    enCours.value = true
    try {
      const { media } = await $fetch<{ media: MediaDTO }>('/api/studio/medias', { method: 'POST', body: corps })
      return media
    } catch (e) {
      const { statut, code } = lireErreurApi(e)
      erreur.value = (code ? MESSAGES[code] : undefined) ?? messagePourStatut(statut) ?? MESSAGE_PAR_DEFAUT
      return null
    } finally {
      enCours.value = false
    }
  }

  return { enCours, erreur, televerser }
}
