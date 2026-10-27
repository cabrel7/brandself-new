import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { medias, vitrines } from '../../shared/db/schema'
import { makePng } from '../support/images'
import { fichiersDuMedia } from './support/disque'
import { rejet } from './support/erreurs'
import { createUser, insertMediaRow, insertRealisation, insertRealisationImage, insertService, insertVitrineRow } from './support/fabriques'
import { mediasService, vitrineAcces } from './support/modules'

// Helpers partagés extraits de services.ts par la factorisation S4 (server/services/vitrine-acces.ts).
// CONTRAT ATTENDU :
//   requireVitrineId(userId)                    -> Promise<string>  (id de la vitrine, sinon NotFoundError VITRINE_INTROUVABLE)
//   lockVitrineId(tx, userId)                   -> Promise<string>  (idem, SELECT … FOR UPDATE dans la transaction fournie)
//   requireOwnedMedias(executor, userId, ids)   -> Promise<void>    (UnprocessableError MEDIA_INVALIDE si un id est inconnu ou à autrui ; liste vide = rien)
//   cleanupMedias(userId, ids, contexte)        -> Promise<void>    (deleteMediaIfUnreferenced pour chaque id ; ne rejette JAMAIS)

async function uploader(userId: string): Promise<string> {
  const { uploadMedia } = await mediasService()
  return (await uploadMedia(userId, await makePng(200, 100))).id
}

describe('vitrine-acces — requireVitrineId et lockVitrineId', () => {
  it('should answer the vitrine id of the user, and VITRINE_INTROUVABLE (404) for a user without vitrine', async () => {
    const { requireVitrineId } = await vitrineAcces()
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id)
    const sans = await createUser()

    expect(await requireVitrineId(user.id)).toBe(vitrine.id)
    const erreur = await rejet(requireVitrineId(sans.id))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })

  it('should lock the vitrine inside the transaction and answer its id, or VITRINE_INTROUVABLE', async () => {
    const { lockVitrineId } = await vitrineAcces()
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id)
    const sans = await createUser()

    expect(await db.transaction((tx) => lockVitrineId(tx, user.id))).toBe(vitrine.id)
    expect((await rejet(db.transaction((tx) => lockVitrineId(tx, sans.id)))).code).toBe('VITRINE_INTROUVABLE')
  })

  it('should serialise two transactions on the same vitrine: the second waits for the first to finish (real row lock)', async () => {
    const { lockVitrineId } = await vitrineAcces()
    const user = await createUser()
    await insertVitrineRow(user.id)
    const journal: string[] = []

    const premiere = db.transaction(async (tx) => {
      await lockVitrineId(tx, user.id)
      journal.push('verrou 1')
      await new Promise((resolve) => setTimeout(resolve, 300))
      journal.push('fin 1')
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const seconde = db.transaction(async (tx) => {
      await lockVitrineId(tx, user.id)
      journal.push('verrou 2')
    })
    await Promise.all([premiere, seconde])

    expect(journal).toEqual(['verrou 1', 'fin 1', 'verrou 2'])
  })

  it('should not make two different vitrines wait for each other', async () => {
    const { lockVitrineId } = await vitrineAcces()
    const a = await createUser()
    const b = await createUser()
    await insertVitrineRow(a.id)
    await insertVitrineRow(b.id)
    const journal: string[] = []

    const premiere = db.transaction(async (tx) => {
      await lockVitrineId(tx, a.id)
      await new Promise((resolve) => setTimeout(resolve, 300))
      journal.push('fin A')
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    await db.transaction(async (tx) => {
      await lockVitrineId(tx, b.id)
      journal.push('verrou B')
    })
    await premiere

    expect(journal).toEqual(['verrou B', 'fin A'])
  })
})

describe('vitrine-acces — requireOwnedMedias', () => {
  it('should accept an empty list and a list of media that all belong to the user', async () => {
    const { requireOwnedMedias } = await vitrineAcces()
    const user = await createUser()
    const [m1, m2] = [await insertMediaRow(user.id), await insertMediaRow(user.id)]

    await expect(requireOwnedMedias(db, user.id, [])).resolves.toBeUndefined()
    await expect(requireOwnedMedias(db, user.id, [m1.id, m2.id])).resolves.toBeUndefined()
  })

  it.each([
    ['un média d’un autre utilisateur', async (_u: string, b: string) => [b]],
    ['un identifiant inconnu', async () => [randomUUID()]],
  ])('should refuse %s with MEDIA_INVALIDE (422), even among valid ones', async (_libelle, fabriquer) => {
    const { requireOwnedMedias } = await vitrineAcces()
    const user = await createUser()
    const autre = await createUser()
    const miens = [(await insertMediaRow(user.id)).id, (await insertMediaRow(user.id)).id]
    const intrus = await fabriquer(user.id, (await insertMediaRow(autre.id)).id)

    const erreur = await rejet(requireOwnedMedias(db, user.id, [...miens, ...intrus]))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('MEDIA_INVALIDE')
    expect(erreur.status).toBe(422)
  })

  it('should work inside a transaction too', async () => {
    const { requireOwnedMedias } = await vitrineAcces()
    const user = await createUser()
    const m1 = await insertMediaRow(user.id)

    await expect(db.transaction((tx) => requireOwnedMedias(tx, user.id, [m1.id]))).resolves.toBeUndefined()
    expect((await rejet(db.transaction((tx) => requireOwnedMedias(tx, user.id, [randomUUID()])))).code).toBe('MEDIA_INVALIDE')
  })
})

describe('vitrine-acces — cleanupMedias', () => {
  it('should delete the unreferenced media (row and 3 files) and keep every referenced one', async () => {
    const { cleanupMedias } = await vitrineAcces()
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id)
    const [libre, photo, enService, principale, galerie] = [
      await uploader(user.id), await uploader(user.id), await uploader(user.id), await uploader(user.id), await uploader(user.id),
    ]
    await db.update(vitrines).set({ photoMediaId: photo }).where(eq(vitrines.id, vitrine.id))
    await insertService(vitrine.id, { imageMediaId: enService })
    const ligne = await insertRealisation(vitrine.id, { imageMediaId: principale })
    await insertRealisationImage(ligne.id, galerie, 0)

    await cleanupMedias(user.id, [libre, photo, enService, principale, galerie], 'test')

    expect(await db.select().from(medias).where(eq(medias.id, libre))).toHaveLength(0)
    expect(await fichiersDuMedia(libre)).toHaveLength(0)
    for (const id of [photo, enService, principale, galerie]) {
      expect(await db.select().from(medias).where(eq(medias.id, id)), id).toHaveLength(1)
      expect(await fichiersDuMedia(id), id).toHaveLength(3)
    }
  })

  it('should never delete the media of another user, and never reject (empty list, unknown ids)', async () => {
    const { cleanupMedias } = await vitrineAcces()
    const user = await createUser()
    const autre = await createUser()
    const deB = await uploader(autre.id)

    await expect(cleanupMedias(user.id, [], 'test')).resolves.toBeUndefined()
    await expect(cleanupMedias(user.id, [randomUUID(), deB], 'test')).resolves.toBeUndefined()

    expect(await db.select().from(medias).where(eq(medias.id, deB))).toHaveLength(1)
    expect(await fichiersDuMedia(deB)).toHaveLength(3)
  })
})
