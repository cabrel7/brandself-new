import { describe, expect, it } from 'vitest'

// S6 — règles pures des liens (shared/liens.ts + server/services/liens-regles.ts) :
// aucune base, aucun réseau. Imports paresseux.
const partage = () => import('../../shared/liens')
const regles = () => import('../../server/services/liens-regles')
const schemas = () => import('../../shared/schemas/lien')

describe('construireUrlLien (URL toujours construite côté serveur)', () => {
  it('whatsapp : chiffres seuls après https://wa.me/ (signe, espaces et tirets retirés)', async () => {
    const { construireUrlLien } = await partage()
    expect(construireUrlLien({ type: 'whatsapp', username: 'dr-cabrel', numero: '+237 699 00 00 01' })).toBe(
      'https://wa.me/237699000001',
    )
  })

  it('email : mailto: devant l’adresse', async () => {
    const { construireUrlLien } = await partage()
    expect(construireUrlLien({ type: 'email', username: 'dr-cabrel', adresse: 'contact@dr-cabrel.test' })).toBe(
      'mailto:contact@dr-cabrel.test',
    )
  })

  it('telephone : tel: + numéro normalisé (signe conservé, séparateurs retirés)', async () => {
    const { construireUrlLien } = await partage()
    expect(construireUrlLien({ type: 'telephone', username: 'dr-cabrel', numero: '+237 (699) 00-00.02' })).toBe(
      'tel:+237699000002',
    )
  })

  it('vitrine : chemin interne /<username><chemin de la page>', async () => {
    const { construireUrlLien } = await partage()
    expect(construireUrlLien({ type: 'vitrine', username: 'dr-cabrel', page: 'reserver' })).toBe('/dr-cabrel/agenda')
    expect(construireUrlLien({ type: 'vitrine', username: 'dr-cabrel', page: 'accueil' })).toBe('/dr-cabrel')
  })

  it('libre et reseau : l’URL https validée passe telle quelle', async () => {
    const { construireUrlLien } = await partage()
    expect(construireUrlLien({ type: 'libre', username: 'dr-cabrel', url: 'https://exemple.test/page' })).toBe(
      'https://exemple.test/page',
    )
    expect(construireUrlLien({ type: 'reseau', username: 'dr-cabrel', url: 'https://linkedin.com/in/x' })).toBe(
      'https://linkedin.com/in/x',
    )
  })
})

describe('numéro et adresse : jamais de javascript: ni de schéma inattendu', () => {
  it('normaliserNumero garde le signe initial et les chiffres', async () => {
    const { normaliserNumero } = await partage()
    expect(normaliserNumero('+237 699-00.00(03)')).toBe('+237699000003')
    expect(normaliserNumero('237699000004')).toBe('237699000004')
  })

  it('les parseurs de pré-remplissage lisent l’URL construite', async () => {
    const { numeroDepuisWhatsappUrl, adresseDepuisMailtoUrl, numeroDepuisTelUrl, pageDepuisVitrineUrl } = await partage()
    expect(numeroDepuisWhatsappUrl('https://wa.me/237699000001')).toBe('237699000001')
    expect(adresseDepuisMailtoUrl('mailto:contact@dr-cabrel.test')).toBe('contact@dr-cabrel.test')
    expect(numeroDepuisTelUrl('tel:+237699000002')).toBe('+237699000002')
    expect(pageDepuisVitrineUrl('dr-cabrel', '/dr-cabrel/services')).toBe('services')
    expect(pageDepuisVitrineUrl('dr-cabrel', '/dr-cabrel')).toBe('accueil')
    expect(pageDepuisVitrineUrl('autre', '/dr-cabrel/services')).toBe(null)
  })
})

describe('cohérence plateforme/URL (liens reseau)', () => {
  it('plateformeDepuisUrl reconnaît les domaines des réseaux de la liste', async () => {
    const { plateformeDepuisUrl } = await partage()
    expect(plateformeDepuisUrl('https://www.linkedin.com/in/dr-cabrel-nguesso')).toBe('linkedin')
    expect(plateformeDepuisUrl('https://x.com/cabrel')).toBe('x')
    expect(plateformeDepuisUrl('https://youtu.be/abc')).toBe('youtube')
    expect(plateformeDepuisUrl('https://exemple.test')).toBe(null)
    expect(plateformeDepuisUrl('pas une url')).toBe(null)
  })

  it('un faux sous-domaine ne passe pas (suffixe de domaine strict)', async () => {
    const { plateformeDepuisUrl } = await partage()
    expect(plateformeDepuisUrl('https://fakelinkedin.com')).toBe(null)
  })
})

