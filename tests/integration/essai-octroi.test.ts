import { eq, sql } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { abonnements, services as tableServices, vitrines } from '../../shared/db/schema'
import { ESSAI_DEFAUT, ESSAI_EMPREINTE_FORMAT } from '../../shared/essai'
import { db } from '../../server/utils/db'
import { poserAbonnementOrigine } from './support/admin-a3'
import { preparerConfigurationA5 } from './support/admin-a5'
import {
  accorder, avecConfigurationIllisible, avecPanneSurEssais, compterAbonnements, creerCompteEmail, creerCompteTelephone, DEBUT_ESSAI, etatConsomme,
  FIN_ESSAI_V1, ID_VERSION_ESSAI_V1, jours, lireAbonnementDe, lireEssais, lireToutesLesEmpreintes, moduleEssai, moduleLectureConfiguration,
  plus, poserVersionEssai, poserVersionEssaiBrute, preparerCompteTerminable, supprimerCompte, terminerPour,
} from './support/essai'
import { insertService } from './support/fabriques'
import { espionnerJournaux } from './support/planification'
import { lireOutbox } from './support/notifications'
import { poserAbonnement } from './support/abonnements'
import { vitrinesService } from './support/modules'

// E1 : octroi de l'essai gratuit à la création de la vitrine. CA-E1-01 à 03, 06, 07, 09, 10, 12 (côté base), 13, 14, 15, 28 (services masqués,
// jamais supprimés). VRAIE base, VRAI Redis ; seule l'horloge est injectée. Les tests qui posent une autre version d'essai s'appuient sur
// `restaurerConfiguration()` (preparerConfigurationA5 : avant chaque test et après le dernier).

preparerConfigurationA5()

describe('terminer : un essai à la création de la vitrine (CA-E1-01, 02, 03)', () => {
  it('should create the subscription (essai, payant, +14 days), the essai row (v1) and the e-mail fingerprint, and answer the essai (CA-01)', async () => {
    const { user } = await preparerCompteTerminable({ email: 'Marie.Test@Exemple.test' })

    const resultat = await terminerPour(user.id)

    expect(resultat).toEqual({ creee: true, essai: { finLe: FIN_ESSAI_V1.toISOString(), dureeJours: 14 } })
    const abonnement = await lireAbonnementDe(user.id)
    expect(abonnement).toMatchObject({ plan: 'payant', origine: 'essai', dernierPaiementId: null })
    expect(abonnement?.expireLe.getTime()).toBe(FIN_ESSAI_V1.getTime())
    expect(abonnement?.premiereActivationLe.getTime()).toBe(DEBUT_ESSAI.getTime())
    const [essai] = await lireEssais(user.id)
    expect(essai).toMatchObject({ userId: user.id, dureeJours: 14, versionId: ID_VERSION_ESSAI_V1, convertiLe: null })
    expect(essai?.debutLe.getTime()).toBe(DEBUT_ESSAI.getTime())
    expect(essai?.finLe.getTime()).toBe(FIN_ESSAI_V1.getTime())
    const empreintes = await lireToutesLesEmpreintes()
    expect(empreintes).toHaveLength(1)
    expect(empreintes[0]).toMatchObject({ nature: 'email', essaiId: essai?.id })
    expect(empreintes[0]?.empreinte).toMatch(ESSAI_EMPREINTE_FORMAT)
    const { empreinteEssai } = await moduleEssai()
    expect(empreintes[0]?.empreinte).toBe(empreinteEssai('email', 'marie.test@exemple.test'))
  })

  it('should store no clear data in the fingerprint table (no address, no number)', async () => {
    const { user } = await preparerCompteTerminable({ email: 'secret.personne@exemple.test' })
    await terminerPour(user.id)

    expect(JSON.stringify(await lireToutesLesEmpreintes())).not.toMatch(/secret|personne|exemple/)
  })

  it('should insert ALL the proposed services even when the free plan only allows fewer, the essai being granted before the quota (CA-02)', async () => {
    // Une proposition compte 3 services au plus (CHECK de la base) : on abaisse donc le quota du plan gratuit à 2 (même méthode que S10 CA89).
    const avant = await limiteServicesGratuit()
    await fixerLimiteServicesGratuit(2)
    try {
      const { user } = await preparerCompteTerminable({}, 3)

      const resultat = await terminerPour(user.id)

      expect(resultat.essai).not.toBeNull()
      const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.userId, user.id))
      expect(await db.select().from(tableServices).where(eq(tableServices.vitrineId, vitrine!.id))).toHaveLength(3)
    } finally {
      // `restaurerConfiguration()` ne remet que les statuts : la valeur modifiée en place est rétablie ici.
      await fixerLimiteServicesGratuit(avant)
    }
  })

  it('should replay with essai: null, one essai row and one subscription (CA-03)', async () => {
    const { user } = await preparerCompteTerminable()
    await terminerPour(user.id)

    const rejeu = await terminerPour(user.id, 'un-autre-nom')

    expect(rejeu).toEqual({ creee: false, essai: null })
    expect(await lireEssais(user.id)).toHaveLength(1)
    expect(await compterAbonnements()).toBe(1)
    expect(await lireAbonnementDe(user.id)).toMatchObject({ origine: 'essai' })
  })

  it('should NOT grant a second essai when the vitrine is deleted then created again (the essai stays consumed)', async () => {
    const { user } = await preparerCompteTerminable()
    await terminerPour(user.id)
    await db.delete(vitrines).where(eq(vitrines.userId, user.id))
    const avant = await lireAbonnementDe(user.id)

    const { createVitrine } = await (await vitrinesService())
    const recree = await createVitrine(user.id, { titre: null, prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username: 'recree-apres-suppression' }, plus(DEBUT_ESSAI, jours(3)))

    expect(recree.essai).toBeNull()
    expect(await lireEssais(user.id)).toHaveLength(1)
    expect((await lireAbonnementDe(user.id))?.expireLe.getTime()).toBe(avant?.expireLe.getTime())
  })
})

