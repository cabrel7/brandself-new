// S11 : collecte, lecture hybride et plan (intégration, vraie PostgreSQL + vrai Redis).
import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import { reservations, statistiquesJour, vues } from '../../shared/db/schema'
import { eq, count } from 'drizzle-orm'
import { createUser, insertVitrineRow, insertService, insertLien } from './support/fabriques'
import { creerVitrinePubliee } from './support/services'
import { enregistrerVue, getStatistiques, getTotaux7J, agregerStatistiques, purgerStatistiques } from '../../server/services/statistiques'
import { recordLienClic } from '../../server/services/liens'

const maintenant = new Date('2026-03-15T10:00:00Z')

async function nettoyerVues() {
  await db.delete(vues)
  await db.delete(statistiquesJour)
  const cles = await redis.keys('vue:*')
  if (cles.length > 0) await redis.del(...cles)
}

async function vitrinePubliee(username = 'dr-stats', payant = false) {
  const user = await createUser()
  if (payant) {
    const vitrine = await creerVitrinePubliee(user, username)
    return { user, vitrine }
  }
  const vitrine = await insertVitrineRow(user.id, { username, publiee: true })
  return { user, vitrine }
}

describe('enregistrerVue (collecte)', () => {
  it('CA01 : N visites comptées, puis lues par getStatistiques (jour courant en direct)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee()
    for (let i = 0; i < 5; i++) {
      await enregistrerVue({
        username: vitrine.username,
        chemin: i % 2 === 0 ? '/dr-cabrel' : '/dr-cabrel/services/mon-service',
        origine: null,
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
        headers: {},
        now: maintenant,
      })
    }
    const stats = await getStatistiques(vitrine.userId, 7, maintenant)
    expect(stats.totaux.visites).toBe(5)
    expect(stats.periode).toBe(7)
  })

  it('CA02 : robot non compté (zéro ligne)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-robot')
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      headers: {},
      now: maintenant,
    })
    const [ligne] = await db.select({ total: count() }).from(vues).where(eq(vues.vitrineId, vitrine.id))
    expect(Number(ligne.total)).toBe(0)
  })

  it('CA03 : aucune IP brute en base (empreinte hex64, toutes colonnes texte)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-ip')
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: maintenant,
    })
    const lignes = await db.select().from(vues).where(eq(vues.vitrineId, vitrine.id))
    expect(lignes).toHaveLength(1)
    expect(lignes[0].empreinte).toMatch(/^[a-f0-9]{64}$/)
    for (const cle of ['pageType', 'pageIdentifiant', 'source', 'appareil', 'pays', 'empreinte'] as const) {
      expect(String(lignes[0][cle] ?? '')).not.toContain('203.0.113.7')
    }
  })

  it('CA05 : jour dans le fuseau de la vitrine (23:30Z → lendemain à Douala)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-fuseau')
    const nowDouala = new Date('2026-01-01T23:30:00Z')
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: nowDouala,
    })
    const [ligne] = await db.select({ jour: vues.jour }).from(vues).where(eq(vues.vitrineId, vitrine.id))
    expect(String(ligne.jour).slice(0, 10)).toBe('2026-01-02')
  })

  it('CA06 : limiteur 60/min puis 429', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-limite')
    const base = () =>
      enregistrerVue({
        username: vitrine.username,
        chemin: '/dr-cabrel',
        origine: null,
        ip: '203.0.113.9',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
        headers: {},
        now: maintenant,
      })
    for (let i = 0; i < 60; i++) await base()
    await expect(base()).rejects.toMatchObject({ message: expect.stringContaining('Trop de tentatives') })
  })

  it('CA07 : username inconnu ou non publié → 404, zéro ligne', async () => {
    await nettoyerVues()
    await expect(
      enregistrerVue({
        username: 'inconnu-xyz',
        chemin: '/inconnu-xyz',
        origine: null,
        ip: '203.0.113.7',
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
        headers: {},
        now: maintenant,
      }),
    ).rejects.toMatchObject({ code: 'VITRINE_INTROUVABLE' })
    const [total] = await db.select({ total: count() }).from(vues)
    expect(Number(total.total)).toBe(0)
  })
})

