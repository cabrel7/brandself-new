import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { temoignages } from '../../shared/db/schema'
import type { TemoignageCreateInput, TemoignageUpdateInput } from '../../shared/schemas/temoignage'
import { schemaTemoignageCreate, schemaTemoignageUpdate } from '../../shared/schemas/temoignage'
import { rejet } from './support/erreurs'
import { createUser, insertTemoignage } from './support/fabriques'
import { creerVitrinePubliee, UUID_V4_OU_V7 } from './support/services'

// Vrai PostgreSQL (migrations réelles), vrai Redis, aucun mock : la couche service est éprouvée
// contre la base `brandself_test`, un test par critère (spec S5).
// `support/modules.ts` ne liste pas encore `temoignages` et ce livrable ne modifie aucun fichier
// existant : import paresseux local, même patron que `modules.ts` (« jamais d’import statique »).
const temoignagesService = () => import('../../server/services/temoignages')

const DONNEES: TemoignageCreateInput = {
  slug: 'un-temoignage',
  auteur: 'Un patient',
  texte: 'Très bien.',
  enVedette: false,
  ordre: 0,
  actif: true,
}

async function utilisateurAvecVitrinePubliee(username = 'dr-temoignages') {
  const user = await createUser()
  const vitrine = await creerVitrinePubliee(user, username)
  return { user, vitrine }
}

/** Création via la vraie couche service ; l’entrée passe par le vrai schéma Zod. */
async function creer(userId: string, surcharges: Partial<TemoignageCreateInput> = {}) {
  const { createTemoignage } = await temoignagesService()
  return createTemoignage(userId, schemaTemoignageCreate.parse({ ...DONNEES, ...surcharges }))
}

/** Mise à jour via la vraie couche service ; le patch passe par le schéma partiel. */
async function modifier(userId: string, id: string, patch: Partial<TemoignageUpdateInput>) {
  const { updateTemoignage } = await temoignagesService()
  return updateTemoignage(userId, id, schemaTemoignageUpdate.parse(patch))
}

async function ligneEnBase(id: string) {
  const [ligne] = await db.select().from(temoignages).where(eq(temoignages.id, id))
  return ligne
}

async function slugsEnBase(vitrineId: string): Promise<string[]> {
  const lignes = await db
    .select({ slug: temoignages.slug, ordre: temoignages.ordre })
    .from(temoignages)
    .where(eq(temoignages.vitrineId, vitrineId))
    .orderBy(asc(temoignages.ordre), asc(temoignages.createdAt), asc(temoignages.id))
  return lignes.map((ligne) => ligne.slug)
}

describe('temoignages — création : la ligne existe réellement en base', () => {
  it('should persist slug, auteur, fonction, texte, vedette, actif and order 0 (Drizzle select)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()

    const { item, compteurs } = await creer(user.id, {
      slug: 'alice-mbarga',
      auteur: 'Alice Mbarga',
      fonction: 'Cliente',
      texte: 'Toujours à l’écoute.',
      enVedette: true,
    })

    expect(item.id).toMatch(UUID_V4_OU_V7)
    expect(item).toMatchObject({
      vitrineId: vitrine.id,
      slug: 'alice-mbarga',
      auteur: 'Alice Mbarga',
      fonction: 'Cliente',
      texte: 'Toujours à l’écoute.',
      enVedette: true,
      actif: true,
      ordre: 0,
    })
    expect(compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })

    const ligne = await ligneEnBase(item.id)
    expect(ligne).toMatchObject({
      vitrineId: vitrine.id,
      slug: 'alice-mbarga',
      auteur: 'Alice Mbarga',
      fonction: 'Cliente',
      texte: 'Toujours à l’écoute.',
      enVedette: true,
      actif: true,
      ordre: 0,
    })
    expect(ligne?.createdAt).toBeInstanceOf(Date)
    expect(ligne?.updatedAt).toBeInstanceOf(Date)
  })

  it('should give each new creation of the same vitrine the next order (0, then 1, then 2)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()

    const premier = await creer(user.id, { slug: 'alice-mbarga', auteur: 'Alice' })
    const deuxieme = await creer(user.id, { slug: 'bruno-njoya', auteur: 'Bruno' })
    const troisieme = await creer(user.id, { slug: 'chantal-ekwalla', auteur: 'Chantal' })

    expect([premier.item.ordre, deuxieme.item.ordre, troisieme.item.ordre]).toEqual([0, 1, 2])
    expect(await slugsEnBase(vitrine.id)).toEqual(['alice-mbarga', 'bruno-njoya', 'chantal-ekwalla'])
    expect((await ligneEnBase(deuxieme.item.id))?.ordre).toBe(1)
    expect((await ligneEnBase(troisieme.item.id))?.ordre).toBe(2)
  })

  it('should store a masked témoignage as inactive, never as a vedette, and count no visible one', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()

    const { item, compteurs } = await creer(user.id, {
      slug: 'chantal-masquee',
      auteur: 'Chantal',
      actif: false,
      enVedette: false,
    })

    expect(item).toMatchObject({ actif: false, enVedette: false })
    expect(compteurs).toEqual({ total: 1, visibles: 0, enVedette: 0, vedetteMax: 3 })
    expect(await ligneEnBase(item.id)).toMatchObject({ actif: false, enVedette: false })
  })

  it('should reject an explicitly featured masked témoignage (400 enVedette) and insert nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()

    const erreur = await rejet(creer(user.id, {
      slug: 'avis-incoherent',
      auteur: 'Alice',
      actif: false,
      enVedette: true,
    }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VALIDATION')
    expect(erreur.status).toBe(400)
    expect(erreur.data?.champs).toEqual({
      enVedette: ['Un témoignage masqué ne peut pas être en vedette.'],
    })
    expect(await slugsEnBase(vitrine.id)).toEqual([])
  })
})

