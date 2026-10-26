import { randomUUID } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { medias, vitrines } from '../../shared/db/schema'
import { mediaSrcset } from '../../shared/medias'
import { schemaVitrineUpdate } from '../../shared/schemas/vitrine'
import { USERNAME_CHECK_LIMIT } from '../../shared/limites'
import { displayName } from '../../shared/vitrine'
import type { VitrineCreateInput } from '../../shared/schemas/vitrine'
import { makePng } from '../support/images'
import { fichiersDuMedia } from './support/disque'
import { erreurPostgres, rejet } from './support/erreurs'
import {
  createUser,
  insertLien,
  insertMediaRow,
  insertRealisation,
  insertService,
  insertTemoignage,
  insertVitrineRow,
  type UserRow,
} from './support/fabriques'
import {
  mediasService,
  ressourceVitrine,
  vitrinesService,
} from './support/modules'

// Vrai PostgreSQL (migrations réelles, dont 0009), vrai Redis, vrai disque. Aucun mock.
// Un test par critère d'acceptation : le nom commence par « CAn ».

function donneesCreation(username: string, surcharges: Partial<VitrineCreateInput> = {}): VitrineCreateInput {
  return { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username, ...surcharges }
}

async function ligneVitrine(userId: string) {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.userId, userId))
  return ligne
}

async function creerVitrineComplete(user: UserRow, username = 'dr-test'): Promise<void> {
  const { createVitrine, updateVitrine } = await vitrinesService()
  await createVitrine(user.id, donneesCreation(username))
  await updateVitrine(user.id, schemaVitrineUpdate.parse({ ville: 'Douala', pays: 'CM' }))
}

async function uploaderPhoto(userId: string): Promise<string> {
  const { uploadMedia } = await mediasService()
  const media = await uploadMedia(userId, await makePng(300, 200))
  return media.id
}

