import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { ValidationError } from '../../server/exceptions/http'
import { readBodyWith } from '../../server/utils/validation'
import { vitrines } from '../../shared/db/schema'
import { schemaVitrineUpdate } from '../../shared/schemas/vitrine'
import { fakeEvent } from '../support/h3'
import { SEO_VALIDE } from '../unit/support/seo-ia'
import { rejet } from './support/erreurs'
import { ressourceVitrine, vitrinesService } from './support/modules'
import { creerVitrineSeo } from './support/seo-ia'

// Décision #24, groupe G : API studio de la vitrine (service + resource réels, base réelle ; la route
// `PUT /api/studio/vitrine` est `readBodyWith(schemaVitrineUpdate)` → `updateVitrine` → resource, sans logique).

const TITRE_SAISI = 'Cardiologue interventionnel à Douala, rendez-vous en ligne'
const DESCRIPTION_SAISIE = 'Prenez rendez-vous en ligne avec un cardiologue à Douala et retrouvez toutes les informations utiles avant votre venue.'

async function lireStudio(userId: string) {
  const { getOwnVitrine } = await vitrinesService()
  const { toVitrineStudioResource } = await ressourceVitrine()
  return toVitrineStudioResource(await getOwnVitrine(userId))
}

async function put(userId: string, corps: unknown) {
  const { updateVitrine } = await vitrinesService()
  const { toVitrineStudioResource } = await ressourceVitrine()
  const patch = await readBodyWith(fakeEvent({ method: 'PUT', body: JSON.stringify(corps) }), schemaVitrineUpdate)
  return toVitrineStudioResource(await updateVitrine(userId, patch))
}

async function ligne(vitrineId: string) {
  const [resultat] = await db.select().from(vitrines).where(eq(vitrines.id, vitrineId))
  return resultat!
}

describe('GET vitrine studio : seoTitre, seoDescription, seoAuto (G)', () => {
  it('should expose the typed texts (null when none) and the automatic text resolved from the fresh proposal', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais' })

    const dto = await lireStudio(user.id)

    expect(dto).toMatchObject({ seoTitre: null, seoDescription: null })
    expect(dto.seoAuto).toEqual({
      titre: `${dto.nomAffiche} — ${SEO_VALIDE.titre}`,
      description: SEO_VALIDE.description,
      origine: 'ia',
    })
  })

  it('should keep seoAuto independent from the typed texts (they are shown next to it, never mixed into it)', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    const dto = await lireStudio(user.id)

    expect(dto).toMatchObject({ seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })
    expect(dto.seoAuto).toEqual({ titre: `${dto.nomAffiche} — ${SEO_VALIDE.titre}`, description: SEO_VALIDE.description, origine: 'ia' })
  })

  it('should answer origine « gabarit » for a vitrine with no proposal and for a stale one', async () => {
    const aucun = await creerVitrineSeo({ ia: 'aucun' })
    const perime = await creerVitrineSeo({ ia: 'perime' })

    expect((await lireStudio(aucun.user.id)).seoAuto.origine).toBe('gabarit')
    expect((await lireStudio(perime.user.id)).seoAuto.origine).toBe('gabarit')
  })

  it('should not leak the signature, the generation date or a seo_ia column in the response', async () => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais' })

    const json = JSON.stringify(await lireStudio(user.id))

    expect(json).not.toMatch(/seo_?ia/i)
    expect(json).not.toContain((await ligne(vitrine.id)).seoIaSignature ?? 'absent')
  })
})

describe('PUT vitrine studio : saisies SEO (G)', () => {
  it.each([
    ['seoTitre', '   '],
    ['seoDescription', '   '],
    ['seoTitre', ''],
    ['seoDescription', '\n\t '],
  ])('should store NULL in base when %s is %j (blank = back to automatic)', async (champ, valeur) => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    const dto = await put(user.id, { [champ]: valeur })

    expect((await ligne(vitrine.id))[champ as 'seoTitre' | 'seoDescription']).toBeNull()
    expect(dto[champ as 'seoTitre' | 'seoDescription']).toBeNull()
  })

  it('should store NULL for an explicit null (« Revenir au texte automatique ») and leave the other text alone', async () => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais', seoTitre: TITRE_SAISI, seoDescription: DESCRIPTION_SAISIE })

    await put(user.id, { seoTitre: null })

    expect(await ligne(vitrine.id)).toMatchObject({ seoTitre: null, seoDescription: DESCRIPTION_SAISIE })
  })

  it('should answer 400 VALIDATION with champs.seoTitre when the titre has 20 characters (below the 30 minimum)', async () => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'frais' })
    const vingt = 'Cardiologue à Douala'
    expect(vingt).toHaveLength(20)

    const erreur = await rejet(put(user.id, { seoTitre: vingt }))

    expect(erreur.brute).toBeInstanceOf(ValidationError)
    expect(erreur).toMatchObject({ code: 'VALIDATION', status: 400 })
    expect(Object.keys((erreur.data?.champs ?? {}) as object)).toEqual(['seoTitre'])
    expect((await ligne(vitrine.id)).seoTitre).toBeNull()
  })

  it.each([
    ['seoTitre', 'x'.repeat(71)],
    ['seoDescription', 'x'.repeat(49)],
    ['seoDescription', 'x'.repeat(161)],
  ])('should answer 400 VALIDATION on %s out of bounds (%#)', async (champ, valeur) => {
    const { user } = await creerVitrineSeo({ ia: 'frais' })

    const erreur = await rejet(put(user.id, { [champ]: valeur }))

    expect(erreur).toMatchObject({ code: 'VALIDATION', status: 400 })
    expect(Object.keys((erreur.data?.champs ?? {}) as object)).toEqual([champ])
  })

  it('should refuse a body that tries to write the IA columns directly (strict schema, nothing written)', async () => {
    const { user, vitrine } = await creerVitrineSeo({ ia: 'aucun' })

    for (const champ of ['seoIaTitre', 'seoIaDescription', 'seoIaSignature', 'seoIaGenereLe', 'seoAuto']) {
      const erreur = await rejet(put(user.id, { [champ]: 'Cardiologue à Douala pour votre cœur' }))
      expect(erreur).toMatchObject({ code: 'VALIDATION', status: 400 })
    }

    const apres = await ligne(vitrine.id)
    expect([apres.seoIaTitre, apres.seoIaDescription, apres.seoIaSignature, apres.seoIaGenereLe]).toEqual([null, null, null, null])
  })

  it('should return the new typed texts and a seoAuto that ignores them in the PUT response', async () => {
    const { user } = await creerVitrineSeo({ ia: 'frais' })

    const dto = await put(user.id, { seoTitre: TITRE_SAISI })

    expect(dto.seoTitre).toBe(TITRE_SAISI)
    expect(dto.seoAuto.titre).toBe(`${dto.nomAffiche} — ${SEO_VALIDE.titre}`)
  })
})