describe('temoignages — liste : tri et compteurs', () => {
  it('should list the rows in order (ordre, then creation) with total, visibles, enVedette and vedetteMax', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()
    await insertTemoignage(vitrine.id, { slug: 'tiers', auteur: 'Tiers', ordre: 2, actif: false, enVedette: false })
    await insertTemoignage(vitrine.id, { slug: 'premier', auteur: 'Premier', ordre: 0, actif: true, enVedette: true })
    await insertTemoignage(vitrine.id, { slug: 'second', auteur: 'Second', ordre: 1, actif: true, enVedette: true })

    const { listOwnTemoignages } = await temoignagesService()
    const { items, compteurs } = await listOwnTemoignages(user.id)

    expect(items.map((ligne) => ligne.slug)).toEqual(['premier', 'second', 'tiers'])
    expect(items.map((ligne) => ligne.ordre)).toEqual([0, 1, 2])
    expect(compteurs).toEqual({ total: 3, visibles: 2, enVedette: 2, vedetteMax: 3 })
  })

  it('should answer VITRINE_INTROUVABLE (404) for a user without vitrine', async () => {
    const user = await createUser()

    const { listOwnTemoignages } = await temoignagesService()
    const erreur = await rejet(listOwnTemoignages(user.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })
})

describe('temoignages — mise à jour', () => {
  it('should persist the new texte and enVedette, leaving the other columns untouched', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()
    const { item } = await creer(user.id, {
      slug: 'bruno-njoya',
      auteur: 'Bruno',
      fonction: 'Directeur',
      texte: 'Diagnostic rapide.',
      enVedette: false,
    })

    const { item: modifie, compteurs } = await modifier(user.id, item.id, { texte: 'Diagnostic rapide et humain.', enVedette: true })

    expect(modifie).toMatchObject({
      id: item.id,
      slug: 'bruno-njoya',
      auteur: 'Bruno',
      fonction: 'Directeur',
      texte: 'Diagnostic rapide et humain.',
      enVedette: true,
      actif: true,
      ordre: 0,
    })
    expect(compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    expect(await ligneEnBase(item.id)).toMatchObject({
      slug: 'bruno-njoya',
      auteur: 'Bruno',
      fonction: 'Directeur',
      texte: 'Diagnostic rapide et humain.',
      enVedette: true,
      actif: true,
    })
  })

  it('should withdraw the vedette of a masked témoignage (R4) and update the counters', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()
    const { item } = await creer(user.id, { slug: 'alice-mbarga', auteur: 'Alice', enVedette: true })

    const { item: masque, compteurs } = await modifier(user.id, item.id, { actif: false })

    expect(masque).toMatchObject({ actif: false, enVedette: false })
    expect(compteurs).toEqual({ total: 1, visibles: 0, enVedette: 0, vedetteMax: 3 })
    expect(await ligneEnBase(item.id)).toMatchObject({ actif: false, enVedette: false })
  })

  it('should reject an explicitly featured masked state (400 enVedette) without mutating the row', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()
    const { item } = await creer(user.id, {
      slug: 'avis-a-conserver',
      auteur: 'Alice',
      texte: 'Texte initial.',
      enVedette: true,
    })
    const avant = await ligneEnBase(item.id)

    const erreur = await rejet(modifier(user.id, item.id, {
      texte: 'Texte à ne pas enregistrer.',
      actif: false,
      enVedette: true,
    }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VALIDATION')
    expect(erreur.status).toBe(400)
    expect(erreur.data?.champs).toEqual({
      enVedette: ['Un témoignage masqué ne peut pas être en vedette.'],
    })
    expect(await ligneEnBase(item.id)).toEqual(avant)
  })

  it('should update only texte without changing actif, enVedette or ordre in the database', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()
    const vedette = (await creer(user.id, { slug: 'avis-vedette', auteur: 'Alice', enVedette: true })).item
    const masque = (await creer(user.id, { slug: 'avis-masque', auteur: 'Bruno', actif: false })).item
    await db.update(temoignages).set({ ordre: 7 }).where(eq(temoignages.id, vedette.id))
    await db.update(temoignages).set({ ordre: 9 }).where(eq(temoignages.id, masque.id))

    await modifier(user.id, vedette.id, { texte: 'Texte vedette corrigé.' })
    await modifier(user.id, masque.id, { texte: 'Texte masqué corrigé.' })

    expect(await ligneEnBase(vedette.id)).toMatchObject({
      texte: 'Texte vedette corrigé.',
      actif: true,
      enVedette: true,
      ordre: 7,
    })
    expect(await ligneEnBase(masque.id)).toMatchObject({
      texte: 'Texte masqué corrigé.',
      actif: false,
      enVedette: false,
      ordre: 9,
    })
  })
})

