import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { liens } from '../../shared/db/schema'
import { schemaLienCreate } from '../../shared/schemas/lien'
import { createUser, insertLien, insertVitrineRow } from './support/fabriques'
import { liensService, ressourceLien } from './support/modules'
import { creerVitrinePubliee } from './support/services'

// Vrai PostgreSQL (migrations réelles, dont 0012). Aucun mock. Un test par critère
// d'acceptation (spec S6 §Tests) : validations par type, ordre, clics.

async function utilisateurAvecVitrinePubliee(username = 'dr-liens') {
  const user = await createUser()
  const vitrine = await creerVitrinePubliee(user, username)
  return { user, vitrine }
}

describe('liens : création validée par type (S6)', () => {
  it('construit l’URL WhatsApp côté serveur (wa.me avec les chiffres seuls)', async () => {
    const { createLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee()
    const { item } = await createLien(user.id, schemaLienCreate.parse({ type: 'whatsapp', libelle: 'Écrire sur WhatsApp', numero: '+237 699 00 00 01' }))
    expect(item.type).toBe('whatsapp')
    expect(item.url).toBe('https://wa.me/237699000001')
    expect(item.slug).toBe('ecrire-sur-whatsapp')
  })

  it('construit les URL construites : mailto, tel, page interne', async () => {
    const { createLien } = await liensService()
    const { user, vitrine } = await utilisateurAvecVitrinePubliee('dr-interne')
    const email = await createLien(user.id, schemaLienCreate.parse({ type: 'email', libelle: 'Me contacter', adresse: 'contact@exemple.test' }))
    expect(email.item.url).toBe('mailto:contact@exemple.test')
    const tel = await createLien(user.id, schemaLienCreate.parse({ type: 'telephone', libelle: 'Appeler', numero: '+237 699 00 00 02' }))
    expect(tel.item.url).toBe('tel:+237699000002')
    const interne = await createLien(user.id, schemaLienCreate.parse({ type: 'vitrine', libelle: 'Prendre rendez-vous', page: 'reserver' }))
    expect(interne.item.url).toBe(`/${vitrine.username}/agenda`)
  })

  it('refuse un lien javascript: (seuls les schémas sûrs passent)', async () => {
    const { createLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-js')
    expect(() => schemaLienCreate.parse({ type: 'libre', libelle: 'Piège', url: 'javascript:alert(1)' })).toThrow()
    await expect(
      createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Site', url: 'https://exemple.test' })),
    ).resolves.toBeTruthy()
  })

  it('refuse un lien http: (https seulement)', async () => {
    expect(() => schemaLienCreate.parse({ type: 'libre', libelle: 'Site', url: 'http://exemple.test' })).toThrow()
  })

  it('refuse un lien reseau dont l’URL ne correspond pas à la plateforme', async () => {
    const { createLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-reseau')
    await expect(
      createLien(user.id, schemaLienCreate.parse({ type: 'reseau', libelle: 'Mon profil', plateforme: 'linkedin', url: 'https://instagram.com/cabrel' })),
    ).rejects.toMatchObject({ data: { champs: { url: expect.anything() } } })
  })

  it('le slug est unique : deux liens de même libellé sont distingués', async () => {
    const { createLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-slugs')
    const premier = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Mon site', url: 'https://a.test' }))
    const second = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Mon site', url: 'https://b.test' }))
    expect(second.item.slug).toBe('mon-site-2')
    expect(second.item.slug).not.toBe(premier.item.slug)
  })
})

describe('liens : modification (type fixé à la création)', () => {
  it('reconstruit l’URL quand le champ spécifique change', async () => {
    const { createLien, updateLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-modif')
    const { item } = await createLien(user.id, schemaLienCreate.parse({ type: 'whatsapp', libelle: 'Écrire sur WhatsApp', numero: '+237699000001' }))
    const { item: modifie } = await updateLien(user.id, item.id, { numero: '+237699000009' })
    expect(modifie.url).toBe('https://wa.me/237699000009')
  })

  it('refuse un champ hors du type du lien (cohérence type/champs)', async () => {
    const { createLien, updateLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-coherence')
    const { item } = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Mon site', url: 'https://a.test' }))
    await expect(updateLien(user.id, item.id, { numero: '+237699000001' })).rejects.toMatchObject({
      data: { champs: { numero: expect.anything() } },
    })
  })

  it('masque un lien sans le supprimer (interrupteur de visibilité)', async () => {
    const { createLien, updateLien } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-visible')
    const { item } = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Mon site', url: 'https://a.test' }))
    const { item: masque } = await updateLien(user.id, item.id, { actif: false })
    expect(masque.actif).toBe(false)
    const [ligne] = await db.select().from(liens).where(eq(liens.id, item.id))
    expect(ligne).toBeTruthy()
  })
})

describe('liens : ordre (permutation exacte)', () => {
  it('applique le nouvel ordre et refuse une liste incomplète', async () => {
    const { createLien, reorderLiens } = await liensService()
    const { user } = await utilisateurAvecVitrinePubliee('dr-ordre')
    const a = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Lien A', url: 'https://a.test' }))
    const b = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Lien B', url: 'https://b.test' }))
    const c = await createLien(user.id, schemaLienCreate.parse({ type: 'libre', libelle: 'Lien C', url: 'https://c.test' }))

    const { items } = await reorderLiens(user.id, [c.item.id, a.item.id, b.item.id])
    expect(items.map((ligne) => ligne.libelle)).toEqual(['Lien C', 'Lien A', 'Lien B'])

    await expect(reorderLiens(user.id, [a.item.id, b.item.id])).rejects.toMatchObject({ code: 'ORDRE_INVALIDE' })
    await expect(reorderLiens(user.id, [c.item.id, a.item.id, b.item.id, c.item.id])).rejects.toMatchObject({ code: 'ORDRE_INVALIDE' })
  })
})

describe('liens : page publique et pied de vitrine (liens actifs seulement, réseaux en icônes)', () => {
  it('ne renvoie que les liens actifs d’une vitrine publiée, dans l’ordre', async () => {
    const { getPublicLiens } = await liensService()
    const { toLienPublicCarteResource } = await ressourceLien()
    const { user, vitrine } = await utilisateurAvecVitrinePubliee('dr-public')
    const actif = await insertLien(vitrine.id, { slug: `lien-${Date.now()}-a`, libelle: 'Écrire sur WhatsApp', url: 'https://wa.me/237699000001', type: 'whatsapp', actif: true, ordre: 0 })
    await insertLien(vitrine.id, { slug: `lien-${Date.now()}-b`, libelle: 'Masqué', url: 'https://masque.test', type: 'libre', actif: false, ordre: 1 })
    const reseau = await insertLien(vitrine.id, { slug: `lien-${Date.now()}-c`, libelle: 'Mon LinkedIn', url: 'https://www.linkedin.com/in/cabrel', type: 'reseau', actif: true, ordre: 2 })

    const { total, liens: visibles } = await getPublicLiens(vitrine.username)
    expect(total).toBe(2)
    expect(visibles.map((ligne) => ligne.id)).toEqual([actif.id, reseau.id])

    const cartes = visibles.map(toLienPublicCarteResource)
    expect(cartes.map((carte) => carte.type)).toEqual(['whatsapp', 'reseau'])
    expect(cartes.find((carte) => carte.type === 'reseau')?.plateforme).toBe('linkedin')
    // Liste blanche : jamais les données internes.
    expect(cartes[0]).not.toHaveProperty('vitrineId')
    expect(cartes[0]).not.toHaveProperty('ordre')

    // Vitrine non publiée : 404.
    const autre = await createUser()
    await insertVitrineRow(autre.id, { username: 'dr-brouillon', publiee: false })
    await expect(getPublicLiens('dr-brouillon')).rejects.toMatchObject({ code: 'VITRINE_INTROUVABLE' })
    void user
  })
})

describe('liens : clics (total et semaine, remise à zéro au changement de semaine)', () => {
  it('expose une ancienne semaine à zéro puis persiste le premier clic et le lundi ISO UTC', async () => {
    const { recordLienClic, listOwnLiens } = await liensService()
    const { toLienStudioResource } = await ressourceLien()
    const { user, vitrine } = await utilisateurAvecVitrinePubliee('dr-clics')
    const reference = new Date('2026-11-01T23:30:00.000Z')
    const ligne = await insertLien(vitrine.id, {
      slug: `lien-clic-${Date.now()}`,
      libelle: 'Mon site',
      url: 'https://clics.test',
      type: 'libre',
      actif: true,
      clics: 8,
      clicsSemaine: 12,
      semaineDebut: '2020-01-06',
    })

    const avant = await listOwnLiens(user.id)
    const itemAvant = avant.items.find((item) => item.id === ligne.id)
    expect(avant.compteurs).toEqual({ total: 1, visibles: 1, clicsSemaine: 0 })
    expect(itemAvant && toLienStudioResource(itemAvant).clicsSemaine).toBe(0)

    await recordLienClic(vitrine.username, ligne.slug, '203.0.113.9', reference)

    const [persiste] = await db.select().from(liens).where(eq(liens.id, ligne.id))
    expect(persiste).toMatchObject({ clics: 9, clicsSemaine: 1, semaineDebut: '2026-10-26' })
  })

  it('un lien masqué n’enregistre pas de clic', async () => {
    const { recordLienClic } = await liensService()
    const { vitrine } = await utilisateurAvecVitrinePubliee('dr-clic-masque')
    const ligne = await insertLien(vitrine.id, { slug: `lien-cache-${Date.now()}`, libelle: 'Masqué', url: 'https://c.test', type: 'libre', actif: false })
    await expect(recordLienClic(vitrine.username, ligne.slug, '203.0.113.9')).rejects.toMatchObject({ code: 'LIEN_INTROUVABLE' })
  })
})