describe('checkLienPatchCoherence (type fixé à la création)', () => {
  it('refuse les champs hors du type du lien', async () => {
    const { checkLienPatchCoherence } = await regles()
    expect(checkLienPatchCoherence('libre', { numero: '+237699000001' })).toHaveProperty('numero')
    expect(checkLienPatchCoherence('whatsapp', { url: 'https://x.test', page: 'accueil' })).toHaveProperty('page')
    expect(checkLienPatchCoherence('vitrine', { adresse: 'a@b.test' })).toHaveProperty('adresse')
  })

  it('accepte les champs du type et libelle/actif', async () => {
    const { checkLienPatchCoherence } = await regles()
    expect(checkLienPatchCoherence('whatsapp', { libelle: 'WhatsApp', numero: '+237699000001', actif: true })).toEqual({})
    expect(checkLienPatchCoherence('reseau', { plateforme: 'linkedin', url: 'https://linkedin.com/in/x' })).toEqual({})
  })
})

describe('compteurs hebdomadaires en semaine ISO UTC', () => {
  it('calcule le lundi UTC pour un lundi et un dimanche de la même semaine', async () => {
    const { getIsoWeekStartUtc } = await regles()

    expect(getIsoWeekStartUtc(new Date('2026-10-26T00:00:00.000Z'))).toBe('2026-10-26')
    expect(getIsoWeekStartUtc(new Date('2026-11-01T23:59:59.999Z'))).toBe('2026-10-26')
  })

  it('bascule au lundi suivant exactement à minuit UTC', async () => {
    const { getIsoWeekStartUtc } = await regles()

    expect(getIsoWeekStartUtc(new Date('2026-11-01T23:59:59.999Z'))).toBe('2026-10-26')
    expect(getIsoWeekStartUtc(new Date('2026-11-02T00:00:00.000Z'))).toBe('2026-11-02')
  })

  it('expose les clics de la semaine courante et masque ceux d’une semaine périmée', async () => {
    const { getCurrentWeekClicks } = await regles()
    const reference = new Date('2026-10-29T12:00:00.000Z')

    expect(getCurrentWeekClicks({ clicsSemaine: 7, semaineDebut: '2026-10-26' }, reference)).toBe(7)
    expect(getCurrentWeekClicks({ clicsSemaine: 19, semaineDebut: '2026-10-19' }, reference)).toBe(0)
  })
})

describe('schemaLienCreate : seules les URL https (jamais javascript:), un champ par type', () => {
  it('accepte une URL https pour un lien libre', async () => {
    const { schemaLienCreate } = await schemas()
    const result = schemaLienCreate.safeParse({ type: 'libre', libelle: 'Mon site', url: 'https://exemple.test' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data).toMatchObject({ type: 'libre', actif: true })
  })

  it('refuse javascript: (schéma non autorisé)', async () => {
    const { schemaLienCreate } = await schemas()
    const result = schemaLienCreate.safeParse({ type: 'libre', libelle: 'Piège', url: 'javascript:alert(1)' })
    expect(result.success).toBe(false)
  })

  it('refuse http: (https seulement)', async () => {
    const { schemaLienCreate } = await schemas()
    expect(schemaLienCreate.safeParse({ type: 'libre', libelle: 'Site', url: 'http://exemple.test' }).success).toBe(false)
  })

  it('refuse un champ hors du type choisi', async () => {
    const { schemaLienCreate } = await schemas()
    expect(
      schemaLienCreate.safeParse({ type: 'whatsapp', libelle: 'WhatsApp', numero: '+237699000001', url: 'https://x.test' })
        .success,
    ).toBe(false)
  })

  it('refuse un numéro sans assez de chiffres', async () => {
    const { schemaLienCreate } = await schemas()
    expect(schemaLienCreate.safeParse({ type: 'whatsapp', libelle: 'WhatsApp', numero: '123' }).success).toBe(false)
  })

  it('refuse une plateforme et une page inconnues', async () => {
    const { schemaLienCreate } = await schemas()
    expect(schemaLienCreate.safeParse({ type: 'reseau', libelle: 'X', plateforme: 'myspace', url: 'https://myspace.test/x' }).success)
      .toBe(false)
    expect(schemaLienCreate.safeParse({ type: 'vitrine', libelle: 'Page', page: 'nimporte' }).success).toBe(false)
  })
})
