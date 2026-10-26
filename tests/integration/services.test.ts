import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { db } from '../../server/utils/db'
import { medias, services, vitrines } from '../../shared/db/schema'
import { VEDETTE_MAX } from '../../shared/services'
import { makePng } from '../support/images'
import { fichiersDuMedia } from './support/disque'
import { erreurPostgres, exigerModulesPresents, rejet } from './support/erreurs'
import {
  createUser,
  insertMediaRow,
  insertService,
  insertServiceComplet,
  insertVitrineRow,
} from './support/fabriques'
import { mediasService, ressourceService, servicesService } from './support/modules'
import {
  DONNEES_PAYANTES,
  EN_LIGNE,
  HORS_LIGNE,
  UUID_V4_OU_V7,
  creer,
  creerVitrinePubliee,
  ligneService,
  lignesDeLaVitrine,
  modifier,
} from './support/services'

// Vrai PostgreSQL (migrations réelles, dont 0010), vrai Redis, vrai disque. Aucun mock : ni la base,
// ni le stockage, ni la couche service. Le drapeau PAIEMENT_EN_LIGNE est passé en option.
// Un test par critère d'acceptation : le nom commence par « CAn » (spec S3 §7, préfixe S3-CA).

const PAUSE_HORODATAGE_MS = 15

async function uploaderImage(userId: string): Promise<string> {
  const { uploadMedia } = await mediasService()
  return (await uploadMedia(userId, await makePng(300, 200))).id
}

async function utilisateurAvecVitrine(username = 'dr-test') {
  const user = await createUser()
  const vitrine = await creerVitrinePubliee(user, username)
  return { user, vitrine }
}

async function titresDeLaVitrine(vitrineId: string): Promise<string[]> {
  return (await lignesDeLaVitrine(vitrineId)).map((l) => l.titre)
}

describe('services — contraintes de la base (CA02 à CA04)', () => {
  const PRIX = { prixMontant: 15000, prixDevise: 'XAF', paiementMode: 'sur_place' } as const

  it.each([
    ['type inconnu', { type: 'consultation' }, 'services_type_check'],
    ['payant sans prix', { tarif: 'payant', prixDevise: 'XAF', paiementMode: 'sur_place' }, 'services_prix_tarif_check'],
    ['gratuit avec un prix', { prixMontant: 1000, prixDevise: 'XAF' }, 'services_prix_tarif_check'],
    ['devis au tarif payant', { type: 'devis', dureeMin: null, tarif: 'payant', ...PRIX }, 'services_devis_tarif_check'],
    ['rendez-vous sans durée', { dureeMin: null }, 'services_duree_requise_check'],
    ['accompagnement sans nb_seances', { type: 'accompagnement', nbSeances: null }, 'services_seances_type_check'],
    ['rendez-vous avec nb_seances = 6', { nbSeances: 6 }, 'services_seances_type_check'],
    ['rythme sur un rendez-vous', { rythme: 'hebdomadaire' }, 'services_rythme_type_check'],
    ['en vedette et masqué', { enVedette: true, actif: false }, 'services_vedette_actif_check'],
    ['slug avec majuscule et espace', { slug: 'Bad Slug' }, 'services_slug_format_check'],
    ['slug avec double tiret', { slug: 'a--b' }, 'services_slug_format_check'],
    ['slug vide', { slug: '' }, 'services_slug_format_check'],
    ['slug de 81 caractères', { slug: 'a'.repeat(81) }, 'services_slug_format_check'],
    ['devise GBP', { tarif: 'payant', prixMontant: 1000, prixDevise: 'GBP', paiementMode: 'sur_place' }, 'services_prix_devise_check'],
    ['prix = 0', { tarif: 'payant', prixMontant: 0, prixDevise: 'XAF', paiementMode: 'sur_place' }, 'services_prix_montant_check'],
    ['prix au-delà du plafond', { tarif: 'payant', prixMontant: 1_000_000_001, prixDevise: 'XAF', paiementMode: 'sur_place' }, 'services_prix_montant_check'],
    ['mode de règlement inconnu', { tarif: 'payant', prixMontant: 1000, prixDevise: 'XAF', paiementMode: 'cheque' }, 'services_paiement_mode_check'],
    ['gratuit avec un mode de règlement', { paiementMode: 'sur_place' }, 'services_paiement_tarif_check'],
    ['payant sans mode de règlement', { tarif: 'payant', prixMontant: 1000, prixDevise: 'XAF' }, 'services_paiement_tarif_check'],
    ['13 lignes « inclus »', { inclus: Array.from({ length: 13 }, (_, i) => `ligne ${i}`) }, 'services_inclus_check'],
    ['durée de 3 minutes', { dureeMin: 3 }, 'services_duree_min_check'],
    ['durée de 1441 minutes', { dureeMin: 1441 }, 'services_duree_min_check'],
    ['une seule séance', { type: 'accompagnement', nbSeances: 1 }, 'services_nb_seances_check'],
    ['53 séances', { type: 'accompagnement', nbSeances: 53 }, 'services_nb_seances_check'],
    ['rythme inconnu', { type: 'accompagnement', nbSeances: 6, rythme: 'quotidien' }, 'services_rythme_check'],
    ['tarif inconnu', { tarif: 'offert' }, 'services_tarif_check'],
    ['ordre négatif', { ordre: -1 }, 'services_ordre_check'],
  ])('CA02 should reject an INSERT with %s with a CHECK violation (23514)', async (_libelle, surcharges, contrainte) => {
    const { vitrine } = await utilisateurAvecVitrine()

    const erreur = await rejet(insertService(vitrine.id, surcharges as Partial<typeof services.$inferInsert>).then(() => undefined))

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23514', contrainte })
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
  })

  it('CA02 should accept the valid shapes of every type (devis without duration, accompagnement, payant, 12 inclus)', async () => {
    const { vitrine } = await utilisateurAvecVitrine()

    await insertService(vitrine.id, { type: 'devis', dureeMin: null, tarif: 'devis' })
    await insertService(vitrine.id, { type: 'accompagnement', nbSeances: 6, rythme: 'hebdomadaire' })
    await insertService(vitrine.id, { type: 'atelier', dureeMin: 90, tarif: 'payant', prixMontant: 1_000_000_000, prixDevise: 'EUR', paiementMode: 'au_choix' })
    await insertService(vitrine.id, { inclus: Array.from({ length: 12 }, (_, i) => `ligne ${i}`) })

    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(4)
  })

  it('CA03 should allow the same slug in two different vitrines', async () => {
    const a = await utilisateurAvecVitrine('vitrine-a')
    const b = await utilisateurAvecVitrine('vitrine-b')

    await insertService(a.vitrine.id, { slug: 'consultation' })
    await insertService(b.vitrine.id, { slug: 'consultation' })

    expect(await lignesDeLaVitrine(a.vitrine.id)).toHaveLength(1)
    expect(await lignesDeLaVitrine(b.vitrine.id)).toHaveLength(1)
  })

  it('CA03 should reject the same slug twice in the same vitrine (23505 services_vitrine_id_slug_unique)', async () => {
    const { vitrine } = await utilisateurAvecVitrine()
    await insertService(vitrine.id, { slug: 'consultation' })

    const erreur = await rejet(insertService(vitrine.id, { slug: 'consultation' }).then(() => undefined))

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23505', contrainte: 'services_vitrine_id_slug_unique' })
  })

  it('CA04 should reset image_media_id to NULL (FK ON DELETE SET NULL) when the medias row is deleted', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const media = await insertMediaRow(user.id)
    const service = await insertService(vitrine.id, { imageMediaId: media.id })

    await db.delete(medias).where(eq(medias.id, media.id))

    expect((await ligneService(service.id))?.imageMediaId).toBeNull()
  })

  it('CA04 should reject an image_media_id that points to no media (23503 services_image_media_id_medias_id_fk)', async () => {
    const { vitrine } = await utilisateurAvecVitrine()

    const erreur = await rejet(insertService(vitrine.id, { imageMediaId: randomUUID() }).then(() => undefined))

    expect(erreurPostgres(erreur.brute)).toEqual({ sqlstate: '23503', contrainte: 'services_image_media_id_medias_id_fk' })
  })
})

