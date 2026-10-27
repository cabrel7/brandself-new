import { randomUUID } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { Client } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { db } from '../../server/utils/db'
import { medias, realisations, users, vitrines } from '../../shared/db/schema'
import { schemaRealisationCreate, schemaRealisationUpdate } from '../../shared/schemas/realisation'
import { makePng } from '../support/images'
import { fichiersDuMedia } from './support/disque'
import { erreurPostgres, exigerModulesPresents, rejet } from './support/erreurs'
import {
  createUser,
  insertMediaRow,
  insertRealisation,
  insertRealisationImage,
  insertService,
  insertVitrineRow,
} from './support/fabriques'
import { mediasService, realisationsService, ressourceRealisation } from './support/modules'
import {
  creer,
  galerieEnBase,
  ligneRealisation,
  lignesDeGalerie,
  lignesDeLaVitrine,
  modifier,
  ordreContraireDuTri,
  toutesLesLignesDeGalerie,
} from './support/realisations'
import { UUID_V4_OU_V7, creerVitrinePubliee } from './support/services'

// Vrai PostgreSQL (migrations réelles, dont 0011), vrai Redis, vrai disque. Aucun mock : ni la base,
// ni le stockage, ni la couche service. Un test par critère d'acceptation : le nom commence par « CAn »
// (spec S4 §7, préfixe S4-CA). S4-CA41 (compteurs de navigation) est dans vitrines.test.ts, S4-CA42 dans medias.test.ts.

const PAUSE_HORODATAGE_MS = 15
const MESSAGE_ORDRE_INVALIDE = "L'ordre envoyé n'est plus à jour. Rechargez la page et réessayez."

/** Les messages utilisent l'apostrophe typographique du projet : on tolère les deux. */
const sansTypographie = (texte: string) => texte.replaceAll('’', "'")

async function uploaderImage(userId: string): Promise<string> {
  const { uploadMedia } = await mediasService()
  return (await uploadMedia(userId, await makePng(300, 200))).id
}

async function uploaderImages(userId: string, n: number): Promise<string[]> {
  const ids: string[] = []
  for (let i = 0; i < n; i += 1) {
    ids.push(await uploaderImage(userId))
  }
  return ids
}

async function utilisateurAvecVitrine(username = 'dr-test') {
  const user = await createUser()
  const vitrine = await creerVitrinePubliee(user, username)
  return { user, vitrine }
}

async function titresDeLaVitrine(vitrineId: string): Promise<string[]> {
  return (await lignesDeLaVitrine(vitrineId)).map((l) => l.titre)
}

async function mediaExiste(id: string): Promise<boolean> {
  return (await db.select().from(medias).where(eq(medias.id, id))).length === 1
}

/** Le média existe en base ET ses 3 variantes sont sur le disque. */
async function mediaIntact(id: string): Promise<boolean> {
  return (await mediaExiste(id)) && (await fichiersDuMedia(id)).length === 3
}

/** Le média n'existe plus en base ET plus aucun fichier ne subsiste. */
async function mediaDisparu(id: string): Promise<boolean> {
  return !(await mediaExiste(id)) && (await fichiersDuMedia(id)).length === 0
}

/** Nombre de requêtes SQL émises par `action` (le prototype de pg.Client voit aussi les transactions). */
async function compterRequetes(action: () => Promise<unknown>): Promise<number> {
  const espion = vi.spyOn(Client.prototype as { query: (...args: unknown[]) => unknown }, 'query')
  try {
    await action()
    return espion.mock.calls.length
  } finally {
    espion.mockRestore()
  }
}

/** `n` réalisations visibles, chacune avec une image principale et 3 images de galerie (insertions directes). */
async function peupler(userId: string, vitrineId: string, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    const image = await insertMediaRow(userId)
    const ligne = await insertRealisation(vitrineId, { titre: `R${i}`, slug: `r${i}`, ordre: i, imageMediaId: image.id })
    for (let g = 0; g < 3; g += 1) {
      await insertRealisationImage(ligne.id, (await insertMediaRow(userId)).id, g)
    }
  }
}

describe('realisations — contraintes de la base (CA02 à CA05)', () => {
  it.each([
    ['slug avec majuscule et espace', { slug: 'Bad Slug' }, 'realisations_slug_format_check'],
    ['slug avec double tiret', { slug: 'a--b' }, 'realisations_slug_format_check'],
    ['slug vide', { slug: '' }, 'realisations_slug_format_check'],
    ['slug de 81 caractères', { slug: 'a'.repeat(81) }, 'realisations_slug_format_check'],
    ['slug finissant par un tiret', { slug: 'abc-' }, 'realisations_slug_format_check'],
    ['année 1899', { annee: 1899 }, 'realisations_annee_check'],
    ['année 2101', { annee: 2101 }, 'realisations_annee_check'],
    ['lien javascript:', { lien: 'javascript:alert(1)' }, 'realisations_lien_check'],
    ['lien ftp://', { lien: 'ftp://x.cm' }, 'realisations_lien_check'],
    ['lien sans schéma', { lien: 'www.x.cm' }, 'realisations_lien_check'],
    ['lien de 501 caractères', { lien: `https://${'a'.repeat(493)}` }, 'realisations_lien_check'],
    ['en vedette et masquée', { enVedette: true, actif: false }, 'realisations_vedette_actif_check'],
    ['ordre négatif', { ordre: -1 }, 'realisations_ordre_check'],
  ])('CA02 should reject an INSERT with %s with a CHECK violation (23514)', async (_libelle, surcharges, contrainte) => {
    const { vitrine } = await utilisateurAvecVitrine()

    const erreur = await rejet(insertRealisation(vitrine.id, surcharges as Partial<typeof realisations.$inferInsert>).then(() => undefined))

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23514', contrainte })
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
  })

  it.each([
    ['ordre 6', 6],
    ['ordre -1', -1],
  ])('CA02 should reject a gallery image with %s (23514 realisation_images_ordre_check)', async (_libelle, ordre) => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const ligne = await insertRealisation(vitrine.id)
    const media = await insertMediaRow(user.id)

    const erreur = await rejet(insertRealisationImage(ligne.id, media.id, ordre).then(() => undefined))

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23514', contrainte: 'realisation_images_ordre_check' })
    expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
  })

  it('CA02 should accept the valid edge shapes (1-char and 80-char slugs, years 1900 and 2100, HTTP:// in capitals, a 500-char link, vedette + visible, order 0)', async () => {
    const { vitrine } = await utilisateurAvecVitrine()

    await insertRealisation(vitrine.id, { slug: 'a' })
    await insertRealisation(vitrine.id, { slug: 'a'.repeat(80) })
    await insertRealisation(vitrine.id, { annee: 1900 })
    await insertRealisation(vitrine.id, { annee: 2100 })
    await insertRealisation(vitrine.id, { annee: null, lien: null })
    await insertRealisation(vitrine.id, { lien: 'HTTP://X.CM' })
    await insertRealisation(vitrine.id, { lien: `https://${'a'.repeat(492)}` })
    await insertRealisation(vitrine.id, { enVedette: true, actif: true, ordre: 0 })
    await insertRealisation(vitrine.id, { enVedette: false, actif: false })

    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(9)
  })

  it('CA03 should allow the same slug in two different vitrines', async () => {
    const a = await utilisateurAvecVitrine('vitrine-a')
    const b = await utilisateurAvecVitrine('vitrine-b')

    await insertRealisation(a.vitrine.id, { slug: 'projet' })
    await insertRealisation(b.vitrine.id, { slug: 'projet' })

    expect(await lignesDeLaVitrine(a.vitrine.id)).toHaveLength(1)
    expect(await lignesDeLaVitrine(b.vitrine.id)).toHaveLength(1)
  })

  it('CA03 should reject the same slug twice in the same vitrine (23505 realisations_vitrine_id_slug_unique), even when one is masked', async () => {
    const { vitrine } = await utilisateurAvecVitrine()
    await insertRealisation(vitrine.id, { slug: 'projet', actif: false })

    const erreur = await rejet(insertRealisation(vitrine.id, { slug: 'projet' }).then(() => undefined))

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23505', contrainte: 'realisations_vitrine_id_slug_unique' })
  })

  it('CA03 should reject the same (realisation, order) twice (23505) but accept the same order in another realisation', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const r1 = await insertRealisation(vitrine.id)
    const r2 = await insertRealisation(vitrine.id)
    const [m1, m2, m3] = [await insertMediaRow(user.id), await insertMediaRow(user.id), await insertMediaRow(user.id)]
    await insertRealisationImage(r1.id, m1.id, 0)

    const erreur = await rejet(insertRealisationImage(r1.id, m2.id, 0).then(() => undefined))
    await insertRealisationImage(r2.id, m3.id, 0)

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23505', contrainte: 'realisation_images_realisation_id_ordre_unique' })
    expect(await toutesLesLignesDeGalerie()).toHaveLength(2)
  })

  it('CA03 should reject the same (realisation, media) twice (23505) but accept the same media in the gallery of another realisation', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const r1 = await insertRealisation(vitrine.id)
    const r2 = await insertRealisation(vitrine.id)
    const media = await insertMediaRow(user.id)
    await insertRealisationImage(r1.id, media.id, 0)

    const erreur = await rejet(insertRealisationImage(r1.id, media.id, 1).then(() => undefined))
    await insertRealisationImage(r2.id, media.id, 0)

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23505', contrainte: 'realisation_images_realisation_id_media_id_unique' })
    expect(await toutesLesLignesDeGalerie()).toHaveLength(2)
  })

  it('CA04 should refuse a seventh gallery image whatever its order (23514 beyond the range, 23505 inside it)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const ligne = await insertRealisation(vitrine.id)
    for (let ordre = 0; ordre < 6; ordre += 1) {
      await insertRealisationImage(ligne.id, (await insertMediaRow(user.id)).id, ordre)
    }

    for (const ordre of [-1, 0, 1, 2, 3, 4, 5, 6, 7, 10, 100]) {
      const media = await insertMediaRow(user.id)

      const erreur = await rejet(insertRealisationImage(ligne.id, media.id, ordre).then(() => undefined))

      expect(['23514', '23505'], `ordre ${ordre}`).toContain(erreurPostgres(erreur.brute).sqlstate)
    }
    expect(await lignesDeGalerie(ligne.id)).toHaveLength(6)
  })

  it('CA05 should reset image_media_id to NULL (FK ON DELETE SET NULL) when the main image media is deleted, and keep the realisation', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const media = await insertMediaRow(user.id)
    const ligne = await insertRealisation(vitrine.id, { imageMediaId: media.id })

    await db.delete(medias).where(eq(medias.id, media.id))

    expect((await ligneRealisation(ligne.id))?.imageMediaId).toBeNull()
  })

  it('CA05 should drop the gallery line (FK ON DELETE CASCADE) when a gallery media is deleted, and keep the others and the realisation', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const ligne = await insertRealisation(vitrine.id)
    const [m1, m2, m3] = [await insertMediaRow(user.id), await insertMediaRow(user.id), await insertMediaRow(user.id)]
    await insertRealisationImage(ligne.id, m1.id, 0)
    await insertRealisationImage(ligne.id, m2.id, 1)
    await insertRealisationImage(ligne.id, m3.id, 2)

    await db.delete(medias).where(eq(medias.id, m2.id))

    expect(await galerieEnBase(ligne.id)).toEqual([m1.id, m3.id])
    expect(await ligneRealisation(ligne.id)).toBeDefined()
  })

  it('CA05 should drop the gallery lines when the realisation is deleted, and keep the medias rows', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const ligne = await insertRealisation(vitrine.id)
    const [m1, m2] = [await insertMediaRow(user.id), await insertMediaRow(user.id)]
    await insertRealisationImage(ligne.id, m1.id, 0)
    await insertRealisationImage(ligne.id, m2.id, 1)

    await db.delete(realisations).where(eq(realisations.id, ligne.id))

    expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
    expect(await db.select().from(medias).where(inArray(medias.id, [m1.id, m2.id]))).toHaveLength(2)
  })

  it('CA05 should reject a main image or a gallery line that points to nothing (23503, named foreign keys)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const ligne = await insertRealisation(vitrine.id)
    const media = await insertMediaRow(user.id)

    const imageFantome = await rejet(insertRealisation(vitrine.id, { imageMediaId: randomUUID() }).then(() => undefined))
    const mediaFantome = await rejet(insertRealisationImage(ligne.id, randomUUID(), 0).then(() => undefined))
    const realisationFantome = await rejet(insertRealisationImage(randomUUID(), media.id, 0).then(() => undefined))

    expect(erreurPostgres(imageFantome.brute)).toEqual({ sqlstate: '23503', contrainte: 'realisations_image_media_id_medias_id_fk' })
    expect(erreurPostgres(mediaFantome.brute)).toEqual({ sqlstate: '23503', contrainte: 'realisation_images_media_id_medias_id_fk' })
    expect(erreurPostgres(realisationFantome.brute)).toEqual({ sqlstate: '23503', contrainte: 'realisation_images_realisation_id_realisations_id_fk' })
  })

  it('CA05 should remove the vitrine, its realisations and their gallery lines when the account is deleted (two cascade paths to the same line)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    await peupler(user.id, vitrine.id, 2)
    expect(await toutesLesLignesDeGalerie()).toHaveLength(6)

    await db.delete(users).where(eq(users.id, user.id))

    expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
    expect(await db.select().from(realisations)).toHaveLength(0)
    expect(await db.select().from(vitrines)).toHaveLength(0)
    expect(await db.select().from(medias)).toHaveLength(0)
  })
})