describe('temoignages — slug unique par vitrine et accès studio par slug', () => {
  it('should reuse a slug in two vitrines, suffix a duplicate in one vitrine and enforce the database constraint', async () => {
    const a = await utilisateurAvecVitrinePubliee('dr-slug-a')
    const b = await utilisateurAvecVitrinePubliee('dr-slug-b')

    const premierA = await creer(a.user.id, { slug: 'alice', auteur: 'Alice' })
    const secondA = await creer(a.user.id, { slug: 'alice', auteur: 'Alice' })
    const premierB = await creer(b.user.id, { slug: 'alice', auteur: 'Alice' })

    expect(premierA.item.slug).toBe('alice')
    expect(secondA.item.slug).toBe('alice-2')
    expect(premierB.item.slug).toBe('alice')
    await expect(db.insert(temoignages).values({
      id: randomUUID(),
      vitrineId: a.vitrine.id,
      slug: 'alice',
      auteur: 'Doublon',
      texte: 'Refusé par PostgreSQL.',
    })).rejects.toMatchObject({
      cause: { code: '23505', constraint: 'temoignages_vitrine_id_slug_unique' },
    })
  })

  it('should scope GET, PUT and DELETE by both vitrine and slug', async () => {
    const a = await utilisateurAvecVitrinePubliee('dr-scope-a')
    const b = await utilisateurAvecVitrinePubliee('dr-scope-b')
    const chezA = (await creer(a.user.id, { slug: 'avis-partage', auteur: 'Alice', texte: 'Texte A.' })).item
    const chezB = (await creer(b.user.id, { slug: 'avis-partage', auteur: 'Alice', texte: 'Texte B.' })).item
    const { deleteTemoignageBySlug, getOwnTemoignageBySlug, updateTemoignageBySlug } = await temoignagesService()

    expect((await getOwnTemoignageBySlug(a.user.id, 'avis-partage')).item.id).toBe(chezA.id)
    expect((await getOwnTemoignageBySlug(b.user.id, 'avis-partage')).item.id).toBe(chezB.id)

    await updateTemoignageBySlug(b.user.id, 'avis-partage', schemaTemoignageUpdate.parse({ texte: 'Texte B modifié.' }))
    expect(await ligneEnBase(chezA.id)).toMatchObject({ texte: 'Texte A.' })
    expect(await ligneEnBase(chezB.id)).toMatchObject({ texte: 'Texte B modifié.' })

    await deleteTemoignageBySlug(a.user.id, 'avis-partage')
    expect(await ligneEnBase(chezA.id)).toBeUndefined()
    expect(await ligneEnBase(chezB.id)).toMatchObject({ texte: 'Texte B modifié.' })
  })

  it('should expose ISO dates, a DTO whitelist and counters for detail responses', async () => {
    const { user } = await utilisateurAvecVitrinePubliee('dr-dto-temoignage')
    await creer(user.id, { slug: 'avis-dto', auteur: 'Alice', enVedette: true })
    const { getOwnTemoignageBySlug } = await temoignagesService()
    const { toTemoignageStudioResource, toTemoignagesCompteursResource } = await import('../../server/resources/temoignage')
    const { item, compteurs } = await getOwnTemoignageBySlug(user.id, 'avis-dto')
    const dto = toTemoignageStudioResource(item)

    expect(dto).not.toHaveProperty('vitrineId')
    expect(dto.creeLe).toBe(item.createdAt.toISOString())
    expect(dto.modifieLe).toBe(item.updatedAt.toISOString())
    expect(new Date(dto.creeLe).toISOString()).toBe(dto.creeLe)
    expect(toTemoignagesCompteursResource(compteurs)).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
  })
})