describe('services — création (CA05 à CA15)', () => {
  it('CA05 should create a complete service with generated slug, order 0, automatic vedette and default payment mode', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    const { item, compteurs } = await creer(user.id, DONNEES_PAYANTES)

    expect(item.service).toMatchObject({
      vitrineId: vitrine.id,
      slug: 'consultation-de-cardiologie',
      titre: 'Consultation de cardiologie',
      type: 'rdv',
      dureeMin: 45,
      tarif: 'payant',
      prixMontant: 15000,
      prixDevise: 'XAF',
      paiementMode: 'sur_place',
      inclus: [],
      ordre: 0,
      actif: true,
      reservable: true,
      enVedette: true,
      imageMediaId: null,
    })
    expect(item.image).toBeNull()
    expect(compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
    expect(await ligneService(item.service.id)).toEqual(item.service)
  })

  it('CA05 should give the service a UUID identifier (the studio routes validate :id as a uuid)', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id)

    expect(item.service.id).toMatch(UUID_V4_OU_V7)
  })

  it('CA05 should create an accompagnement with its sessions, rhythm and inclus list', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id, {
      titre: 'Suivi après infarctus',
      type: 'accompagnement',
      nbSeances: 6,
      rythme: 'hebdomadaire',
      dureeMin: 30,
      tarif: 'payant',
      prixMontant: 60000,
      prixDevise: 'XAF',
      inclus: ['Bilan initial', 'Plan alimentaire'],
    })

    expect(item.service).toMatchObject({
      type: 'accompagnement',
      nbSeances: 6,
      rythme: 'hebdomadaire',
      dureeMin: 30,
      inclus: ['Bilan initial', 'Plan alimentaire'],
    })
  })

  it('CA05 should assign order = max + 1 (not the count) after a deletion, and 0 again when the vitrine is empty', async () => {
    const { deleteService } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    await creer(user.id, { titre: 'S2' })
    await creer(user.id, { titre: 'S3' })
    await deleteService(user.id, s1.item.service.id)

    const s4 = await creer(user.id, { titre: 'S4' })

    expect(s4.item.service.ordre).toBe(3)
    for (const ligne of await lignesDeLaVitrine(vitrine.id)) {
      await deleteService(user.id, ligne.id)
    }
    expect((await creer(user.id, { titre: 'S5' })).item.service.ordre).toBe(0)
  })

  it('CA06 should make the first three services vedettes automatically and not the fourth (orders 0 to 3)', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    for (const titre of ['S1', 'S2', 'S3', 'S4']) {
      await creer(user.id, { titre })
    }

    const lignes = await lignesDeLaVitrine(vitrine.id)
    expect(lignes.map((l) => l.enVedette)).toEqual([true, true, true, false])
    expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2, 3])
  })

  it('CA07 should keep the first service out of vedette when enVedette is false, then fill the three places automatically', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    await creer(user.id, { titre: 'S1', enVedette: false })
    for (const titre of ['S2', 'S3', 'S4', 'S5']) {
      await creer(user.id, { titre })
    }

    const lignes = await lignesDeLaVitrine(vitrine.id)
    expect(lignes.map((l) => l.enVedette)).toEqual([false, true, true, true, false])
  })

  it('CA07 should never make a masked service a vedette automatically', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item, compteurs } = await creer(user.id, { actif: false })

    expect(item.service).toMatchObject({ actif: false, enVedette: false })
    expect(compteurs).toMatchObject({ total: 1, visibles: 0, enVedette: 0 })
  })

  it('CA08 should answer VEDETTE_COMPLETE (409) with the three current vedettes in order when a fourth is explicitly requested, and insert nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()
    const crees = []
    for (const titre of ['S1', 'S2', 'S3']) {
      crees.push((await creer(user.id, { titre })).item.service)
    }
    const { createService } = await servicesService()
    const { schemaServiceCreate } = await import('../../shared/schemas/service')

    const erreur = await rejet(
      createService(user.id, schemaServiceCreate.parse({ titre: 'S4', type: 'rdv', dureeMin: 30, tarif: 'gratuit', enVedette: true }), HORS_LIGNE),
    )

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VEDETTE_COMPLETE')
    expect(erreur.status).toBe(409)
    expect(erreur.data?.enVedette).toEqual(crees.map((c) => ({ id: c.id, titre: c.titre })))
    expect(await titresDeLaVitrine(vitrine.id)).toEqual(['S1', 'S2', 'S3'])
  })

  it('CA08 should accept an explicit enVedette true while a place is free', async () => {
    const { user } = await utilisateurAvecVitrine()
    await creer(user.id, { titre: 'S1' })

    const { item, compteurs } = await creer(user.id, { titre: 'S2', enVedette: true })

    expect(item.service.enVedette).toBe(true)
    expect(compteurs.enVedette).toBe(2)
  })

  it('CA09 should transliterate accents and ligatures, replace & by "et" and number the duplicates (-2, -3)', async () => {
    const { user } = await utilisateurAvecVitrine()
    const titre = 'Échographie cœur & poumons'

    const premier = await creer(user.id, { titre })
    const deuxieme = await creer(user.id, { titre })
    const troisieme = await creer(user.id, { titre })

    expect(premier.item.service.slug).toBe('echographie-coeur-et-poumons')
    expect(deuxieme.item.service.slug).toBe('echographie-coeur-et-poumons-2')
    expect(troisieme.item.service.slug).toBe('echographie-coeur-et-poumons-3')
  })

  it('CA09 should fall back to the slug "service" when the title has no usable character', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id, { titre: '!!!' })
    const suivant = await creer(user.id, { titre: '???' })

    expect(item.service.slug).toBe('service')
    expect(suivant.item.service.slug).toBe('service-2')
  })

  it('CA09 should keep a slug of at most 80 characters, without trailing dash, for an 80-character accented title', async () => {
    const { user } = await utilisateurAvecVitrine()
    const titre = `${'Électrocardiogramme '.repeat(4).slice(0, 78)} é`
    expect(titre).toHaveLength(80)

    const { item } = await creer(user.id, { titre })
    const doublon = await creer(user.id, { titre })

    for (const slug of [item.service.slug, doublon.item.service.slug]) {
      expect(slug.length).toBeLessThanOrEqual(80)
      expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(slug.startsWith('electrocardiogramme-electrocardiogramme-')).toBe(true)
    }
    expect(doublon.item.service.slug).not.toBe(item.service.slug)
  })

  it('CA09 should not add a suffix for the same title in the vitrine of another user', async () => {
    const a = await utilisateurAvecVitrine('vitrine-a')
    const b = await utilisateurAvecVitrine('vitrine-b')
    await creer(a.user.id, { titre: 'Bilan' })

    const { item } = await creer(b.user.id, { titre: 'Bilan' })

    expect(item.service.slug).toBe('bilan')
  })

  it('CA10 should keep the slug unchanged when the title is edited', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { titre: 'Consultation' })

    const { item: modifie } = await modifier(user.id, item.service.id, { titre: 'Nouveau titre' })

    expect(modifie.service.titre).toBe('Nouveau titre')
    expect(modifie.service.slug).toBe('consultation')
  })

  describe('CA11 validation de cohérence sur l’état fusionné (400 VALIDATION, champ visé)', () => {
    it.each([
      ['rendez-vous sans durée', { type: 'rdv', dureeMin: null }, ['dureeMin']],
      ['atelier sans durée', { type: 'atelier', dureeMin: null }, ['dureeMin']],
      ['accompagnement sans durée', { type: 'accompagnement', nbSeances: 6, dureeMin: null }, ['dureeMin']],
      ['accompagnement sans séances', { type: 'accompagnement', nbSeances: null }, ['nbSeances']],
      ['devis au tarif payant', { type: 'devis', dureeMin: null, tarif: 'payant', prixMontant: 1000, prixDevise: 'XAF' }, ['tarif']],
      ['devis au tarif gratuit', { type: 'devis', dureeMin: null, tarif: 'gratuit' }, ['tarif']],
      ['payant sans prix', { tarif: 'payant', prixDevise: 'XAF' }, ['prixMontant']],
      ['payant sans devise', { tarif: 'payant', prixMontant: 1000 }, ['prixDevise']],
      ['payant sans prix ni devise', { tarif: 'payant' }, ['prixMontant', 'prixDevise']],
      ['plusieurs incohérences cumulées', { type: 'accompagnement', dureeMin: null, tarif: 'payant' }, ['dureeMin', 'nbSeances', 'prixDevise', 'prixMontant']],
      ['vedette explicite sur un service masqué', { actif: false, enVedette: true }, ['enVedette']],
    ])('CA11 should reject %s and insert nothing', async (_libelle, surcharges, champsAttendus) => {
      const { user, vitrine } = await utilisateurAvecVitrine()

      const erreur = await rejet(creer(user.id, surcharges as Record<string, unknown>))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('VALIDATION')
      expect(erreur.status).toBe(400)
      const champs = erreur.data?.champs as Record<string, string[]>
      expect(Object.keys(champs).sort()).toEqual([...champsAttendus].sort())
      for (const messages of Object.values(champs)) {
        expect(messages.length).toBeGreaterThan(0)
      }
      expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
    })

    it('CA11 should explain why a masked service cannot be a vedette, in French', async () => {
      const { user } = await utilisateurAvecVitrine()

      const erreur = await rejet(creer(user.id, { actif: false, enVedette: true }))

      expect((erreur.data?.champs as Record<string, string[]>).enVedette).toEqual(['Un service masqué ne peut pas être en vedette.'])
    })

    it('CA11 should accept a devis without duration', async () => {
      const { user } = await utilisateurAvecVitrine()

      const { item } = await creer(user.id, { titre: 'Second avis', type: 'devis', dureeMin: null, tarif: 'devis' })

      expect(item.service).toMatchObject({ type: 'devis', dureeMin: null, tarif: 'devis', prixMontant: null, paiementMode: null })
    })
  })

  describe('CA12 normalisation avant validation', () => {
    it('CA12 should store NULL for sessions and rhythm of a rendez-vous that carried them', async () => {
      const { user } = await utilisateurAvecVitrine()

      const { item } = await creer(user.id, { type: 'rdv', nbSeances: 6, rythme: 'hebdomadaire' })

      expect(item.service).toMatchObject({ type: 'rdv', nbSeances: null, rythme: null })
    })

    it('CA12 should store NULL for price, currency, payment mode and instructions of a free service', async () => {
      const { user } = await utilisateurAvecVitrine()

      const { item } = await creer(user.id, {
        tarif: 'gratuit',
        prixMontant: 5000,
        prixDevise: 'XAF',
        paiementMode: 'sur_place',
        paiementInstructions: 'À régler au cabinet',
      })

      expect(item.service).toMatchObject({ tarif: 'gratuit', prixMontant: null, prixDevise: null, paiementMode: null, paiementInstructions: null })
    })

    it('CA12 should store a devis as price-less even if a price was sent', async () => {
      const { user } = await utilisateurAvecVitrine()

      const { item } = await creer(user.id, { type: 'devis', dureeMin: null, tarif: 'devis', prixMontant: 5000, prixDevise: 'EUR' })

      expect(item.service).toMatchObject({ tarif: 'devis', prixMontant: null, prixDevise: null, paiementMode: null })
    })

    it('CA12 should default the payment mode of a paid service to sur_place and keep an explicit one when allowed', async () => {
      const { user } = await utilisateurAvecVitrine()

      const defaut = await creer(user.id, { ...DONNEES_PAYANTES, titre: 'Par défaut' })
      const explicite = await creer(user.id, { ...DONNEES_PAYANTES, titre: 'Au choix', paiementMode: 'au_choix' }, EN_LIGNE)

      expect(defaut.item.service.paiementMode).toBe('sur_place')
      expect(explicite.item.service.paiementMode).toBe('au_choix')
    })

    it('CA12 should trim the inclus lines and drop the empty ones', async () => {
      const { user } = await utilisateurAvecVitrine()

      const { item } = await creer(user.id, { inclus: ['  a ', '', 'b'] })

      expect(item.service.inclus).toEqual(['a', 'b'])
    })
  })

  it('CA13 should answer 422 PAIEMENT_EN_LIGNE_INDISPONIBLE for au_choix and en_ligne while the flag is false, and persist nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    for (const paiementMode of ['au_choix', 'en_ligne'] as const) {
      const erreur = await rejet(creer(user.id, { ...DONNEES_PAYANTES, paiementMode }, HORS_LIGNE))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('PAIEMENT_EN_LIGNE_INDISPONIBLE')
      expect(erreur.status).toBe(422)
    }
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
  })

  it('CA13 should accept en_ligne and au_choix when the flag is true', async () => {
    const { user } = await utilisateurAvecVitrine()

    const enLigne = await creer(user.id, { ...DONNEES_PAYANTES, titre: 'En ligne', paiementMode: 'en_ligne' }, EN_LIGNE)
    const auChoix = await creer(user.id, { ...DONNEES_PAYANTES, titre: 'Au choix', paiementMode: 'au_choix' }, EN_LIGNE)

    expect(enLigne.item.service.paiementMode).toBe('en_ligne')
    expect(auChoix.item.service.paiementMode).toBe('au_choix')
  })

  it('CA13 should not complain about a payment mode that normalisation removes (free service sent with au_choix)', async () => {
    const { user } = await utilisateurAvecVitrine()

    const { item } = await creer(user.id, { tarif: 'gratuit', paiementMode: 'au_choix' }, HORS_LIGNE)

    expect(item.service.paiementMode).toBeNull()
  })

  it('CA13 should refuse to switch an existing service to au_choix on update while the flag is false', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, DONNEES_PAYANTES)

    const erreur = await rejet(modifier(user.id, item.service.id, { paiementMode: 'au_choix' }, HORS_LIGNE))

    expect(erreur.code).toBe('PAIEMENT_EN_LIGNE_INDISPONIBLE')
    expect((await ligneService(item.service.id))?.paiementMode).toBe('sur_place')
  })

  it('CA14 should reject an image of another user with 422 MEDIA_INVALIDE and persist nothing', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine('vitrine-a')
    const autre = await createUser()
    const mediaDeB = await insertMediaRow(autre.id)

    const erreur = await rejet(creer(user.id, { imageMediaId: mediaDeB.id }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('MEDIA_INVALIDE')
    expect(erreur.status).toBe(422)
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
    expect(await db.select().from(medias).where(eq(medias.id, mediaDeB.id))).toHaveLength(1)
  })

  it('CA14 should reject an image that does not exist with 422 MEDIA_INVALIDE', async () => {
    const { user, vitrine } = await utilisateurAvecVitrine()

    const erreur = await rejet(creer(user.id, { imageMediaId: randomUUID() }))

    expect(erreur.code).toBe('MEDIA_INVALIDE')
    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
  })

  it('CA14 should attach an image of the user and expose it as /medias/<id>/1600.webp in the studio DTO', async () => {
    const { toServiceStudioResource } = await ressourceService()
    const { user } = await utilisateurAvecVitrine()
    const imageId = await uploaderImage(user.id)

    const { item } = await creer(user.id, { imageMediaId: imageId })

    expect(item.service.imageMediaId).toBe(imageId)
    expect(toServiceStudioResource(item.service, item.image).image).toMatchObject({ id: imageId, url: `/medias/${imageId}/1600.webp` })
  })

  it('CA15 should fail with VITRINE_INTROUVABLE when the user has no vitrine', async () => {
    const user = await createUser()

    const erreur = await rejet(creer(user.id))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })

  it('CA15 should create the service in the vitrine of the caller and never in another one', async () => {
    const a = await utilisateurAvecVitrine('vitrine-a')
    const b = await utilisateurAvecVitrine('vitrine-b')

    await creer(a.user.id, { titre: 'Chez A' })

    expect(await titresDeLaVitrine(a.vitrine.id)).toEqual(['Chez A'])
    expect(await lignesDeLaVitrine(b.vitrine.id)).toHaveLength(0)
  })
})