describe('realisations — création (CA06 à CA16)', () => {
  it('CA06 should create a realisation with generated slug, order 0, automatic vedette, empty gallery and the 1600 image url', async () => {
    const { toRealisationStudioResource, toRealisationsCompteursResource } = await ressourceRealisation()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const imageId = await uploaderImage(user.id)

    const { item, compteurs } = await creer(user.id, {
      titre: 'Unité de cathétérisme, CHU de Douala',
      imageMediaId: imageId,
      annee: 2025,
      lieu: 'CHU de Douala',
    })

    expect(item.realisation).toMatchObject({
      vitrineId: vitrine.id,
      slug: 'unite-de-catheterisme-chu-de-douala',
      titre: 'Unité de cathétérisme, CHU de Douala',
      annee: 2025,
      lieu: 'CHU de Douala',
      role: null,
      lien: null,
      description: null,
      imageMediaId: imageId,
      ordre: 0,
      actif: true,
      enVedette: true,
    })
    expect(item.galerie).toEqual([])
    expect(item.image?.id).toBe(imageId)
    expect(compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    expect(await ligneRealisation(item.realisation.id)).toEqual(item.realisation)
    const dto = toRealisationStudioResource(item.realisation, item.image, item.galerie)
    expect(dto.image).toMatchObject({ id: imageId, url: `/medias/${imageId}/1600.webp` })
    expect(dto.galerie).toEqual([])
    expect(toRealisationsCompteursResource(compteurs)).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
  })

  it('CA06 should give the realisation a UUID identifier (the studio routes validate :id as a uuid)', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id)

    expect(item.realisation.id).toMatch(UUID_V4_OU_V7)
  })

  it('CA06 should create the realisation of a vitrine that is not published yet (the studio works before the publication)', async () => {
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { username: 'brouillon', publiee: false })

    const { item } = await creer(user.id, { titre: 'Brouillon' })

    expect(item.realisation.vitrineId).toBe(vitrine.id)
  })

  it('CA06 should assign order = max + 1 (not the count) after a deletion, and 0 again when the vitrine is empty', async () => {
    const { deleteRealisation } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })
    await creer(user.id, { titre: 'R2' })
    await creer(user.id, { titre: 'R3' })
    await deleteRealisation(user.id, r1.item.realisation.id)

    const r4 = await creer(user.id, { titre: 'R4' })

    expect(r4.item.realisation.ordre).toBe(3)
    for (const ligne of await lignesDeLaVitrine(vitrine.id)) {
      await deleteRealisation(user.id, ligne.id)
    }
    expect((await creer(user.id, { titre: 'R5' })).item.realisation.ordre).toBe(0)
  })

  it('CA07 should refuse a creation without main image or with a null one before the service: nothing is inserted', async () => {
    const { vitrine } = await utilisateurAvecVitrine()

    for (const imageMediaId of [undefined, null]) {
      const resultat = schemaRealisationCreate.safeParse({ titre: 'Sans image', imageMediaId })
      expect(resultat.success).toBe(false)
      expect(resultat.error?.issues[0]?.path).toEqual(['imageMediaId'])
      expect(resultat.error?.issues[0]?.message).toBe('Ajoutez une image principale.')
    }
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
  })

  it('CA08 should make the first three realisations vedettes automatically and not the fourth (orders 0 to 3)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    for (const titre of ['R1', 'R2', 'R3', 'R4']) {
      await creer(user.id, { titre })
    }

    const lignes = await lignesDeLaVitrine(vitrine.id)
    expect(lignes.map((l) => l.enVedette)).toEqual([true, true, true, false])
    expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2, 3])
  })

  it('CA08 should keep the first realisation out of vedette when enVedette is false, then fill the three places automatically', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    await creer(user.id, { titre: 'R1', enVedette: false })
    for (const titre of ['R2', 'R3', 'R4', 'R5']) {
      await creer(user.id, { titre })
    }

    expect((await lignesDeLaVitrine(vitrine.id)).map((l) => l.enVedette)).toEqual([false, true, true, true, false])
  })

  it('CA08 should never make a masked realisation a vedette automatically', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item, compteurs } = await creer(user.id, { actif: false })

    expect(item.realisation).toMatchObject({ actif: false, enVedette: false })
    expect(compteurs).toMatchObject({ total: 1, visibles: 0, enVedette: 0 })
  })

  it('CA08 should accept an explicit enVedette true while a place is free', async () => {
    const { user } = await utilisateurAvecVitrine()
    await creer(user.id, { titre: 'R1' })

    const { item, compteurs } = await creer(user.id, { titre: 'R2', enVedette: true })

    expect(item.realisation.enVedette).toBe(true)
    expect(compteurs.enVedette).toBe(2)
  })

  it('CA09 should answer VEDETTE_COMPLETE (409) with the three current vedettes in order when a fourth is explicitly requested, and insert nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const crees = []
    for (const titre of ['R1', 'R2', 'R3']) {
      crees.push((await creer(user.id, { titre })).item.realisation)
    }
    const galerie = await insertMediaRow(user.id)

    const erreur = await rejet(creer(user.id, { titre: 'R4', enVedette: true, galerie: [galerie.id] }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VEDETTE_COMPLETE')
    expect(erreur.status).toBe(409)
    expect(erreur.data?.enVedette).toEqual(crees.map((c) => ({ id: c.id, titre: c.titre })))
    expect(await titresDeLaVitrine(vitrine.id)).toEqual(['R1', 'R2', 'R3'])
    expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
  })

  it('CA10 should transliterate accents and ligatures, replace & by "et" and number the duplicates (-2, -3)', async () => {
    const { user } = await utilisateurAvecVitrine()
    const titre = 'Dépistage cœur & poumons'

    const premier = await creer(user.id, { titre })
    const deuxieme = await creer(user.id, { titre })
    const troisieme = await creer(user.id, { titre })

    expect(premier.item.realisation.slug).toBe('depistage-coeur-et-poumons')
    expect(deuxieme.item.realisation.slug).toBe('depistage-coeur-et-poumons-2')
    expect(troisieme.item.realisation.slug).toBe('depistage-coeur-et-poumons-3')
  })

  it('CA10 should fall back to the slug "realisation" when the title has no usable character', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id, { titre: '!!!' })
    const suivant = await creer(user.id, { titre: '???' })

    expect(item.realisation.slug).toBe('realisation')
    expect(suivant.item.realisation.slug).toBe('realisation-2')
  })

  it('CA10 should keep a slug of at most 80 characters, without trailing dash, for a 100-character accented title', async () => {
    const { user } = await utilisateurAvecVitrine()
    const titre = 'Électrocardiogramme d’effort '.repeat(5).slice(0, 100)
    expect(titre).toHaveLength(100)

    const { item } = await creer(user.id, { titre })
    const doublon = await creer(user.id, { titre })

    for (const slug of [item.realisation.slug, doublon.item.realisation.slug]) {
      expect(slug.length).toBeLessThanOrEqual(80)
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(slug.startsWith('electrocardiogramme-d-effort-')).toBe(true)
    }
    expect(doublon.item.realisation.slug).not.toBe(item.realisation.slug)
  })

  it('CA10 should not add a suffix for the same title in the vitrine of another user', async () => {
    const a = await utilisateurAvecVitrine('vitrine-a')
    const b = await utilisateurAvecVitrine('vitrine-b')
    await creer(a.user.id, { titre: 'Bilan' })

    const { item } = await creer(b.user.id, { titre: 'Bilan' })

    expect(item.realisation.slug).toBe('bilan')
  })

  it('CA10 should number a new slug past a MASKED realisation of the same vitrine (the taken slugs are all the rows, not the visible ones)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    await insertRealisation(vitrine.id, { slug: 'bilan', actif: false })

    const { item } = await creer(user.id, { titre: 'Bilan' })

    expect(item.realisation.slug).toBe('bilan-2')
  })

  it('CA11 should refuse to create a masked realisation in vedette (400 enVedette, French message) and insert nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    const erreur = await rejet(creer(user.id, { actif: false, enVedette: true }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VALIDATION')
    expect(erreur.status).toBe(400)
    expect(erreur.data?.champs).toEqual({ enVedette: ['Une réalisation masquée ne peut pas être en vedette.'] })
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
  })

  it('CA12 should store the normalised link (www.chu-douala.cm -> https://www.chu-douala.cm, spaces trimmed, blank -> NULL) and accept HTTP://X.CM', async () => {
    const { user } = await utilisateurAvecVitrine()

    const www = await creer(user.id, { titre: 'A', lien: 'www.chu-douala.cm' })
    const espaces = await creer(user.id, { titre: 'B', lien: '  https://x.cm/p  ' })
    const vide = await creer(user.id, { titre: 'C', lien: '' })
    const majuscules = await creer(user.id, { titre: 'D', lien: 'HTTP://X.CM' })

    expect(www.item.realisation.lien).toBe('https://www.chu-douala.cm')
    expect(espaces.item.realisation.lien).toBe('https://x.cm/p')
    expect(vide.item.realisation.lien).toBeNull()
    expect(majuscules.item.realisation.lien?.toLowerCase()).toBe('http://x.cm')
  })

  it('CA12 should store NULL for blank texts and trimmed values for the others', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id, { description: '   ', lieu: '  Douala ', role: '', annee: 2024 })

    expect(item.realisation).toMatchObject({ description: null, lieu: 'Douala', role: null, annee: 2024 })
  })

  it('CA13 should create the gallery in the order of the array, whatever the alphabetical order of the ids (orders 0, 1, 2)', async () => {
    const { user } = await utilisateurAvecVitrine()
    const [g1, g2, g3] = ordreContraireDuTri(await Promise.all([1, 2, 3].map(async () => (await insertMediaRow(user.id)).id)))

    const { item } = await creer(user.id, { galerie: [g1, g2, g3] })

    expect(item.galerie.map((m) => m.id)).toEqual([g1, g2, g3])
    const lignes = await lignesDeGalerie(item.realisation.id)
    expect(lignes.map((l) => [l.mediaId, l.ordre])).toEqual([[g1, 0], [g2, 1], [g3, 2]])
  })

  it('CA13 should accept six gallery images and give the lines the orders 0 to 5', async () => {
    const { user } = await utilisateurAvecVitrine()
    const ids = await Promise.all(Array.from({ length: 6 }, async () => (await insertMediaRow(user.id)).id))

    const { item } = await creer(user.id, { galerie: ids })

    expect((await lignesDeGalerie(item.realisation.id)).map((l) => l.ordre)).toEqual([0, 1, 2, 3, 4, 5])
    expect(item.galerie).toHaveLength(6)
  })

  it('CA14 should refuse the main image inside the gallery (400 galerie, French message) and persist nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const principale = await insertMediaRow(user.id)
    const autre = await insertMediaRow(user.id)

    const erreur = await rejet(creer(user.id, { imageMediaId: principale.id, galerie: [autre.id, principale.id] }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VALIDATION')
    expect(erreur.status).toBe(400)
    const champs = erreur.data?.champs as Record<string, string[]>
    expect(Object.keys(champs)).toEqual(['galerie'])
    expect(champs.galerie.map(sansTypographie)).toEqual(["Cette image est déjà l'image principale."])
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
    expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
  })

  describe('CA15 propriété des médias (422 MEDIA_INVALIDE, rien n’est persisté)', () => {
    it.each([
      ['l’image principale d’un autre utilisateur', (ctx: { mb: string, g1: string }) => ({ imageMediaId: ctx.mb })],
      ['une image principale inconnue', () => ({ imageMediaId: randomUUID() })],
      ['une image de galerie d’un autre utilisateur', (ctx: { mb: string, g1: string }) => ({ galerie: [ctx.g1, ctx.mb] })],
      ['une image de galerie inconnue', (ctx: { mb: string, g1: string }) => ({ galerie: [ctx.g1, randomUUID()] })],
    ])('CA15 should refuse %s', async (_libelle, surcharges) => {
      const { user, vitrine } = await utilisateurAvecVitrine('vitrine-a')
      const autre = await createUser()
      const mediaDeB = await insertMediaRow(autre.id)
      const g1 = (await insertMediaRow(user.id)).id

      const erreur = await rejet(creer(user.id, surcharges({ mb: mediaDeB.id, g1 })))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('MEDIA_INVALIDE')
      expect(erreur.status).toBe(422)
      expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
      expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
      expect(await mediaExiste(mediaDeB.id)).toBe(true)
    })
  })

  it('CA16 should fail with VITRINE_INTROUVABLE when the user has no vitrine', async () => {
    const user = await createUser()

    const erreur = await rejet(creer(user.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })

  it('CA16 should create the realisation in the vitrine of the caller and never in another one', async () => {
    const a = await utilisateurAvecVitrine('vitrine-a')
    const b = await utilisateurAvecVitrine('vitrine-b')

    await creer(a.user.id, { titre: 'Chez A' })

    expect(await titresDeLaVitrine(a.vitrine.id)).toEqual(['Chez A'])
    expect(await lignesDeLaVitrine(b.vitrine.id)).toHaveLength(0)
  })
})

describe('realisations — mise à jour (CA17 à CA28)', () => {
  it('CA17 should only change the sent field and updated_at; gallery and main image stay intact', async () => {
    const { user } = await utilisateurAvecVitrine()
    const image = await insertMediaRow(user.id)
    const galerie = [(await insertMediaRow(user.id)).id, (await insertMediaRow(user.id)).id]
    const { item } = await creer(user.id, { imageMediaId: image.id, galerie, description: 'Avant', lieu: 'Douala', annee: 2024 })
    const avant = (await ligneRealisation(item.realisation.id))!
    await new Promise((resolve) => setTimeout(resolve, PAUSE_HORODATAGE_MS))

    const { item: modifie } = await modifier(user.id, item.realisation.id, { description: 'x' })

    const apres = (await ligneRealisation(item.realisation.id))!
    expect(apres.description).toBe('x')
    expect(apres.updatedAt.getTime()).toBeGreaterThan(avant.updatedAt.getTime())
    expect({ ...apres, description: avant.description, updatedAt: avant.updatedAt }).toEqual(avant)
    expect(modifie.realisation).toEqual(apres)
    expect(modifie.image?.id).toBe(image.id)
    expect(modifie.galerie.map((m) => m.id)).toEqual(galerie)
    expect(await galerieEnBase(item.realisation.id)).toEqual(galerie)
  })

  it('CA17 should store an empty description as NULL, and clear the link, the year, the place and the role with null', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { description: 'Une description', lien: 'https://x.cm', annee: 2020, lieu: 'Douala', role: 'Chef' })

    await modifier(user.id, item.realisation.id, { description: '   ', lien: '', annee: null, lieu: null, role: '' })

    expect(await ligneRealisation(item.realisation.id)).toMatchObject({ description: null, lien: null, annee: null, lieu: null, role: null })
  })

  it('CA18 should keep the slug unchanged when the title is edited', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { titre: 'Projet' })

    const { item: modifie } = await modifier(user.id, item.realisation.id, { titre: 'Nouveau titre' })

    expect(modifie.realisation.titre).toBe('Nouveau titre')
    expect(modifie.realisation.slug).toBe('projet')
  })

  it('CA19 should refuse a null main image before the service (400 imageMediaId) and leave the realisation untouched', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)
    const avant = await ligneRealisation(item.realisation.id)

    const resultat = schemaRealisationUpdate.safeParse({ imageMediaId: null })

    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues[0]?.path).toEqual(['imageMediaId'])
    expect(await ligneRealisation(item.realisation.id)).toEqual(avant)
  })

  describe('CA19 image principale remplacée', () => {
    it('CA19 should delete the old main image row and its three files when it is replaced, and keep the new one', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, m2] = await uploaderImages(user.id, 2)
      const { item } = await creer(user.id, { imageMediaId: m1 })
      expect(await fichiersDuMedia(m1)).toHaveLength(3)

      const { item: modifie } = await modifier(user.id, item.realisation.id, { imageMediaId: m2 })

      expect(modifie.image?.id).toBe(m2)
      expect(await mediaDisparu(m1)).toBe(true)
      expect(await mediaIntact(m2)).toBe(true)
      expect((await ligneRealisation(item.realisation.id))?.imageMediaId).toBe(m2)
    })

    it('CA19 should keep the old image when it is also the photo of the vitrine', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const [m1, m2] = await uploaderImages(user.id, 2)
      await db.update(vitrines).set({ photoMediaId: m1 }).where(eq(vitrines.id, vitrine.id))
      const { item } = await creer(user.id, { imageMediaId: m1 })

      await modifier(user.id, item.realisation.id, { imageMediaId: m2 })

      expect(await mediaIntact(m1)).toBe(true)
    })

    it('CA19 should keep the old image when a service still uses it', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const [m1, m2] = await uploaderImages(user.id, 2)
      const { item } = await creer(user.id, { imageMediaId: m1 })
      await insertService(vitrine.id, { imageMediaId: m1 })

      await modifier(user.id, item.realisation.id, { imageMediaId: m2 })

      expect(await mediaIntact(m1)).toBe(true)
    })

    it('CA19 should keep the old image when another realisation still uses it as its main image', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, m2] = await uploaderImages(user.id, 2)
      const r1 = await creer(user.id, { titre: 'R1', imageMediaId: m1 })
      const r2 = await creer(user.id, { titre: 'R2', imageMediaId: m1 })

      await modifier(user.id, r1.item.realisation.id, { imageMediaId: m2 })

      expect(await mediaIntact(m1)).toBe(true)
      expect((await ligneRealisation(r2.item.realisation.id))?.imageMediaId).toBe(m1)
    })

    it('CA19 should keep the old image when it is in the GALLERY of another realisation (the row, its files, and that gallery line)', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [partagee, m2, autrePrincipale] = await uploaderImages(user.id, 3)
      const r1 = await creer(user.id, { titre: 'R1', imageMediaId: autrePrincipale, galerie: [partagee] })
      const r2 = await creer(user.id, { titre: 'R2', imageMediaId: partagee })

      await modifier(user.id, r2.item.realisation.id, { imageMediaId: m2 })

      expect(await mediaIntact(partagee)).toBe(true)
      expect(await galerieEnBase(r1.item.realisation.id)).toEqual([partagee])
      const relue = (await (await realisationsService()).getOwnRealisation(user.id, r1.item.realisation.id)).item
      expect(relue.galerie.map((m) => m.id)).toEqual([partagee])
    })

    it('CA19 should keep the image when the same imageMediaId is sent again', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1] = await uploaderImages(user.id, 1)
      const { item } = await creer(user.id, { imageMediaId: m1 })

      await modifier(user.id, item.realisation.id, { imageMediaId: m1, description: 'Mise à jour' })

      expect(await mediaIntact(m1)).toBe(true)
    })

    it('CA19 should reject an image of another user (422 MEDIA_INVALIDE) and keep the current one, files included', async () => {
      const { user } = await utilisateurAvecVitrine()
      const autre = await createUser()
      const mediaDeB = await insertMediaRow(autre.id)
      const [m1] = await uploaderImages(user.id, 1)
      const { item } = await creer(user.id, { imageMediaId: m1 })

      const erreur = await rejet(modifier(user.id, item.realisation.id, { imageMediaId: mediaDeB.id }))

      expect(erreur.code).toBe('MEDIA_INVALIDE')
      expect(erreur.status).toBe(422)
      expect((await ligneRealisation(item.realisation.id))?.imageMediaId).toBe(m1)
      expect(await mediaIntact(m1)).toBe(true)
      expect(await mediaExiste(mediaDeB.id)).toBe(true)
    })

    it('CA19 should reject an unknown image id (422 MEDIA_INVALIDE) and persist nothing', async () => {
      const { user } = await utilisateurAvecVitrine()
      const { item } = await creer(user.id)
      const avant = await ligneRealisation(item.realisation.id)

      const erreur = await rejet(modifier(user.id, item.realisation.id, { imageMediaId: randomUUID() }))

      expect(erreur.code).toBe('MEDIA_INVALIDE')
      expect(await ligneRealisation(item.realisation.id)).toEqual(avant)
    })
  })

  describe('CA20 remplacement de galerie', () => {
    it('CA20 should replace the gallery by the sent list in the sent order and delete the left-out image (row and files)', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1, g2, g3] = await uploaderImages(user.id, 4)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1, g2, g3] })

      const { item: modifie } = await modifier(user.id, item.realisation.id, { galerie: [g3, g1] })

      expect(modifie.galerie.map((m) => m.id)).toEqual([g3, g1])
      expect(await galerieEnBase(item.realisation.id)).toEqual([g3, g1])
      expect((await lignesDeGalerie(item.realisation.id)).map((l) => l.ordre)).toEqual([0, 1])
      expect(await mediaDisparu(g2)).toBe(true)
      expect(await mediaIntact(g1)).toBe(true)
      expect(await mediaIntact(g3)).toBe(true)
      expect(await mediaIntact(m1)).toBe(true)
    })

    it('CA20 should empty the gallery with [] and delete every former gallery image, keeping the main image', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1, g3] = await uploaderImages(user.id, 3)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g3, g1] })

      const { item: modifie } = await modifier(user.id, item.realisation.id, { galerie: [] })

      expect(modifie.galerie).toEqual([])
      expect(await galerieEnBase(item.realisation.id)).toEqual([])
      expect(await mediaDisparu(g1)).toBe(true)
      expect(await mediaDisparu(g3)).toBe(true)
      expect(await mediaIntact(m1)).toBe(true)
    })

    it('CA20 should only reorder the gallery without deleting any image', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1, g2] = await uploaderImages(user.id, 3)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1, g2] })

      await modifier(user.id, item.realisation.id, { galerie: [g2, g1] })

      expect(await galerieEnBase(item.realisation.id)).toEqual([g2, g1])
      expect(await mediaIntact(g1)).toBe(true)
      expect(await mediaIntact(g2)).toBe(true)
    })

    it('CA20 should add images to an existing gallery (the new ones must belong to the user) and fill up to six', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [g1, ...autres] = await uploaderImages(user.id, 6)
      const { item } = await creer(user.id, { galerie: [g1] })

      const { item: modifie } = await modifier(user.id, item.realisation.id, { galerie: [g1, ...autres] })

      expect(modifie.galerie).toHaveLength(6)
      expect((await lignesDeGalerie(item.realisation.id)).map((l) => l.ordre)).toEqual([0, 1, 2, 3, 4, 5])
    })

    it('CA20 should leave the gallery unchanged when the field is absent from the patch', async () => {
      const { user } = await utilisateurAvecVitrine()
      const g = await Promise.all([1, 2].map(async () => (await insertMediaRow(user.id)).id))
      const { item } = await creer(user.id, { galerie: g })

      await modifier(user.id, item.realisation.id, { titre: 'Autre titre', actif: true })

      expect(await galerieEnBase(item.realisation.id)).toEqual(g)
    })

    it('CA20 should refuse an image of another user in the new gallery (422) and keep the current gallery', async () => {
      const { user } = await utilisateurAvecVitrine()
      const autre = await createUser()
      const mediaDeB = await insertMediaRow(autre.id)
      const [g1] = await uploaderImages(user.id, 1)
      const { item } = await creer(user.id, { galerie: [g1] })

      const erreur = await rejet(modifier(user.id, item.realisation.id, { galerie: [g1, mediaDeB.id] }))

      expect(erreur.code).toBe('MEDIA_INVALIDE')
      expect(await galerieEnBase(item.realisation.id)).toEqual([g1])
      expect(await mediaIntact(g1)).toBe(true)
    })

    it('CA20 should not delete a left-out gallery image that another realisation still shows', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [g1, g2] = await uploaderImages(user.id, 2)
      const r1 = await creer(user.id, { titre: 'R1', galerie: [g1, g2] })
      const r2 = await creer(user.id, { titre: 'R2', galerie: [g2] })

      await modifier(user.id, r1.item.realisation.id, { galerie: [g1] })

      expect(await mediaIntact(g2)).toBe(true)
      expect(await galerieEnBase(r2.item.realisation.id)).toEqual([g2])
    })
  })

  describe('CA21 à CA22 cohérence de l’image principale et de la galerie sur l’état fusionné', () => {
    it('CA21 should accept an exchange between the main image and a gallery image (200) and delete no media', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1] = await uploaderImages(user.id, 2)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1] })

      const { item: modifie } = await modifier(user.id, item.realisation.id, { imageMediaId: g1, galerie: [m1] })

      expect(modifie.image?.id).toBe(g1)
      expect(modifie.galerie.map((m) => m.id)).toEqual([m1])
      expect(await galerieEnBase(item.realisation.id)).toEqual([m1])
      expect(await mediaIntact(m1)).toBe(true)
      expect(await mediaIntact(g1)).toBe(true)
    })

    it('CA22 should refuse to promote a gallery image without removing it from the gallery (400 galerie) and change nothing', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1] = await uploaderImages(user.id, 2)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1] })
      const avant = await ligneRealisation(item.realisation.id)

      const erreur = await rejet(modifier(user.id, item.realisation.id, { imageMediaId: g1 }))

      expect(erreur.code).toBe('VALIDATION')
      expect(Object.keys(erreur.data?.champs as object)).toEqual(['galerie'])
      expect(await ligneRealisation(item.realisation.id)).toEqual(avant)
      expect(await galerieEnBase(item.realisation.id)).toEqual([g1])
      expect(await mediaIntact(m1)).toBe(true)
      expect(await mediaIntact(g1)).toBe(true)
    })

    it('CA22 should refuse a new gallery that holds the current main image (400 galerie) and change nothing', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1] = await uploaderImages(user.id, 2)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1] })

      const erreur = await rejet(modifier(user.id, item.realisation.id, { galerie: [g1, m1] }))

      expect(erreur.code).toBe('VALIDATION')
      expect(Object.keys(erreur.data?.champs as object)).toEqual(['galerie'])
      expect(await galerieEnBase(item.realisation.id)).toEqual([g1])
    })

    it('CA22 should promote a gallery image when it leaves the gallery in the same request: only the old main image is deleted', async () => {
      const { user } = await utilisateurAvecVitrine()
      const [m1, g1, g2] = await uploaderImages(user.id, 3)
      const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1, g2] })

      const { item: modifie } = await modifier(user.id, item.realisation.id, { imageMediaId: g1, galerie: [g2] })

      expect(modifie.image?.id).toBe(g1)
      expect(await galerieEnBase(item.realisation.id)).toEqual([g2])
      expect(await mediaDisparu(m1)).toBe(true)
      expect(await mediaIntact(g1)).toBe(true)
      expect(await mediaIntact(g2)).toBe(true)
    })
  })

  describe('CA23 plafond de vedettes à la mise à jour', () => {
    it('CA23 should refuse a fourth vedette (409) naming the three current ones, then accept it once one is withdrawn', async () => {
      const { user } = await utilisateurAvecVitrine()
      const r1 = await creer(user.id, { titre: 'R1' })
      const r2 = await creer(user.id, { titre: 'R2' })
      const r3 = await creer(user.id, { titre: 'R3' })
      const r4 = await creer(user.id, { titre: 'R4' })
      expect(r4.item.realisation.enVedette).toBe(false)

      const erreur = await rejet(modifier(user.id, r4.item.realisation.id, { enVedette: true }))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('VEDETTE_COMPLETE')
      expect(erreur.status).toBe(409)
      expect(erreur.data?.enVedette).toEqual([r1, r2, r3].map((r) => ({ id: r.item.realisation.id, titre: r.item.realisation.titre })))
      expect((await ligneRealisation(r4.item.realisation.id))?.enVedette).toBe(false)

      await modifier(user.id, r2.item.realisation.id, { enVedette: false })
      const { item, compteurs } = await modifier(user.id, r4.item.realisation.id, { enVedette: true })

      expect(item.realisation.enVedette).toBe(true)
      expect(compteurs.enVedette).toBe(3)
    })

    it('CA23 should accept enVedette true on a realisation that is already a vedette when the three places are taken', async () => {
      const { user } = await utilisateurAvecVitrine()
      const r1 = await creer(user.id, { titre: 'R1' })
      await creer(user.id, { titre: 'R2' })
      await creer(user.id, { titre: 'R3' })

      const { item, compteurs } = await modifier(user.id, r1.item.realisation.id, { enVedette: true })

      expect(item.realisation.enVedette).toBe(true)
      expect(compteurs.enVedette).toBe(3)
    })

    it('CA23 should free a vedette place when a vedette is masked: the next creation becomes a vedette automatically', async () => {
      const { user } = await utilisateurAvecVitrine()
      await creer(user.id, { titre: 'R1' })
      await creer(user.id, { titre: 'R2' })
      const r3 = await creer(user.id, { titre: 'R3' })
      await modifier(user.id, r3.item.realisation.id, { actif: false })

      const { item, compteurs } = await creer(user.id, { titre: 'R4' })

      expect(item.realisation.enVedette).toBe(true)
      expect(compteurs).toEqual({ total: 4, visibles: 3, enVedette: 3, vedetteMax: 3 })
    })
  })

  describe('CA24 masquer', () => {
    it('CA24 should withdraw the vedette of a masked realisation and update the counters', async () => {
      const { user } = await utilisateurAvecVitrine()
      const r1 = await creer(user.id, { titre: 'R1' })
      await creer(user.id, { titre: 'R2' })
      const avant = (await modifier(user.id, r1.item.realisation.id, { titre: 'R1' })).compteurs
      expect(avant).toEqual({ total: 2, visibles: 2, enVedette: 2, vedetteMax: 3 })

      const { item, compteurs } = await modifier(user.id, r1.item.realisation.id, { actif: false })

      expect(item.realisation).toMatchObject({ actif: false, enVedette: false })
      expect(compteurs).toEqual({ total: 2, visibles: 1, enVedette: 1, vedetteMax: 3 })
    })

    it('CA24 should refuse actif false together with an explicit enVedette true (400 enVedette) and keep it visible', async () => {
      const { user } = await utilisateurAvecVitrine()
      const { item } = await creer(user.id)

      const erreur = await rejet(modifier(user.id, item.realisation.id, { actif: false, enVedette: true }))

      expect(erreur.code).toBe('VALIDATION')
      expect(Object.keys(erreur.data?.champs as object)).toEqual(['enVedette'])
      expect((await ligneRealisation(item.realisation.id))?.actif).toBe(true)
    })

    it('CA24 should refuse to make a masked realisation a vedette (400 enVedette)', async () => {
      const { user } = await utilisateurAvecVitrine()
      const { item } = await creer(user.id, { actif: false })

      const erreur = await rejet(modifier(user.id, item.realisation.id, { enVedette: true }))

      expect(erreur.code).toBe('VALIDATION')
      expect(Object.keys(erreur.data?.champs as object)).toEqual(['enVedette'])
    })

    it('CA24 should not give back the vedette place when a masked realisation is shown again without enVedette', async () => {
      const { user } = await utilisateurAvecVitrine()
      const { item } = await creer(user.id)
      await modifier(user.id, item.realisation.id, { actif: false })

      const { item: reaffichee } = await modifier(user.id, item.realisation.id, { actif: true })

      expect(reaffichee.realisation).toMatchObject({ actif: true, enVedette: false })
    })

    it('CA24 should refuse to show a masked realisation again as a vedette when the three places are taken (409)', async () => {
      const { user } = await utilisateurAvecVitrine()
      const masquee = await creer(user.id, { titre: 'Masquée', actif: false })
      for (const titre of ['R1', 'R2', 'R3']) {
        await creer(user.id, { titre })
      }

      const erreur = await rejet(modifier(user.id, masquee.item.realisation.id, { actif: true, enVedette: true }))

      expect(erreur.code).toBe('VEDETTE_COMPLETE')
    })
  })

  describe('CA25 ligne ancienne sans image principale', () => {
    it('CA25 should hide a legacy realisation without main image (200): the image is only required at creation or on an explicit null', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const ancienne = await insertRealisation(vitrine.id, { imageMediaId: null, enVedette: true })

      const { item } = await modifier(user.id, ancienne.id, { actif: false })

      expect(item.realisation).toMatchObject({ actif: false, enVedette: false, imageMediaId: null })
      expect(item.image).toBeNull()
    })

    it('CA25 should accept the other edits of a legacy realisation without image (title, gallery, vedette)', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const ancienne = await insertRealisation(vitrine.id, { imageMediaId: null })
      const [g1] = await uploaderImages(user.id, 1)

      await modifier(user.id, ancienne.id, { titre: 'Renommée' })
      await modifier(user.id, ancienne.id, { galerie: [g1] })
      const { item } = await modifier(user.id, ancienne.id, { enVedette: true })

      expect(item.realisation).toMatchObject({ titre: 'Renommée', enVedette: true, imageMediaId: null })
      expect(item.galerie.map((m) => m.id)).toEqual([g1])
    })

    it('CA25 should let a legacy realisation receive its first main image', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const ancienne = await insertRealisation(vitrine.id, { imageMediaId: null })
      const [m1] = await uploaderImages(user.id, 1)

      const { item } = await modifier(user.id, ancienne.id, { imageMediaId: m1 })

      expect(item.image?.id).toBe(m1)
      expect(await mediaIntact(m1)).toBe(true)
    })

    it('CA25 should list a realisation whose main image was deleted through the media route, with image null', async () => {
      const { listOwnRealisations } = await realisationsService()
      const { user } = await utilisateurAvecVitrine()
      const [m1] = await uploaderImages(user.id, 1)
      const { item } = await creer(user.id, { imageMediaId: m1 })
      const { deleteMedia } = await mediasService()

      await deleteMedia(user.id, m1)

      const { items } = await listOwnRealisations(user.id)
      expect(items).toHaveLength(1)
      expect(items[0]?.realisation.id).toBe(item.realisation.id)
      expect(items[0]?.image).toBeNull()
    })
  })

  describe('CA26 concurrence', () => {
    it('CA26 should let exactly one of two simultaneous vedette updates win (the other gets VEDETTE_COMPLETE) and keep three vedettes', async () => {
      const TOURS = 4

      for (let tour = 0; tour < TOURS; tour += 1) {
        const { user, vitrine } = await utilisateurAvecVitrine(`course-vedette-${tour}`)
        await creer(user.id, { titre: 'R1' })
        await creer(user.id, { titre: 'R2' })
        const r3 = await creer(user.id, { titre: 'R3', enVedette: false })
        const r4 = await creer(user.id, { titre: 'R4', enVedette: false })

        const resultats = await Promise.allSettled([
          modifier(user.id, r3.item.realisation.id, { enVedette: true }),
          modifier(user.id, r4.item.realisation.id, { enVedette: true }),
        ])
        exigerModulesPresents(resultats)

        expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        const echec = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        const erreur = await rejet(Promise.reject(echec?.reason))
        expect(erreur.estDomainError).toBe(true)
        expect(erreur.code).toBe('VEDETTE_COMPLETE')
        expect((await lignesDeLaVitrine(vitrine.id)).filter((l) => l.enVedette)).toHaveLength(3)
      }
    })

    it('CA26 should never exceed three vedettes when four realisations are created at the same time', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()

      const resultats = await Promise.allSettled(['R1', 'R2', 'R3', 'R4'].map((titre) => creer(user.id, { titre })))
      exigerModulesPresents(resultats)

      expect(resultats.every((r) => r.status === 'fulfilled')).toBe(true)
      const lignes = await lignesDeLaVitrine(vitrine.id)
      expect(lignes).toHaveLength(4)
      expect(lignes.filter((l) => l.enVedette)).toHaveLength(3)
      expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2, 3])
    })

    it('CA26 should give distinct slugs (bilan, bilan-2) and distinct orders to two simultaneous creations of the same title', async () => {
      const TOURS = 4

      for (let tour = 0; tour < TOURS; tour += 1) {
        const { user, vitrine } = await utilisateurAvecVitrine(`course-slug-${tour}`)

        const resultats = await Promise.allSettled([creer(user.id, { titre: 'Bilan' }), creer(user.id, { titre: 'Bilan' })])
        exigerModulesPresents(resultats)

        expect(resultats.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
        const lignes = await lignesDeLaVitrine(vitrine.id)
        expect(lignes.map((l) => l.slug).sort()).toEqual(['bilan', 'bilan-2'])
        expect(lignes.map((l) => l.ordre)).toEqual([0, 1])
      }
    })

    it('CA26 should end with exactly one of the two lists when two gallery replacements run at the same time, with no non-business error and no orphan media', async () => {
      const TOURS = 3

      for (let tour = 0; tour < TOURS; tour += 1) {
        const { user } = await utilisateurAvecVitrine(`course-galerie-${tour}`)
        const [g1, g2, g3] = await uploaderImages(user.id, 3)
        const { item } = await creer(user.id)

        const resultats = await Promise.allSettled([
          modifier(user.id, item.realisation.id, { galerie: [g1, g2] }),
          modifier(user.id, item.realisation.id, { galerie: [g3] }),
        ])
        exigerModulesPresents(resultats)

        expect(resultats.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
        const finale = await galerieEnBase(item.realisation.id)
        expect([JSON.stringify([g1, g2]), JSON.stringify([g3])]).toContain(JSON.stringify(finale))
        expect((await lignesDeGalerie(item.realisation.id)).map((l) => l.ordre)).toEqual(finale.map((_, i) => i))
        for (const id of [g1, g2, g3]) {
          expect(finale.includes(id) ? await mediaIntact(id) : await mediaDisparu(id), `${id} (finale ${finale.length} images)`).toBe(true)
        }
      }
    })

    it('CA26 should answer every simultaneous update and deletion of the same realisation with success or REALISATION_INTROUVABLE, never a raw error', async () => {
      const { deleteRealisation } = await realisationsService()
      const TOURS = 4

      for (let tour = 0; tour < TOURS; tour += 1) {
        const { user, vitrine } = await utilisateurAvecVitrine(`course-suppression-${tour}`)
        const { item } = await creer(user.id, { galerie: [(await insertMediaRow(user.id)).id] })

        const resultats = await Promise.allSettled([
          modifier(user.id, item.realisation.id, { titre: 'Modifiée', galerie: [] }),
          deleteRealisation(user.id, item.realisation.id),
        ])
        exigerModulesPresents(resultats)

        expect(resultats[1]?.status).toBe('fulfilled')
        if (resultats[0]?.status === 'rejected') {
          const erreur = await rejet(Promise.reject(resultats[0].reason))
          expect(erreur.estDomainError).toBe(true)
          expect(erreur.code).toBe('REALISATION_INTROUVABLE')
        }
        expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
        expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
      }
    })
  })

  describe('CA27 isolation entre utilisateurs (404, jamais 403)', () => {
    async function deuxVitrinesAvecUneRealisation() {
      const a = await utilisateurAvecVitrine('vitrine-a')
      const b = await utilisateurAvecVitrine('vitrine-b')
      const g1 = (await insertMediaRow(a.user.id)).id
      const { item } = await creer(a.user.id, { titre: 'Réalisation de A', galerie: [g1] })
      return { a, b, realisationDeA: item.realisation, g1 }
    }

    it('CA27 should answer REALISATION_INTROUVABLE when B reads a realisation of A', async () => {
      const { getOwnRealisation } = await realisationsService()
      const { b, realisationDeA } = await deuxVitrinesAvecUneRealisation()

      const erreur = await rejet(getOwnRealisation(b.user.id, realisationDeA.id))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('REALISATION_INTROUVABLE')
      expect(erreur.status).toBe(404)
    })

    it('CA27 should answer REALISATION_INTROUVABLE when B updates a realisation of A, which stays intact (gallery included)', async () => {
      const { b, realisationDeA, g1 } = await deuxVitrinesAvecUneRealisation()
      const miennes = await insertMediaRow(b.user.id)

      const erreur = await rejet(modifier(b.user.id, realisationDeA.id, { titre: 'Piratée', actif: false, galerie: [miennes.id] }))

      expect(erreur.code).toBe('REALISATION_INTROUVABLE')
      expect(await ligneRealisation(realisationDeA.id)).toEqual(realisationDeA)
      expect(await galerieEnBase(realisationDeA.id)).toEqual([g1])
    })

    it('CA27 should answer REALISATION_INTROUVABLE when B deletes a realisation of A, which stays intact', async () => {
      const { deleteRealisation } = await realisationsService()
      const { b, realisationDeA, g1 } = await deuxVitrinesAvecUneRealisation()

      const erreur = await rejet(deleteRealisation(b.user.id, realisationDeA.id))

      expect(erreur.code).toBe('REALISATION_INTROUVABLE')
      expect(await ligneRealisation(realisationDeA.id)).toEqual(realisationDeA)
      expect(await galerieEnBase(realisationDeA.id)).toEqual([g1])
      expect(await mediaExiste(g1)).toBe(true)
    })

    it('CA27 should answer VITRINE_INTROUVABLE (not REALISATION_INTROUVABLE) to a user without vitrine', async () => {
      const { getOwnRealisation } = await realisationsService()
      const { realisationDeA } = await deuxVitrinesAvecUneRealisation()
      const sansVitrine = await createUser()

      const erreur = await rejet(getOwnRealisation(sansVitrine.id, realisationDeA.id))

      expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    })

    it('CA27 should not list the realisations of another user', async () => {
      const { listOwnRealisations } = await realisationsService()
      const { b } = await deuxVitrinesAvecUneRealisation()

      const { items, compteurs } = await listOwnRealisations(b.user.id)

      expect(items).toEqual([])
      expect(compteurs).toEqual({ total: 0, visibles: 0, enVedette: 0, vedetteMax: 3 })
    })
  })

  it('CA27 should read an own realisation with its image, its gallery in order and the counters', async () => {
    const { getOwnRealisation } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const [m1, ...galerie] = await uploaderImages(user.id, 3)
    const ordre = ordreContraireDuTri(galerie)
    const { item } = await creer(user.id, { imageMediaId: m1, galerie: ordre })

    const lu = await getOwnRealisation(user.id, item.realisation.id)

    expect(lu.item.realisation).toEqual(item.realisation)
    expect(lu.item.image?.id).toBe(m1)
    expect(lu.item.galerie.map((m) => m.id)).toEqual(ordre)
    expect(lu.compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
  })

  it('CA28 should refuse an empty patch before the service (400)', () => {
    const resultat = schemaRealisationUpdate.safeParse({})

    expect(resultat.success).toBe(false)
    expect(resultat.error?.issues[0]?.message).toBe('Aucune modification à enregistrer.')
  })
})