describe('vitrines — création (CA1 à CA3)', () => {
  it('CA1 should create the vitrine with the account timezone, the default palette and null ville/pays', async () => {
    const { createVitrine } = await vitrinesService()
    const user = await createUser({ fuseau: 'Europe/Paris' })

    await createVitrine(user.id, donneesCreation('dr-test'))

    const ligne = await ligneVitrine(user.id)
    expect(ligne).toMatchObject({
      userId: user.id,
      username: 'dr-test',
      titre: 'dr',
      prenom: 'Cabrel',
      nom: 'Nguesso',
      metier: 'Cardiologue',
      fuseau: 'Europe/Paris',
      palette: 'terracotta',
      ville: null,
      pays: null,
      photoMediaId: null,
      publieeLe: null,
    })
    expect(displayName('dr', ligne.prenom, ligne.nom)).toBe('Dr Cabrel Nguesso')
  })

  it('CA1 should expose the created vitrine as a studio DTO with nomAffiche "Dr Cabrel Nguesso"', async () => {
    const { createVitrine, getOwnVitrine } = await vitrinesService()
    const { toVitrineStudioResource } = await ressourceVitrine()
    const user = await createUser()
    await createVitrine(user.id, donneesCreation('dr-test'))

    const dto = toVitrineStudioResource(await getOwnVitrine(user.id))

    expect(dto).toMatchObject({
      username: 'dr-test',
      titre: 'dr',
      nomAffiche: 'Dr Cabrel Nguesso',
      ville: null,
      pays: null,
      photo: null,
      palette: 'terracotta',
      publiee: false,
      publieeLe: null,
    })
  })

  it('CA1 should create a vitrine without titre (null) and keep nomAffiche without prefix', async () => {
    const { createVitrine } = await vitrinesService()
    const user = await createUser()

    await createVitrine(user.id, donneesCreation('sans-titre', { titre: null }))

    const ligne = await ligneVitrine(user.id)
    expect(ligne.titre).toBeNull()
    expect(displayName(null, ligne.prenom, ligne.nom)).toBe('Cabrel Nguesso')
  })

  it('CA2 should reject a second vitrine for the same user with VITRINE_EXISTE and keep the first one', async () => {
    const { createVitrine } = await vitrinesService()
    const user = await createUser()
    await createVitrine(user.id, donneesCreation('premiere'))

    const erreur = await rejet(createVitrine(user.id, donneesCreation('seconde')))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_EXISTE')
    expect(erreur.status).toBe(409)
    const lignes = await db.select().from(vitrines).where(eq(vitrines.userId, user.id))
    expect(lignes.map((l) => l.username)).toEqual(['premiere'])
  })

  it('CA3 should reject a username already used by another user with USERNAME_PRIS', async () => {
    const { createVitrine } = await vitrinesService()
    const premier = await createUser()
    const second = await createUser()
    await createVitrine(premier.id, donneesCreation('pris'))

    const erreur = await rejet(createVitrine(second.id, donneesCreation('pris')))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('USERNAME_PRIS')
    expect(erreur.status).toBe(409)
    expect(await ligneVitrine(second.id)).toBeUndefined()
  })

  it('CA3 should let exactly one of two simultaneous creations win and never raise a raw error (no 500)', async () => {
    const { createVitrine } = await vitrinesService()
    const TOURS = 5

    for (let tour = 0; tour < TOURS; tour += 1) {
      const a = await createUser()
      const b = await createUser()
      const username = `course-${tour}`

      const resultats = await Promise.allSettled([
        createVitrine(a.id, donneesCreation(username)),
        createVitrine(b.id, donneesCreation(username)),
      ])

      const reussis = resultats.filter((r) => r.status === 'fulfilled')
      const echecs = resultats.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      expect(reussis).toHaveLength(1)
      expect(echecs).toHaveLength(1)
      const erreur = await rejet(Promise.reject(echecs[0].reason))
      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('USERNAME_PRIS')
      const lignes = await db.select().from(vitrines).where(eq(vitrines.username, username))
      expect(lignes).toHaveLength(1)
    }
  })

  it('CA3 should turn a same-user double submit into a business error (VITRINE_EXISTE or USERNAME_PRIS), never a raw one', async () => {
    const { createVitrine } = await vitrinesService()
    const user = await createUser()

    const resultats = await Promise.allSettled([
      createVitrine(user.id, donneesCreation('double-clic')),
      createVitrine(user.id, donneesCreation('double-clic')),
    ])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const echec = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    const erreur = await rejet(Promise.reject(echec?.reason))
    expect(erreur.estDomainError).toBe(true)
    expect(['VITRINE_EXISTE', 'USERNAME_PRIS']).toContain(erreur.code)
    expect(await db.select().from(vitrines).where(eq(vitrines.userId, user.id))).toHaveLength(1)
  })
})