describe('services — mise à jour (CA16 à CA24 ; CA25 est dans schemas-service.test.ts)', () => {
  it('CA16 should only change the sent field and updated_at', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { ...DONNEES_PAYANTES, description: 'Avant', inclus: ['a'] })
    const avant = (await ligneService(item.service.id))!
    await new Promise((resolve) => setTimeout(resolve, PAUSE_HORODATAGE_MS))

    const { item: modifie } = await modifier(user.id, item.service.id, { description: 'x' })

    const apres = (await ligneService(item.service.id))!
    expect(apres.description).toBe('x')
    expect(apres.updatedAt.getTime()).toBeGreaterThan(avant.updatedAt.getTime())
    expect({ ...apres, description: avant.description, updatedAt: avant.updatedAt }).toEqual(avant)
    expect(modifie.service).toEqual(apres)
  })

  it('CA16 should store an empty description as NULL', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { description: 'Une description' })

    await modifier(user.id, item.service.id, { description: '   ' })

    expect((await ligneService(item.service.id))?.description).toBeNull()
  })

  it('CA17 should refuse rendez-vous -> accompagnement without sessions (400 nbSeances) and leave the row untouched', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)
    const avant = (await ligneService(item.service.id))!

    const erreur = await rejet(modifier(user.id, item.service.id, { type: 'accompagnement' }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VALIDATION')
    expect(Object.keys(erreur.data?.champs as object)).toEqual(['nbSeances'])
    expect(await ligneService(item.service.id)).toEqual(avant)
  })

  it('CA17 should accept rendez-vous -> accompagnement when sessions are sent in the same request', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)

    const { item: modifie } = await modifier(user.id, item.service.id, { type: 'accompagnement', nbSeances: 6, rythme: 'mensuel' })

    expect(modifie.service).toMatchObject({ type: 'accompagnement', nbSeances: 6, rythme: 'mensuel', dureeMin: 30 })
  })

  it('CA17 should clear sessions and rhythm when an accompagnement becomes a rendez-vous', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { type: 'accompagnement', nbSeances: 6, rythme: 'hebdomadaire' })

    const { item: modifie } = await modifier(user.id, item.service.id, { type: 'rdv' })

    expect(modifie.service).toMatchObject({ type: 'rdv', nbSeances: null, rythme: null })
  })

  it('CA17 should refuse to turn a service with a duration into a devis while its tarif stays free (R3 on the merged state)', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)

    const erreur = await rejet(modifier(user.id, item.service.id, { type: 'devis' }))

    expect(erreur.code).toBe('VALIDATION')
    expect(Object.keys(erreur.data?.champs as object)).toEqual(['tarif'])
  })

  it('CA17 should accept a turn into a devis when the tarif devis is sent too, and keep the now optional duration', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)

    const { item: modifie } = await modifier(user.id, item.service.id, { type: 'devis', tarif: 'devis' })

    expect(modifie.service).toMatchObject({ type: 'devis', tarif: 'devis', dureeMin: 30 })
  })

  it('CA18 should clear price, currency, payment mode and instructions when a paid service becomes free', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { ...DONNEES_PAYANTES, paiementInstructions: 'Espèces' })
    expect(item.service.paiementInstructions).toBe('Espèces')

    const { item: modifie } = await modifier(user.id, item.service.id, { tarif: 'gratuit' })

    expect(modifie.service).toMatchObject({ tarif: 'gratuit', prixMontant: null, prixDevise: null, paiementMode: null, paiementInstructions: null })
  })

  it('CA18 should require a price when a free service becomes paid, then default the payment mode to sur_place', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)

    const erreur = await rejet(modifier(user.id, item.service.id, { tarif: 'payant' }))
    const { item: modifie } = await modifier(user.id, item.service.id, { tarif: 'payant', prixMontant: 2500, prixDevise: 'EUR' })

    expect(Object.keys(erreur.data?.champs as object).sort()).toEqual(['prixDevise', 'prixMontant'])
    expect(modifie.service).toMatchObject({ tarif: 'payant', prixMontant: 2500, prixDevise: 'EUR', paiementMode: 'sur_place' })
  })

  it('CA19 should refuse a fourth vedette on update (409) naming the three current ones, then accept it once one is withdrawn', async () => {
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    const s2 = await creer(user.id, { titre: 'S2' })
    const s3 = await creer(user.id, { titre: 'S3' })
    const s4 = await creer(user.id, { titre: 'S4', enVedette: false })
    expect(s4.item.service.enVedette).toBe(false)

    const erreur = await rejet(modifier(user.id, s4.item.service.id, { enVedette: true }))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VEDETTE_COMPLETE')
    expect(erreur.status).toBe(409)
    expect(erreur.data?.enVedette).toEqual([s1, s2, s3].map((s) => ({ id: s.item.service.id, titre: s.item.service.titre })))
    expect((await ligneService(s4.item.service.id))?.enVedette).toBe(false)

    await modifier(user.id, s2.item.service.id, { enVedette: false })
    const { item, compteurs } = await modifier(user.id, s4.item.service.id, { enVedette: true })

    expect(item.service.enVedette).toBe(true)
    expect(compteurs.enVedette).toBe(3)
  })

  it('CA20 should accept enVedette true on a service that is already a vedette when the three places are taken', async () => {
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    await creer(user.id, { titre: 'S2' })
    await creer(user.id, { titre: 'S3' })

    const { item, compteurs } = await modifier(user.id, s1.item.service.id, { enVedette: true })

    expect(item.service.enVedette).toBe(true)
    expect(compteurs.enVedette).toBe(3)
  })

  it('CA21 should withdraw the vedette of a masked service and update the counters', async () => {
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    await creer(user.id, { titre: 'S2' })
    const avant = (await modifier(user.id, s1.item.service.id, { titre: 'S1' })).compteurs
    expect(avant).toEqual({ total: 2, visibles: 2, enVedette: 2, vedetteMax: 3 })

    const { item, compteurs } = await modifier(user.id, s1.item.service.id, { actif: false })

    expect(item.service).toMatchObject({ actif: false, enVedette: false })
    expect(compteurs).toEqual({ total: 2, visibles: 1, enVedette: 1, vedetteMax: 3 })
  })

  it('CA21 should refuse actif false together with an explicit enVedette true (400 enVedette)', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)

    const erreur = await rejet(modifier(user.id, item.service.id, { actif: false, enVedette: true }))

    expect(erreur.code).toBe('VALIDATION')
    expect(Object.keys(erreur.data?.champs as object)).toEqual(['enVedette'])
    expect((await ligneService(item.service.id))?.actif).toBe(true)
  })

  it('CA21 should refuse to make a masked service a vedette (400 enVedette)', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id, { actif: false })

    const erreur = await rejet(modifier(user.id, item.service.id, { enVedette: true }))

    expect(erreur.code).toBe('VALIDATION')
    expect(Object.keys(erreur.data?.champs as object)).toEqual(['enVedette'])
  })

  it('CA21 should not give back the vedette place when a masked service is shown again without enVedette', async () => {
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)
    await modifier(user.id, item.service.id, { actif: false })

    const { item: reaffiche } = await modifier(user.id, item.service.id, { actif: true })

    expect(reaffiche.service).toMatchObject({ actif: true, enVedette: false })
  })

  it('CA21 should refuse to show a masked service again as a vedette when the three places are taken', async () => {
    const { user } = await utilisateurAvecVitrine()
    const masque = await creer(user.id, { titre: 'Masqué', actif: false })
    for (const titre of ['S1', 'S2', 'S3']) {
      await creer(user.id, { titre })
    }

    const erreur = await rejet(modifier(user.id, masque.item.service.id, { actif: true, enVedette: true }))

    expect(erreur.code).toBe('VEDETTE_COMPLETE')
  })

  describe('CA22 concurrence', () => {
    it('CA22 should let exactly one of two simultaneous vedette updates win (the other gets VEDETTE_COMPLETE) and keep three vedettes', async () => {
      const TOURS = 4

      for (let tour = 0; tour < TOURS; tour += 1) {
        const { user, vitrine } = await utilisateurAvecVitrine(`course-vedette-${tour}`)
        await creer(user.id, { titre: 'S1' })
        await creer(user.id, { titre: 'S2' })
        const s3 = await creer(user.id, { titre: 'S3', enVedette: false })
        const s4 = await creer(user.id, { titre: 'S4', enVedette: false })

        const resultats = await Promise.allSettled([
          modifier(user.id, s3.item.service.id, { enVedette: true }),
          modifier(user.id, s4.item.service.id, { enVedette: true }),
        ])
        exigerModulesPresents(resultats)

        expect(resultats.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        const echec = resultats.find((r): r is PromiseRejectedResult => r.status === 'rejected')
        const erreur = await rejet(Promise.reject(echec?.reason))
        expect(erreur.estDomainError).toBe(true)
        expect(erreur.code).toBe('VEDETTE_COMPLETE')
        const lignes = await lignesDeLaVitrine(vitrine.id)
        expect(lignes.filter((l) => l.enVedette)).toHaveLength(VEDETTE_MAX)
      }
    })

    it('CA22 should never exceed three vedettes when four services are created at the same time', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()

      const resultats = await Promise.allSettled(['S1', 'S2', 'S3', 'S4'].map((titre) => creer(user.id, { titre })))
      exigerModulesPresents(resultats)

      expect(resultats.every((r) => r.status === 'fulfilled')).toBe(true)
      const lignes = await lignesDeLaVitrine(vitrine.id)
      expect(lignes).toHaveLength(4)
      expect(lignes.filter((l) => l.enVedette)).toHaveLength(VEDETTE_MAX)
      expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2, 3])
    })

    it('CA22 should give distinct slugs (bilan, bilan-2) and distinct orders to two simultaneous creations of the same title', async () => {
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
  })

  describe('CA23 image remplacée ou retirée', () => {
    it('CA23 should delete the old image row and its three files when the image is replaced', async () => {
      const { user } = await utilisateurAvecVitrine()
      const ancienne = await uploaderImage(user.id)
      const nouvelle = await uploaderImage(user.id)
      const { item } = await creer(user.id, { imageMediaId: ancienne })
      expect(await fichiersDuMedia(ancienne)).toHaveLength(3)

      await modifier(user.id, item.service.id, { imageMediaId: nouvelle })

      expect(await db.select().from(medias).where(eq(medias.id, ancienne))).toHaveLength(0)
      expect(await fichiersDuMedia(ancienne)).toHaveLength(0)
      expect(await db.select().from(medias).where(eq(medias.id, nouvelle))).toHaveLength(1)
      expect(await fichiersDuMedia(nouvelle)).toHaveLength(3)
      expect((await ligneService(item.service.id))?.imageMediaId).toBe(nouvelle)
    })

    it('CA23 should keep the old image when it is also the photo of the vitrine', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const ancienne = await uploaderImage(user.id)
      const nouvelle = await uploaderImage(user.id)
      await db.update(vitrines).set({ photoMediaId: ancienne }).where(eq(vitrines.id, vitrine.id))
      const { item } = await creer(user.id, { imageMediaId: ancienne })

      await modifier(user.id, item.service.id, { imageMediaId: nouvelle })

      expect(await db.select().from(medias).where(eq(medias.id, ancienne))).toHaveLength(1)
      expect(await fichiersDuMedia(ancienne)).toHaveLength(3)
    })

    it('CA23 should keep the old image when another service still uses it', async () => {
      const { user, vitrine } = await utilisateurAvecVitrine()
      const ancienne = await uploaderImage(user.id)
      const nouvelle = await uploaderImage(user.id)
      const { item } = await creer(user.id, { imageMediaId: ancienne })
      await insertService(vitrine.id, { imageMediaId: ancienne })

      await modifier(user.id, item.service.id, { imageMediaId: nouvelle })

      expect(await db.select().from(medias).where(eq(medias.id, ancienne))).toHaveLength(1)
    })

    it('CA23 should keep the image when the same imageMediaId is sent again', async () => {
      const { user } = await utilisateurAvecVitrine()
      const image = await uploaderImage(user.id)
      const { item } = await creer(user.id, { imageMediaId: image })

      await modifier(user.id, item.service.id, { imageMediaId: image, description: 'Mise à jour' })

      expect(await db.select().from(medias).where(eq(medias.id, image))).toHaveLength(1)
      expect(await fichiersDuMedia(image)).toHaveLength(3)
    })

    it('CA23 should remove then delete the image when imageMediaId is set to null', async () => {
      const { user } = await utilisateurAvecVitrine()
      const image = await uploaderImage(user.id)
      const { item } = await creer(user.id, { imageMediaId: image })

      const { item: modifie } = await modifier(user.id, item.service.id, { imageMediaId: null })

      expect(modifie.service.imageMediaId).toBeNull()
      expect(modifie.image).toBeNull()
      expect(await db.select().from(medias).where(eq(medias.id, image))).toHaveLength(0)
      expect(await fichiersDuMedia(image)).toHaveLength(0)
    })

    it('CA23 should reject an image of another user on update (422 MEDIA_INVALIDE) and keep the current one', async () => {
      const { user } = await utilisateurAvecVitrine()
      const autre = await createUser()
      const mediaDeB = await insertMediaRow(autre.id)
      const image = await uploaderImage(user.id)
      const { item } = await creer(user.id, { imageMediaId: image })

      const erreur = await rejet(modifier(user.id, item.service.id, { imageMediaId: mediaDeB.id }))

      expect(erreur.code).toBe('MEDIA_INVALIDE')
      expect((await ligneService(item.service.id))?.imageMediaId).toBe(image)
      expect(await fichiersDuMedia(image)).toHaveLength(3)
    })
  })

  describe('CA24 isolation entre utilisateurs (404, jamais 403)', () => {
    async function deuxVitrinesAvecUnService() {
      const a = await utilisateurAvecVitrine('vitrine-a')
      const b = await utilisateurAvecVitrine('vitrine-b')
      const { item } = await creer(a.user.id, { titre: 'Service de A' })
      return { a, b, serviceDeA: item.service }
    }

    it('CA24 should answer SERVICE_INTROUVABLE when B reads a service of A', async () => {
      const { getOwnService } = await servicesService()
      const { b, serviceDeA } = await deuxVitrinesAvecUnService()

      const erreur = await rejet(getOwnService(b.user.id, serviceDeA.id))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('SERVICE_INTROUVABLE')
      expect(erreur.status).toBe(404)
    })

    it('CA24 should answer SERVICE_INTROUVABLE when B updates a service of A, which stays intact', async () => {
      const { b, serviceDeA } = await deuxVitrinesAvecUnService()

      const erreur = await rejet(modifier(b.user.id, serviceDeA.id, { titre: 'Piraté', actif: false }))

      expect(erreur.code).toBe('SERVICE_INTROUVABLE')
      expect(await ligneService(serviceDeA.id)).toEqual(serviceDeA)
    })

    it('CA24 should answer SERVICE_INTROUVABLE when B deletes a service of A, which stays intact', async () => {
      const { deleteService } = await servicesService()
      const { b, serviceDeA } = await deuxVitrinesAvecUnService()

      const erreur = await rejet(deleteService(b.user.id, serviceDeA.id))

      expect(erreur.code).toBe('SERVICE_INTROUVABLE')
      expect(await ligneService(serviceDeA.id)).toEqual(serviceDeA)
    })

    it('CA24 should answer VITRINE_INTROUVABLE (not SERVICE_INTROUVABLE) to a user without vitrine', async () => {
      const { getOwnService } = await servicesService()
      const { serviceDeA } = await deuxVitrinesAvecUnService()
      const sansVitrine = await createUser()

      const erreur = await rejet(getOwnService(sansVitrine.id, serviceDeA.id))

      expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    })

    it('CA24 should not list the services of another user', async () => {
      const { listOwnServices } = await servicesService()
      const { b } = await deuxVitrinesAvecUnService()

      const { items, compteurs } = await listOwnServices(b.user.id)

      expect(items).toEqual([])
      expect(compteurs).toEqual({ total: 0, visibles: 0, enVedette: 0, vedetteMax: 3 })
    })
  })

  it('CA24 should read an own service with its image and counters', async () => {
    const { getOwnService } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const imageId = await uploaderImage(user.id)
    const { item } = await creer(user.id, { imageMediaId: imageId })

    const lu = await getOwnService(user.id, item.service.id)

    expect(lu.item.service).toEqual(item.service)
    expect(lu.item.image?.id).toBe(imageId)
    expect(lu.compteurs).toEqual({ total: 1, visibles: 1, enVedette: 1, vedetteMax: 3 })
  })
})

