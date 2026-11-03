import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { vitrines } from '../../shared/db/schema'
import { NEXT_STEPS } from '../../shared/vitrine'
import type { NextStep } from '../../shared/vitrine'
import { db } from '../../server/utils/db'
import { insererDisponibilite } from './support/agenda'
import { rejet } from './support/erreurs'
import { insertRealisation } from './support/fabriques'
import { vitrinesService } from './support/modules'
import { creerPro, utc } from './support/notifications'
import type { Pro } from './support/notifications'
import { ajouterPhoto } from './support/planification'

// S9 §3.3, #93, #94, §6, CA50 à CA55 : getNextStep / ignoreNextStep / markShared, services réels, PostgreSQL réel.
// Les routes studio exigent une session Better Auth (requireUserSession) : leur contrat HTTP est prouvé dans
// e2e/api/notifications.spec.ts ; ici on prouve la persistance et les règles (CHECK, idempotence, concurrence).

async function lireVitrine(id: string) {
  const [ligne] = await db.select().from(vitrines).where(eq(vitrines.id, id))
  return ligne
}

/** Vitrine avec photo, un service actif (celui de creerPro), des disponibilités, une réalisation : seul « partager » reste. */
async function toutFait(pro: Pro): Promise<void> {
  await ajouterPhoto(pro)
  await insererDisponibilite(pro.vitrine.id, { jourSemaine: 1, debut: '09:00', fin: '12:00' })
  await insertRealisation(pro.vitrine.id, { titre: 'Chantier' })
}

describe('getNextStep : l’ordre des cinq étapes (CA50, CA52)', () => {
  it('should follow the order photo, service, disponibilites, realisation, partager', () => {
    expect([...NEXT_STEPS]).toEqual(['photo', 'service', 'disponibilites', 'realisation', 'partager'])
  })

  it('should propose "disponibilites" for a vitrine with photo, one active service and no availability (CA50)', async () => {
    const { getNextStep } = await vitrinesService()
    const pro = await creerPro()
    await ajouterPhoto(pro)

    expect(await getNextStep(pro.user.id)).toBe('disponibilites')
  })

  it('should propose "photo" first for a bare vitrine', async () => {
    const { getNextStep } = await vitrinesService()
    const pro = await creerPro()

    expect(await getNextStep(pro.user.id)).toBe('photo')
  })

  it('should propose "partager" once everything else is done, the vitrine is published and never shared (CA52)', async () => {
    const { getNextStep } = await vitrinesService()
    const pro = await creerPro({ publiee: true })
    await toutFait(pro)

    expect(await getNextStep(pro.user.id)).toBe('partager')
  })

  it('should propose nothing when everything is done but the vitrine is not published (CA52)', async () => {
    const { getNextStep } = await vitrinesService()
    const pro = await creerPro({ publiee: false })
    await toutFait(pro)

    expect(await getNextStep(pro.user.id)).toBeNull()
  })

  it('should agree with the studio summary: one single source for the next step', async () => {
    const { getNextStep, getStudioSummary } = await vitrinesService()
    const pro = await creerPro()
    await ajouterPhoto(pro)

    expect((await getStudioSummary(pro.user.id)).prochaineEtape).toBe(await getNextStep(pro.user.id))
  })

  it('should answer VITRINE_INTROUVABLE (404) for a user without vitrine', async () => {
    const { getNextStep } = await vitrinesService()
    const pro = await creerPro()
    await db.delete(vitrines).where(eq(vitrines.id, pro.vitrine.id))

    const erreur = await rejet(getNextStep(pro.user.id))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'VITRINE_INTROUVABLE', status: 404 })
  })
})