describe('vitrines — mise à jour (CA4, CA6 à CA9)', () => {
  it('CA4 should only change the field that was sent', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ accroche: 'Cardiologue à votre écoute', bio: 'Ma présentation', palette: 'sauge' }))
    const avant = await ligneVitrine(user.id)

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ ville: 'Yaoundé' }))

    const apres = await ligneVitrine(user.id)
    expect(apres.ville).toBe('Yaoundé')
    expect({ ...apres, ville: avant.ville, updatedAt: avant.updatedAt }).toEqual(avant)
  })

  it('CA4 should store empty and blank strings as NULL', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ accroche: 'Une accroche', bio: 'Une bio', emailContact: 'contact@exemple.com', telephone: '+237600000000' }))

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ accroche: '', bio: '   ', emailContact: '', telephone: '' }))

    expect(await ligneVitrine(user.id)).toMatchObject({ accroche: null, bio: null, emailContact: null, telephone: null })
  })

  it('CA4 should persist contact, whatsapp and palette fields', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ whatsapp: '+237699999999', emailContact: 'contact@exemple.com', palette: 'bordeaux', titre: 'pr' }))

    expect(await ligneVitrine(user.id)).toMatchObject({
      whatsapp: '+237699999999',
      emailContact: 'contact@exemple.com',
      palette: 'bordeaux',
      titre: 'pr',
    })
  })

  it('CA4 should fail with VITRINE_INTROUVABLE when the user has no vitrine', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()

    const erreur = await rejet(updateVitrine(user.id, schemaVitrineUpdate.parse({ ville: 'Douala' })))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA6 should reject a photoMediaId owned by another user with MEDIA_INVALIDE and leave the vitrine unchanged', async () => {
    const { updateVitrine } = await vitrinesService()
    const a = await createUser()
    const b = await createUser()
    await creerVitrineComplete(a)
    const mediaDeB = await insertMediaRow(b.id)
    const avant = await ligneVitrine(a.id)

    const erreur = await rejet(
      updateVitrine(a.id, schemaVitrineUpdate.parse({ photoMediaId: mediaDeB.id, ville: 'Yaoundé' })),
    )

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('MEDIA_INVALIDE')
    expect(erreur.status).toBe(422)
    expect(await ligneVitrine(a.id)).toEqual(avant)
    expect(await db.select().from(medias).where(eq(medias.id, mediaDeB.id))).toHaveLength(1)
  })

  it('CA6 should reject a photoMediaId that does not exist with MEDIA_INVALIDE', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)

    const erreur = await rejet(updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: randomUUID() })))

    expect(erreur.code).toBe('MEDIA_INVALIDE')
    expect((await ligneVitrine(user.id)).photoMediaId).toBeNull()
  })

  it('CA7 should delete the old photo row and its 3 files when the photo is replaced', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    const ancienne = await uploaderPhoto(user.id)
    const nouvelle = await uploaderPhoto(user.id)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: ancienne }))
    expect(await fichiersDuMedia(ancienne)).toHaveLength(3)

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: nouvelle }))

    expect(await db.select().from(medias).where(eq(medias.id, ancienne))).toHaveLength(0)
    expect(await fichiersDuMedia(ancienne)).toHaveLength(0)
    expect(await db.select().from(medias).where(eq(medias.id, nouvelle))).toHaveLength(1)
    expect(await fichiersDuMedia(nouvelle)).toHaveLength(3)
    expect((await ligneVitrine(user.id)).photoMediaId).toBe(nouvelle)
  })

  it('CA7 should keep the old photo when it is still referenced elsewhere (a service image)', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    const ancienne = await uploaderPhoto(user.id)
    const nouvelle = await uploaderPhoto(user.id)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: ancienne }))
    const vitrine = await ligneVitrine(user.id)
    await insertService(vitrine.id, { imageMediaId: ancienne })

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: nouvelle }))

    expect(await db.select().from(medias).where(eq(medias.id, ancienne))).toHaveLength(1)
    expect(await fichiersDuMedia(ancienne)).toHaveLength(3)
  })

  it('CA7 should keep the photo when the same photoMediaId is sent again', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    const photo = await uploaderPhoto(user.id)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: photo }))

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: photo, bio: 'Nouvelle présentation' }))

    expect(await db.select().from(medias).where(eq(medias.id, photo))).toHaveLength(1)
    expect(await fichiersDuMedia(photo)).toHaveLength(3)
  })

  it('CA7 should delete the old photo when photoMediaId is set to null', async () => {
    const { updateVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    const photo = await uploaderPhoto(user.id)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: photo }))

    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: null }))

    expect((await ligneVitrine(user.id)).photoMediaId).toBeNull()
    expect(await db.select().from(medias).where(eq(medias.id, photo))).toHaveLength(0)
    expect(await fichiersDuMedia(photo)).toHaveLength(0)
  })

  it('CA8 should reset photo_media_id to NULL when the media is deleted through the service', async () => {
    const { updateVitrine } = await vitrinesService()
    const { deleteMedia } = await mediasService()
    const user = await createUser()
    await creerVitrineComplete(user)
    const photo = await uploaderPhoto(user.id)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: photo }))

    await deleteMedia(user.id, photo)

    expect((await ligneVitrine(user.id)).photoMediaId).toBeNull()
  })

  it('CA8 should reset photo_media_id to NULL (FK ON DELETE SET NULL) when the media row is deleted directly', async () => {
    const user = await createUser()
    const media = await insertMediaRow(user.id)
    const vitrine = await insertVitrineRow(user.id)
    await db.update(vitrines).set({ photoMediaId: media.id }).where(eq(vitrines.id, vitrine.id))

    await db.delete(medias).where(eq(medias.id, media.id))

    expect((await ligneVitrine(user.id)).photoMediaId).toBeNull()
  })

  describe('CA9 contraintes CHECK de la migration 0009', () => {
    const valeursValides = {
      titre: 'dr',
      prenom: 'Cabrel',
      nom: 'Nguesso',
      metier: 'Cardiologue',
      pays: 'CM',
      palette: 'terracotta',
    }

    it.each([
      ['palette inconnue', { palette: 'rose' }, 'vitrines_palette_check'],
      ['titre inconnu', { titre: 'docteur' }, 'vitrines_titre_check'],
      ['pays en toutes lettres', { pays: 'Cameroun' }, 'vitrines_pays_check'],
      ['pays en minuscules', { pays: 'cm' }, 'vitrines_pays_check'],
      ['username avec majuscule et underscore', { username: 'Bad_Name' }, 'vitrines_username_format_check'],
      ['username trop court', { username: 'ab' }, 'vitrines_username_format_check'],
      ['username trop long', { username: 'a'.repeat(31) }, 'vitrines_username_format_check'],
      ['username avec double tiret', { username: 'a--b' }, 'vitrines_username_format_check'],
      ['username finissant par un tiret', { username: 'abc-' }, 'vitrines_username_format_check'],
    ])('CA9 should reject an invalid INSERT (%s) with a CHECK violation', async (_libelle, invalide, contrainte) => {
      const user = await createUser()

      const erreur = await rejet(
        db.insert(vitrines).values({ id: randomUUID(), userId: user.id, username: 'valide', ...valeursValides, ...invalide }).then(() => undefined),
      )

      expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23514', contrainte })
    })

    it('CA9 should accept titre and pays set to NULL', async () => {
      const user = await createUser()

      await db.insert(vitrines).values({ id: randomUUID(), userId: user.id, username: 'sans-titre', prenom: 'A', nom: 'B', metier: 'C', titre: null, pays: null, ville: null })

      expect(await ligneVitrine(user.id)).toMatchObject({ titre: null, pays: null, ville: null })
    })

    it('CA9 should reject a media with a non-positive size (medias_taille_check)', async () => {
      const user = await createUser()

      const erreur = await rejet(insertMediaRow(user.id, { taille: 0 }).then(() => undefined))

      expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23514', contrainte: 'medias_taille_check' })
    })

    it('CA9 should reject a photo_media_id that points to no media (FK)', async () => {
      const user = await createUser()
      const vitrine = await insertVitrineRow(user.id)

      const erreur = await rejet(
        db.update(vitrines).set({ photoMediaId: randomUUID() }).where(eq(vitrines.id, vitrine.id)).then(() => undefined),
      )

      expect(erreurPostgres(erreur.brute).sqlstate).toBe('23503')
    })

    it('CA9 should name the uniqueness constraints vitrines_username_unique and vitrines_user_id_unique', async () => {
      const resultat = await db.execute<{ conname: string }>(sql`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'vitrines'::regclass AND contype = 'u'
        ORDER BY conname`)

      expect(resultat.rows.map((r) => r.conname)).toEqual(['vitrines_user_id_unique', 'vitrines_username_unique'])
    })
  })
})

