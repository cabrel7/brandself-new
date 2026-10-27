import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { makePng } from '../../tests/support/images'
import { attendreErreur, fermerConnexions, lireErreur, seConnecter } from '../helpers/session'
import type { Session } from '../helpers/session'

// S4-CA44 (les routes existent), CA45 (forme des réponses), CA46 (parcours API), CA41 (compteurs de navigation
// en HTTP), plus les contrats d'erreur HTTP de la création, de la mise à jour, de la galerie, du plafond de
// vedettes, du réordonnancement et de l'isolation. Les routes sans session (CA43) sont dans studio-auth.spec.ts.
// Une session par fichier (limite d'envoi OTP) : describe.serial, un utilisateur, une vitrine.
// Les téléversements sont comptés (30 par heure et par utilisateur) : une image par test au plus, sauf galerie.

const CLES_STUDIO = [
  'actif', 'annee', 'creeLe', 'description', 'enVedette', 'galerie', 'id', 'image', 'lieu', 'lien', 'modifieLe',
  'ordre', 'role', 'slug', 'titre',
].sort()
const CLES_CARTE_PUBLIQUE = ['annee', 'description', 'image', 'lieu', 'slug', 'titre'].sort()
const CLES_DETAIL_PUBLIC = [...CLES_CARTE_PUBLIQUE, 'galerie', 'lien', 'role', 'seo'].sort()
const CLES_MEDIA = ['hauteur', 'id', 'largeur', 'srcset', 'url']
const CLES_VITRINE_PUBLIQUE = [
  'accroche', 'bio', 'contact', 'fuseau', 'metier', 'nom', 'nomAffiche', 'palette', 'pays',
  'paysLibelle', 'photo', 'prenom', 'seo', 'titre', 'username', 'ville',
].sort()

const MESSAGE_ORDRE_INVALIDE = 'L’ordre envoyé n’est plus à jour. Rechargez la page et réessayez.'

interface Media {
  id: string
  url: string
}

interface RealisationStudio {
  id: string
  slug: string
  titre: string
  description: string | null
  image: Media | null
  galerie: Media[]
  annee: number | null
  lieu: string | null
  role: string | null
  lien: string | null
  enVedette: boolean
  actif: boolean
  ordre: number
}

interface Compteurs {
  total: number
  visibles: number
  enVedette: number
  vedetteMax: number
}

interface ReponseRealisation {
  realisation: RealisationStudio
  compteurs: Compteurs
}

interface ReponseListe {
  realisations: RealisationStudio[]
  compteurs: Compteurs
}

interface RealisationPublique {
  slug: string
  titre: string
  [cle: string]: unknown
}

interface ReponsePublicListe {
  total: number
  aLaUne: RealisationPublique[]
  realisations: RealisationPublique[]
}

interface ReponsePublicDetail {
  realisation: RealisationPublique & { seo: { titre: string, description: string }, galerie: Media[], lien: string | null }
  autres: RealisationPublique[]
  total: number
}

interface ReponseVitrinePublique {
  vitrine: Record<string, unknown>
  contenus: { services: number, realisations: number }
}

