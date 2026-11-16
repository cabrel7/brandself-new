import { describe, expect, it } from 'vitest'
import { MEDIA_WIDTHS } from '../../../shared/medias'
import { readMediaVariant, readMediaVariantByFilename, readPartageJpeg, uploadMedia } from '../../../server/services/medias'
import { makePng } from '../../support/images'
import { fakeEvent } from '../../support/h3'
import { createUser, insertVitrineRow } from '../support/fabriques'
import { bloquerEnBase, debloquerEnBase, reactiverEnBase, suspendreEnBase } from '../support/admin-a2'

// Décision du 2026-11-16 : un compte suspendu (`users.banned`) ou une vitrine bloquée (`blocage_admin`) ne servent
// AUCUNE image, sans exception pour le propriétaire : 404 `MEDIA_INTROUVABLE`, identique à « introuvable » (le visiteur
// ne voit jamais la raison), en `Cache-Control: no-store`. Base et stockage RÉELS.

const LARGEUR = MEDIA_WIDTHS[0]
const INTROUVABLE = { status: 404, code: 'MEDIA_INTROUVABLE' }

async function mediaDe(userId: string): Promise<string> {
  return (await uploadMedia(userId, await makePng(2000, 1500))).id
}

async function toutRefuse(id: string): Promise<void> {
  await expect(readMediaVariant(id, LARGEUR)).rejects.toMatchObject(INTROUVABLE)
  await expect(readMediaVariantByFilename(id, `${LARGEUR}.webp`)).rejects.toMatchObject(INTROUVABLE)
  await expect(readPartageJpeg(id)).rejects.toMatchObject(INTROUVABLE)
}

async function toutServi(id: string): Promise<void> {
  expect((await readMediaVariant(id, LARGEUR)).length).toBeGreaterThan(0)
  expect((await readMediaVariantByFilename(id, `${LARGEUR}.webp`)).data.length).toBeGreaterThan(0)
  expect((await readPartageJpeg(id)).length).toBeGreaterThan(0)
}

describe('images d\'un titulaire suspendu', () => {
  it('should serve the variants and the share image of an active account (control)', async () => {
    const user = await createUser()
    await toutServi(await mediaDe(user.id))
  })

  it('should answer the same 404 as an unknown media for every variant once the holder is suspended, even if the share image is cached', async () => {
    const user = await createUser()
    const id = await mediaDe(user.id)
    await readPartageJpeg(id) // met la variante de partage en cache : la garde doit passer avant le cache
    await suspendreEnBase(user.id)

    await toutRefuse(id)
    await expect(readPartageJpeg('identifiant-inconnu')).rejects.toMatchObject(INTROUVABLE)
  })

  it('should serve the images again once the holder is reactivated', async () => {
    const user = await createUser()
    const id = await mediaDe(user.id)
    await suspendreEnBase(user.id)
    await expect(readMediaVariant(id, LARGEUR)).rejects.toMatchObject(INTROUVABLE)

    await reactiverEnBase(user.id)

    await toutServi(id)
  })

  it('should not suspend the images of another account', async () => {
    const suspendu = await createUser()
    const actif = await createUser()
    const idActif = await mediaDe(actif.id)
    await suspendreEnBase(suspendu.id)

    await toutServi(idActif)
  })
})

describe('images d\'une vitrine bloquée par l\'administration (blocage_admin)', () => {
  it('should refuse every variant, the share image included (even cached), with the same 404, for an ACTIVE owner', async () => {
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { publiee: true })
    const id = await mediaDe(user.id)
    await readPartageJpeg(id)
    await bloquerEnBase(vitrine.id)

    await toutRefuse(id)
  })

  it('should serve the images again once the block is lifted', async () => {
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { publiee: true })
    const id = await mediaDe(user.id)
    await bloquerEnBase(vitrine.id)
    await expect(readMediaVariant(id, LARGEUR)).rejects.toMatchObject(INTROUVABLE)

    await debloquerEnBase(vitrine.id)

    await toutServi(id)
  })

  it('should keep serving an active owner whose vitrine is not blocked, and a blocked vitrine does not affect another account', async () => {
    const proprietaire = await createUser()
    await insertVitrineRow(proprietaire.id, { publiee: true })
    const idProprietaire = await mediaDe(proprietaire.id)
    const bloque = await createUser()
    const vitrineBloquee = await insertVitrineRow(bloque.id, { publiee: true })
    await bloquerEnBase(vitrineBloquee.id)

    await toutServi(idProprietaire)
  })

  it('should serve a holder without any vitrine (no block to apply)', async () => {
    const user = await createUser()
    await toutServi(await mediaDe(user.id))
  })
})

describe('route /medias/[id]/[fichier] : 404 en no-store', () => {
  async function appeler(id: string, fichier: string) {
    const { default: handler } = await import('../../../server/routes/medias/[id]/[fichier].get')
    const event = fakeEvent({ url: `/medias/${id}/${fichier}`, params: { id, fichier } })
    const corps = await handler(event)
    return { corps, statut: event.node.res.statusCode, enTetes: event.node.res.getHeaders() }
  }

  it('should answer a served image with the public immutable cache header (control)', async () => {
    const user = await createUser()
    const id = await mediaDe(user.id)

    const reponse = await appeler(id, `${LARGEUR}.webp`)

    expect(reponse.statut).toBe(200)
    expect(String(reponse.enTetes['cache-control'])).toContain('immutable')
  })

  it.each([
    ['compte suspendu', async (userId: string) => suspendreEnBase(userId)],
    ['vitrine bloquée', async (userId: string) => {
      const vitrine = await insertVitrineRow(userId, { publiee: true })
      await bloquerEnBase(vitrine.id)
    }],
  ])('should answer 404 MEDIA_INTROUVABLE with Cache-Control no-store (never public or immutable): %s', async (_cas, masquer) => {
    const user = await createUser()
    const id = await mediaDe(user.id)
    await masquer(user.id)

    for (const fichier of [`${LARGEUR}.webp`, 'partage.jpg']) {
      const reponse = await appeler(id, fichier)
      expect(reponse.statut).toBe(404)
      expect(reponse.enTetes['cache-control']).toBe('no-store')
      expect(reponse.corps).toMatchObject({ statusCode: 404, data: { code: 'MEDIA_INTROUVABLE' } })
    }
  })

  it('should answer an unknown media and a malformed file name with the same no-store 404', async () => {
    const inconnu = await appeler('identifiant-inconnu', `${LARGEUR}.webp`)
    const malForme = await appeler('identifiant-inconnu', 'x.png')

    for (const reponse of [inconnu, malForme]) {
      expect(reponse.statut).toBe(404)
      expect(reponse.enTetes['cache-control']).toBe('no-store')
      expect(reponse.corps).toMatchObject({ data: { code: 'MEDIA_INTROUVABLE' } })
    }
  })
})