describe('createVitrine : le même octroi (D1)', () => {
  it('should grant the essai in the same transaction as the vitrine and return it', async () => {
    const user = await creerCompteEmail()
    const { createVitrine } = await vitrinesService()

    const resultat = await createVitrine(user.id, { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username: 'dr-essai-direct' }, DEBUT_ESSAI)

    expect(resultat.essai).toEqual({ finLe: FIN_ESSAI_V1.toISOString(), dureeJours: 14 })
    expect(await lireAbonnementDe(user.id)).toMatchObject({ origine: 'essai', plan: 'payant' })
  })

  it('should roll the essai back with the vitrine when the address is taken (409), leaving nothing consumed', async () => {
    const a = await creerCompteEmail()
    const b = await creerCompteEmail()
    const { createVitrine } = await vitrinesService()
    const donnees = { titre: null, prenom: 'A', nom: 'B', metier: 'Avocat', username: 'adresse-prise-e1' }
    await createVitrine(a.id, donnees, DEBUT_ESSAI)
    const avant = await etatConsomme()

    await expect(createVitrine(b.id, donnees, DEBUT_ESSAI)).rejects.toMatchObject({ code: 'USERNAME_PRIS' })

    expect(await etatConsomme()).toEqual(avant)
    expect(await lireEssais(b.id)).toHaveLength(0)
  })
})

describe('un essai par personne (CA-E1-06, 07)', () => {
  it('should refuse a new account with the same address (case and spaces ignored) once the first account is deleted (CA-06)', async () => {
    const premier = await creerCompteEmail({ email: 'Jean.Dupont@Exemple.test' })
    expect((await accorder(premier.id)).accorde).toBe(true)
    await supprimerCompte(premier.id)
    const second = await creerCompteEmail({ email: '  jean.dupont@EXEMPLE.test ' })

    const resultat = await accorder(second.id, plus(DEBUT_ESSAI, jours(40)))

    expect(resultat).toEqual({ accorde: false, raison: 'deja_consomme' })
    expect(await lireAbonnementDe(second.id)).toBeUndefined()
    expect(await lireEssais(second.id)).toHaveLength(0)
    const [orpheline] = await (await import('./support/essai')).lireToutesLesEssais()
    expect(orpheline?.userId).toBeNull()
  })

  it('should refuse another account that verifies the number of a phone-only account that had its essai (CA-07), whatever the formatting', async () => {
    const premier = await creerCompteTelephone('+237 6 12 34 56 78')
    expect((await accorder(premier.id)).accorde).toBe(true)
    expect((await lireToutesLesEmpreintes()).map((e) => e.nature)).toEqual(['telephone'])
    const autre = await creerCompteEmail({ phoneNumber: '237612345678', phoneNumberVerified: true })

    expect(await accorder(autre.id)).toEqual({ accorde: false, raison: 'deja_consomme' })
    expect(await lireAbonnementDe(autre.id)).toBeUndefined()
    expect(await lireToutesLesEmpreintes()).toHaveLength(1)
  })

  it('should ignore an UNVERIFIED number: two accounts with the same unverified number each get their essai', async () => {
    const a = await creerCompteEmail({ phoneNumber: '+237611111111', phoneNumberVerified: false })
    const b = await creerCompteEmail({ phoneNumber: '+237611111111', phoneNumberVerified: false })

    expect((await accorder(a.id)).accorde).toBe(true)
    expect((await accorder(b.id)).accorde).toBe(true)
  })

  it('should refuse a phone-only account whose number is not verified (no key at all): aucune_cle, nothing written', async () => {
    const compte = await creerCompteTelephone('+237622222222', { verifie: false })

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'aucune_cle' })
    expect(await etatConsomme()).toEqual({ essais: 0, empreintes: 0, abonnements: 0 })
  })

  it('should not throw for an unknown user: aucune_cle', async () => {
    expect(await accorder('compte-inconnu')).toEqual({ accorde: false, raison: 'aucune_cle' })
  })

  it('should hold both keys (e-mail and verified number) for an account with an address and a verified number', async () => {
    const compte = await creerCompteEmail({ phoneNumber: '+237633333333', phoneNumberVerified: true })

    await accorder(compte.id)

    expect((await lireToutesLesEmpreintes()).map((e) => e.nature).sort()).toEqual(['email', 'telephone'])
  })
})

