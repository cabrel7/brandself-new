import { describe, expect, it } from 'vitest'
import { MEDIA_WIDTHS } from '../../../shared/medias'
import { readMediaVariant, readMediaVariantByFilename, readPartageJpeg, uploadMedia } from '../../../server/services/medias'
import { makePng } from '../../support/images'
import { createUser } from '../support/fabriques'
import { reactiverEnBase, suspendreEnBase } from '../support/admin-a2'

// A2 (revue de sécurité) : les variantes d'image d'un titulaire suspendu (`users.suspendu`) ne sont plus servies : 404
// `MEDIA_INTROUVABLE`, identique à « introuvable » (le visiteur ne voit jamais la raison). Base et stockage RÉELS.
//
// NON COUVERT (volontairement) : `blocage_admin`. Le studio du propriétaire charge ses variantes par la même URL publique
// `/medias/{id}/{largeur}.webp` ; réserver l'image au propriétaire connecté exigerait un cache nginx contournable par cookie
// (`location /medias/` met en cache 1 an toute réponse 200). Signalé dans le rapport, à trancher.

const LARGEUR = MEDIA_WIDTHS[0]
const INTROUVABLE = { status: 404, code: 'MEDIA_INTROUVABLE' }

async function mediaDe(userId: string): Promise<string> {
  return (await uploadMedia(userId, await makePng(2000, 1500))).id
}

describe('images d\'un titulaire suspendu', () => {
  it('should serve the variants and the share image of an active account (control)', async () => {
    const user = await createUser()
    const id = await mediaDe(user.id)

    expect((await readMediaVariant(id, LARGEUR)).length).toBeGreaterThan(0)
    expect((await readMediaVariantByFilename(id, `${LARGEUR}.webp`)).data.length).toBeGreaterThan(0)
    expect((await readPartageJpeg(id)).length).toBeGreaterThan(0)
  })

  it('should answer the same 404 as an unknown media for every variant once the holder is suspended, even if the share image is cached', async () => {
    const user = await createUser()
    const id = await mediaDe(user.id)
    await readPartageJpeg(id) // met la variante de partage en cache : la garde doit passer avant le cache
    await suspendreEnBase(user.id)

    await expect(readMediaVariant(id, LARGEUR)).rejects.toMatchObject(INTROUVABLE)
    await expect(readMediaVariantByFilename(id, `${LARGEUR}.webp`)).rejects.toMatchObject(INTROUVABLE)
    await expect(readPartageJpeg(id)).rejects.toMatchObject(INTROUVABLE)
    await expect(readPartageJpeg('identifiant-inconnu')).rejects.toMatchObject(INTROUVABLE)
  })

  it('should serve the images again once the holder is reactivated', async () => {
    const user = await createUser()
    const id = await mediaDe(user.id)
    await suspendreEnBase(user.id)
    await expect(readMediaVariant(id, LARGEUR)).rejects.toMatchObject(INTROUVABLE)

    await reactiverEnBase(user.id)

    expect((await readMediaVariant(id, LARGEUR)).length).toBeGreaterThan(0)
  })

  it('should not suspend the images of another account', async () => {
    const suspendu = await createUser()
    const actif = await createUser()
    const idActif = await mediaDe(actif.id)
    await suspendreEnBase(suspendu.id)

    expect((await readMediaVariant(idActif, LARGEUR)).length).toBeGreaterThan(0)
  })
})