describe('getStatistiques (API studio)', () => {
  it('CA17 : gratuit, période 7 → joursMax 7, pages/sources null', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-gratuit', false)
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: maintenant,
    })
    const stats = await getStatistiques(vitrine.userId, 7, maintenant)
    expect(stats.joursMax).toBe(7)
    expect(stats.pages).toBeNull()
    expect(stats.sources).toBeNull()
    expect(stats.totaux.visites).toBe(1)
    expect(stats.parJour).toHaveLength(7)
  })

  it('CA18 : gratuit, période 30 → 403 explicite (jamais 7 silencieux)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-gratuit-30', false)
    await expect(getStatistiques(vitrine.userId, 30, maintenant)).rejects.toMatchObject({
      code: 'STATISTIQUES_PERIODE_INTERDITE',
    })
  })

  it('CA20 : payant, période 90 → pages et sources non nuls', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-payant', true)
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel/services/mon-service',
      origine: 'https://www.google.com/search',
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: maintenant,
    })
    const stats = await getStatistiques(vitrine.userId, 90, maintenant)
    expect(stats.joursMax).toBe(90)
    expect(stats.pages).not.toBeNull()
    expect(stats.sources).not.toBeNull()
    expect(stats.pages!.some((p) => p.libelle === 'Service')).toBe(true)
    expect(stats.sources!.some((s) => s.libelle === 'Google')).toBe(true)
  })

  it('CA21 : réservations tous statuts dans la fenêtre', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-resa')
    const service = await insertService(vitrine.id)
    const dansFenetre = new Date('2026-03-15T11:00:00Z')
    const horsFenetre = new Date('2026-02-01T11:00:00Z')
    await db.insert(reservations).values([
      { id: 'r1', vitrineId: vitrine.id, serviceId: service.id, nom: 'A', email: 'a@t.test', telephone: '+237600000001', debut: dansFenetre, fin: new Date(dansFenetre.getTime() + 30 * 60_000), statut: 'annulee', confirmationTokenHash: createHash('sha256').update('r1').digest('hex'), confirmationExpireLe: new Date('2026-12-01'), createdAt: dansFenetre },
      { id: 'r2', vitrineId: vitrine.id, serviceId: service.id, nom: 'B', email: 'b@t.test', telephone: '+237600000002', debut: dansFenetre, fin: new Date(dansFenetre.getTime() + 30 * 60_000), statut: 'confirmee', confirmationTokenHash: createHash('sha256').update('r2').digest('hex'), confirmationExpireLe: new Date('2026-12-01'), createdAt: dansFenetre },
      { id: 'r3', vitrineId: vitrine.id, serviceId: service.id, nom: 'C', email: 'c@t.test', telephone: '+237600000003', debut: horsFenetre, fin: new Date(horsFenetre.getTime() + 30 * 60_000), statut: 'confirmee', confirmationTokenHash: createHash('sha256').update('r3').digest('hex'), confirmationExpireLe: new Date('2026-12-01'), createdAt: horsFenetre },
    ])
    const stats = await getStatistiques(vitrine.userId, 7, maintenant)
    expect(stats.totaux.reservations).toBe(2)
  })

  it('CA16 : lecture hybride — veille sans agrégat apparaît (live)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-hybride')
    const hier = new Date('2026-03-14T10:00:00Z')
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: hier,
    })
    const stats = await getStatistiques(vitrine.userId, 7, maintenant)
    expect(stats.totaux.visites).toBeGreaterThan(0)
  })
})

describe('getTotaux7J (accueil studio)', () => {
  it('CA23 : valeurs numériques (plus de littéraux 0)', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-totaux')
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: maintenant,
    })
    const totaux = await getTotaux7J(vitrine.userId, maintenant)
    expect(typeof totaux.visites).toBe('number')
    expect(typeof totaux.clics).toBe('number')
    expect(typeof totaux.reservations).toBe('number')
    expect(totaux.visites).toBe(1)
  })
})

describe('agregerStatistiques / purgerStatistiques (jobs)', () => {
  it('CA13 : agrégation idempotente', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-agreg')
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: new Date('2026-03-14T10:00:00Z'),
    })
    await agregerStatistiques(new Date('2026-03-15T11:00:00Z'))
    const avant = await db.select().from(statistiquesJour).where(eq(statistiquesJour.vitrineId, vitrine.id))
    await agregerStatistiques(new Date('2026-03-15T12:00:00Z'))
    const apres = await db.select().from(statistiquesJour).where(eq(statistiquesJour.vitrineId, vitrine.id))
    expect(apres).toHaveLength(avant.length)
    expect(apres[0]!.visites).toBe(avant[0]!.visites)
  })

  it('CA14 : aucune vue dans la fenêtre → aucune ligne créée', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-vide')
    await agregerStatistiques(new Date('2026-03-15T11:00:00Z'))
    const lignes = await db.select().from(statistiquesJour).where(eq(statistiquesJour.vitrineId, vitrine.id))
    expect(lignes).toHaveLength(0)
  })

  it('CA15 : purge supprime les vues >90 j et agrégats >180 j', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-purge')
    const vieux = new Date('2025-11-01T10:00:00Z') // > 90 j avant le 15/03/2026
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: vieux,
    })
    await agregerStatistiques(new Date('2025-11-02T11:00:00Z'))
    await purgerStatistiques(maintenant)
    const vuesRestantes = await db.select().from(vues).where(eq(vues.vitrineId, vitrine.id))
    expect(vuesRestantes).toHaveLength(0)
  })
})

describe('recordLienClic → statistiques_jour (S11 #171 / CA22)', () => {
  it('CA22 : un clic est compté, puis jamais écrasé par l’agrégation', async () => {
    await nettoyerVues()
    const { vitrine } = await vitrinePubliee('dr-clics')
    const lien = await insertLien(vitrine.id, { slug: 'lien-ca22', actif: true })
    const jourClic = new Date('2026-03-14T10:00:00Z')

    await recordLienClic(vitrine.username, lien.slug, '203.0.113.50', jourClic)
    await enregistrerVue({
      username: vitrine.username,
      chemin: '/dr-cabrel',
      origine: null,
      ip: '203.0.113.51',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit',
      headers: {},
      now: jourClic,
    })

    const avant = await getStatistiques(vitrine.userId, 7, maintenant)
    expect(avant.totaux.clics).toBe(1)
    expect(avant.totaux.visites).toBe(1)

    await agregerStatistiques(new Date('2026-03-15T11:00:00Z'))

    const apres = await getStatistiques(vitrine.userId, 7, maintenant)
    expect(apres.totaux.clics).toBe(1)
    expect(apres.totaux.visites).toBe(1)

    const [agregat] = await db.select().from(statistiquesJour).where(eq(statistiquesJour.vitrineId, vitrine.id))
    expect(agregat).toBeDefined()
    expect(agregat!.clics).toBe(1)
    expect(agregat!.visites).toBe(1)
  })
})