describe('configuration de l\'essai (CA-E1-09, 10, 13)', () => {
  it('should read in the seeded version 1 exactly the code defaults (CA-13)', async () => {
    const { lireConfigEssai } = await moduleLectureConfiguration()

    const config = await lireConfigEssai({ sansCache: true })

    expect(config).toMatchObject({ ...ESSAI_DEFAUT, versionId: ID_VERSION_ESSAI_V1 })
  })

  it('should grant nothing when the active version is switched off, and consume nothing (CA-09)', async () => {
    await poserVersionEssai({ ...ESSAI_DEFAUT, actif: false })
    const compte = await creerCompteEmail()

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'desactive' })
    expect(await etatConsomme()).toEqual({ essais: 0, empreintes: 0, abonnements: 0 })
    // Rien n'est consommé : la même personne reçoit son essai quand la version est réactivée.
    await poserVersionEssai({ ...ESSAI_DEFAUT })
    expect((await accorder(compte.id)).accorde).toBe(true)
  })

  it('should create the vitrine with essai: null when the version is switched off (terminer, CA-09)', async () => {
    await poserVersionEssai({ ...ESSAI_DEFAUT, actif: false })
    const { user } = await preparerCompteTerminable()

    const resultat = await terminerPour(user.id)

    expect(resultat).toMatchObject({ creee: true, essai: null })
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
  })

  it('should give a new essai of 30 days under a v2, while an essai granted under v1 keeps its end date (CA-10)', async () => {
    const a = await creerCompteEmail()
    const b = await creerCompteEmail()
    await accorder(a.id)
    const v2 = await poserVersionEssai({ actif: true, dureeJours: 30, relanceServicesJour: 3, relanceStatistiquesJour: 10 })

    const resultat = await accorder(b.id)

    expect(resultat).toEqual({ accorde: true, essai: { finLe: plus(DEBUT_ESSAI, jours(30)).toISOString(), dureeJours: 30 } })
    expect((await lireAbonnementDe(a.id))?.expireLe.getTime()).toBe(FIN_ESSAI_V1.getTime())
    expect((await lireEssais(a.id))[0]).toMatchObject({ dureeJours: 14, versionId: ID_VERSION_ESSAI_V1 })
    expect((await lireEssais(b.id))[0]).toMatchObject({ dureeJours: 30, versionId: v2 })
  })

  it('should fall back on the code defaults (versionId `code`) for an invalid active row, without throwing (CA-12)', async () => {
    const { lireConfigEssai } = await moduleLectureConfiguration()
    for (const brute of [
      { ...ESSAI_DEFAUT, dureeJours: 0 },
      { ...ESSAI_DEFAUT, relanceStatistiquesJour: 14 },
      { ...ESSAI_DEFAUT, inconnue: 1 },
      { actif: true },
    ]) {
      await poserVersionEssaiBrute(brute)

      expect(await lireConfigEssai({ sansCache: true }), JSON.stringify(brute)).toMatchObject({ ...ESSAI_DEFAUT, versionId: 'code' })
    }
  })

  it('should still grant 14 days under an invalid row (open fallback) and record versionId `code`', async () => {
    await poserVersionEssaiBrute({ ...ESSAI_DEFAUT, dureeJours: 0 })
    const compte = await creerCompteEmail()

    const resultat = await accorder(compte.id)

    expect(resultat).toMatchObject({ accorde: true, essai: { dureeJours: 14 } })
    expect((await lireEssais(compte.id))[0]?.versionId).toBe('code')
  })

  it('should fall back on the code defaults when the versions table is unreadable, and never throw (CA-12)', async () => {
    const journaux = espionnerJournaux()
    try {
      const { lireConfigEssai } = await moduleLectureConfiguration()

      const config = await avecConfigurationIllisible(() => lireConfigEssai({ sansCache: true }))

      expect(config).toMatchObject({ ...ESSAI_DEFAUT, versionId: 'code' })
    } finally {
      journaux.restaurer()
    }
  })
})

