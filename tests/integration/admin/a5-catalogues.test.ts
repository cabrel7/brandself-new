import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { vitrines } from '../../../shared/db/schema'
import { JOBS } from '../../../shared/jobs'
import { schemaListeCatalogueDto, schemaNomBloqueReponse, schemaPaysReponse, schemaReferentielsDto } from '../../../shared/schemas/admin-catalogues'
import { db } from '../../../server/utils/db'
import { avecJournalEnPanne, compterJournal, demanderCodeTelephone, journalDe, ouvrirAdmin, preparerSuiteAdmin, tousLesJobs } from '../support/admin'
import {
  CHARGEURS_A5,
  appelerA5,
  cleIdempotenceUnique,
  codeReauthCatalogue,
  compterTable,
  lirePays,
  MOTIF_A5,
  preparerConfigurationA5,
} from '../support/admin-a5'
import type { AdminA5, RouteA5 } from '../support/admin-a5'
import { createUser, insertVitrineRow } from '../support/fabriques'
import { rejet } from '../support/erreurs'

// A5 CA01, CA02, CA13 (catalogues), CA15 (catalogues), CA16, CA17 : pays, devises, noms bloqués. Routes, services, base,
// Redis, file BullMQ et Better Auth RÉELS ; aucun mock du journal. `configuration_versions`, `pays`, `usernames_bloques`
// ne sont pas vidés par le nettoyage global : preparerConfigurationA5() les remet à l'état de la migration avant chaque test.

const suite = preparerSuiteAdmin()
preparerConfigurationA5()
let connecte: AdminA5

beforeEach(async () => {
  const { admin, cookie } = await ouvrirAdmin(suite.auth())
  connecte = { admin, cookie }
})

/** Toute écriture de catalogue est réauthentifiée (code lié à `<nom>:<id>`) ; `reauth: null` n'envoie aucun code. */
interface OptionsEcriture { reauth?: string | null, cle?: string }
const codePour = (action: 'catalogueCreer' | 'catalogueModifier' | 'catalogueSupprimer', cible: string, options: OptionsEcriture) =>
  options.reauth === null ? undefined : (options.reauth ?? codeReauthCatalogue(connecte.admin.id, action, cible))

async function modifierPays(code: string, corps: Record<string, unknown>, options: OptionsEcriture = {}) {
  const reauth = await codePour('catalogueModifier', `pays:${code}`, options)
  return appelerA5('catalogueModifier', connecte, { params: { nom: 'pays', id: code }, corps: { motif: MOTIF_A5, ...corps }, cleIdempotence: options.cle ?? cleIdempotenceUnique(), ...(reauth === undefined ? {} : { reauth }) })
}
async function supprimerPays(code: string, options: OptionsEcriture = {}) {
  const reauth = await codePour('catalogueSupprimer', `pays:${code}`, options)
  return appelerA5('catalogueSupprimer', connecte, { params: { nom: 'pays', id: code }, corps: { motif: MOTIF_A5 }, cleIdempotence: options.cle ?? cleIdempotenceUnique(), ...(reauth === undefined ? {} : { reauth }) })
}
async function bloquerNom(valeur: string, cle: string = cleIdempotenceUnique(), options: OptionsEcriture = {}) {
  const reauth = await codePour('catalogueCreer', `noms-bloques:${valeur}`, options)
  return appelerA5('cataloguesCreer', connecte, { params: { nom: 'noms-bloques' }, corps: { valeur, motif: 'Nom de marque protégé' }, cleIdempotence: cle, ...(reauth === undefined ? {} : { reauth }) })
}
const referentiels = () => appelerA5('referentiels', null, { cookie: null })

async function vitrineAuPays(pays: string, username: string) {
  const user = await createUser()
  return insertVitrineRow(user.id, { username, pays, publiee: true })
}

