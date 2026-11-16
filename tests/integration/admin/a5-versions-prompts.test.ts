import { beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { vitrines } from '../../../shared/db/schema'
import { schemaEssaiPromptDto, schemaVersionReponse } from '../../../shared/schemas/admin-versions'
import { db } from '../../../server/utils/db'
import { ouvrirAdmin, preparerSuiteAdmin, journalDe } from '../support/admin'
import {
  MOTIF_A5,
  VALEURS_PROMPT_TEST,
  activer,
  appelerA5,
  creerBrouillon,
  cleIdempotenceUnique,
  compterTable,
  idDeReponse,
  lirePrompts,
  preparerConfigurationA5,
  retourArriere,
} from '../support/admin-a5'
import type { AdminA5 } from '../support/admin-a5'
import { erreurPostgres, rejet } from '../support/erreurs'
import { insertVitrineRow, createUser } from '../support/fabriques'

// A5 CA08, CA09, CA10 (D-A5-09) : versions de PROMPTS IA. Éditer = une NOUVELLE ligne `prompts_ia` inactive ; une ligne
// existante est figée (42501) ; le serveur calcule les variables et refuse toute variable hors liste blanche ; l'essai à
// blanc n'écrit rien, n'accepte aucune donnée utilisateur et est limité à 10 par heure et par administrateur.
// VRAIE base, VRAI Redis (limiteur), vrai journal ; fournisseur d'IA : le faux fournisseur de la configuration de test.

const suite = preparerSuiteAdmin()
preparerConfigurationA5()
let connecte: AdminA5

const TYPE = 'onboarding_vitrine'
const CANARI_UTILISATEUR = 'Canari-Vitrine-Zorglub-Essai'

beforeEach(async () => {
  const { admin, cookie } = await ouvrirAdmin(suite.auth())
  connecte = { admin, cookie }
})

async function promptActif() {
  const actif = (await lirePrompts(TYPE)).find((p) => p.actif)
  if (!actif) throw new Error(`Aucun prompt actif pour ${TYPE}.`)
  return actif
}

describe('éditer = nouvelle version, l\'ancienne est figée (CA08)', () => {
  it('should create a v3 inactive with computed variables and leave v2 unchanged and active; a SQL edit of v2 fails with 42501', async () => {
    const v2 = await promptActif()

    const reponse = await creerBrouillon(connecte, 'prompts', TYPE, { ...VALEURS_PROMPT_TEST, gabarit: 'Nouveau gabarit pour {{donnees}}' })

    expect(reponse.status).toBe(200)
    expect(schemaVersionReponse.parse(reponse.corps)).toMatchObject({ rejoue: false, version: { type: 'prompts', cle: TYPE, numero: v2.version + 1, statut: 'inactive' } })
    const lignes = await lirePrompts(TYPE)
    const v3 = lignes.find((p) => p.version === v2.version + 1)
    expect(v3).toMatchObject({ actif: false, variables: ['donnees'], motif: MOTIF_A5, cree_par: connecte.admin.id, gabarit: 'Nouveau gabarit pour {{donnees}}' })
    expect(lignes.find((p) => p.id === v2.id)).toEqual(v2)
    const edition = await rejet(db.execute(sql`UPDATE prompts_ia SET gabarit = 'Modifié {{donnees}}' WHERE id = ${v2.id}`))
    expect(erreurPostgres(edition.brute).sqlstate).toBe('42501')
    expect(await journalDe('version.creer')).toHaveLength(1)
  })
})

describe('variables : liste blanche calculée par le serveur (CA09)', () => {
  it('should answer 422 VARIABLE_INCONNUE for {{nom}} and refuse variables sent by the client, creating no row', async () => {
    const avant = await compterTable('prompts_ia')

    const inconnue = await creerBrouillon(connecte, 'prompts', TYPE, { ...VALEURS_PROMPT_TEST, gabarit: 'Bonjour {{nom}}, voici {{donnees}}' })
    const imposee = await appelerA5('versionsCreer', connecte, {
      params: { type: 'prompts' },
      corps: { cle: TYPE, valeurs: { ...VALEURS_PROMPT_TEST, variables: ['donnees', 'nom'] }, motif: MOTIF_A5 },
      cleIdempotence: cleIdempotenceUnique(),
    })

    expect(inconnue).toMatchObject({ status: 422, code: 'VARIABLE_INCONNUE' })
    expect(imposee.status).toBe(422)
    expect(await compterTable('prompts_ia')).toBe(avant)
  })
})

describe('activation et retour d\'un prompt (D-A5-09)', () => {
  it('should swap the active prompt in one step with a reauthentication code, serve it, and restore v2 on rollback', async () => {
    const v2 = await promptActif()
    const v3 = idDeReponse(await creerBrouillon(connecte, 'prompts', TYPE, { ...VALEURS_PROMPT_TEST, gabarit: 'Nouveau gabarit pour {{donnees}}' }))
    const { getActivePrompt } = await import('../../../server/services/ia/prompts')

    const sans = await activer(connecte, 'prompts', v3, { reauth: null })
    const programmee = await activer(connecte, 'prompts', v3, { programmeePour: new Date(Date.now() + 3_600_000).toISOString() })
    const intacte = (await lirePrompts(TYPE)).filter((p) => p.actif).map((p) => p.id)
    const activation = await activer(connecte, 'prompts', v3)
    const apres = (await lirePrompts(TYPE)).filter((p) => p.actif)
    const servi = await getActivePrompt(TYPE)
    const retour = await retourArriere(connecte, 'prompts', v2.id)

    expect(sans).toMatchObject({ status: 403, code: 'REAUTH_REQUISE' })
    expect(programmee.status).toBe(422)
    expect(intacte).toEqual([v2.id])
    expect(activation.status).toBe(200)
    expect(apres.map((p) => p.id)).toEqual([v3])
    expect(servi).toMatchObject({ id: v3, version: v2.version + 1 })
    expect(retour.status).toBe(200)
    expect((await lirePrompts(TYPE)).filter((p) => p.actif).map((p) => p.id)).toEqual([v2.id])
    expect(await journalDe('version.activer')).toHaveLength(1)
    expect(await journalDe('version.retour')).toHaveLength(1)
  })
})

describe('essai à blanc (CA10)', () => {
  const corps = { cle: 'ameliorer_texte', valeurs: VALEURS_PROMPT_TEST }
  const essai = (surcharge: Record<string, unknown> = {}) =>
    appelerA5('promptsEssai', connecte, { corps: { ...corps, ...surcharge }, cleIdempotence: cleIdempotenceUnique() })

  it('should refuse a body carrying user data (strict schema), and never put real vitrine data in the answer', async () => {
    const user = await createUser()
    const vitrine = await insertVitrineRow(user.id, { publiee: true })
    await db.update(vitrines).set({ bio: CANARI_UTILISATEUR }).where(eq(vitrines.id, vitrine.id))

    const refuse = await essai({ donnees: { texte: CANARI_UTILISATEUR } })
    const accepte = await essai()

    expect(refuse.status).toBe(422)
    expect(accepte.status).toBe(200)
    expect(JSON.stringify(accepte.corps)).not.toContain(CANARI_UTILISATEUR)
  })

  it('should answer 429 ESSAI_LIMITE on the 11th try within the hour, and persist nothing at all', async () => {
    const avant = { prompts: await compterTable('prompts_ia'), generations: await compterTable('generations_ia') }
    const reponses = []

    for (let i = 0; i < 11; i += 1) reponses.push(await essai())

    expect(reponses.slice(0, 10).map((r) => r.status)).toEqual(Array.from({ length: 10 }, () => 200))
    expect(schemaEssaiPromptDto.parse(reponses[9]?.corps).essaisRestants).toBe(0)
    expect(reponses[10]).toMatchObject({ status: 429, code: 'ESSAI_LIMITE' })
    expect({ prompts: await compterTable('prompts_ia'), generations: await compterTable('generations_ia') }).toEqual(avant)
    expect(await journalDe('prompt.essai')).toHaveLength(0)
  }, 60_000)
})