describe('vitrines — publication (CA10 à CA13)', () => {
  it('CA10 should refuse to publish when ville and pays are missing and list them in manquants', async () => {
    const { createVitrine, publishVitrine } = await vitrinesService()
    const user = await createUser()
    await createVitrine(user.id, donneesCreation('incomplete'))

    const erreur = await rejet(publishVitrine(user.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('PUBLICATION_INCOMPLETE')
    expect(erreur.status).toBe(422)
    expect(erreur.data?.manquants).toEqual(['ville', 'pays'])
    expect((await ligneVitrine(user.id)).publieeLe).toBeNull()
  })

  it('CA10 should list only the field that is still missing', async () => {
    const { createVitrine, updateVitrine, publishVitrine } = await vitrinesService()
    const user = await createUser()
    await createVitrine(user.id, donneesCreation('presque'))
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ ville: 'Douala' }))

    const erreur = await rejet(publishVitrine(user.id))

    expect(erreur.data?.manquants).toEqual(['pays'])
  })

  it('CA10 should fail with VITRINE_INTROUVABLE when publishing without a vitrine', async () => {
    const { publishVitrine } = await vitrinesService()
    const user = await createUser()

    const erreur = await rejet(publishVitrine(user.id))

    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA11 should publish without a photo and keep publiee_le unchanged on a second publication', async () => {
    const { publishVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)

    await publishVitrine(user.id)
    const premiere = (await ligneVitrine(user.id)).publieeLe
    await publishVitrine(user.id)
    const seconde = (await ligneVitrine(user.id)).publieeLe

    expect(premiere).toBeInstanceOf(Date)
    expect(seconde?.getTime()).toBe(premiere?.getTime())
  })

  it('CA11 should not move publiee_le when two publications run at the same time', async () => {
    const { publishVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)

    await Promise.all([publishVitrine(user.id), publishVitrine(user.id), publishVitrine(user.id)])

    expect((await ligneVitrine(user.id)).publieeLe).toBeInstanceOf(Date)
  })

  it('CA12 should make getPublicVitrine fail with VITRINE_INTROUVABLE once the vitrine is unpublished', async () => {
    const { publishVitrine, unpublishVitrine, getPublicVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)
    await publishVitrine(user.id)
    await expect(getPublicVitrine('dr-test')).resolves.toBeDefined()

    await unpublishVitrine(user.id)

    const erreur = await rejet(getPublicVitrine('dr-test'))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })

  it('CA12 should not expose a vitrine that was never published', async () => {
    const { getPublicVitrine } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user)

    const erreur = await rejet(getPublicVitrine('dr-test'))

    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA12 should fail with VITRINE_INTROUVABLE when unpublishing without a vitrine', async () => {
    const { unpublishVitrine } = await vitrinesService()
    const user = await createUser()

    const erreur = await rejet(unpublishVitrine(user.id))

    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  describe('CA13 vitrine publique', () => {
    const EMAIL_COMPTE = 'compte-prive@exemple.com'
    const TELEPHONE_COMPTE = '+237600000001'
    const CLES_ATTENDUES = [
      'accroche', 'bio', 'contact', 'fuseau', 'metier', 'nom', 'nomAffiche', 'palette', 'paysLibelle',
      'pays', 'photo', 'prenom', 'seo', 'titre', 'username', 'ville',
    ].sort()

    async function publierAvecPhoto() {
      const { createVitrine, updateVitrine, publishVitrine } = await vitrinesService()
      const user = await createUser({ email: EMAIL_COMPTE, phoneNumber: TELEPHONE_COMPTE })
      await createVitrine(user.id, donneesCreation('dr-test'))
      const photo = await uploaderPhoto(user.id)
      await updateVitrine(user.id, schemaVitrineUpdate.parse({
        ville: 'Douala',
        pays: 'CM',
        photoMediaId: photo,
        emailContact: 'contact@cabinet.cm',
        telephone: '+237699000000',
      }))
      await publishVitrine(user.id)
      return { user, photo, vitrine: await ligneVitrine(user.id) }
    }

    it('CA13 should return exactly the VitrinePubliqueDTO keys, the 1600 photo url and the computed seo', async () => {
      const { getPublicVitrine } = await vitrinesService()
      const { toVitrinePublicResource } = await ressourceVitrine()
      const { photo } = await publierAvecPhoto()

      const dto = toVitrinePublicResource(await getPublicVitrine('dr-test'))

      expect(Object.keys(dto).sort()).toEqual(CLES_ATTENDUES)
      expect(dto).toMatchObject({
        username: 'dr-test',
        titre: 'dr',
        nomAffiche: 'Dr Cabrel Nguesso',
        prenom: 'Cabrel',
        nom: 'Nguesso',
        metier: 'Cardiologue',
        ville: 'Douala',
        pays: 'CM',
        paysLibelle: 'Cameroun',
        palette: 'terracotta',
        fuseau: 'Africa/Douala',
        seo: {
          titre: 'Dr Cabrel Nguesso — Cardiologue à Douala',
          description: 'Dr Cabrel Nguesso, Cardiologue à Douala.',
        },
        contact: { email: 'contact@cabinet.cm', telephone: '+237699000000', whatsapp: null },
      })
      expect(Object.keys(dto.contact).sort()).toEqual(['email', 'telephone', 'whatsapp'])
      expect(dto.photo).toMatchObject({ id: photo, url: `/medias/${photo}/1600.webp`, srcset: mediaSrcset(photo) })
      expect(Object.keys(dto.photo ?? {}).sort()).toEqual(['hauteur', 'id', 'largeur', 'srcset', 'url'])
    })

    it('CA13 should never expose the account email/phone, user id, vitrine id or storage path', async () => {
      const { getPublicVitrine } = await vitrinesService()
      const { toVitrinePublicResource } = await ressourceVitrine()
      const { user, vitrine, photo } = await publierAvecPhoto()

      const json = JSON.stringify(toVitrinePublicResource(await getPublicVitrine('dr-test')))

      for (const secret of [EMAIL_COMPTE, TELEPHONE_COMPTE, user.id, vitrine.id, `${user.id}/${photo}`, 'sectionsMasquees', 'preavisHeures', '"disk"', '"userId"', '"chemin"']) {
        expect(json).not.toContain(secret)
      }
    })

    it('CA13 should use the accroche as seo description and the stored seo overrides when present', async () => {
      const { updateVitrine, getPublicVitrine } = await vitrinesService()
      const { toVitrinePublicResource } = await ressourceVitrine()
      const { user, vitrine } = await publierAvecPhoto()
      await updateVitrine(user.id, schemaVitrineUpdate.parse({ accroche: 'Votre cœur entre de bonnes mains' }))

      const avecAccroche = toVitrinePublicResource(await getPublicVitrine('dr-test'))
      await db.update(vitrines).set({ seoTitre: 'Titre SEO sur mesure', seoDescription: 'Description SEO sur mesure' }).where(eq(vitrines.id, vitrine.id))
      const avecSurcharge = toVitrinePublicResource(await getPublicVitrine('dr-test'))

      expect(avecAccroche.seo.description).toBe('Votre cœur entre de bonnes mains')
      expect(avecSurcharge.seo).toEqual({ titre: 'Titre SEO sur mesure', description: 'Description SEO sur mesure' })
    })

    it('CA13 should return a null photo when the vitrine has none', async () => {
      const { getPublicVitrine, publishVitrine } = await vitrinesService()
      const { toVitrinePublicResource } = await ressourceVitrine()
      const user = await createUser()
      await creerVitrineComplete(user)
      await publishVitrine(user.id)

      const dto = toVitrinePublicResource(await getPublicVitrine('dr-test'))

      expect(dto.photo).toBeNull()
    })

    it('CA13 should normalise the username (DR-TEST finds dr-test)', async () => {
      const { getPublicVitrine } = await vitrinesService()
      const { toVitrinePublicResource } = await ressourceVitrine()
      await publierAvecPhoto()

      const dto = toVitrinePublicResource(await getPublicVitrine('DR-TEST'))

      expect(dto.username).toBe('dr-test')
    })

    it.each([
      ['inconnu', 'inconnu'],
      ['format invalide (underscore)', 'Bad_Name'],
      ['format invalide (injection SQL)', "dr-test'; DROP TABLE vitrines;--"],
      ['chaîne vide', ''],
      ['trop long', 'a'.repeat(300)],
      ['mot réservé', 'studio'],
    ])('CA13 should throw VITRINE_INTROUVABLE for %s', async (_libelle, saisie) => {
      const { getPublicVitrine } = await vitrinesService()
      await publierAvecPhoto()

      const erreur = await rejet(getPublicVitrine(saisie))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('VITRINE_INTROUVABLE')
      expect(await db.select().from(vitrines)).toHaveLength(1)
    })
  })
})

