import { rmdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { createStorage } from 'unstorage'
import fsDriver from 'unstorage/drivers/fs'
import type { Storage } from 'unstorage'
import { env } from '../../shared/env'
import { MEDIA_WIDTHS } from '../../shared/medias'
import type { MediaWidth } from '../../shared/medias'

// Stockage des médias : unstorage + driver disque. On utilise `createStorage` (et non le
// `useStorage()` de Nitro) pour rester testable hors Nitro. Clé : `userId:mediaId:largeur.webp`
// (le driver transforme `:` en `/` : <MEDIAS_DIR>/<userId>/<mediaId>/<largeur>.webp).
// Passer à S3/R2 = changer de driver ici ; `removeDirectory` ne sert que le driver disque.

const SAFE_ID_RE = /^[A-Za-z0-9_-]+$/

function assertSafeId(value: string, label: string): void {
  if (!SAFE_ID_RE.test(value)) {
    throw new Error(`Identifiant de ${label} invalide pour le stockage.`)
  }
}

function assertWidth(width: number): asserts width is MediaWidth {
  if (!(MEDIA_WIDTHS as readonly number[]).includes(width)) {
    throw new Error('Largeur de variante non publiée.')
  }
}

export function mediaKey(userId: string, mediaId: string, width: MediaWidth): string {
  assertSafeId(userId, 'utilisateur')
  assertSafeId(mediaId, 'média')
  assertWidth(width)
  return `${userId}:${mediaId}:${width}.webp`
}

let storage: Storage | undefined
function getStorage(): Storage {
  storage ??= createStorage({ driver: fsDriver({ base: env.MEDIAS_DIR }) })
  return storage
}

export { getStorage }

function directory(userId: string, mediaId?: string): string {
  assertSafeId(userId, 'utilisateur')
  if (mediaId === undefined) {
    return path.resolve(env.MEDIAS_DIR, userId)
  }
  assertSafeId(mediaId, 'média')
  return path.resolve(env.MEDIAS_DIR, userId, mediaId)
}

export async function writeMediaVariant(userId: string, mediaId: string, width: MediaWidth, data: Buffer): Promise<void> {
  await getStorage().setItemRaw(mediaKey(userId, mediaId, width), data)
}

/** Octets d'une variante, ou null si le fichier n'existe pas. */
export async function readMediaVariantFile(userId: string, mediaId: string, width: MediaWidth): Promise<Buffer | null> {
  const data = await getStorage().getItemRaw<Buffer | null>(mediaKey(userId, mediaId, width))
  return data ?? null
}

/** Supprime les 3 variantes d'un média puis son dossier (s'il est vide). Idempotent. */
export async function deleteMediaFiles(userId: string, mediaId: string): Promise<void> {
  const current = getStorage()
  await Promise.all(MEDIA_WIDTHS.map((width) => current.removeItem(mediaKey(userId, mediaId, width))))
  await rmdir(directory(userId, mediaId)).catch(() => undefined)
}

/** Supprime tout le dossier d'un utilisateur (suppression de compte). Idempotent. */
export async function deleteUserMediaFiles(userId: string): Promise<void> {
  await rm(directory(userId), { recursive: true, force: true })
}
