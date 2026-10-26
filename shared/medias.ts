export const MEDIA_MAX_BYTES = 10 * 1024 * 1024
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024
export const MEDIA_MAX_PIXELS = 40_000_000
export const MEDIA_WIDTHS = [400, 800, 1600] as const

export type MediaWidth = (typeof MEDIA_WIDTHS)[number]

export const MEDIA_ACCEPTED_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MEDIA_FORM_FIELD = 'fichier'

export function mediaUrl(id: string, width: MediaWidth): string {
  return `/medias/${id}/${width}.webp`
}

export function mediaSrcset(id: string): string {
  return MEDIA_WIDTHS.map((w) => `${mediaUrl(id, w)} ${w}w`).join(', ')
}
