import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { BATTEMENT_SAUVEGARDE, SAUVEGARDE_ALERTE_HEURES } from '../../../shared/jobs'
import { schemaAgregatsAssistantsDto, schemaAgregatsIaDto, schemaEnvoisDto, schemaSanteDto } from '../../../shared/schemas/admin-a4'
import { journalAssistant } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import { ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import { appelerA4, brut, reinitialiserA4 } from '../support/admin-a4'
import type { AdminA4 } from '../support/admin-a4'
import { createUser, insertGeneration } from '../support/fabriques'

// A4 CA16 et CA21 (D-A4-16, D-A4-17) : agrégats de supervision (IA, envois de codes, assistants) et santé. Lecture seule, SQL
// à colonnes explicites : aucune donnée d'entrée ou de sortie d'une génération, aucun contenu du journal des assistants, aucune
// adresse ni nom ne sortent. Les « canaris » ci-dessous sont posés EN BASE : s'ils ressortent, c'est une fuite. Base réelle.

const suite = preparerSuiteAdmin()
let connecte: AdminA4

beforeEach(async () => {
  await reinitialiserA4()
  connecte = await ouvrirAdmin(suite.auth())
})

const JOUR_MS = 86_400_000
const CANARI_ENTREE = 'canari-entree-visiteur-zorglub'
const CANARI_SORTIE = 'canari-sortie-generee-plugh'

describe('agrégats IA (CA16)', () => {
  it('should count the generations of the window by status, reason, type and provider, give tokens, and expose NO input, output, e-mail nor name', async () => {
    const compte = await createUser({ email: 'canari.titulaire.xyzzy@exemple.test', name: 'Canari Titulaire Xyzzy' })
    const entree = { titre: CANARI_ENTREE, metier: CANARI_ENTREE, ville: CANARI_ENTREE, pays: 'Cameroun' }
    await insertGeneration(compte.id, { statut: 'terminee', entree, sortie: { accroche: CANARI_SORTIE }, fournisseur: 'openai', tokensEntree: 100, tokensSortie: 300, createdAt: new Date(), termineeLe: new Date() })
    await insertGeneration(compte.id, { statut: 'repli', motifRepli: 'ia_coupee', entree, sortie: { accroche: CANARI_SORTIE }, createdAt: new Date(), termineeLe: new Date() })
    await insertGeneration(compte.id, { statut: 'terminee', entree, fournisseur: 'openai', tokensEntree: 999, tokensSortie: 999, createdAt: new Date(Date.now() - 40 * JOUR_MS), termineeLe: new Date(Date.now() - 40 * JOUR_MS) })

    const reponse = await appelerA4('agregatsIa', { cookie: connecte.cookie })
    const refus = await appelerA4('agregatsIa', { cookie: connecte.cookie, query: { jours: '31' } })

    expect(reponse.status).toBe(200)
    const dto = schemaAgregatsIaDto.parse(reponse.corps)
    expect(dto).toMatchObject({ jours: 30, total: 2, tokensEntree: 100, tokensSortie: 300 })
    expect(dto.parMotifRepli).toEqual([{ motif: 'ia_coupee', nombre: 1 }])
    expect(dto.consommateurs).toEqual([{ utilisateurId: compte.id, nombre: 2 }])
    for (const interdit of [CANARI_ENTREE, CANARI_SORTIE, 'xyzzy', 'Canari Titulaire', '@exemple.test']) expect(brut(reponse), interdit).not.toContain(interdit)
    expect(refus.status).toBeGreaterThanOrEqual(400)
    expect(refus.status).toBeLessThan(500)
  })
})

describe('agrégats des envois de codes et des assistants', () => {
  it('should group the code deliveries of the window by channel and country, count errors, and ignore older rows', async () => {
    await db.execute(sql`
      INSERT INTO envois_codes (cree_le, canal, pays, statut, tentative, code_erreur) VALUES
        (now(), 'email', NULL, 'envoye', 1, NULL),
        (now(), 'sms', 'CM', 'envoye', 1, NULL),
        (now(), 'sms', 'CM', 'echec', 1, 'OTP_SMS_NON_CONFIGURE'),
        (now() - interval '20 days', 'sms', 'FR', 'envoye', 1, NULL)`)

    const reponse = await appelerA4('envois', { cookie: connecte.cookie, query: { jours: '7' } })

    const dto = schemaEnvoisDto.parse(reponse.corps)
    expect(dto.total).toEqual({ envoyes: 2, echecs: 1 })
    expect(dto.lignes).toEqual(expect.arrayContaining([
      { canal: 'sms', pays: 'CM', envoyes: 1, echecs: 1 },
      { canal: 'email', pays: null, envoyes: 1, echecs: 0 },
    ]))
    expect(dto.lignes).toHaveLength(2)
    expect(dto.erreurs).toEqual([{ codeErreur: 'OTP_SMS_NON_CONFIGURE', nombre: 1 }])
  })

  it('should count the assistant calls by tool and assistant without exposing arguments, results, before/after states, nor the account', async () => {
    const compte = await createUser({ email: 'canari.assistant.plugh@exemple.test' })
    await db.insert(journalAssistant).values({
      id: randomUUID(),
      userId: compte.id,
      assistantId: 'assistant-test',
      outil: 'obtenir_vitrine',
      argumentsResume: { titre: CANARI_ENTREE },
      resultat: { texte: CANARI_SORTIE },
      avant: { texte: CANARI_ENTREE },
      apres: { texte: CANARI_SORTIE },
    })

    const reponse = await appelerA4('assistants', { cookie: connecte.cookie })

    const dto = schemaAgregatsAssistantsDto.parse(reponse.corps)
    expect(dto).toMatchObject({ total: 1, parOutil: [{ outil: 'obtenir_vitrine', nombre: 1 }], parAssistant: [{ assistantId: 'assistant-test', nombre: 1 }] })
    for (const interdit of [CANARI_ENTREE, CANARI_SORTIE, 'plugh', compte.id]) expect(brut(reponse), interdit).not.toContain(interdit)
  })
})

describe('santé et dernière sauvegarde (CA21, D-A4-16)', () => {
  const insererBattement = (heures: number) =>
    db.execute(sql`INSERT INTO battements_systeme (cle, horodatage) VALUES (${BATTEMENT_SAUVEGARDE}, now() - make_interval(hours => ${heures}))`)

  it('should report the backup as unknown (never as good) without any beat, old beyond 26 hours, and good below', async () => {
    const lire = async () => schemaSanteDto.parse((await appelerA4('sante', { cookie: connecte.cookie })).corps)

    const sans = await lire()
    await insererBattement(SAUVEGARDE_ALERTE_HEURES + 1)
    const ancienne = await lire()
    await db.execute(sql`TRUNCATE battements_systeme`)
    await insererBattement(1)
    const recente = await lire()

    expect(sans.sauvegarde).toEqual({ etat: 'inconnue', derniereReussiteLe: null, ageHeures: null })
    expect(ancienne.sauvegarde.etat).toBe('ancienne')
    expect(ancienne.sauvegarde.ageHeures).toBeGreaterThanOrEqual(SAUVEGARDE_ALERTE_HEURES)
    expect(recente.sauvegarde.etat).toBe('ok')
    expect(recente).toMatchObject({ base: { etat: 'ok' }, redis: { etat: 'ok' } })
  })

  it('should record the beat when the backup script runs (the only writer), and keep a single row when it runs again', async () => {
    const racine = path.resolve(import.meta.dirname, '../../..')
    const lancer = () => promisify(execFile)(process.execPath, [path.join(racine, 'node_modules/tsx/dist/cli.mjs'), path.join(racine, 'scripts/sauvegarde-battement.ts')], { cwd: racine, env: { ...process.env }, timeout: 90_000 })

    await lancer()
    await lancer()

    const lignes = await db.execute<{ cle: string, age: string }>(sql`SELECT cle, extract(epoch FROM now() - horodatage)::text AS age FROM battements_systeme`)
    expect(lignes.rows).toHaveLength(1)
    expect(lignes.rows[0]?.cle).toBe(BATTEMENT_SAUVEGARDE)
    expect(Number(lignes.rows[0]?.age)).toBeLessThan(120)
    const apres = schemaSanteDto.parse((await appelerA4('sante', { cookie: connecte.cookie })).corps)
    expect(apres.sauvegarde.etat).toBe('ok')
  }, 200_000)
})