describe('pays utilisé (CA01, CA17)', () => {
  it('should refuse to delete a country a vitrine uses (409), deactivate it instead, and drop it from /api/referentiels while the vitrine stays valid', async () => {
    const vitrine = await vitrineAuPays('TD', 'vitrine-tchad')

    const suppression = await supprimerPays('TD')
    const desactivation = await modifierPays('TD', { actif: false })
    const publics = await referentiels()
    const liste = await appelerA5('cataloguesListe', connecte, { params: { nom: 'pays' } })

    expect(suppression).toMatchObject({ status: 409, code: 'CATALOGUE_ENTREE_UTILISEE' })
    expect(await lirePays('TD')).toMatchObject({ actif: false })
    expect(desactivation.status).toBe(200)
    expect(schemaPaysReponse.parse(desactivation.corps)).toMatchObject({ entree: { code: 'TD', actif: false, utilise: true }, rejoue: false })
    const codes = schemaReferentielsDto.parse(publics.corps).pays.map((p) => p.code)
    expect(codes).not.toContain('TD')
    expect(codes).toContain('CM')
    const lignes = schemaListeCatalogueDto.parse(liste.corps)
    expect(lignes.nom === 'pays' && lignes.elements.find((p) => p.code === 'LU')?.utilise).toBe(false)
    const [relue] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    expect(relue).toMatchObject({ pays: 'TD', username: 'vitrine-tchad' })
    expect(await journalDe('catalogue.supprimer')).toHaveLength(0)
    expect(await journalDe('catalogue.modifier')).toHaveLength(1)
  })

  it('should delete an unused country and journal it with its motif', async () => {
    const reponse = await supprimerPays('LU')

    expect(reponse).toMatchObject({ status: 200, corps: { effectue: true, rejoue: false } })
    expect(await lirePays('LU')).toBeUndefined()
    const [ligne] = await journalDe('catalogue.supprimer')
    expect(ligne).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'catalogue', motif: MOTIF_A5 })
    expect(ligne?.cible_id).toContain('LU')
  })
})

describe('canal SMS par pays (CA02)', () => {
  const NUMERO_CM = '+237653456789'
  /** Laisse passer un éventuel envoi en arrière-plan : une liste vide est alors une VRAIE absence de mise en file. */
  async function jobsSms() {
    await new Promise((resolve) => setTimeout(resolve, 300))
    return (await tousLesJobs()).filter((job) => job.name === JOBS.sendOtpSms)
  }

  it('should answer 422 CANAL_INDISPONIBLE with no job when the SMS flag of the country is off, and send the code again once it is back on, without redeploying', async () => {
    await modifierPays('CM', { canalSms: false })

    const refuse = await demanderCodeTelephone(suite.auth(), NUMERO_CM, 'public')
    const avant = await jobsSms()
    await modifierPays('CM', { canalSms: true })
    const acceptee = await demanderCodeTelephone(suite.auth(), NUMERO_CM, 'public')

    expect(refuse.status).toBe(422)
    expect(JSON.stringify(refuse.corps)).toContain('CANAL_INDISPONIBLE')
    expect(avant).toHaveLength(0)
    expect(acceptee.status).toBe(200)
    await vi.waitFor(async () => expect((await jobsSms()).length).toBeGreaterThan(0), { timeout: 5_000, interval: 100 })
  })
})

describe('réauthentification des écritures de catalogue', () => {
  it('should refuse a write without code (REAUTH_REQUISE) or with the code of ANOTHER target (REAUTH_INVALIDE), and change nothing', async () => {
    const codeAutreCible = await codeReauthCatalogue(connecte.admin.id, 'catalogueModifier', 'pays:LU')

    const sans = await modifierPays('CM', { actif: false }, { reauth: null })
    const autreCible = await modifierPays('CM', { actif: false }, { reauth: codeAutreCible })

    expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(autreCible).toMatchObject({ status: 403, code: 'REAUTH_INVALIDE' })
    expect(await lirePays('CM')).toMatchObject({ actif: true })
    expect(await compterJournal()).toBe(0)
  })
})