describe('inéligibilité (CA-E1-14) et ordre des contrôles (D6)', () => {
  it('should grant nothing to an account that already has an offered subscription, and leave its end date alone (CA-14)', async () => {
    const compte = await creerCompteEmail()
    const echeance = plus(DEBUT_ESSAI, jours(20))
    await poserAbonnementOrigine(compte.id, echeance, { origine: 'offert' })

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'abonnement_existant' })
    expect((await lireAbonnementDe(compte.id))?.expireLe.getTime()).toBe(echeance.getTime())
    expect(await etatConsomme()).toEqual({ essais: 0, empreintes: 0, abonnements: 1 })
  })

  it('should grant nothing to an account that once paid (an expired paid subscription is still a subscription)', async () => {
    const compte = await creerCompteEmail()
    await poserAbonnement(compte.id, plus(DEBUT_ESSAI, -jours(90)))

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'abonnement_existant' })
  })

  it('should answer `desactive` before `abonnement_existant` (the configuration is judged first)', async () => {
    const compte = await creerCompteEmail()
    await poserAbonnement(compte.id, plus(DEBUT_ESSAI, jours(5)))
    await poserVersionEssai({ ...ESSAI_DEFAUT, actif: false })

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'desactive' })
  })

  it('should answer `abonnement_existant` for an account whose own essai is running (second call)', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id)

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'abonnement_existant' })
    expect(await lireEssais(compte.id)).toHaveLength(1)
  })

  it('should answer `essai_existant` when the essai row stays but the subscription is gone (back to the free plan by the administration, D12)', async () => {
    const compte = await creerCompteEmail()
    await accorder(compte.id)
    await db.delete(abonnements).where(eq(abonnements.userId, compte.id))

    expect(await accorder(compte.id)).toEqual({ accorde: false, raison: 'essai_existant' })
    expect(await compterAbonnements()).toBe(0)
  })
})

describe('panne dans le savepoint (CA-E1-15)', () => {
  it('should answer `erreur` without throwing, write nothing of the essai, and leave the caller\'s transaction usable', async () => {
    const compte = await creerCompteEmail()
    const { accorderEssaiSiEligible } = await moduleEssai()
    const journaux = espionnerJournaux()
    try {
      await avecPanneSurEssais(async () => {
        await db.transaction(async (tx) => {
          const resultat = await accorderEssaiSiEligible(tx, compte.id, DEBUT_ESSAI)
          expect(resultat).toEqual({ accorde: false, raison: 'erreur' })
          // La transaction de l'appelant survit : une écriture après l'échec aboutit.
          await insertServiceDansTx(tx, compte.id)
        })
      })
      expect(journaux.contenu()).not.toContain(compte.email)
    } finally {
      journaux.restaurer()
    }

    expect(await etatConsomme()).toEqual({ essais: 0, empreintes: 0, abonnements: 0 })
    expect(await db.$count(vitrines, eq(vitrines.userId, compte.id))).toBe(1)
  })

  it('should create the vitrine and its services with essai: null when the essai breaks inside terminer', async () => {
    const { user } = await preparerCompteTerminable()
    const journaux = espionnerJournaux()
    let resultat
    try {
      resultat = await avecPanneSurEssais(() => terminerPour(user.id))
    } finally {
      journaux.restaurer()
    }

    expect(resultat).toMatchObject({ creee: true, essai: null })
    const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.userId, user.id))
    expect(vitrine?.publieeLe).toBeInstanceOf(Date)
    expect(await db.select().from(tableServices).where(eq(tableServices.vitrineId, vitrine!.id))).toHaveLength(3)
    expect(await lireAbonnementDe(user.id)).toBeUndefined()
  })
})