describe('vitrines — username (CA14 à CA16)', () => {
  it('CA14 should answer "actuel" for the username the user already owns', async () => {
    const { checkUsernameAvailability } = await vitrinesService()
    const user = await createUser()
    await creerVitrineComplete(user, 'mon-nom')

    const reponse = await checkUsernameAvailability(user.id, 'mon-nom')

    expect(reponse).toMatchObject({ username: 'mon-nom', raison: 'actuel' })
  })

  it('CA14 should answer "pris" and not available for a username owned by another user', async () => {
    const { checkUsernameAvailability } = await vitrinesService()
    const proprietaire = await createUser()
    const visiteur = await createUser()
    await creerVitrineComplete(proprietaire, 'deja-pris')

    const reponse = await checkUsernameAvailability(visiteur.id, 'deja-pris')

    expect(reponse).toMatchObject({ raison: 'pris', disponible: false })
  })

  it('CA14 should answer "pris" whatever the case of the input', async () => {
    const { checkUsernameAvailability } = await vitrinesService()
    const proprietaire = await createUser()
    const visiteur = await createUser()
    await creerVitrineComplete(proprietaire, 'deja-pris')

    const reponse = await checkUsernameAvailability(visiteur.id, 'DEJA-Pris')

    expect(reponse).toMatchObject({ username: 'deja-pris', raison: 'pris' })
  })

  it.each(['admin', 'medias', 'services', 'studio'])('CA14 should answer "reserve" for the reserved word %s', async (mot) => {
    const { checkUsernameAvailability } = await vitrinesService()
    const user = await createUser()

    const reponse = await checkUsernameAvailability(user.id, mot)

    expect(reponse).toMatchObject({ raison: 'reserve', disponible: false })
  })

  it.each(['ab', 'Bad_Name', 'a--b', '-abc', 'a'.repeat(31), 'avec espace'])('CA14 should answer "format" for %j', async (saisie) => {
    const { checkUsernameAvailability } = await vitrinesService()
    const user = await createUser()

    const reponse = await checkUsernameAvailability(user.id, saisie)

    expect(reponse).toMatchObject({ raison: 'format', disponible: false })
  })

  it('CA14 should answer "libre" and available for a free username', async () => {
    const { checkUsernameAvailability } = await vitrinesService()
    const user = await createUser()

    const reponse = await checkUsernameAvailability(user.id, 'tout-neuf')

    expect(reponse).toMatchObject({ username: 'tout-neuf', raison: 'libre', disponible: true })
  })

  it('CA15 should throw TooManyRequestsError with a positive retryAfter on the 31st call within the minute, without limiting another user', async () => {
    const { checkUsernameAvailability } = await vitrinesService()
    const a = await createUser()
    const b = await createUser()
    for (let i = 0; i < USERNAME_CHECK_LIMIT.limit; i += 1) {
      await checkUsernameAvailability(a.id, 'libre-nom')
    }

    const erreur = await rejet(checkUsernameAvailability(a.id, 'libre-nom'))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('TROP_DE_REQUETES')
    expect(erreur.status).toBe(429)
    expect(erreur.retryAfter).toBeGreaterThan(0)
    await expect(checkUsernameAvailability(b.id, 'libre-nom')).resolves.toMatchObject({ raison: 'libre' })
  })

  it('CA16 should refuse to change to a username already taken with USERNAME_PRIS', async () => {
    const { changeUsername } = await vitrinesService()
    const a = await createUser()
    const b = await createUser()
    await creerVitrineComplete(a, 'nom-a')
    await creerVitrineComplete(b, 'nom-b')

    const erreur = await rejet(changeUsername(a.id, 'nom-b'))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('USERNAME_PRIS')
    expect((await ligneVitrine(a.id)).username).toBe('nom-a')
  })

  it('CA16 should change to a free username and release the previous one', async () => {
    const { changeUsername, createVitrine } = await vitrinesService()
    const a = await createUser()
    const b = await createUser()
    await creerVitrineComplete(a, 'ancien-nom')

    await changeUsername(a.id, 'nouveau-nom')

    expect((await ligneVitrine(a.id)).username).toBe('nouveau-nom')
    await createVitrine(b.id, donneesCreation('ancien-nom'))
    expect((await ligneVitrine(b.id)).username).toBe('ancien-nom')
  })

  it('CA16 should fail with VITRINE_INTROUVABLE when the user has no vitrine', async () => {
    const { changeUsername } = await vitrinesService()
    const user = await createUser()

    const erreur = await rejet(changeUsername(user.id, 'nouveau-nom'))

    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA16 should let exactly one of two simultaneous changes to the same username win, the other getting USERNAME_PRIS', async () => {
    const { changeUsername } = await vitrinesService()
    const a = await createUser()
    const b = await createUser()
    await creerVitrineComplete(a, 'nom-a')
    await creerVitrineComplete(b, 'nom-b')

    const resultats = await Promise.allSettled([changeUsername(a.id, 'convoite'), changeUsername(b.id, 'convoite')])

    expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const echec = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
    const erreur = await rejet(Promise.reject(echec?.reason))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('USERNAME_PRIS')
    expect(await db.select().from(vitrines).where(eq(vitrines.username, 'convoite'))).toHaveLength(1)
  })
})