describe('journal et atomicité des écritures de catalogue (CA13)', () => {
  it('should change nothing when the journal write fails (the flag keeps its value, no line written)', async () => {
    const reponse = await avecJournalEnPanne(() => modifierPays('CM', { actif: false }))

    expect(reponse.status).not.toBe(200)
    expect(await lirePays('CM')).toMatchObject({ actif: true })
    expect(await compterJournal()).toBe(0)
  })

  it('should journal a flat before/after with the motif, and refuse a short motif without writing anything', async () => {
    const court = await modifierPays('CM', { canalEmail: false, motif: 'non' })
    const bon = await modifierPays('CM', { canalEmail: false })

    expect(court.status).toBe(422)
    expect(bon.status).toBe(200)
    const lignes = await journalDe('catalogue.modifier')
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({ admin_id: connecte.admin.id, cible_type: 'catalogue', motif: MOTIF_A5, avant: { canal_email: true }, apres: { canal_email: false } })
  })

  it('should refuse an unknown time zone (422 FUSEAU_INCONNU) while keeping an already registered zone valid when it does not change', async () => {
    const inconnu = await modifierPays('CM', { fuseaux: ['Etc/GMT+5'] })
    const inchange = await modifierPays('CM', { fuseaux: ['Africa/Douala'], canalWhatsapp: true })

    expect(inconnu).toMatchObject({ status: 422, code: 'FUSEAU_INCONNU' })
    expect(inchange.status).toBe(200)
    expect(await lirePays('CM')).toMatchObject({ canal_whatsapp: true })
  })
})

describe('idempotence (CA15, catalogues)', () => {
  it('should answer the same entry with rejoue=true and add neither a row nor a journal line when the key is replayed', async () => {
    const cle = cleIdempotenceUnique()

    const premiere = await bloquerNom('marque-rejeu', cle)
    const rejeu = await bloquerNom('marque-rejeu', cle)

    expect(premiere.status).toBe(200)
    expect(rejeu.status).toBe(200)
    expect(schemaNomBloqueReponse.parse(premiere.corps).rejoue).toBe(false)
    expect(schemaNomBloqueReponse.parse(rejeu.corps)).toMatchObject({ rejoue: true, entree: { valeur: 'marque-rejeu' } })
    expect(await compterTable('usernames_bloques')).toBe(1)
    expect(await journalDe('catalogue.creer')).toHaveLength(1)
  })
})

describe('noms d\'adresse réservés ou bloqués (CA16)', () => {
  const donnees = (username: string) => ({ titre: null, prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username })

  it.each([
    ['bloqué par l\'administration', 'marque-protegee'],
    ['réservé par le code (shared/reserved.ts)', 'admin'],
  ])('should refuse a vitrine creation and an address change to a name %s (422 NOM_BLOQUE)', async (_origine, nom) => {
    await bloquerNom('marque-protegee')
    const { createVitrine, changeUsername } = await import('../../../server/services/vitrines')
    const sans = await createUser()
    const avec = await createUser()
    await insertVitrineRow(avec.id, { username: 'adresse-actuelle', publiee: true })

    const creation = await rejet(createVitrine(sans.id, donnees(nom)))
    const changement = await rejet(changeUsername(avec.id, nom))

    expect(creation).toMatchObject({ status: 422, code: 'NOM_BLOQUE' })
    expect(changement).toMatchObject({ status: 422, code: 'NOM_BLOQUE' })
    const [inchangee] = await db.select({ username: vitrines.username }).from(vitrines).where(eq(vitrines.userId, avec.id))
    expect(inchangee?.username).toBe('adresse-actuelle')
  })

  it('should leave an existing vitrine untouched and public when its address becomes blocked afterwards', async () => {
    const vitrine = await vitrineAuPays('CM', 'ancien-nom')
    const { getPublicVitrine } = await import('../../../server/services/vitrines')

    const reponse = await bloquerNom('ancien-nom')

    expect(reponse.status).toBe(200)
    const [relue] = await db.select().from(vitrines).where(eq(vitrines.id, vitrine.id))
    expect(relue).toMatchObject({ username: 'ancien-nom', publieeLe: vitrine.publieeLe })
    await expect(getPublicVitrine('ancien-nom')).resolves.toBeDefined()
  })
})

describe('accès aux routes (A1, CA17)', () => {
  it('should answer the uniform 404 on every administration route of A5 without a session, and write nothing', async () => {
    const ID = '3f2b8c1e-9d4a-4e7b-8a61-0c5d2f9e7b10'
    const routes = (Object.keys(CHARGEURS_A5) as RouteA5[]).filter((r) => r !== 'referentiels')

    for (const route of routes) {
      const reponse = await appelerA5(route, null, {
        cookie: null,
        params: { nom: 'pays', type: 'plans', id: ID },
        corps: { motif: MOTIF_A5 },
        cleIdempotence: cleIdempotenceUnique(),
        reauth: '123456',
      })
      expect(reponse.status, route).toBe(404)
    }
    expect(await compterJournal()).toBe(0)
  })
})
