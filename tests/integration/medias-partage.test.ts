// S12 : tests d'intégration du partage média (PG réel).
import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from '../../server/utils/db'
import { vitrines } from '../../shared/db/schema'
import { randomUUID } from 'node:crypto'
import { createUser } from './support/fabriques'
import { getPartageVariant, uploadMedia } from '../../server/services/medias'

async function creerVitrineAvecMedia(username: string, publiee: boolean) {
  const user = await createUser()
  const [vitrine] = await db
    .insert(vitrines)
    .values({
      id: randomUUID(),
      userId: user.id,
      username,
      titre: 'dr',
      prenom: 'P',
      nom: 'Nom',
      metier: 'Cardiologue',
      ville: 'Douala',
      pays: 'CM',
      publieeLe: publiee ? new Date() : null,
    })
    .returning()
  // Générer une image WebP valide en mémoire.
  const imageBuffer = await sharp({
    create: {
      width: 2000,
      height: 1500,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .webp()
    .toBuffer()
  const media = await uploadMedia(user.id, imageBuffer)
  // Lier le média comme photo de la vitrine.
  await db.update(vitrines).set({ photoMediaId: media.id }).where(eq(vitrines.id, vitrine.id))
  return { vitrine, media }
}

describe('medias-partage (CA36-CA37)', () => {
  it('CA36 : variante partage générée pour média lié à vitrine publiée', async () => {
    const { vitrine, media } = await creerVitrineAvecMedia('dr-partage', true)
    // Le média est lié comme photo de la vitrine publiée : getPartageVariant doit réussir.
    const variant = await getPartageVariant(media.id, vitrine.id)
    expect(variant.url).toContain('/medias/')
    expect(variant.url).toContain('/partage.webp')
    expect(variant.largeur).toBe(1200)
    expect(variant.hauteur).toBe(630)
  })

  it('CA37 : média sans vitrine publiée -> 404, rien généré', async () => {
    const { media } = await creerVitrineAvecMedia('dr-non-publie', false)
    await expect(getPartageVariant(media.id, 'vitrine-inexistante')).rejects.toMatchObject({
      code: 'MEDIA_INTROUVABLE',
    })
  })
})