describe('ignoreNextStep : mémorisé pour toujours (CA51, CA55)', () => {
  it('should answer the following step, store the ignored one and never propose it again even though it stays undone (CA51)', async () => {
    const { getNextStep, ignoreNextStep } = await vitrinesService()
    const pro = await creerPro()
    await ajouterPhoto(pro)

    const suivante = await ignoreNextStep(pro.user.id, 'disponibilites')

    expect(suivante).toBe('realisation')
    expect((await lireVitrine(pro.vitrine.id))?.etapesIgnorees).toEqual(['disponibilites'])
    expect(await getNextStep(pro.user.id)).toBe('realisation')
    expect(await getNextStep(pro.user.id)).toBe('realisation')
  })

  it('should walk the whole chain one ignore at a time and end with null, every step being ignorable', async () => {
    const { ignoreNextStep } = await vitrinesService()
    const pro = await creerPro({ publiee: true })
    const vues: Array<NextStep | null> = []

    let courante: NextStep | null = 'photo'
    while (courante !== null) {
      courante = await ignoreNextStep(pro.user.id, courante)
      vues.push(courante)
    }

    // photo (ignorée) → service est déjà fait : on saute à disponibilites, etc.
    expect(vues).toEqual(['disponibilites', 'realisation', 'partager', null])
    expect([...(await lireVitrine(pro.vitrine.id))!.etapesIgnorees].sort()).toEqual(['disponibilites', 'partager', 'photo', 'realisation'].sort())
  })

  it('should not duplicate an ignored step when ignored twice (CA55)', async () => {
    const { ignoreNextStep } = await vitrinesService()
    const pro = await creerPro()

    await ignoreNextStep(pro.user.id, 'photo')
    await ignoreNextStep(pro.user.id, 'photo')

    expect((await lireVitrine(pro.vitrine.id))?.etapesIgnorees).toEqual(['photo'])
  })

  it('should keep a single entry when the same step is ignored by five simultaneous requests', async () => {
    const { ignoreNextStep } = await vitrinesService()
    const pro = await creerPro()

    await Promise.all(Array.from({ length: 5 }, () => ignoreNextStep(pro.user.id, 'photo')))

    expect((await lireVitrine(pro.vitrine.id))?.etapesIgnorees).toEqual(['photo'])
  })

  it('should keep every step when two different steps are ignored at the same time (no lost update)', async () => {
    const { ignoreNextStep } = await vitrinesService()
    const pro = await creerPro()

    await Promise.all([ignoreNextStep(pro.user.id, 'photo'), ignoreNextStep(pro.user.id, 'realisation')])

    expect([...(await lireVitrine(pro.vitrine.id))!.etapesIgnorees].sort()).toEqual(['photo', 'realisation'])
  })

  it('should isolate users: ignoring a step for A leaves B untouched', async () => {
    const { ignoreNextStep, getNextStep } = await vitrinesService()
    const a = await creerPro()
    const b = await creerPro()

    await ignoreNextStep(a.user.id, 'photo')

    expect(await getNextStep(b.user.id)).toBe('photo')
    expect((await lireVitrine(b.vitrine.id))?.etapesIgnorees).toEqual([])
  })

  it('should answer VITRINE_INTROUVABLE (404) when the user has no vitrine', async () => {
    const { ignoreNextStep } = await vitrinesService()
    const pro = await creerPro()
    await db.delete(vitrines).where(eq(vitrines.id, pro.vitrine.id))

    const erreur = await rejet(ignoreNextStep(pro.user.id, 'photo'))

    expect(erreur).toMatchObject({ code: 'VITRINE_INTROUVABLE', status: 404 })
  })
})

describe('markShared : première date conservée (CA53, CA54)', () => {
  it('should keep the first date when called twice and stop proposing "partager" afterwards (CA53)', async () => {
    const { markShared, getNextStep } = await vitrinesService()
    const pro = await creerPro({ publiee: true })
    await toutFait(pro)
    const premier = utc('2026-11-03T10:00:00.000Z')

    const a = await markShared(pro.user.id, premier)
    const b = await markShared(pro.user.id, utc('2026-11-20T10:00:00.000Z'))

    expect(a.toISOString()).toBe(premier.toISOString())
    expect(b.toISOString()).toBe(premier.toISOString())
    expect((await lireVitrine(pro.vitrine.id))?.partageeLe?.toISOString()).toBe(premier.toISOString())
    expect(await getNextStep(pro.user.id)).toBeNull()
  })

  it('should keep the earliest date under simultaneous first gestures', async () => {
    const { markShared } = await vitrinesService()
    const pro = await creerPro({ publiee: true })

    const dates = await Promise.all(Array.from({ length: 4 }, (_, i) => markShared(pro.user.id, new Date(utc('2026-11-03T10:00:00.000Z').getTime() + i * 1000))))

    expect(new Set(dates.map((d) => d.toISOString())).size).toBe(1)
    expect((await lireVitrine(pro.vitrine.id))?.partageeLe?.toISOString()).toBe(dates[0]?.toISOString())
  })

  it('should refuse with VITRINE_NON_PUBLIEE (422) for an unpublished vitrine and store nothing (CA54)', async () => {
    const { markShared } = await vitrinesService()
    const pro = await creerPro({ publiee: false })

    const erreur = await rejet(markShared(pro.user.id, utc('2026-11-03T10:00:00.000Z')))

    expect(erreur).toMatchObject({ estDomainError: true, code: 'VITRINE_NON_PUBLIEE', status: 422 })
    expect((await lireVitrine(pro.vitrine.id))?.partageeLe).toBeNull()
  })

  it('should answer VITRINE_INTROUVABLE (404) without vitrine, and never share another user’s vitrine', async () => {
    const { markShared } = await vitrinesService()
    const a = await creerPro({ publiee: true })
    const b = await creerPro({ publiee: true })
    await db.delete(vitrines).where(eq(vitrines.id, a.vitrine.id))

    expect(await rejet(markShared(a.user.id))).toMatchObject({ code: 'VITRINE_INTROUVABLE', status: 404 })
    expect((await lireVitrine(b.vitrine.id))?.partageeLe).toBeNull()
  })
})