describe('services — suppression, ordre et liste (CA26 à CA30)', () => {
  it('CA26 should delete the service and its image when nothing else references it', async () => {
    const { deleteService } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const image = await uploaderImage(user.id)
    const { item } = await creer(user.id, { imageMediaId: image })

    await deleteService(user.id, item.service.id)

    expect(await lignesDeLaVitrine(vitrine.id)).toHaveLength(0)
    expect(await db.select().from(medias).where(eq(medias.id, image))).toHaveLength(0)
    expect(await fichiersDuMedia(image)).toHaveLength(0)
  })

  it('CA26 should keep the image of a deleted service when it is the photo of the vitrine', async () => {
    const { deleteService } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const image = await uploaderImage(user.id)
    await db.update(vitrines).set({ photoMediaId: image }).where(eq(vitrines.id, vitrine.id))
    const { item } = await creer(user.id, { imageMediaId: image })

    await deleteService(user.id, item.service.id)

    expect(await db.select().from(medias).where(eq(medias.id, image))).toHaveLength(1)
    expect(await fichiersDuMedia(image)).toHaveLength(3)
  })

  it('CA26 should free the vedette place of a deleted vedette: the next creation becomes a vedette automatically', async () => {
    const { deleteService } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    for (const titre of ['S2', 'S3']) {
      await creer(user.id, { titre })
    }
    expect((await creer(user.id, { titre: 'S4' })).item.service.enVedette).toBe(false)

    await deleteService(user.id, s1.item.service.id)
    const { item, compteurs } = await creer(user.id, { titre: 'S5' })

    expect(item.service.enVedette).toBe(true)
    expect(compteurs).toEqual({ total: 4, visibles: 4, enVedette: 3, vedetteMax: 3 })
  })

  it('CA27 should answer SERVICE_INTROUVABLE when the deleted uuid is unknown', async () => {
    const { deleteService } = await servicesService()
    const { user } = await utilisateurAvecVitrine()

    const erreur = await rejet(deleteService(user.id, randomUUID()))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('SERVICE_INTROUVABLE')
    expect(erreur.status).toBe(404)
  })

  it('CA27 should answer SERVICE_INTROUVABLE when the service was already deleted (double click)', async () => {
    const { deleteService } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const { item } = await creer(user.id)
    await deleteService(user.id, item.service.id)

    const erreur = await rejet(deleteService(user.id, item.service.id))

    expect(erreur.code).toBe('SERVICE_INTROUVABLE')
  })

  it('CA28 should apply the new order: [S3, S1, S2] gives orders 0, 1, 2 to S3, S1, S2 in the studio list', async () => {
    const { reorderServices, listOwnServices } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    const s2 = await creer(user.id, { titre: 'S2' })
    const s3 = await creer(user.id, { titre: 'S3' })

    const { items } = await reorderServices(user.id, [s3, s1, s2].map((s) => s.item.service.id))

    expect(items.map((i) => i.service.titre)).toEqual(['S3', 'S1', 'S2'])
    const lignes = await lignesDeLaVitrine(vitrine.id)
    expect(lignes.map((l) => [l.titre, l.ordre])).toEqual([['S3', 0], ['S1', 1], ['S2', 2]])
    expect((await listOwnServices(user.id)).items.map((i) => i.service.titre)).toEqual(['S3', 'S1', 'S2'])
  })

  it('CA28 should make the public list follow the new order', async () => {
    const { reorderServices, getPublicServices } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    const s2 = await creer(user.id, { titre: 'S2' })
    const s3 = await creer(user.id, { titre: 'S3' })

    await reorderServices(user.id, [s3, s2, s1].map((s) => s.item.service.id))

    const publics = await getPublicServices('dr-test')
    expect(publics.services.map((i) => i.service.titre)).toEqual(['S3', 'S2', 'S1'])
    expect(publics.aLaUne.map((i) => i.service.titre)).toEqual(['S3', 'S2', 'S1'])
  })

  it('CA28 should reorder masked services too (the list contains every service of the vitrine)', async () => {
    const { reorderServices } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    const masque = await creer(user.id, { titre: 'Masqué', actif: false })

    await reorderServices(user.id, [masque, s1].map((s) => s.item.service.id))

    expect(await titresDeLaVitrine(vitrine.id)).toEqual(['Masqué', 'S1'])
  })

  describe('CA29 ordre invalide (422 ORDRE_INVALIDE, ordres inchangés)', () => {
    async function troisServices() {
      const a = await utilisateurAvecVitrine('vitrine-a')
      const b = await utilisateurAvecVitrine('vitrine-b')
      const ids: string[] = []
      for (const titre of ['S1', 'S2', 'S3']) {
        ids.push((await creer(a.user.id, { titre })).item.service.id)
      }
      const serviceDeB = (await creer(b.user.id, { titre: 'Service de B' })).item.service.id
      return { a, b, ids, serviceDeB }
    }

    async function ordresDe(vitrineId: string) {
      return (await lignesDeLaVitrine(vitrineId)).map((l) => [l.titre, l.ordre])
    }

    it.each([
      ['une liste incomplète', ({ ids }: Awaited<ReturnType<typeof troisServices>>) => [ids[2], ids[0]]],
      ['un doublon', ({ ids }: Awaited<ReturnType<typeof troisServices>>) => [ids[0], ids[0], ids[1], ids[2]]],
      ['l’identifiant d’un service d’un autre utilisateur à la place d’un des siens', ({ ids, serviceDeB }: Awaited<ReturnType<typeof troisServices>>) => [ids[0], ids[1], serviceDeB]],
      ['l’identifiant d’un service d’un autre utilisateur en plus', ({ ids, serviceDeB }: Awaited<ReturnType<typeof troisServices>>) => [...ids, serviceDeB]],
      ['un identifiant inconnu en plus', ({ ids }: Awaited<ReturnType<typeof troisServices>>) => [...ids, randomUUID()]],
    ])('CA29 should refuse %s', async (_libelle, fabriquer) => {
      const { reorderServices } = await servicesService()
      const contexte = await troisServices()
      const avant = await ordresDe(contexte.a.vitrine.id)

      const erreur = await rejet(reorderServices(contexte.a.user.id, fabriquer(contexte)))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('ORDRE_INVALIDE')
      expect(erreur.status).toBe(422)
      expect(await ordresDe(contexte.a.vitrine.id)).toEqual(avant)
      expect((await ordresDe(contexte.b.vitrine.id))).toEqual([['Service de B', 0]])
    })

    it('CA29 should answer VITRINE_INTROUVABLE to a user without vitrine', async () => {
      const { reorderServices } = await servicesService()
      const sansVitrine = await createUser()

      const erreur = await rejet(reorderServices(sansVitrine.id, [randomUUID()]))

      expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    })
  })

  it('CA29 should keep consistent orders when two reorderings run at the same time (one complete permutation wins)', async () => {
    const { reorderServices } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const ids = []
    for (const titre of ['S1', 'S2', 'S3']) {
      ids.push((await creer(user.id, { titre })).item.service.id)
    }

    const resultats = await Promise.allSettled([
      reorderServices(user.id, [ids[2], ids[1], ids[0]]),
      reorderServices(user.id, [ids[1], ids[2], ids[0]]),
    ])
    exigerModulesPresents(resultats)

    expect(resultats.every((r) => r.status === 'fulfilled')).toBe(true)
    const lignes = await lignesDeLaVitrine(vitrine.id)
    expect(lignes.map((l) => l.ordre)).toEqual([0, 1, 2])
    expect(['S3,S2,S1', 'S2,S3,S1']).toContain(lignes.map((l) => l.titre).join(','))
  })

  it('CA30 should list the six services in order with the counters 6 / 5 / 3 / 3, masked ones included', async () => {
    const { listOwnServices } = await servicesService()
    const { toServicesCompteursResource } = await ressourceService()
    const { user } = await utilisateurAvecVitrine()
    for (const titre of ['S1', 'S2', 'S3', 'S4', 'S5']) {
      await creer(user.id, { titre })
    }
    await creer(user.id, { titre: 'S6', actif: false })

    const { items, compteurs } = await listOwnServices(user.id)

    expect(items.map((i) => i.service.titre)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
    expect(items.map((i) => i.service.ordre)).toEqual([0, 1, 2, 3, 4, 5])
    expect(toServicesCompteursResource(compteurs)).toEqual({ total: 6, visibles: 5, enVedette: 3, vedetteMax: 3 })
  })

  it('CA30 should sort by order, then creation date, then id', async () => {
    const { listOwnServices } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const t = (heure: number) => new Date(Date.UTC(2026, 0, 1, heure))
    await insertService(vitrine.id, { titre: 'Z (ordre 1)', ordre: 1, createdAt: t(1) })
    await insertService(vitrine.id, { titre: 'B (ordre 0, 11h)', ordre: 0, createdAt: t(11) })
    await insertService(vitrine.id, { titre: 'A (ordre 0, 10h)', ordre: 0, createdAt: t(10) })
    await insertService(vitrine.id, { id: '00000000-0000-4000-8000-000000000002', titre: 'D (ordre 0, 12h, id 2)', ordre: 0, createdAt: t(12) })
    await insertService(vitrine.id, { id: '00000000-0000-4000-8000-000000000001', titre: 'C (ordre 0, 12h, id 1)', ordre: 0, createdAt: t(12) })

    const { items } = await listOwnServices(user.id)

    expect(items.map((i) => i.service.titre)).toEqual([
      'A (ordre 0, 10h)',
      'B (ordre 0, 11h)',
      'C (ordre 0, 12h, id 1)',
      'D (ordre 0, 12h, id 2)',
      'Z (ordre 1)',
    ])
  })

  it('CA30 should answer an empty list with zero counters for a vitrine without service, and VITRINE_INTROUVABLE without vitrine', async () => {
    const { listOwnServices } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const sansVitrine = await createUser()

    const vide = await listOwnServices(user.id)
    const erreur = await rejet(listOwnServices(sansVitrine.id))

    expect(vide.items).toEqual([])
    expect(vide.compteurs).toEqual({ total: 0, visibles: 0, enVedette: 0, vedetteMax: 3 })
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA30 should join the image of each service in the list (no extra query needed by the caller)', async () => {
    const { listOwnServices } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const image = await uploaderImage(user.id)
    await creer(user.id, { titre: 'Avec image', imageMediaId: image })
    await creer(user.id, { titre: 'Sans image' })

    const { items } = await listOwnServices(user.id)

    expect(items.map((i) => i.image?.id ?? null)).toEqual([image, null])
  })
})

describe('services — lecture publique (CA31 à CA37)', () => {
  /** Cinq services visibles (S2 et S4 en vedette) et un masqué, insérés directement. */
  async function vitrineAvecSixServices() {
    const { user, vitrine } = await utilisateurAvecVitrine()
    await insertService(vitrine.id, { titre: 'S1', slug: 's1', ordre: 0 })
    await insertService(vitrine.id, { titre: 'S2', slug: 's2', ordre: 1, enVedette: true })
    await insertService(vitrine.id, { titre: 'S3', slug: 's3', ordre: 2 })
    await insertService(vitrine.id, { titre: 'S4', slug: 's4', ordre: 3, enVedette: true })
    await insertService(vitrine.id, { titre: 'S5', slug: 's5', ordre: 4 })
    await insertService(vitrine.id, { titre: 'Masqué', slug: 'masque', ordre: 5, actif: false })
    return { user, vitrine }
  }

  it('CA31 should list the visible services in order, count them, and put the vedettes in aLaUne; the masked one is absent everywhere', async () => {
    const { getPublicServices } = await servicesService()
    await vitrineAvecSixServices()

    const publics = await getPublicServices('dr-test')

    expect(publics.total).toBe(5)
    expect(publics.services.map((i) => i.service.titre)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5'])
    expect(publics.aLaUne.map((i) => i.service.titre)).toEqual(['S2', 'S4'])
    expect(JSON.stringify(publics)).not.toContain('Masqué')
  })

  it('CA31 should normalise the username (DR-TEST finds dr-test)', async () => {
    const { getPublicServices } = await servicesService()
    await vitrineAvecSixServices()

    const publics = await getPublicServices(' DR-TEST ')

    expect(publics.total).toBe(5)
  })

  it('CA31 should join the images of the public services', async () => {
    const { getPublicServices } = await servicesService()
    const { user, vitrine } = await utilisateurAvecVitrine()
    const image = await uploaderImage(user.id)
    await insertService(vitrine.id, { titre: 'Avec image', slug: 'avec-image', imageMediaId: image })

    const publics = await getPublicServices('dr-test')

    expect(publics.services[0].image?.id).toBe(image)
  })

  it('CA32 should fall back to the first three visible services by order when no service is a vedette', async () => {
    const { getPublicServices } = await servicesService()
    const { vitrine } = await utilisateurAvecVitrine()
    for (const [ordre, titre] of ['S1', 'S2', 'S3', 'S4', 'S5'].entries()) {
      await insertService(vitrine.id, { titre, slug: titre.toLowerCase(), ordre })
    }

    const publics = await getPublicServices('dr-test')

    expect(publics.aLaUne.map((i) => i.service.titre)).toEqual(['S1', 'S2', 'S3'])
    expect(publics.services).toHaveLength(5)
  })

  it('CA32 should never put a masked service in the fallback of aLaUne', async () => {
    const { getPublicServices } = await servicesService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertService(vitrine.id, { titre: 'Masqué', slug: 'masque', ordre: 0, actif: false })
    await insertService(vitrine.id, { titre: 'Visible', slug: 'visible', ordre: 1 })

    const publics = await getPublicServices('dr-test')

    expect(publics.aLaUne.map((i) => i.service.titre)).toEqual(['Visible'])
  })

  it('CA33 should answer total 0 and empty lists for a published vitrine without visible service', async () => {
    const { getPublicServices } = await servicesService()
    const { vitrine } = await utilisateurAvecVitrine()

    const vide = await getPublicServices('dr-test')
    await insertService(vitrine.id, { titre: 'Masqué', slug: 'masque', actif: false })
    const seulementMasque = await getPublicServices('dr-test')

    for (const publics of [vide, seulementMasque]) {
      expect(publics.total).toBe(0)
      expect(publics.services).toEqual([])
      expect(publics.aLaUne).toEqual([])
    }
  })

  it('CA34 should answer VITRINE_INTROUVABLE for an unpublished vitrine, an unknown username and an invalid one', async () => {
    const { getPublicServices, getPublicService } = await servicesService()
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { username: 'brouillon', publiee: false })
    await insertService(vitrine.id, { titre: 'Visible mais non publié', slug: 'visible' })

    for (const username of ['brouillon', 'inconnu', 'Bad_Name', '', "x'; DROP TABLE services;--"]) {
      const liste = await rejet(getPublicServices(username))
      const detail = await rejet(getPublicService(username, 'visible'))

      expect(liste.estDomainError).toBe(true)
      expect(liste.code).toBe('VITRINE_INTROUVABLE')
      expect(liste.status).toBe(404)
      expect(detail.code).toBe('VITRINE_INTROUVABLE')
    }
    expect(await db.select().from(services)).toHaveLength(1)
  })

  it('CA34 should stop exposing the services as soon as the vitrine is unpublished', async () => {
    const { getPublicServices } = await servicesService()
    const { vitrine } = await vitrineAvecSixServices()
    await expect(getPublicServices('dr-test')).resolves.toBeDefined()

    await db.update(vitrines).set({ publieeLe: null }).where(eq(vitrines.id, vitrine.id))

    expect((await rejet(getPublicServices('dr-test'))).code).toBe('VITRINE_INTROUVABLE')
  })

  it('CA35 should return the service, at most two other visible services in order (without the current one) and the total', async () => {
    const { getPublicService } = await servicesService()
    await vitrineAvecSixServices()

    const detailS3 = await getPublicService('dr-test', 's3')
    const detailS1 = await getPublicService('dr-test', 's1')
    const detailS5 = await getPublicService('dr-test', 's5')

    expect(detailS3.item.service.titre).toBe('S3')
    expect(detailS3.autres.map((i) => i.service.titre)).toEqual(['S1', 'S2'])
    expect(detailS3.total).toBe(5)
    expect(detailS1.autres.map((i) => i.service.titre)).toEqual(['S2', 'S3'])
    expect(detailS5.autres.map((i) => i.service.titre)).toEqual(['S1', 'S2'])
  })

  it('CA35 should return an empty "autres" list when the service is the only visible one', async () => {
    const { getPublicService } = await servicesService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertService(vitrine.id, { titre: 'Seul', slug: 'seul' })

    const detail = await getPublicService('dr-test', 'seul')

    expect(detail.autres).toEqual([])
    expect(detail.total).toBe(1)
  })

  it('CA35 should answer SERVICE_INTROUVABLE for a masked slug, an unknown slug and a malformed one', async () => {
    const { getPublicService } = await servicesService()
    await vitrineAvecSixServices()

    for (const slug of ['masque', 'inconnu', 'bad_slug!', '', 'a'.repeat(300), "x'; DROP TABLE services;--"]) {
      const erreur = await rejet(getPublicService('dr-test', slug))

      expect(erreur.estDomainError).toBe(true)
      expect(erreur.code).toBe('SERVICE_INTROUVABLE')
      expect(erreur.status).toBe(404)
    }
  })

  it('CA35 should answer SERVICE_INTROUVABLE for the slug of another vitrine', async () => {
    const { getPublicService } = await servicesService()
    await vitrineAvecSixServices()
    const autre = await utilisateurAvecVitrine('autre-vitrine')
    await insertService(autre.vitrine.id, { titre: 'Chez les autres', slug: 'chez-les-autres' })

    const erreur = await rejet(getPublicService('dr-test', 'chez-les-autres'))

    expect(erreur.code).toBe('SERVICE_INTROUVABLE')
  })

  it('CA35 should find a service whatever the case of the slug (CONSULTATION-DE-CARDIOLOGIE)', async () => {
    const { getPublicService } = await servicesService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertService(vitrine.id, { titre: 'Consultation de cardiologie', slug: 'consultation-de-cardiologie' })

    const detail = await getPublicService('dr-test', 'CONSULTATION-DE-CARDIOLOGIE')

    expect(detail.item.service.slug).toBe('consultation-de-cardiologie')
  })

  describe('CA36 liste blanche des DTO publics', () => {
    const CLES_CARTE = [
      'description', 'dureeMin', 'image', 'nbSeances', 'prixDevise', 'prixMontant', 'reservable',
      'rythme', 'slug', 'tarif', 'titre', 'type',
    ]
    const CLES_DETAIL = [...CLES_CARTE, 'inclus', 'paiementInstructions', 'paiementMode', 'seo'].sort()
    const DESCRIPTION_LONGUE = Array.from({ length: 60 }, (_, i) => `mot${i}`).join(' ')

    async function detailPublic(surcharges: Partial<typeof services.$inferInsert> = {}, options = HORS_LIGNE) {
      const { getPublicService } = await servicesService()
      const { toServicePublicDetailResource } = await ressourceService()
      const { user, vitrine } = await utilisateurAvecVitrine()
      const image = await uploaderImage(user.id)
      const ligne = await insertServiceComplet(vitrine.id, { slug: 'consultation-de-cardiologie', imageMediaId: image, ...surcharges })
      const lu = await getPublicService('dr-test', 'consultation-de-cardiologie')
      return {
        ligne,
        vitrine,
        image,
        user,
        dto: toServicePublicDetailResource(lu.item.service, lu.item.image, lu.vitrine, options),
      }
    }

    it('CA36 should expose exactly the keys of ServicePublicCarteDTO on the cards (list, aLaUne, autres)', async () => {
      const { getPublicServices, getPublicService } = await servicesService()
      const { toServicePublicCarteResource } = await ressourceService()
      await vitrineAvecSixServices()

      const liste = await getPublicServices('dr-test')
      const detail = await getPublicService('dr-test', 's1')

      const cartes = [...liste.services, ...liste.aLaUne, ...detail.autres].map((i) => toServicePublicCarteResource(i.service, i.image))
      expect(cartes.length).toBeGreaterThan(0)
      for (const carte of cartes) {
        expect(Object.keys(carte).sort()).toEqual(CLES_CARTE)
      }
    })

    it('CA36 should expose exactly the keys of ServicePublicDetailDTO on the detail', async () => {
      const { dto } = await detailPublic()

      expect(Object.keys(dto).sort()).toEqual(CLES_DETAIL)
      expect(Object.keys(dto.seo).sort()).toEqual(['description', 'titre'])
    })

    it('CA36 should never leak an identifier, the owner, the order, the vedette flag, the dates or a storage path', async () => {
      const { dto, ligne, vitrine, user, image } = await detailPublic({ enVedette: true })

      const json = JSON.stringify(dto)

      for (const secret of [ligne.id, vitrine.id, user.id, `${user.id}/${image}`, '"ordre"', '"actif"', '"enVedette"', '"vitrineId"', '"creeLe"', '"modifieLe"', '"createdAt"', '"chemin"', '"imageMediaId"']) {
        expect(json).not.toContain(secret)
      }
    })

    it('CA36 should expose the image of the service as MediaDTO keys with the 1600 url', async () => {
      const { dto, image } = await detailPublic()

      expect(Object.keys(dto.image ?? {}).sort()).toEqual(['hauteur', 'id', 'largeur', 'srcset', 'url'])
      expect(dto.image?.url).toBe(`/medias/${image}/1600.webp`)
    })

    it('CA36 should force sur_place when the flag is false even if the database says au_choix', async () => {
      const { dto } = await detailPublic({ paiementMode: 'au_choix' }, HORS_LIGNE)

      expect(dto.paiementMode).toBe('sur_place')
    })

    it('CA36 should compose the SEO title as "<titre> — <nomAffiche>"', async () => {
      const { dto } = await detailPublic()

      expect(dto.seo.titre).toBe('Consultation de cardiologie — Dr Cabrel Nguesso')
    })

    it('CA36 should truncate a 300-character description to at most 160 characters in seo.description', async () => {
      const { dto } = await detailPublic({ description: DESCRIPTION_LONGUE })

      expect(DESCRIPTION_LONGUE.length).toBeGreaterThan(160)
      expect(dto.seo.description.length).toBeLessThanOrEqual(160)
      expect(dto.seo.description.length).toBeGreaterThan(100)
    })

    it('CA36 should fall back to "<titre> avec <nomAffiche>, <metier> à <ville>." without description', async () => {
      const { dto } = await detailPublic({ description: null })

      expect(dto.seo.description).toBe('Consultation de cardiologie avec Dr Cabrel Nguesso, Cardiologue à Douala.')
    })

    it('CA36 should expose the inclus list and the payment instructions on the detail only', async () => {
      const { dto } = await detailPublic()

      expect(dto.inclus).toEqual(['Examen clinique', 'Électrocardiogramme', 'Compte rendu écrit'])
      expect(dto.paiementInstructions).toBe('Règlement en espèces ou par Mobile Money.')
    })
  })

  it('CA36 should keep the real payment mode in the public DTO when the flag is true', async () => {
    const { getPublicService } = await servicesService()
    const { toServicePublicDetailResource } = await ressourceService()
    const { vitrine } = await utilisateurAvecVitrine()
    await insertServiceComplet(vitrine.id, { slug: 'au-choix', paiementMode: 'au_choix' })
    const lu = await getPublicService('dr-test', 'au-choix')

    const horsLigne = toServicePublicDetailResource(lu.item.service, lu.item.image, lu.vitrine, HORS_LIGNE)
    const enLigne = toServicePublicDetailResource(lu.item.service, lu.item.image, lu.vitrine, EN_LIGNE)

    expect(horsLigne.paiementMode).toBe('sur_place')
    expect(enLigne.paiementMode).toBe('au_choix')
  })

  it('CA37 should remove a service from services and aLaUne once masked, and answer SERVICE_INTROUVABLE on its detail', async () => {
    const { getPublicServices, getPublicService } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })
    await creer(user.id, { titre: 'S2' })
    expect((await getPublicServices('dr-test')).aLaUne.map((i) => i.service.titre)).toEqual(['S1', 'S2'])
    await expect(getPublicService('dr-test', 's1')).resolves.toBeDefined()

    await modifier(user.id, s1.item.service.id, { actif: false })

    const publics = await getPublicServices('dr-test')
    expect(publics.services.map((i) => i.service.titre)).toEqual(['S2'])
    expect(publics.aLaUne.map((i) => i.service.titre)).toEqual(['S2'])
    expect(publics.total).toBe(1)
    expect((await rejet(getPublicService('dr-test', 's1'))).code).toBe('SERVICE_INTROUVABLE')
  })

  it('CA37 should make a deleted service disappear from the public lists and detail', async () => {
    const { getPublicServices, getPublicService, deleteService } = await servicesService()
    const { user } = await utilisateurAvecVitrine()
    const s1 = await creer(user.id, { titre: 'S1' })

    await deleteService(user.id, s1.item.service.id)

    expect((await getPublicServices('dr-test')).total).toBe(0)
    expect((await rejet(getPublicService('dr-test', 's1'))).code).toBe('SERVICE_INTROUVABLE')
  })
})