describe('realisations — suppression, ordre et liste (CA29 à CA33)', () => {
  it('CA29 should delete the realisation, its gallery lines, its main image and its gallery images when nothing else references them', async () => {
    const { deleteRealisation } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const [m1, g1, g2] = await uploaderImages(user.id, 3)
    const { item } = await creer(user.id, { imageMediaId: m1, galerie: [g1, g2] })

    await deleteRealisation(user.id, item.realisation.id)

    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
    expect(await toutesLesLignesDeGalerie()).toHaveLength(0)
    for (const id of [m1, g1, g2]) {
      expect(await mediaDisparu(id), id).toBe(true)
    }
  })

  it('CA29 should keep the images that something else references (vitrine photo, service, another realisation main image or gallery)', async () => {
    const { deleteRealisation } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const [photo, enService, principaleAilleurs, galerieAilleurs, libre] = await uploaderImages(user.id, 5)
    await db.update(vitrines).set({ photoMediaId: photo }).where(eq(vitrines.id, vitrine.id))
    await insertService(vitrine.id, { imageMediaId: enService })
    const autre = await creer(user.id, { titre: 'Autre', imageMediaId: principaleAilleurs, galerie: [galerieAilleurs] })
    const { item } = await creer(user.id, { titre: 'À supprimer', imageMediaId: photo, galerie: [enService, principaleAilleurs, galerieAilleurs, libre] })

    await deleteRealisation(user.id, item.realisation.id)

    for (const id of [photo, enService, principaleAilleurs, galerieAilleurs]) {
      expect(await mediaIntact(id), id).toBe(true)
    }
    expect(await mediaDisparu(libre)).toBe(true)
    expect(await galerieEnBase(autre.item.realisation.id)).toEqual([galerieAilleurs])
  })

  it('CA29 should free the vedette place of a deleted vedette: the next creation becomes a vedette automatically', async () => {
    const { deleteRealisation } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })
    for (const titre of ['R2', 'R3']) {
      await creer(user.id, { titre })
    }
    expect((await creer(user.id, { titre: 'R4' })).item.realisation.enVedette).toBe(false)

    await deleteRealisation(user.id, r1.item.realisation.id)
    const { item, compteurs } = await creer(user.id, { titre: 'R5' })

    expect(item.realisation.enVedette).toBe(true)
    expect(compteurs).toEqual({ total: 4, visibles: 4, enVedette: 3, vedetteMax: 3 })
  })

  it('CA30 should answer REALISATION_INTROUVABLE when the deleted uuid is unknown, and when it was already deleted (double click)', async () => {
    const { deleteRealisation } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)
    await deleteRealisation(user.id, item.realisation.id)

    const inconnu = await rejet(deleteRealisation(user.id, randomUUID()))
    const doublon = await rejet(deleteRealisation(user.id, item.realisation.id))

    for (const erreur of [inconnu, doublon]) {
      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('REALISATION_INTROUVABLE')
      expect(erreur.status).toBe(404)
    }
  })

  it('CA31 should apply the new order: [R3, R1, R2] gives orders 0, 1, 2 to R3, R1, R2 in the studio list', async () => {
    const { reorderRealisations, listOwnRealisations } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })
    const r2 = await creer(user.id, { titre: 'R2' })
    const r3 = await creer(user.id, { titre: 'R3' })

    const { items, compteurs } = await reorderRealisations(user.id, [r3, r1, r2].map((r) => r.item.realisation.id))

    expect(items.map((i) => i.realisation.titre)).toEqual(['R3', 'R1', 'R2'])
    expect(compteurs).toEqual({ total: 3, visibles: 3, enVedette: 3, vedetteMax: 3 })
    const lignes = await lignesDeLaVitrine(vitrine.id)
    expect(lignes.map((l) => [l.titre, l.ordre])).toEqual([['R3', 0], ['R1', 1], ['R2', 2]])
    expect((await listOwnRealisations(user.id)).items.map((i) => i.realisation.titre)).toEqual(['R3', 'R1', 'R2'])
  })

  it('CA31 should keep the galleries and images of the realisations when they are reordered', async () => {
    const { reorderRealisations } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const g1 = (await insertMediaRow(user.id)).id
    const r1 = await creer(user.id, { titre: 'R1', galerie: [g1] })
    const r2 = await creer(user.id, { titre: 'R2' })

    const { items } = await reorderRealisations(user.id, [r2.item.realisation.id, r1.item.realisation.id])

    expect(items.map((i) => i.galerie.map((m) => m.id))).toEqual([[], [g1]])
    expect(items.map((i) => i.image?.id)).toEqual([r2.item.image?.id, r1.item.image?.id])
  })

  it('CA31 should make the public list follow the new order', async () => {
    const { reorderRealisations, getPublicRealisations } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })
    const r2 = await creer(user.id, { titre: 'R2' })
    const r3 = await creer(user.id, { titre: 'R3' })

    await reorderRealisations(user.id, [r3, r2, r1].map((r) => r.item.realisation.id))

    const publiques = await getPublicRealisations('dr-test')
    expect(publiques.realisations.map((i) => i.realisation.titre)).toEqual(['R3', 'R2', 'R1'])
    expect(publiques.aLaUne.map((i) => i.realisation.titre)).toEqual(['R3', 'R2', 'R1'])
  })

  it('CA31 should reorder masked realisations too (the list contains every realisation of the vitrine)', async () => {
    const { reorderRealisations } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })
    const masquee = await creer(user.id, { titre: 'Masquée', actif: false })

    await reorderRealisations(user.id, [masquee, r1].map((r) => r.item.realisation.id))

    expect(await titresDeLaVitrine(vitrine.id)).toEqual(['Masquée', 'R1'])
  })

  describe('CA32 ordre invalide (422 ORDRE_INVALIDE, ordres inchangés)', () => {
    async function troisRealisations() {
      const a = await utilisateurAvecVitrine('vitrine-a')
      const b = await utilisateurAvecVitrine('vitrine-b')
      const ids: string[] = []
      for (const titre of ['R1', 'R2', 'R3']) {
        ids.push((await creer(a.user.id, { titre })).item.realisation.id)
      }
      const realisationDeB = (await creer(b.user.id, { titre: 'Réalisation de B' })).item.realisation.id
      return { a, b, ids, realisationDeB }
    }

    async function ordresDe(vitrineId: string) {
      return (await lignesDeLaVitrine(vitrineId)).map((l) => [l.titre, l.ordre])
    }

    it.each([
      ['une liste incomplète', ({ ids }: Awaited<ReturnType<typeof troisRealisations>>) => [ids[2], ids[0]]],
      ['un doublon', ({ ids }: Awaited<ReturnType<typeof troisRealisations>>) => [ids[0], ids[0], ids[1], ids[2]]],
      ['l’identifiant d’une réalisation d’un autre utilisateur à la place d’une des siennes', ({ ids, realisationDeB }: Awaited<ReturnType<typeof troisRealisations>>) => [ids[0], ids[1], realisationDeB]],
      ['l’identifiant d’une réalisation d’un autre utilisateur en plus', ({ ids, realisationDeB }: Awaited<ReturnType<typeof troisRealisations>>) => [...ids, realisationDeB]],
      ['un identifiant inconnu en plus', ({ ids }: Awaited<ReturnType<typeof troisRealisations>>) => [...ids, randomUUID()]],
    ])('CA32 should refuse %s', async (_libelle, fabriquer) => {
      const { reorderRealisations } = await realisationsService()
      const contexte = await troisRealisations()
      const avant = await ordresDe(contexte.a.vitrine.id)

      const erreur = await rejet(reorderRealisations(contexte.a.user.id, fabriquer(contexte)))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('ORDRE_INVALIDE')
      expect(erreur.status).toBe(422)
      expect(sansTypographie(erreur.message)).toBe(MESSAGE_ORDRE_INVALIDE)
      expect(await ordresDe(contexte.a.vitrine.id)).toEqual(avant)
      expect(await ordresDe(contexte.b.vitrine.id)).toEqual([['Réalisation de B', 0]])
    })

    it('CA32 should answer VITRINE_INTROUVABLE to a user without vitrine', async () => {
      const { reorderRealisations } = await realisationsService()
      const sansVitrine = await createUser()

      const erreur = await rejet(reorderRealisations(sansVitrine.id, [randomUUID()]))

      expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    })

    it('CA32 should keep consistent orders when two reorderings run at the same time (one complete permutation wins)', async () => {
      const { reorderRealisations } = await realisationsService()
      const { user, vitrine } = await utilisateurAvecVitrine()
      const ids = []
      for (const titre of ['R1', 'R2', 'R3']) {
        ids.push((await creer(user.id, { titre })).item.realisation.id)
      }

      const resultats = await Promise.allSettled([
        reorderRealisations(user.id, [ids[2], ids[1], ids[0]]),
        reorderRealisations(user.id, [ids[1], ids[2], ids[0]]),
      ])
      exigerModulesPresents(resultats)

      expect(resultats.every((r) => r.status === 'fulfilled')).toBe(true)
      const lignes = await lignesDeLaVitrine(vitrine.id)
      expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2])
      expect(['R3,R2,R1', 'R2,R3,R1']).toContain(lignes.map((l) => l.titre).join(','))
    })
  })

  it('CA33 should list the four realisations in order with the gallery of each in order and the counters 4 / 3 / 2 / 3', async () => {
    const { listOwnRealisations } = await realisationsService()
    const { toRealisationsCompteursResource } = await ressourceRealisation()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const [a, b] = ordreContraireDuTri([(await insertMediaRow(user.id)).id, (await insertMediaRow(user.id)).id])
    const principale = await insertMediaRow(user.id)
    const r1 = await insertRealisation(vitrine.id, { titre: 'R1', slug: 'r1', ordre: 0, enVedette: true, imageMediaId: principale.id })
    await insertRealisation(vitrine.id, { titre: 'R2', slug: 'r2', ordre: 1, enVedette: true })
    await insertRealisation(vitrine.id, { titre: 'R3', slug: 'r3', ordre: 2 })
    await insertRealisation(vitrine.id, { titre: 'R4 masquée', slug: 'r4', ordre: 3, actif: false })
    await insertRealisationImage(r1.id, a, 0)
    await insertRealisationImage(r1.id, b, 1)

    const { items, compteurs } = await listOwnRealisations(user.id)

    expect(items.map((i) => i.realisation.titre)).toEqual(['R1', 'R2', 'R3', 'R4 masquée'])
    expect(items.map((i) => i.galerie.map((m) => m.id))).toEqual([[a, b], [], [], []])
    expect(items[0]?.image?.id).toBe(principale.id)
    expect(toRealisationsCompteursResource(compteurs)).toEqual({ total: 4, visibles: 3, enVedette: 2, vedetteMax: 3 })
  })

  it('CA33 should sort by order, then creation date, then id', async () => {
    const { listOwnRealisations } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const t = (heure: number) => new Date(Date.UTC(2026, 0, 1, heure))
    await insertRealisation(vitrine.id, { titre: 'Z (ordre 1)', ordre: 1, createdAt: t(1) })
    await insertRealisation(vitrine.id, { titre: 'B (ordre 0, 11h)', ordre: 0, createdAt: t(11) })
    await insertRealisation(vitrine.id, { titre: 'A (ordre 0, 10h)', ordre: 0, createdAt: t(10) })
    await insertRealisation(vitrine.id, { id: '00000000-0000-4000-8000-000000000002', titre: 'D (ordre 0, 12h, id 2)', ordre: 0, createdAt: t(12) })
    await insertRealisation(vitrine.id, { id: '00000000-0000-4000-8000-000000000001', titre: 'C (ordre 0, 12h, id 1)', ordre: 0, createdAt: t(12) })

    const { items } = await listOwnRealisations(user.id)

    expect(items.map((i) => i.realisation.titre)).toEqual([
      'A (ordre 0, 10h)',
      'B (ordre 0, 11h)',
      'C (ordre 0, 12h, id 1)',
      'D (ordre 0, 12h, id 2)',
      'Z (ordre 1)',
    ])
  })

  it('CA33 should answer an empty list with zero counters for a vitrine without realisation, and VITRINE_INTROUVABLE without vitrine', async () => {
    const { listOwnRealisations } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const sansVitrine = await createUser()

    const vide = await listOwnRealisations(user.id)
    const erreur = await rejet(listOwnRealisations(sansVitrine.id))

    expect(vide.items).toEqual([])
    expect(vide.compteurs).toEqual({ total: 0, visibles: 0, enVedette: 0, vedetteMax: 3 })
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA33 should keep the number of SQL queries of the studio list independent of the number of realisations (no N+1 on the galleries)', async () => {
    const { listOwnRealisations } = await realisationsService()
    const petite = await utilisateurAvecVitrine('petite-vitrine')
    const grande = await utilisateurAvecVitrine('grande-vitrine')
    await peupler(petite.user.id, petite.vitrine.id, 1)
    await peupler(grande.user.id, grande.vitrine.id, 6)

    const requetesPetite = await compterRequetes(() => listOwnRealisations(petite.user.id))
    const requetesGrande = await compterRequetes(() => listOwnRealisations(grande.user.id))

    expect(requetesPetite).toBeGreaterThan(0)
    expect(requetesGrande).toBe(requetesPetite)
    expect((await listOwnRealisations(grande.user.id)).items.every((i) => i.galerie.length === 3)).toBe(true)
  })
})