test.describe.serial('réalisations — API studio et publique (S4-CA44 à CA46)', () => {
  let session: Session
  let username: string
  /** Image partagée : photo de la vitrine, donc jamais supprimée par le nettoyage des médias (30 envois par heure seulement). */
  let partagee: string

  test.beforeAll(async ({ playwright }) => {
    session = await seConnecter(playwright)
    username = `real-${randomUUID().slice(0, 8)}`
  })

  test.afterAll(async () => {
    await session.api.dispose()
    await fermerConnexions()
  })

  async function televerser(): Promise<string> {
    const reponse = await session.api.post('/api/studio/medias', {
      multipart: { fichier: { name: 'projet.png', mimeType: 'image/png', buffer: await makePng(400, 300) } },
    })
    expect(reponse.status(), await reponse.text()).toBe(201)
    return ((await reponse.json()) as { media: { id: string } }).media.id
  }

  async function creer(donnees: Record<string, unknown>): Promise<ReponseRealisation> {
    const imageMediaId = (donnees.imageMediaId as string | undefined) ?? partagee
    const reponse = await session.api.post('/api/studio/realisations', { data: { imageMediaId, ...donnees } })
    expect(reponse.status(), await reponse.text()).toBe(201)
    return (await reponse.json()) as ReponseRealisation
  }

  async function lister(): Promise<ReponseListe> {
    const reponse = await session.api.get('/api/studio/realisations')
    expect(reponse.status()).toBe(200)
    return (await reponse.json()) as ReponseListe
  }

  async function viderLesRealisations(): Promise<void> {
    for (const realisation of (await lister()).realisations) {
      expect((await session.api.delete(`/api/studio/realisations/${realisation.id}`)).status()).toBe(204)
    }
  }

  test('CA44 GET and POST on /api/studio/realisations answer 404 VITRINE_INTROUVABLE while the user has no vitrine', async () => {
    await attendreErreur(await session.api.get('/api/studio/realisations'), 404, 'VITRINE_INTROUVABLE')
    await attendreErreur(await session.api.post('/api/studio/realisations', { data: { titre: 'x', imageMediaId: randomUUID() } }), 404, 'VITRINE_INTROUVABLE')
  })

  test('CA44 the vitrine is created, completed and published (setup of the following tests)', async () => {
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    partagee = await televerser()
    expect((await session.api.put('/api/studio/vitrine', { data: { photoMediaId: partagee } })).status()).toBe(200)
  })

  test.describe('routes de l’élément (CA44 : elles existent)', () => {
    test('CA44 GET /api/studio/realisations/<random uuid> answers 404 REALISATION_INTROUVABLE (not a bare route 404)', async () => {
      await attendreErreur(await session.api.get(`/api/studio/realisations/${randomUUID()}`), 404, 'REALISATION_INTROUVABLE')
    })

    test('CA44 GET /api/studio/realisations/pas-un-uuid answers 400 VALIDATION', async () => {
      await attendreErreur(await session.api.get('/api/studio/realisations/pas-un-uuid'), 400, 'VALIDATION')
    })

    test('CA44 PUT and DELETE on an unknown uuid answer 404 REALISATION_INTROUVABLE; on a malformed id 400 VALIDATION', async () => {
      await attendreErreur(await session.api.put(`/api/studio/realisations/${randomUUID()}`, { data: { titre: 'x' } }), 404, 'REALISATION_INTROUVABLE')
      await attendreErreur(await session.api.delete(`/api/studio/realisations/${randomUUID()}`), 404, 'REALISATION_INTROUVABLE')
      await attendreErreur(await session.api.put('/api/studio/realisations/pas-un-uuid', { data: { titre: 'x' } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.delete('/api/studio/realisations/pas-un-uuid'), 400, 'VALIDATION')
    })

    test('CA44 POST /api/studio/realisations/reordonner is a route of its own (it is not captured by :id)', async () => {
      const reponse = await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [randomUUID()] } })

      await attendreErreur(reponse, 422, 'ORDRE_INVALIDE')
    })

    test('CA44 the old slug-based studio paths no longer exist', async () => {
      await attendreErreur(await session.api.get('/api/studio/realisations/unite-de-catheterisme'), 400, 'VALIDATION')
    })
  })

  test.describe('création et forme des réponses (CA45)', () => {
    test.beforeEach(viderLesRealisations)

    test('CA45 POST answers 201 with the exact RealisationStudioDTO keys, the counters, and no ORM field', async () => {
      const imageMediaId = partagee

      const reponse = await session.api.post('/api/studio/realisations', {
        data: { titre: 'Unité de cathétérisme, CHU de Douala', imageMediaId, annee: 2025, lieu: 'CHU de Douala' },
      })

      expect(reponse.status()).toBe(201)
      const corps = (await reponse.json()) as ReponseRealisation
      expect(Object.keys(corps).sort()).toEqual(['compteurs', 'realisation'])
      expect(Object.keys(corps.realisation).sort()).toEqual(CLES_STUDIO)
      for (const interdite of ['vitrineId', 'createdAt', 'updatedAt', 'imageMediaId']) {
        expect(corps.realisation).not.toHaveProperty(interdite)
      }
      expect(corps.realisation).toMatchObject({
        slug: 'unite-de-catheterisme-chu-de-douala',
        titre: 'Unité de cathétérisme, CHU de Douala',
        annee: 2025,
        lieu: 'CHU de Douala',
        role: null,
        lien: null,
        description: null,
        enVedette: true,
        actif: true,
        ordre: 0,
        galerie: [],
      })
      expect(Object.keys(corps.realisation.image ?? {}).sort()).toEqual(CLES_MEDIA)
      expect(corps.realisation.image).toMatchObject({ id: imageMediaId, url: `/medias/${imageMediaId}/1600.webp` })
      expect(corps.realisation.id).toMatch(/^[0-9a-f-]{36}$/)
      expect(corps.compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    })

    test('CA45 GET /api/studio/realisations/:id and the list answer the same realisation', async () => {
      const { realisation } = await creer({ titre: 'Campagne' })

      const unitaire = (await (await session.api.get(`/api/studio/realisations/${realisation.id}`)).json()) as ReponseRealisation
      const liste = await lister()

      expect(unitaire.realisation).toEqual(realisation)
      expect(liste.realisations).toEqual([realisation])
      expect(liste.compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    })

    test('CA45 PUT answers 200 with the updated realisation and the counters; DELETE answers 204 with an empty body', async () => {
      const { realisation } = await creer({ titre: 'Campagne' })

      const maj = await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { description: 'Un projet.' } })
      expect(maj.status()).toBe(200)
      const corps = (await maj.json()) as ReponseRealisation
      expect(Object.keys(corps.realisation).sort()).toEqual(CLES_STUDIO)
      expect(corps.realisation).toMatchObject({ id: realisation.id, slug: realisation.slug, description: 'Un projet.' })
      expect(corps.compteurs.total).toBe(1)

      const suppression = await session.api.delete(`/api/studio/realisations/${realisation.id}`)
      expect(suppression.status()).toBe(204)
      expect(await suppression.text()).toBe('')
      await attendreErreur(await session.api.get(`/api/studio/realisations/${realisation.id}`), 404, 'REALISATION_INTROUVABLE')
    })

    test('CA45 the gallery is created in the order sent and replaced as a whole by a PUT', async () => {
      const [g1, g2, g3] = [await televerser(), await televerser(), await televerser()]
      const { realisation } = await creer({ titre: 'Avec galerie', galerie: [g2, g1, g3] })
      expect(realisation.galerie.map((m) => m.id)).toEqual([g2, g1, g3])

      const maj = await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { galerie: [g3, g2] } })

      expect(maj.status()).toBe(200)
      expect(((await maj.json()) as ReponseRealisation).realisation.galerie.map((m) => m.id)).toEqual([g3, g2])
      expect((await session.api.get(`/medias/${g1}/1600.webp`)).status()).toBe(404)
      expect((await session.api.get(`/medias/${g3}/800.webp`)).status()).toBe(200)
    })
  })

  test.describe('erreurs de validation et de règles métier (HTTP)', () => {
    test.beforeEach(viderLesRealisations)

    test('CA07 POST without main image, or with a null one, answers 400 VALIDATION with "Ajoutez une image principale." and inserts nothing', async () => {
      for (const donnees of [{ titre: 'Sans image' }, { titre: 'Sans image', imageMediaId: null }]) {
        const corps = await attendreErreur(await session.api.post('/api/studio/realisations', { data: donnees }), 400, 'VALIDATION')
        expect(corps.data?.champs?.imageMediaId?.[0]).toBe('Ajoutez une image principale.')
      }
      expect((await lister()).realisations).toHaveLength(0)
    })

    test('CA11 POST with invalid fields answers 400 VALIDATION listing the fields', async () => {
      const reponse = await session.api.post('/api/studio/realisations', {
        data: { titre: '', imageMediaId: randomUUID(), annee: 1899, lien: 'javascript:alert(1)', galerie: ['abc'] },
      })

      const corps = await attendreErreur(reponse, 400, 'VALIDATION')
      const champs = Object.keys(corps.data?.champs ?? {})
      for (const attendu of ['annee', 'lien', 'titre']) {
        expect(champs).toContain(attendu)
      }
      expect(champs.some((c) => c.startsWith('galerie'))).toBe(true)
    })

    test('CA11 POST with an unsafe link, 7 gallery images or a duplicated one answers 400 on the targeted field', async () => {
      const imageMediaId = randomUUID()
      const base = { titre: 'A', imageMediaId }
      const cas: [Record<string, unknown>, string][] = [
        [{ ...base, lien: 'javascript:alert(1)' }, 'lien'],
        [{ ...base, lien: 'ftp://x.cm' }, 'lien'],
        [{ ...base, lien: 'https://' }, 'lien'],
        [{ ...base, galerie: Array.from({ length: 7 }, () => randomUUID()) }, 'galerie'],
        [{ ...base, galerie: [imageMediaId, imageMediaId] }, 'galerie'],
        [{ ...base, annee: 2025.5 }, 'annee'],
        [{ ...base, annee: 2101 }, 'annee'],
        [{ ...base, titre: 'a'.repeat(101) }, 'titre'],
        [{ ...base, description: 'a'.repeat(2001) }, 'description'],
      ]

      for (const [donnees, champ] of cas) {
        const corps = await attendreErreur(await session.api.post('/api/studio/realisations', { data: donnees }), 400, 'VALIDATION')
        expect(Object.keys(corps.data?.champs ?? {}), JSON.stringify(donnees).slice(0, 80)).toContain(champ)
      }
    })

    test('CA11 POST with a forbidden key (slug, ordre, vitrineId) answers 400', async () => {
      for (const cle of ['slug', 'ordre', 'vitrineId']) {
        await attendreErreur(await session.api.post('/api/studio/realisations', { data: { titre: 'A', imageMediaId: randomUUID(), [cle]: 'x' } }), 400, 'VALIDATION')
      }
      expect((await lister()).realisations).toHaveLength(0)
    })

    test('CA11 a malformed JSON body answers 400, never a 500', async () => {
      const reponse = await session.api.post('/api/studio/realisations', {
        headers: { 'content-type': 'application/json' },
        data: '{"titre": ',
      })

      expect(reponse.status()).toBe(400)
    })

    test('CA12 the link is normalised on the way in (www.chu-douala.cm -> https://www.chu-douala.cm)', async () => {
      const { realisation } = await creer({ titre: 'Avec lien', lien: 'www.chu-douala.cm' })

      expect(realisation.lien).toBe('https://www.chu-douala.cm')
    })

    test('CA14 POST with the main image inside the gallery answers 400 on galerie', async () => {
      const image = partagee

      const reponse = await session.api.post('/api/studio/realisations', { data: { titre: 'A', imageMediaId: image, galerie: [image] } })

      const corps = await attendreErreur(reponse, 400, 'VALIDATION')
      expect(Object.keys(corps.data?.champs ?? {})).toEqual(['galerie'])
    })

    test('CA15 POST with an image that does not exist answers 422 MEDIA_INVALIDE, as for a gallery image, and persists nothing', async () => {
      await attendreErreur(await session.api.post('/api/studio/realisations', { data: { titre: 'A', imageMediaId: randomUUID() } }), 422, 'MEDIA_INVALIDE')
      const image = partagee
      await attendreErreur(await session.api.post('/api/studio/realisations', { data: { titre: 'A', imageMediaId: image, galerie: [randomUUID()] } }), 422, 'MEDIA_INVALIDE')
      expect((await lister()).realisations).toHaveLength(0)
    })

    test('CA09 an explicit fourth vedette answers 409 VEDETTE_COMPLETE with the three current ones in data.enVedette and a generic message', async () => {
      const crees: RealisationStudio[] = []
      const image = partagee
      for (const titre of ['R1', 'R2', 'R3']) {
        crees.push((await creer({ titre, imageMediaId: image })).realisation)
      }

      const reponse = await session.api.post('/api/studio/realisations', { data: { titre: 'R4', imageMediaId: image, enVedette: true } })

      expect(reponse.status()).toBe(409)
      const corps = (await lireErreur(reponse)) as Awaited<ReturnType<typeof lireErreur>> & { data: { enVedette: { id: string, titre: string }[] } }
      expect(corps.data.code).toBe('VEDETTE_COMPLETE')
      expect(corps.data.enVedette).toEqual(crees.map((r) => ({ id: r.id, titre: r.titre })))
      expect(corps.message).toContain('3 éléments en vedette')
      expect(corps.message).not.toMatch(/service/i)
      expect((await lister()).realisations).toHaveLength(3)
    })

    test('CA23 PUT enVedette true on a fourth realisation answers 409; once a vedette is withdrawn it answers 200', async () => {
      const image = partagee
      const [, r2, , r4] = [
        (await creer({ titre: 'R1', imageMediaId: image })).realisation,
        (await creer({ titre: 'R2', imageMediaId: image })).realisation,
        (await creer({ titre: 'R3', imageMediaId: image })).realisation,
        (await creer({ titre: 'R4', imageMediaId: image })).realisation,
      ]
      expect(r4.enVedette).toBe(false)

      await attendreErreur(await session.api.put(`/api/studio/realisations/${r4.id}`, { data: { enVedette: true } }), 409, 'VEDETTE_COMPLETE')
      expect((await session.api.put(`/api/studio/realisations/${r2.id}`, { data: { enVedette: false } })).status()).toBe(200)
      const reponse = await session.api.put(`/api/studio/realisations/${r4.id}`, { data: { enVedette: true } })

      expect(reponse.status()).toBe(200)
      expect(((await reponse.json()) as ReponseRealisation).compteurs.enVedette).toBe(3)
    })

    test('CA24 hiding withdraws the vedette; hiding together with an explicit vedette, or making a hidden one a vedette, answers 400 on enVedette', async () => {
      const { realisation } = await creer({ titre: 'R1' })

      const masquee = await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { actif: false } })
      expect(masquee.status()).toBe(200)
      const corps = (await masquee.json()) as ReponseRealisation
      expect(corps.realisation).toMatchObject({ actif: false, enVedette: false })
      expect(corps.compteurs).toEqual({ total: 1, visibles: 0, enVedette: 0, vedetteMax: 3 })
      const refus = await attendreErreur(await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { enVedette: true } }), 400, 'VALIDATION')
      expect(Object.keys(refus.data?.champs ?? {})).toEqual(['enVedette'])
      await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { actif: true } })
      await attendreErreur(await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { actif: false, enVedette: true } }), 400, 'VALIDATION')
    })

    test('CA19 PUT with a null main image, an empty body or a forbidden key answers 400', async () => {
      const { realisation } = await creer({ titre: 'R1' })

      await attendreErreur(await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { imageMediaId: null } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: {} }), 400, 'VALIDATION')
      await attendreErreur(await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { slug: 'autre' } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { ordre: 4 } }), 400, 'VALIDATION')
      const relue = (await (await session.api.get(`/api/studio/realisations/${realisation.id}`)).json()) as ReponseRealisation
      expect(relue.realisation).toEqual(realisation)
    })

    test('CA22 PUT promoting a gallery image without removing it from the gallery answers 400 on galerie and changes nothing', async () => {
      const [m1, g1] = [await televerser(), await televerser()]
      const { realisation } = await creer({ titre: 'R1', imageMediaId: m1, galerie: [g1] })

      const reponse = await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { imageMediaId: g1 } })

      const corps = await attendreErreur(reponse, 400, 'VALIDATION')
      expect(Object.keys(corps.data?.champs ?? {})).toEqual(['galerie'])
      const relue = (await (await session.api.get(`/api/studio/realisations/${realisation.id}`)).json()) as ReponseRealisation
      expect(relue.realisation).toEqual(realisation)
    })

    test('CA21 PUT exchanging the main image and a gallery image answers 200 and keeps both images served', async () => {
      const [m1, g1] = [await televerser(), await televerser()]
      const { realisation } = await creer({ titre: 'R1', imageMediaId: m1, galerie: [g1] })

      const reponse = await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { imageMediaId: g1, galerie: [m1] } })

      expect(reponse.status()).toBe(200)
      const corps = (await reponse.json()) as ReponseRealisation
      expect(corps.realisation.image?.id).toBe(g1)
      expect(corps.realisation.galerie.map((m) => m.id)).toEqual([m1])
      expect((await session.api.get(`/medias/${m1}/800.webp`)).status()).toBe(200)
      expect((await session.api.get(`/medias/${g1}/800.webp`)).status()).toBe(200)
    })

    test('CA32 reordonner with an incomplete, duplicated or foreign list answers 422/400 and keeps the order, with the generic French message', async () => {
      const image = partagee
      const a = (await creer({ titre: 'A', imageMediaId: image })).realisation
      const b = (await creer({ titre: 'B', imageMediaId: image })).realisation

      const incomplet = await attendreErreur(await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [b.id] } }), 422, 'ORDRE_INVALIDE')
      await attendreErreur(await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [a.id, b.id, randomUUID()] } }), 422, 'ORDRE_INVALIDE')
      await attendreErreur(await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [a.id, a.id] } }), 400, 'VALIDATION')
      await attendreErreur(await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [] } }), 400, 'VALIDATION')
      expect(incomplet.message).toBe(MESSAGE_ORDRE_INVALIDE)
      expect(incomplet.message).not.toContain('�')
      expect((await lister()).realisations.map((r) => r.titre)).toEqual(['A', 'B'])
    })

    test('CA31 reordonner answers 200 with the list in the new order and the counters', async () => {
      const image = partagee
      const a = (await creer({ titre: 'A', imageMediaId: image })).realisation
      const b = (await creer({ titre: 'B', imageMediaId: image })).realisation
      const c = (await creer({ titre: 'C', imageMediaId: image })).realisation

      const reponse = await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [c.id, a.id, b.id] } })

      expect(reponse.status()).toBe(200)
      const corps = (await reponse.json()) as ReponseListe
      expect(corps.realisations.map((r) => [r.titre, r.ordre])).toEqual([['C', 0], ['A', 1], ['B', 2]])
      expect(corps.compteurs).toEqual({ total: 3, visibles: 3, enVedette: 3, vedetteMax: 3 })
    })

    test('CA26 two simultaneous POST of the same title give distinct slugs (bilan, bilan-2)', async () => {
      const image = partagee
      const donnees = { titre: 'Bilan', imageMediaId: image }

      const [r1, r2] = await Promise.all([
        session.api.post('/api/studio/realisations', { data: donnees }),
        session.api.post('/api/studio/realisations', { data: donnees }),
      ])

      expect([r1.status(), r2.status()]).toEqual([201, 201])
      const slugs = await Promise.all([r1, r2].map(async (r) => ((await r.json()) as ReponseRealisation).realisation.slug))
      expect(slugs.sort()).toEqual(['bilan', 'bilan-2'])
    })

    test('CA26 two simultaneous vedette updates: exactly one 200 and one 409', async () => {
      const image = partagee
      await creer({ titre: 'R1', imageMediaId: image })
      await creer({ titre: 'R2', imageMediaId: image })
      const r3 = (await creer({ titre: 'R3', imageMediaId: image, enVedette: false })).realisation
      const r4 = (await creer({ titre: 'R4', imageMediaId: image, enVedette: false })).realisation

      const [a, b] = await Promise.all([
        session.api.put(`/api/studio/realisations/${r3.id}`, { data: { enVedette: true } }),
        session.api.put(`/api/studio/realisations/${r4.id}`, { data: { enVedette: true } }),
      ])

      expect([a.status(), b.status()].sort()).toEqual([200, 409])
      expect((await lister()).compteurs.enVedette).toBe(3)
    })
  })

  test.describe('isolation entre utilisateurs (CA27)', () => {
    test('CA27 another user gets 404 REALISATION_INTROUVABLE (never 403) on read, update and delete of a realisation of the first user', async ({ playwright }) => {
      await viderLesRealisations()
      const { realisation } = await creer({ titre: 'Réalisation de A' })
      const autre = await seConnecter(playwright)
      try {
        const creation = await autre.api.post('/api/studio/vitrine', {
          data: { titre: null, prenom: 'Autre', nom: 'Utilisateur', metier: 'Médecin', username: `autre-${randomUUID().slice(0, 8)}` },
        })
        expect(creation.status()).toBe(201)

        await attendreErreur(await autre.api.get(`/api/studio/realisations/${realisation.id}`), 404, 'REALISATION_INTROUVABLE')
        await attendreErreur(await autre.api.put(`/api/studio/realisations/${realisation.id}`, { data: { titre: 'Piratée' } }), 404, 'REALISATION_INTROUVABLE')
        await attendreErreur(await autre.api.delete(`/api/studio/realisations/${realisation.id}`), 404, 'REALISATION_INTROUVABLE')
        await attendreErreur(await autre.api.post('/api/studio/realisations/reordonner', { data: { ids: [realisation.id] } }), 422, 'ORDRE_INVALIDE')
        const liste = (await (await autre.api.get('/api/studio/realisations')).json()) as ReponseListe
        expect(liste.realisations).toEqual([])
      } finally {
        await autre.api.dispose()
      }

      const intact = (await (await session.api.get(`/api/studio/realisations/${realisation.id}`)).json()) as ReponseRealisation
      expect(intact.realisation).toEqual(realisation)
    })
  })

  test.describe('lecture publique et parcours (CA41, CA46)', () => {
    test.beforeEach(viderLesRealisations)

    test('CA46 GET /api/public/realisations answers 404 VITRINE_INTROUVABLE ("realisations" is not a vitrine) and /api/public/:username is still served', async ({ request }) => {
      await attendreErreur(await request.get('/api/public/realisations'), 404, 'VITRINE_INTROUVABLE')
      expect((await request.get(`/api/public/${username}`)).status()).toBe(200)
    })

    test('CA37 the public list of an unknown vitrine answers 404 VITRINE_INTROUVABLE, and an empty published vitrine answers 200 with empty lists', async ({ request }) => {
      await attendreErreur(await request.get('/api/public/inconnu-sans-vitrine/realisations'), 404, 'VITRINE_INTROUVABLE')
      await attendreErreur(await request.get('/api/public/Bad_Name/realisations'), 404, 'VITRINE_INTROUVABLE')

      const vide = await request.get(`/api/public/${username}/realisations`)

      expect(vide.status()).toBe(200)
      expect(await vide.json()).toEqual({ total: 0, aLaUne: [], realisations: [] })
    })

    test('CA46 parcours: 4 creations, aLaUne 3 and contenus 4, hide R1 (detail 404, contenus 3), reorder, the public order follows', async ({ request }) => {
      const image = partagee
      const r1 = (await creer({ titre: 'R1', imageMediaId: image })).realisation
      const r2 = (await creer({ titre: 'R2', imageMediaId: image })).realisation
      const r3 = (await creer({ titre: 'R3', imageMediaId: image })).realisation
      const r4 = (await creer({ titre: 'R4', imageMediaId: image })).realisation

      const publiques = (await (await request.get(`/api/public/${username}/realisations`)).json()) as ReponsePublicListe
      expect(publiques.total).toBe(4)
      expect(publiques.aLaUne.map((r) => r.titre)).toEqual(['R1', 'R2', 'R3'])
      expect(publiques.realisations.map((r) => r.titre)).toEqual(['R1', 'R2', 'R3', 'R4'])
      const accueil = (await (await request.get(`/api/public/${username}`)).json()) as ReponseVitrinePublique
      expect(accueil.contenus.realisations).toBe(4)
      expect((await request.get(`/api/public/${username}/realisations/r1`)).status()).toBe(200)

      expect((await session.api.put(`/api/studio/realisations/${r1.id}`, { data: { actif: false } })).status()).toBe(200)

      await attendreErreur(await request.get(`/api/public/${username}/realisations/r1`), 404, 'REALISATION_INTROUVABLE')
      const apresMasquage = (await (await request.get(`/api/public/${username}/realisations`)).json()) as ReponsePublicListe
      expect(apresMasquage.total).toBe(3)
      expect(apresMasquage.realisations.map((r) => r.titre)).toEqual(['R2', 'R3', 'R4'])
      expect(apresMasquage.aLaUne.map((r) => r.titre)).toEqual(['R2', 'R3'])
      expect(((await (await request.get(`/api/public/${username}`)).json()) as ReponseVitrinePublique).contenus.realisations).toBe(3)

      const reordonne = await session.api.post('/api/studio/realisations/reordonner', { data: { ids: [r4.id, r3.id, r2.id, r1.id] } })
      expect(reordonne.status()).toBe(200)

      const apresOrdre = (await (await request.get(`/api/public/${username}/realisations`)).json()) as ReponsePublicListe
      expect(apresOrdre.realisations.map((r) => r.titre)).toEqual(['R4', 'R3', 'R2'])
      expect(apresOrdre.aLaUne.map((r) => r.titre)).toEqual(['R3', 'R2'])
    })

    test('CA41 GET /api/public/:username answers { vitrine, contenus } with the visible services and realisations; the vitrine keys are unchanged', async ({ request }) => {
      const service = await session.api.post('/api/studio/services', { data: { titre: 'Consultation', type: 'rdv', dureeMin: 30, tarif: 'gratuit' } })
      expect(service.status()).toBe(201)
      const { id: serviceId } = ((await service.json()) as { service: { id: string } }).service
      await creer({ titre: 'R1' })
      const masquee = (await creer({ titre: 'R2' })).realisation
      expect((await session.api.put(`/api/studio/realisations/${masquee.id}`, { data: { actif: false } })).status()).toBe(200)

      try {
        const reponse = await request.get(`/api/public/${username}`)

        expect(reponse.status()).toBe(200)
        const corps = (await reponse.json()) as ReponseVitrinePublique
        expect(Object.keys(corps).sort()).toEqual(['contenus', 'vitrine'])
        expect(Object.keys(corps.vitrine).sort()).toEqual(CLES_VITRINE_PUBLIQUE)
        expect(corps.contenus.realisations).toBe(1)
        expect(corps.contenus.services).toBeGreaterThanOrEqual(1)
        expect(Object.keys(corps.contenus).sort()).toEqual(['realisations', 'services'])
      } finally {
        await session.api.delete(`/api/studio/services/${serviceId}`)
      }
    })

    test('CA38 the public detail answers the realisation with its gallery in order, at most two others and the total; slug case is ignored', async ({ request }) => {
      const [g1, g2] = [await televerser(), await televerser()]
      const { realisation } = await creer({ titre: 'Unité de cathétérisme', galerie: [g2, g1] })
      await creer({ titre: 'Bilan' })
      await creer({ titre: 'Suivi' })
      await creer({ titre: 'Écho' })

      const reponse = await request.get(`/api/public/${username}/realisations/UNITE-DE-CATHETERISME`)

      expect(reponse.status()).toBe(200)
      const detail = (await reponse.json()) as ReponsePublicDetail
      expect(detail.realisation.slug).toBe(realisation.slug)
      expect(detail.realisation.galerie.map((m) => m.id)).toEqual([g2, g1])
      expect(detail.autres.map((r) => r.titre)).toEqual(['Bilan', 'Suivi'])
      expect(detail.total).toBe(4)
    })

    test('CA39 the public DTOs expose exactly the whitelisted keys and never an identifier', async ({ request }) => {
      const { realisation } = await creer({ titre: 'Unité de cathétérisme', description: 'a'.repeat(300), role: 'Responsable', lien: 'https://chu-douala.cm' })

      const liste = (await (await request.get(`/api/public/${username}/realisations`)).json()) as ReponsePublicListe
      const detailBrut = await (await request.get(`/api/public/${username}/realisations/${realisation.slug}`)).text()
      const detail = JSON.parse(detailBrut) as ReponsePublicDetail

      expect(Object.keys(liste.realisations[0] ?? {}).sort()).toEqual(CLES_CARTE_PUBLIQUE)
      expect(Object.keys(liste.aLaUne[0] ?? {}).sort()).toEqual(CLES_CARTE_PUBLIQUE)
      expect(Object.keys(detail.realisation).sort()).toEqual(CLES_DETAIL_PUBLIC)
      expect(Object.keys(detail.realisation.seo).sort()).toEqual(['description', 'titre'])
      expect(detail.realisation.seo.titre).toBe('Unité de cathétérisme — Dr Cabrel Nguesso')
      expect(detail.realisation.seo.description.length).toBeLessThanOrEqual(160)
      expect(detail.realisation.lien).toBe('https://chu-douala.cm')
      for (const secret of [realisation.id, '"ordre"', '"enVedette"', '"actif"', '"vitrineId"', '"creeLe"', '"modifieLe"', '"imageMediaId"', session.userId]) {
        expect(detailBrut).not.toContain(secret)
      }
    })

    test('CA38 an unknown, masked or malformed slug answers 404 REALISATION_INTROUVABLE', async ({ request }) => {
      const { realisation } = await creer({ titre: 'Masquée bientôt' })
      expect((await session.api.put(`/api/studio/realisations/${realisation.id}`, { data: { actif: false } })).status()).toBe(200)

      for (const slug of ['inconnu', realisation.slug, 'bad_slug!', 'a'.repeat(200)]) {
        await attendreErreur(await request.get(`/api/public/${username}/realisations/${encodeURIComponent(slug)}`), 404, 'REALISATION_INTROUVABLE')
      }
    })

    test('CA37 once the vitrine is unpublished the public routes answer 404 VITRINE_INTROUVABLE; republished they answer again', async ({ request }) => {
      const { realisation } = await creer({ titre: 'Publiée' })
      expect((await session.api.post('/api/studio/vitrine/depublier')).status()).toBe(200)

      await attendreErreur(await request.get(`/api/public/${username}/realisations`), 404, 'VITRINE_INTROUVABLE')
      await attendreErreur(await request.get(`/api/public/${username}/realisations/${realisation.slug}`), 404, 'VITRINE_INTROUVABLE')

      expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
      expect((await request.get(`/api/public/${username}/realisations`)).status()).toBe(200)
    })
  })
})