describe('temoignages — plafond de vedettes (VEDETTE_COMPLETE)', () => {
  it('should refuse a fourth vedette at creation (409, naming the three current ones) and insert nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()
    const creees = []
    for (const suffixe of ['a', 'b', 'c']) {
      creees.push((await creer(user.id, { slug: `vedette-${suffixe}`, auteur: `Vedette ${suffixe}`, enVedette: true })).item)
    }

    const erreur = await rejet(creer(user.id, { slug: 'quatrieme', auteur: 'Quatrième', enVedette: true }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VEDETTE_COMPLETE')
    expect(erreur.status).toBe(409)
    expect(erreur.data?.enVedette).toEqual(creees.map((temoignage) => ({ id: temoignage.id, auteur: temoignage.auteur })))
    expect(await slugsEnBase(vitrine.id)).toEqual(['vedette-a', 'vedette-b', 'vedette-c'])
  })

  it('should refuse a fourth vedette at update (409) and accept it once one is withdrawn', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()
    const r1 = (await creer(user.id, { slug: 'vedette-1', auteur: 'Vedette 1', enVedette: true })).item
    const r2 = (await creer(user.id, { slug: 'vedette-2', auteur: 'Vedette 2', enVedette: true })).item
    const r3 = (await creer(user.id, { slug: 'vedette-3', auteur: 'Vedette 3', enVedette: true })).item
    const r4 = (await creer(user.id, { slug: 'hors-vedette', auteur: 'Hors vedette', enVedette: false })).item

    const erreur = await rejet(modifier(user.id, r4.id, { enVedette: true }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VEDETTE_COMPLETE')
    expect(erreur.status).toBe(409)
    expect(erreur.data?.enVedette).toEqual([r1, r2, r3].map((temoignage) => ({ id: temoignage.id, auteur: temoignage.auteur })))
    expect((await ligneEnBase(r4.id))?.enVedette).toBe(false)

    await modifier(user.id, r2.id, { enVedette: false })
    const { item, compteurs } = await modifier(user.id, r4.id, { enVedette: true })

    expect(item.enVedette).toBe(true)
    expect(compteurs.enVedette).toBe(3)
  })
})

describe('temoignages — suppression', () => {
  it('should remove the row from the database', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()
    const { item } = await creer(user.id, { slug: 'a-supprimer', auteur: 'À supprimer' })
    expect(await ligneEnBase(item.id)).toBeTruthy()

    const { deleteTemoignage } = await temoignagesService()
    await deleteTemoignage(user.id, item.id)

    expect(await ligneEnBase(item.id)).toBeUndefined()
    expect(await slugsEnBase(vitrine.id)).toEqual([])
  })

  it('should answer TEMOINAGE_INTROUVABLE (404) for an unknown or foreign identifier', async () => {
    const { user } = await utilisateurAvecVitrinePubliee()
    const { deleteTemoignage } = await temoignagesService()

    const erreur = await rejet(deleteTemoignage(user.id, '00000000-0000-4000-8000-000000000000'))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('TEMOINAGE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })
})

describe('temoignages — ordre (permutation exacte)', () => {
  it('should persist the new order (0, 1, 2 in the database) and refuse an incomplete list', async () => {
    const { user, vitrine } = await utilisateurAvecVitrinePubliee()
    const a = (await creer(user.id, { slug: 'temoignage-a', auteur: 'A' })).item
    const b = (await creer(user.id, { slug: 'temoignage-b', auteur: 'B' })).item
    const c = (await creer(user.id, { slug: 'temoignage-c', auteur: 'C' })).item
    expect(await slugsEnBase(vitrine.id)).toEqual(['temoignage-a', 'temoignage-b', 'temoignage-c'])

    const { reorderTemoignages } = await temoignagesService()
    const { items } = await reorderTemoignages(user.id, [c.id, a.id, b.id])

    expect(items.map((ligne) => ligne.slug)).toEqual(['temoignage-c', 'temoignage-a', 'temoignage-b'])
    const lignes = await db
      .select({ slug: temoignages.slug, ordre: temoignages.ordre })
      .from(temoignages)
      .where(eq(temoignages.vitrineId, vitrine.id))
      .orderBy(asc(temoignages.ordre))
    expect(lignes).toEqual([
      { slug: 'temoignage-c', ordre: 0 },
      { slug: 'temoignage-a', ordre: 1 },
      { slug: 'temoignage-b', ordre: 2 },
    ])

    const incomplet = await rejet(reorderTemoignages(user.id, [a.id, b.id]))
    expect(incomplet.estDomainError).toBe(true)
    expect(incomplet.code).toBe('ORDRE_INVALIDE')
    expect(incomplet.status).toBe(422)

    const duplique = await rejet(reorderTemoignages(user.id, [a.id, b.id, c.id, a.id]))
    expect(duplique.code).toBe('ORDRE_INVALIDE')
    expect(await slugsEnBase(vitrine.id)).toEqual(['temoignage-c', 'temoignage-a', 'temoignage-b'])
  })
})

describe('temoignages — isolation entre vitrines', () => {
  it('should hide another vitrine’s témoignages and refuse update, delete and reorder (404/422)', async () => {
    const a = await utilisateurAvecVitrinePubliee('dr-temoignage-a')
    const b = await utilisateurAvecVitrinePubliee('dr-temoignage-b')
    const { item } = await creer(a.user.id, { slug: 'chez-a', auteur: 'Chez A', texte: 'Texte de A.' })

    const { listOwnTemoignages } = await temoignagesService()
    expect((await listOwnTemoignages(b.user.id)).items).toHaveLength(0)

    const modif = await rejet(modifier(b.user.id, item.id, { texte: 'Piraté.' }))
    expect(modif.estDomainError).toBe(true)
    expect(modif.code).toBe('TEMOINAGE_INTROUVABLE')
    expect(modif.status).toBe(404)

    const { deleteTemoignage } = await temoignagesService()
    const suppression = await rejet(deleteTemoignage(b.user.id, item.id))
    expect(suppression.code).toBe('TEMOINAGE_INTROUVABLE')
    expect(suppression.status).toBe(404)

    const { reorderTemoignages } = await temoignagesService()
    const ordre = await rejet(reorderTemoignages(b.user.id, [item.id]))
    expect(ordre.estDomainError).toBe(true)
    expect(ordre.code).toBe('ORDRE_INVALIDE')
    expect(ordre.status).toBe(422)

    // La vitrine d’A est intacte.
    expect(await ligneEnBase(item.id)).toMatchObject({ auteur: 'Chez A', texte: 'Texte de A.' })
    expect((await listOwnTemoignages(a.user.id)).items.map((ligne) => ligne.slug)).toEqual(['chez-a'])
    expect(await slugsEnBase(b.vitrine.id)).toEqual([])
  })
})