describe('vitrines — résumé du studio (CA17)', () => {
  it('CA17 should count only the active rows of the user vitrine', async () => {
    const { getStudioSummary } = await vitrinesService()
    const { toStudioResumeResource } = await ressourceVitrine()
    const a = await createUser()
    const b = await createUser()
    await creerVitrineComplete(a, 'vitrine-a')
    await creerVitrineComplete(b, 'vitrine-b')
    const vitrineA = await ligneVitrine(a.id)
    const vitrineB = await ligneVitrine(b.id)
    await insertService(vitrineA.id)
    await insertService(vitrineA.id)
    await insertService(vitrineA.id, { actif: false })
    await insertRealisation(vitrineA.id)
    await insertTemoignage(vitrineA.id, { actif: false })
    await insertLien(vitrineA.id)
    await insertLien(vitrineA.id)
    await insertLien(vitrineA.id)
    await insertService(vitrineB.id)
    await insertRealisation(vitrineB.id)
    await insertRealisation(vitrineB.id)

    const resume = toStudioResumeResource(await getStudioSummary(a.id))

    expect(resume.compteurs).toEqual({ services: 2, realisations: 1, temoignages: 0, liens: 3 })
  })

  it('CA17 should propose the next step "photo" first, then "service", then "realisation", then none', async () => {
    const { getStudioSummary, updateVitrine } = await vitrinesService()
    const { toStudioResumeResource } = await ressourceVitrine()
    const user = await createUser()
    await creerVitrineComplete(user)
    const vitrine = await ligneVitrine(user.id)
    const etape = async () => toStudioResumeResource(await getStudioSummary(user.id)).prochaineEtape

    expect(await etape()).toBe('photo')

    const photo = await uploaderPhoto(user.id)
    await updateVitrine(user.id, schemaVitrineUpdate.parse({ photoMediaId: photo }))
    expect(await etape()).toBe('service')

    await insertService(vitrine.id, { actif: false }) // un service inactif ne compte pas
    expect(await etape()).toBe('service')
    await insertService(vitrine.id)
    expect(await etape()).toBe('realisation')

    await insertRealisation(vitrine.id)
    expect(await etape()).toBeNull()
  })

  it('CA17 should list the fields still missing to publish and zero statistics', async () => {
    const { createVitrine, getStudioSummary } = await vitrinesService()
    const { toStudioResumeResource } = await ressourceVitrine()
    const user = await createUser()
    await createVitrine(user.id, donneesCreation('a-completer'))

    const resume = toStudioResumeResource(await getStudioSummary(user.id))

    expect(resume.manquantsPourPublier).toEqual(['ville', 'pays'])
    expect(resume.statistiques7j).toEqual({ visites: 0, clics: 0, reservations: 0 })
  })
})