describe('après l\'essai : retour au plan gratuit sans grâce, contenu masqué jamais supprimé (CA-E1-28)', () => {
  it('should be free one second after the end, keep every service in the database, and keep the grace of a paid subscription', async () => {
    const { getPlanEffectif } = await import('../../server/services/plans')
    const essai = await creerCompteEmail()
    const paye = await creerCompteEmail()
    await accorder(essai.id)
    await poserAbonnement(paye.id, FIN_ESSAI_V1)
    const apres = plus(FIN_ESSAI_V1, 1000)

    expect((await getPlanEffectif(essai.id, new Date(FIN_ESSAI_V1.getTime() - 1))).plan).toBe('payant')
    expect((await getPlanEffectif(essai.id, FIN_ESSAI_V1)).plan).toBe('gratuit')
    expect((await getPlanEffectif(essai.id, apres)).plan).toBe('gratuit')
    expect(await getPlanEffectif(paye.id, apres)).toMatchObject({ plan: 'payant', etat: 'grace' })
  })

  it('should hide the services beyond the free quota publicly and never delete them', async () => {
    const { user } = await preparerCompteTerminable({}, 3)
    await terminerPour(user.id)
    const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.userId, user.id))
    for (let i = 0; i < 2; i += 1) await insertService(vitrine!.id)
    const { getPublicVitrinePage } = await vitrinesService()
    const pendant = await getPublicVitrinePage(vitrine!.username, plus(DEBUT_ESSAI, jours(5)))
    const apres = await getPublicVitrinePage(vitrine!.username, plus(FIN_ESSAI_V1, 1000))

    expect(pendant.contenus.services).toBe(5)
    expect(apres.contenus.services).toBe(3)
    expect(await db.select().from(tableServices).where(eq(tableServices.vitrineId, vitrine!.id))).toHaveLength(5)
  })
})

describe('journal sans donnée personnelle (D6)', () => {
  it('should never log an address, a number or a fingerprint while granting or refusing', async () => {
    const journaux = espionnerJournaux()
    try {
      const a = await creerCompteEmail({ email: 'journal.test@exemple.test', phoneNumber: '+237644444444', phoneNumberVerified: true })
      await accorder(a.id)
      const b = await creerCompteEmail({ email: 'autre.journal@exemple.test', phoneNumber: '+237644444444', phoneNumberVerified: true })
      await accorder(b.id)
      const texte = journaux.contenu()

      expect(texte).not.toMatch(/journal\.test|autre\.journal|644444444/)
      expect(texte).not.toMatch(/[0-9a-f]{64}/)
    } finally {
      journaux.restaurer()
    }
  })

  it('should list the relation `essais` empty after the cleanup of every test (TRUNCATE users CASCADE)', async () => {
    expect(await etatConsomme()).toEqual({ essais: 0, empreintes: 0, abonnements: 0 })
    expect(await lireOutbox()).toEqual([])
  })
})

async function insertServiceDansTx(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string): Promise<void> {
  const { randomUUID } = await import('node:crypto')
  await tx.insert(vitrines).values({ id: randomUUID(), userId, username: `panne-${randomUUID().slice(0, 8)}`, prenom: 'A', nom: 'B', metier: 'C' })
}

async function limiteServicesGratuit(): Promise<number> {
  const resultat = await db.execute<{ services: number }>(sql`SELECT (valeurs->>'services')::int AS services FROM configuration_versions WHERE categorie = 'plan' AND cle = 'gratuit' AND statut = 'active'`)
  return Number(resultat.rows[0]?.services)
}

async function fixerLimiteServicesGratuit(valeur: number): Promise<void> {
  await db.execute(sql`ALTER TABLE configuration_versions DISABLE TRIGGER configuration_versions_proteger`)
  try {
    await db.execute(sql`UPDATE configuration_versions SET valeurs = jsonb_set(valeurs, '{services}', to_jsonb(${valeur}::int)) WHERE categorie = 'plan' AND cle = 'gratuit' AND statut = 'active'`)
  } finally {
    await db.execute(sql`ALTER TABLE configuration_versions ENABLE TRIGGER configuration_versions_proteger`)
  }
  const { viderCacheConfiguration } = await moduleLectureConfiguration()
  viderCacheConfiguration()
}
