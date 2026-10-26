import type { MediaDTO } from '../../shared/dto/media'
import { mediaSrcset, mediaUrl } from '../../shared/medias'
import type { MediaRow } from '../services/medias'

/** Variante affichée par défaut : la plus grande (1600). Jamais de chemin disque dans la sortie. */
export function toMediaResource(media: MediaRow): MediaDTO {
  return {
    id: media.id,
    url: mediaUrl(media.id, 1600),
    srcset: mediaSrcset(media.id),
    largeur: media.largeur ?? 0,
    hauteur: media.hauteur ?? 0,
  }
}