describe('realisations — lecture publique (CA34 à CA40)', () => {
  /** Trois réalisations visibles (R2 en vedette) et une masquée, insérées directement. */
  async function vitrineAvecQuatreRealisations() {
    const { user, vitrine } = await utilisateurAvecVitrine()
    await insertRealisation(vitrine.id, { titre: 'R1', slug: 'r1', ordre: 0 })
    await insertRealisation(vitrine.id, { titre: 'R2', slug: 'r2', ordre: 1, enVedette: true })
    await insertRealisation(vitrine.id, { titre: 'R3', slug: 'r3', ordre: 2 })
    await insertRealisation(vitrine.id, { titre: 'Masquée', slug: 'masquee', ordre: 3, actif: false })
    return { user, vitrine }
  }

  it('CA34 should list the visible realisations in order, count them, and put the vedettes in aLaUne; the masked one is absent everywhere', async () => {
    const { getPublicRealisations } = await realisationsService()
    await vitrineAvecQuatreRealisations()

    const publiques = await getPublicRealisations('dr-test')

    expect(publiques.total).toBe(3)
    expect(publiques.realisations.map((i) => i.realisation.titre)).toEqual(['R1', 'R2', 'R3'])
    expect(publiques.aLaUne.map((i) => i.realisation.titre)).toEqual(['R2'])
    expect(JSON.stringify(publiques)).not.toContain('Masquée')
  })

  it('CA34 should normalise the username (DR-TEST finds dr-test)', async () => {
    const { getPublicRealisations } = await realisationsService()
    await vitrineAvecQuatreRealisations()

    expect((await getPublicRealisations(' DR-TEST ')).total).toBe(3)
  })

  it('CA34 should join the main image of the public realisations', async () => {
    const { getPublicRealisations } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const image = await insertMediaRow(user.id)
    await insertRealisation(vitrine.id, { titre: 'Avec image', slug: 'avec-image', imageMediaId: image.id })

    const publiques = await getPublicRealisations('dr-test')

    expect(publiques.realisations[0]?.image?.id).toBe(image.id)
  })

  it('CA35 should fall back to the first three visible realisations by order when none is a vedette', async () => {
    const { getPublicRealisations } = await realisationsService()
    const { vitrine } = await utilisateurAvecVitrine()
    for (const [ordre, titre] of ['R1', 'R2', 'R3', 'R4'].entries()) {
      await insertRealisation(vitrine.id, { titre, slug: titre.toLowerCase(), ordre })
    }

    const publiques = await getPublicRealisations('dr-test')

    expect(publiques.aLaUne.map((i) => i.realisation.titre)).toEqual(['R1', 'R2', 'R3'])
    expect(publiques.realisations).toHaveLength(4)
  })

  it('CA35 should never put a masked realisation in the fallback of aLaUne', async () => {
    const { getPublicRealisations } = await realisationsService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertRealisation(vitrine.id, { titre: 'Masquée', slug: 'masquee', ordre: 0, actif: false })
    await insertRealisation(vitrine.id, { titre: 'Visible', slug: 'visible', ordre: 1 })

    expect((await getPublicRealisations('dr-test')).aLaUne.map((i) => i.realisation.titre)).toEqual(['Visible'])
  })

  it('CA36 should answer total 0 and empty lists for a published vitrine without visible realisation', async () => {
    const { getPublicRealisations } = await realisationsService()
    const { vitrine } = await utilisateurAvecVitrine()

    const vide = await getPublicRealisations('dr-test')
    await insertRealisation(vitrine.id, { titre: 'Masquée', slug: 'masquee', actif: false })
    const seulementMasquee = await getPublicRealisations('dr-test')

    for (const publiques of [vide, seulementMasquee]) {
      expect(publiques.total).toBe(0)
      expect(publiques.realisations).toEqual([])
      expect(publiques.aLaUne).toEqual([])
    }
  })

  it('CA37 should answer VITRINE_INTROUVABLE for an unpublished vitrine, an unknown username and an invalid one', async () => {
    const { getPublicRealisations, getPublicRealisation } = await realisationsService()
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { username: 'brouillon', publiee: false })
    await insertRealisation(vitrine.id, { titre: 'Visible mais non publiée', slug: 'visible' })

    for (const username of ['brouillon', 'inconnu', 'Bad_Name', '', "x'; DROP TABLE realisations;--"]) {
      const liste = await rejet(getPublicRealisations(username))
      const detail = await rejet(getPublicRealisation(username, 'visible'))

      expect(liste.estDomainError).toBe(true)
      expect(liste.code).toBe('VITRINE_INTROUVABLE')
      expect(liste.status).toBe(404)
      expect(detail.code).toBe('VITRINE_INTROUVABLE')
    }
    expect(await db.select().from(realisations)).toHaveLength(1)
  })

  it('CA37 should stop exposing the realisations as soon as the vitrine is unpublished', async () => {
    const { getPublicRealisations } = await realisationsService()
    const { vitrine } = await vitrineAvecQuatreRealisations()
    await expect(getPublicRealisations('dr-test')).resolves.toBeDefined()

    await db.update(vitrines).set({ publieeLe: null }).where(eq(vitrines.id, vitrine.id))

    expect((await rejet(getPublicRealisations('dr-test'))).code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA38 should return the realisation with its gallery in order, at most two other visible realisations in order (without the current one) and the total', async () => {
    const { getPublicRealisation } = await realisationsService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    for (const [ordre, titre] of ['R1', 'R2', 'R3', 'R4', 'R5'].entries()) {
      await insertRealisation(vitrine.id, { titre, slug: titre.toLowerCase(), ordre })
    }
    await insertRealisation(vitrine.id, { titre: 'Masquée', slug: 'masquee', ordre: 5, actif: false })
    const r3 = (await lignesDeLaVitrine(vitrine.id)).find((l) => l.slug === 'r3')!
    const [g1, g2, g3] = ordreContraireDuTri([
      (await insertMediaRow(user.id)).id,
      (await insertMediaRow(user.id)).id,
      (await insertMediaRow(user.id)).id,
    ])
    await insertRealisationImage(r3.id, g1, 0)
    await insertRealisationImage(r3.id, g2, 1)
    await insertRealisationImage(r3.id, g3, 2)

    const detailR3 = await getPublicRealisation('dr-test', 'r3')
    const detailR1 = await getPublicRealisation('dr-test', 'r1')
    const detailR5 = await getPublicRealisation('dr-test', 'r5')

    expect(detailR3.item.realisation.titre).toBe('R3')
    expect(detailR3.item.galerie.map((m) => m.id)).toEqual([g1, g2, g3])
    expect(detailR3.autres.map((i) => i.realisation.titre)).toEqual(['R1', 'R2'])
    expect(detailR3.total).toBe(5)
    expect(detailR1.autres.map((i) => i.realisation.titre)).toEqual(['R2', 'R3'])
    expect(detailR5.autres.map((i) => i.realisation.titre)).toEqual(['R1', 'R2'])
  })

  it('CA38 should return an empty "autres" list when the realisation is the only visible one', async () => {
    const { getPublicRealisation } = await realisationsService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertRealisation(vitrine.id, { titre: 'Seule', slug: 'seule' })

    const detail = await getPublicRealisation('dr-test', 'seule')

    expect(detail.autres).toEqual([])
    expect(detail.total).toBe(1)
    expect(detail.item.galerie).toEqual([])
  })

  it('CA38 should answer REALISATION_INTROUVABLE for a masked slug, an unknown slug and a malformed one', async () => {
    const { getPublicRealisation } = await realisationsService()
    await vitrineAvecQuatreRealisations()

    for (const slug of ['masquee', 'inconnu', 'bad_slug!', '', 'a'.repeat(300), "x'; DROP TABLE realisations;--"]) {
      const erreur = await rejet(getPublicRealisation('dr-test', slug))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('REALISATION_INTROUVABLE')
      expect(erreur.status).toBe(404)
    }
  })

  it('CA38 should answer REALISATION_INTROUVABLE for the slug of another vitrine', async () => {
    const { getPublicRealisation } = await realisationsService()
    await vitrineAvecQuatreRealisations()
    const autre = await utilisateurAvecVitrine('autre-vitrine')
    await insertRealisation(autre.vitrine.id, { titre: 'Chez les autres', slug: 'chez-les-autres' })

    const erreur = await rejet(getPublicRealisation('dr-test', 'chez-les-autres'))

    expect(erreur.code).toBe('REALISATION_INTROUVABLE')
  })

  it('CA38 should find a realisation whatever the case of the slug (UNITE-DE-CATHETERISME-CHU-DE-DOUALA)', async () => {
    const { getPublicRealisation } = await realisationsService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertRealisation(vitrine.id, { titre: 'Unité de cathétérisme, CHU de Douala', slug: 'unite-de-catheterisme-chu-de-douala' })

    const detail = await getPublicRealisation('dr-test', 'UNITE-DE-CATHETERISME-CHU-DE-DOUALA')

    expect(detail.item.realisation.slug).toBe('unite-de-catheterisme-chu-de-douala')
  })

  it('CA38 should keep the number of SQL queries of the public detail and list independent of the number of realisations (no N+1)', async () => {
    const { getPublicRealisation, getPublicRealisations } = await realisationsService()
    const petite = await utilisateurAvecVitrine('petite-vitrine')
    const grande = await utilisateurAvecVitrine('grande-vitrine')
    await peupler(petite.user.id, petite.vitrine.id, 3)
    await peupler(grande.user.id, grande.vitrine.id, 8)

    const detailPetite = await compterRequetes(() => getPublicRealisation('petite-vitrine', 'r0'))
    const detailGrande = await compterRequetes(() => getPublicRealisation('grande-vitrine', 'r0'))
    const listePetite = await compterRequetes(() => getPublicRealisations('petite-vitrine'))
    const listeGrande = await compterRequetes(() => getPublicRealisations('grande-vitrine'))

    expect(detailPetite).toBeGreaterThan(0)
    expect(detailGrande).toBe(detailPetite)
    expect(listePetite).toBeGreaterThan(0)
    expect(listeGrande).toBe(listePetite)
  })

  describe('CA39 liste blanche des DTO publics', () => {
    const CLES_CARTE = ['annee', 'description', 'image', 'lieu', 'slug', 'titre']
    const CLES_DETAIL = [...CLES_CARTE, 'galerie', 'lien', 'role', 'seo'].sort()
    const DESCRIPTION_LONGUE = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')

    async function detailPublic(surcharges: Partial<typeof realisations.$inferInsert> = {}) {
      const { getPublicRealisation } = await realisationsService()
      const { toRealisationPublicDetailResource } = await ressourceRealisation()
      const { user, vitrine } = await utilisateurAvecVitrine()
      const [image, g1, g2] = await uploaderImages(user.id, 3)
      const ligne = await insertRealisation(vitrine.id, {
        titre: 'Unité de cathétérisme, CHU de Douala',
        slug: 'unite-de-catheterisme-chu-de-douala',
        description: 'Mise en place d’une unité dédiée.',
        imageMediaId: image,
        annee: 2025,
        lieu: 'CHU de Douala',
        role: 'Responsable médical',
        lien: 'https://chu-douala.cm/unite',
        enVedette: true,
        ...surcharges,
      })
      await insertRealisationImage(ligne.id, g1, 0)
      await insertRealisationImage(ligne.id, g2, 1)
      const lu = await getPublicRealisation('dr-test', 'unite-de-catheterisme-chu-de-douala')
      return {
        ligne,
        vitrine,
        image,
        galerie: [g1, g2],
        user,
        dto: toRealisationPublicDetailResource(lu.item.realisation, lu.item.image, lu.item.galerie, lu.vitrine),
      }
    }

    it('CA39 should expose exactly the keys of RealisationPublicCarteDTO on the cards (list, aLaUne, autres)', async () => {
      const { getPublicRealisations, getPublicRealisation } = await realisationsService()
      const { toRealisationPublicCarteResource } = await ressourceRealisation()
      await vitrineAvecQuatreRealisations()

      const liste = await getPublicRealisations('dr-test')
      const detail = await getPublicRealisation('dr-test', 'r1')

      const cartes = [...liste.realisations, ...liste.aLaUne, ...detail.autres].map((i) => toRealisationPublicCarteResource(i.realisation, i.image))
      expect(cartes.length).toBeGreaterThan(0)
      for (const carte of cartes) {
        expect(Object.keys(carte).sort()).toEqual(CLES_CARTE)
      }
    })

    it('CA39 should expose exactly the keys of RealisationPublicDetailDTO on the detail', async () => {
      const { dto } = await detailPublic()

      expect(Object.keys(dto).sort()).toEqual(CLES_DETAIL)
      expect(Object.keys(dto.seo).sort()).toEqual(['description', 'titre'])
    })

    it('CA39 should never leak an identifier, the owner, the order, the vedette flag, the dates or a storage path (the media ids of the images are public)', async () => {
      const { dto, ligne, vitrine, user, image } = await detailPublic()

      const json = JSON.stringify(dto)

      for (const secret of [ligne.id, vitrine.id, user.id, `${user.id}/${image}`, '"ordre"', '"actif"', '"enVedette"', '"vitrineId"', '"creeLe"', '"modifieLe"', '"createdAt"', '"updatedAt"', '"chemin"', '"imageMediaId"', '"userId"']) {
        expect(json).not.toContain(secret)
      }
    })

    it('CA39 should expose the main image and the gallery as MediaDTO keys with the 1600 urls, the gallery in order', async () => {
      const { dto, image, galerie } = await detailPublic()

      expect(Object.keys(dto.image ?? {}).sort()).toEqual(['hauteur', 'id', 'largeur', 'srcset', 'url'])
      expect(dto.image?.url).toBe(`/medias/${image}/1600.webp`)
      expect(dto.galerie.map((m) => m.id)).toEqual(galerie)
      expect(dto.galerie.map((m) => m.url)).toEqual(galerie.map((id) => `/medias/${id}/1600.webp`))
    })

    it('CA39 should compose the SEO title as "<titre> — <nomAffiche>"', async () => {
      const { dto } = await detailPublic()

      expect(dto.seo.titre).toBe('Unité de cathétérisme, CHU de Douala — Dr Cabrel Nguesso')
    })

    it('CA39 should truncate a 300-character description to at most 160 characters in seo.description', async () => {
      const { dto } = await detailPublic({ description: DESCRIPTION_LONGUE })

      expect(DESCRIPTION_LONGUE.length).toBeGreaterThan(160)
      expect(dto.seo.description.length).toBeLessThanOrEqual(160)
      expect(dto.seo.description.length).toBeGreaterThan(100)
    })

    it('CA39 should fall back to "<titre>, une réalisation de <nomAffiche>, <metier> à <ville>." without description', async () => {
      const { dto } = await detailPublic({ description: null })

      expect(dto.seo.description).toBe('Unité de cathétérisme, CHU de Douala, une réalisation de Dr Cabrel Nguesso, Cardiologue à Douala.')
    })

    it('CA39 should expose the role and the link on the detail only', async () => {
      const { getPublicRealisations } = await realisationsService()
      const { toRealisationPublicCarteResource } = await ressourceRealisation()
      const { dto } = await detailPublic()
      const liste = await getPublicRealisations('dr-test')

      expect(dto.role).toBe('Responsable médical')
      expect(dto.lien).toBe('https://chu-douala.cm/unite')
      const carte = liste.realisations[0]
      expect(carte).toBeDefined()
      expect(JSON.stringify(toRealisationPublicCarteResource(carte!.realisation, carte!.image))).not.toContain('Responsable médical')
    })
  })

  it('CA40 should remove a realisation from the list and from aLaUne once masked, and answer REALISATION_INTROUVABLE on its detail', async () => {
    const { getPublicRealisations, getPublicRealisation } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })
    await creer(user.id, { titre: 'R2' })
    expect((await getPublicRealisations('dr-test')).aLaUne.map((i) => i.realisation.titre)).toEqual(['R1', 'R2'])
    await expect(getPublicRealisation('dr-test', 'r1')).resolves.toBeDefined()

    await modifier(user.id, r1.item.realisation.id, { actif: false })

    const publiques = await getPublicRealisations('dr-test')
    expect(publiques.realisations.map((i) => i.realisation.titre)).toEqual(['R2'])
    expect(publiques.aLaUne.map((i) => i.realisation.titre)).toEqual(['R2'])
    expect(publiques.total).toBe(1)
    expect((await rejet(getPublicRealisation('dr-test', 'r1'))).code).toBe('REALISATION_INTROUVABLE')
  })

  it('CA40 should make a deleted realisation disappear from the public lists and detail', async () => {
    const { getPublicRealisations, getPublicRealisation, deleteRealisation } = await realisationsService()
    const { user } = await utilisateurAvecVitrine()
    const r1 = await creer(user.id, { titre: 'R1' })

    await deleteRealisation(user.id, r1.item.realisation.id)

    expect((await getPublicRealisations('dr-test')).total).toBe(0)
    expect((await rejet(getPublicRealisation('dr-test', 'r1'))).code).toBe('REALISATION_INTROUVABLE')
  })
})
