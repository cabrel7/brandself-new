import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { paiements, webhooksRefuses } from '../../shared/db/schema'
import { db } from '../../server/utils/db'
import { erreurPostgres, rejet } from './support/erreurs'
import { createUser } from './support/fabriques'

// A3 §3 : migration 0030 (source des paiements, cohérence du paiement manuel, index des revenus, compteur horaire des
// webhooks refusés). État de la base APRÈS la migration, lu dans les catalogues PostgreSQL (jouée par le globalSetup sur
// la vraie base de test), contraintes éprouvées par des écritures réelles, puis REJOUABILITÉ.
// `webhooks_refuses` n'a aucune clé étrangère : le TRUNCATE ... CASCADE de tests/integration/setup.ts ne l'atteint pas,
// d'où le nettoyage explicite ci-dessous.

const MIGRATIONS_DIR = path.resolve(import.meta.dirname, '../../server/db/migrations')
const BREAKPOINT = '--> statement-breakpoint'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

function fichierMigration(): string {
  const fichiers = readdirSync(MIGRATIONS_DIR).filter((f) => f.startsWith('0030_') && f.endsWith('.sql'))
  if (fichiers.length !== 1) throw new Error(`Une seule migration 0030 est attendue, reçu : ${fichiers.join(', ') || 'aucune'}.`)
  return fichiers[0]!
}

interface Colonne {
  type: string
  nullable: boolean
  defaut: string | null
}

async function colonnes(table: string): Promise<Record<string, Colonne>> {
  const resultat = await db.execute<{ column_name: string, data_type: string, is_nullable: string, column_default: string | null }>(sql`
    SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = ${table}`)
  return Object.fromEntries(resultat.rows.map((r) => [r.column_name, { type: r.data_type, nullable: r.is_nullable === 'YES', defaut: r.column_default }]))
}

interface Contrainte {
  type: string
  validee: boolean
  definition: string
}

async function contraintes(table: string): Promise<Record<string, Contrainte>> {
  const resultat = await db.execute<{ conname: string, contype: string, convalidated: boolean, def: string }>(sql`
    SELECT conname, contype, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
    WHERE conrelid = ${`public.${table}`}::regclass`)
  return Object.fromEntries(resultat.rows.map((r) => [r.conname, { type: r.contype, validee: r.convalidated, definition: r.def }]))
}

async function indexDe(table: string): Promise<Record<string, string>> {
  const resultat = await db.execute<{ indexname: string, indexdef: string }>(sql`
    SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema() AND tablename = ${table}`)
  return Object.fromEntries(resultat.rows.map((r) => [r.indexname, r.indexdef]))
}

async function planSansBalayageSequentiel(requete: ReturnType<typeof sql>): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL enable_seqscan = off`)
    const resultat = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN ${requete}`)
    return resultat.rows.map((r) => r['QUERY PLAN']).join('\n')
  })
}

type LignePaiement = typeof paiements.$inferInsert

/** Paiement K-PAY valide (état de départ) ; les surcharges servent à éprouver chaque contrainte. */
function paiementKpay(surcharges: Partial<LignePaiement> = {}): LignePaiement {
  return {
    id: randomUUID(),
    userId: null,
    fournisseur: 'kpay',
    methode: 'mobile_money',
    operateur: 'MTN_MOMO_CMR',
    environnement: 'test',
    idFournisseur: randomUUID(),
    referenceFournisseur: randomUUID(),
    plan: 'payant',
    periodeMois: 1,
    devise: 'XAF',
    montantPlan: 5000,
    montant: 5000,
    fraisTauxPb: 500,
    fraisSupporteur: 'marchand',
    fraisEstimes: 250,
    netEstime: 4750,
    expireAvant: new Date(Date.now() + 900_000),
    ...surcharges,
  }
}

/** Paiement manuel valide en `cree` : toutes les garanties de D-A3-03 respectées. */
function paiementManuel(surcharges: Partial<LignePaiement> = {}): LignePaiement {
  const id = surcharges.id ?? randomUUID()
  return {
    id,
    userId: null,
    fournisseur: 'manuel',
    methode: 'manuel',
    operateur: null,
    environnement: 'live',
    idFournisseur: null,
    referenceFournisseur: `manuel-${id}`,
    plan: 'payant',
    periodeMois: 1,
    devise: 'XAF',
    montantPlan: 5000,
    montant: 5000,
    fraisTauxPb: 0,
    fraisSupporteur: 'marchand',
    fraisEstimes: 0,
    netEstime: 5000,
    expireAvant: new Date(Date.now() + 900_000),
    source: 'manuel',
    ...surcharges,
  }
}

async function incrementerRefus(heure: Date, fournisseur: string, motif: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO webhooks_refuses (heure, fournisseur, motif) VALUES (${heure}, ${fournisseur}, ${motif})
    ON CONFLICT (heure, fournisseur, motif) DO UPDATE SET nombre = webhooks_refuses.nombre + 1`)
}

beforeEach(async () => {
  await db.execute(sql`DELETE FROM webhooks_refuses`)
})

describe('migration 0030 : fichiers et journal drizzle', () => {
  it('should exist once, with its snapshot, and carry the commented manual rollback', () => {
    const fichier = fichierMigration()

    expect(fichier).toBe('0030_a3_paiements_admin.sql')
    expect(existsSync(path.join(MIGRATIONS_DIR, 'meta/0030_snapshot.json'))).toBe(true)
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichier), 'utf-8')
    expect(contenu).toMatch(/ROLLBACK/)
    expect(contenu).toMatch(/--\s*DROP TABLE IF EXISTS webhooks_refuses/)
    expect(contenu).toMatch(/--\s*ALTER TABLE paiements DROP COLUMN IF EXISTS source/)
    expect(contenu).toMatch(/--\s*DELETE FROM drizzle\.__drizzle_migrations/)
  })

  it('should be registered right after 0029 in the drizzle journal, with a later date (or it would never be applied)', () => {
    const journal = JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, 'meta/_journal.json'), 'utf-8')) as {
      entries: Array<{ idx: number, tag: string, when: number, breakpoints: boolean }>
    }
    const { entries } = journal

    expect(entries.map((e) => e.idx)).toEqual(entries.map((_, i) => i))
    expect(entries[29]).toMatchObject({ idx: 29, tag: '0029_a2_utilisateurs_vitrines' })
    expect(entries[30]).toMatchObject({ idx: 30, tag: '0030_a3_paiements_admin', breakpoints: true })
    for (const entree of entries) expect(existsSync(path.join(MIGRATIONS_DIR, `${entree.tag}.sql`)), entree.tag).toBe(true)
    for (let i = 1; i < entries.length; i += 1) expect(entries[i]!.when, entries[i]!.tag).toBeGreaterThan(entries[i - 1]!.when)
  })

  it('should chain its snapshot to the one of 0029 and describe the new column, table and indexes', () => {
    const lire = (nom: string) => JSON.parse(readFileSync(path.join(MIGRATIONS_DIR, `meta/${nom}`), 'utf-8')) as {
      id: string
      prevId: string
      tables: Record<string, { columns: Record<string, unknown>, indexes: Record<string, unknown> }>
    }
    const precedent = lire('0029_snapshot.json')
    const courant = lire('0030_snapshot.json')

    expect(courant.prevId).toBe(precedent.id)
    expect(Object.keys(courant.tables['public.paiements']!.columns)).toContain('source')
    expect(Object.keys(courant.tables['public.paiements']!.indexes)).toEqual(expect.arrayContaining(['paiements_liste_admin_idx', 'paiements_encaisse_idx']))
    expect(Object.keys(courant.tables)).toContain('public.webhooks_refuses')
    expect(Object.keys(precedent.tables)).not.toContain('public.webhooks_refuses')
  })

  it('should NOT recreate abonnements.origine (delivered by 0029): no statement of 0030 touches abonnements', () => {
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
    const code = contenu.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n')

    expect(code).not.toMatch(/abonnements/)
  })

  it('should be written to be replayed: every statement is guarded (IF NOT EXISTS, IF EXISTS, NOT VALID)', () => {
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
    const instructions = contenu
      .split(BREAKPOINT)
      .map((bloc) => bloc.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n').trim())
      .filter((bloc) => bloc !== '')

    expect(instructions.length).toBeGreaterThan(8)
    for (const instruction of instructions) {
      const nu = instruction.replace(/\s+/g, ' ')
      if (/^ALTER TABLE .* ADD COLUMN/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^ALTER TABLE .* ADD CONSTRAINT/.test(nu)) expect(nu, nu).toContain('NOT VALID')
      else if (/^CREATE (UNIQUE )?INDEX/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
      else if (/^CREATE TABLE/.test(nu)) expect(nu, nu).toContain('IF NOT EXISTS')
    }
    for (const nom of ['paiements_source_check', 'paiements_source_coherence_check']) {
      expect(contenu, nom).toMatch(new RegExp(`DROP CONSTRAINT IF EXISTS "${nom}"`))
      expect(contenu, nom).toMatch(new RegExp(`VALIDATE CONSTRAINT "${nom}"`))
    }
    expect(instructions.join('\n')).not.toMatch(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM)\b/i)
  })
})

describe('migration 0030 : paiements.source', () => {
  // P1 (migration 0033) : la source 'kpay' est devenue 'fournisseur' (défaut compris). Le modèle d'origine de 0030
  // (défaut 'kpay') est éprouvé plus bas, dans « rejouabilité », en rejouant 0030 dans l'état d'avant 0033.
  it("should have source (text, not null), defaulting to 'fournisseur' since 0033: a payment inserted without source is a provider one", async () => {
    const c = await colonnes('paiements')
    const compte = await createUser()
    const ligne = paiementKpay({ userId: compte.id })
    await db.execute(sql`
      INSERT INTO paiements (id, user_id, fournisseur, methode, environnement, plan, periode_mois, devise, montant_plan, montant,
        frais_taux_pb, frais_supporteur, frais_estimes, net_estime, expire_avant)
      VALUES (${ligne.id}, ${compte.id}, 'kpay', 'mobile_money', 'test', 'payant', 1, 'XAF', 5000, 5000, 500, 'marchand', 250, 4750, now() + interval '15 minutes')`)

    const [relu] = await db.select({ source: paiements.source }).from(paiements).where(eq(paiements.id, ligne.id))

    expect(c.source).toMatchObject({ type: 'text', nullable: false })
    expect(c.source?.defaut).toContain("'fournisseur'")
    expect(relu?.source).toBe('fournisseur')
  })

  it('should declare paiements_source_check and paiements_source_coherence_check, validated', async () => {
    const c = await contraintes('paiements')

    expect(c.paiements_source_check).toMatchObject({ type: 'c', validee: true })
    expect(c.paiements_source_coherence_check).toMatchObject({ type: 'c', validee: true })
  })

  it.each(['kpay', 'stripe', 'KPAY', 'Manuel', '', 'admin'])('should refuse the source %j (23514)', async (source) => {
    const erreur = await rejet(db.insert(paiements).values(paiementKpay({ source })))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_check' })
  })

  it('should accept a K-PAY payment and a valid manual payment, in `cree` and (once applied) `reussi`', async () => {
    const maintenant = new Date()
    const manuelReussi = paiementManuel({ statut: 'reussi', appliqueLe: maintenant, termineLe: maintenant })

    await db.insert(paiements).values([paiementKpay(), paiementManuel(), manuelReussi])

    const lignes = await db.select({ source: paiements.source, statut: paiements.statut }).from(paiements)
    expect(lignes.map((l) => `${l.source}:${l.statut}`).sort()).toEqual(['fournisseur:cree', 'manuel:cree', 'manuel:reussi'])
  })

  it('should leave the provider an open value: a non-K-PAY, non-manual provider is still accepted (S10 rule, no migration to add one)', async () => {
    await expect(db.insert(paiements).values(paiementKpay({ fournisseur: 'stripe', methode: 'carte', operateur: null }))).resolves.toBeDefined()
  })
})

describe('migration 0030 : cohérence du paiement manuel', () => {
  it.each<[string, Partial<LignePaiement>]>([
    ['une source manuel avec le fournisseur kpay', { fournisseur: 'kpay' }],
    ['le fournisseur manuel avec la source fournisseur', { source: 'fournisseur' }],
    ['une méthode autre que manuel', { methode: 'mobile_money' }],
    ['un statut en_attente', { statut: 'en_attente', idFournisseur: null, initiationIncertaine: true }],
    ['un statut echoue', { statut: 'echoue', termineLe: new Date() }],
    ['un statut anomalie', { statut: 'anomalie', termineLe: new Date() }],
    ['un identifiant fournisseur', { idFournisseur: 'ID-FOURNISSEUR-1' }],
    ['une référence sans le préfixe manuel-', { referenceFournisseur: 'REF-LIBRE-1' }],
    ['une référence au nom d\'un autre paiement', { referenceFournisseur: `manuel-${randomUUID()}` }],
    ['une référence absente (NULL)', { referenceFournisseur: null }],
    ['un taux de frais non nul', { fraisTauxPb: 500 }],
    ['des frais estimés non nuls', { fraisEstimes: 250, netEstime: 4750 }],
    ['un net différent du montant', { netEstime: 4999 }],
    ['un code d\'échec', { codeEchec: 'SOLDE_INSUFFISANT' }],
    ['une initiation incertaine', { initiationIncertaine: true }],
  ])('should refuse a manual payment with %s (23514)', async (_libelle, surcharges) => {
    const erreur = await rejet(db.insert(paiements).values(paiementManuel(surcharges)))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION })
    expect(['paiements_source_coherence_check', 'paiements_terminal_check', 'paiements_attente_id_check', 'paiements_montants_check']).toContain(erreurPostgres(erreur.brute).contrainte)
  })

  it('should refuse to turn a K-PAY payment into a manual one by UPDATE (a real payment can never be relabelled)', async () => {
    const ligne = paiementKpay()
    await db.insert(paiements).values(ligne)

    const erreur = await rejet(db.execute(sql`UPDATE paiements SET source = 'manuel' WHERE id = ${ligne.id}`))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
  })

  it('should let a manual reference coexist with a K-PAY reference of the same text (the unique indexes are per provider)', async () => {
    const id = randomUUID()
    await db.insert(paiements).values(paiementKpay({ referenceFournisseur: `manuel-${id}` }))

    await expect(db.insert(paiements).values(paiementManuel({ id }))).resolves.toBeDefined()
  })

  it('should refuse to insert the same manual payment twice (23505: its reference is manuel-<id>, unique by construction)', async () => {
    const manuel = paiementManuel()
    await db.insert(paiements).values(manuel)

    const erreur = await rejet(db.insert(paiements).values({ ...manuel, id: manuel.id }))

    expect(erreurPostgres(erreur.brute).sqlstate).toBe(UNIQUE_VIOLATION)
  })

  it('should keep the original payment replaceable: a K-PAY payment can still move to `anomalie` (final) when a manual one replaces it', async () => {
    const original = paiementKpay({ statut: 'expire', termineLe: new Date() })
    await db.insert(paiements).values(original)

    await db.execute(sql`UPDATE paiements SET statut = 'anomalie', code_echec = 'REMPLACE_PAR_MANUEL' WHERE id = ${original.id}`)

    const [relu] = await db.select({ statut: paiements.statut, codeEchec: paiements.codeEchec, source: paiements.source }).from(paiements).where(eq(paiements.id, original.id))
    expect(relu).toEqual({ statut: 'anomalie', codeEchec: 'REMPLACE_PAR_MANUEL', source: 'fournisseur' })
  })
})

describe('migration 0030 : index des listes et des revenus', () => {
  it('should create the two indexes with the expected shape', async () => {
    const index = await indexDe('paiements')

    expect(index.paiements_liste_admin_idx).toMatch(/\(statut, created_at DESC\)/)
    expect(index.paiements_encaisse_idx).toMatch(/\(devise, applique_le\) WHERE \(statut = 'reussi'::text\)/)
  })

  it('should serve the real queries (payments by status newest first, monthly takings per currency)', async () => {
    const liste = await planSansBalayageSequentiel(sql`SELECT id FROM paiements WHERE statut = 'echoue' ORDER BY created_at DESC LIMIT 25`)
    const revenus = await planSansBalayageSequentiel(sql`
      SELECT devise, count(*), sum(montant) FROM paiements
      WHERE statut = 'reussi' AND source = 'fournisseur' AND applique_le >= now() - interval '31 days' AND applique_le < now() GROUP BY devise`)

    expect(liste).toContain('paiements_liste_admin_idx')
    expect(revenus).toContain('paiements_encaisse_idx')
  })
})

describe('migration 0030 : webhooks_refuses', () => {
  it('should create the table with typed columns, a composite primary key and no free-form column (no body, no IP, no header)', async () => {
    const c = await colonnes('webhooks_refuses')
    const cs = await contraintes('webhooks_refuses')

    expect(Object.keys(c).sort()).toEqual(['fournisseur', 'heure', 'motif', 'nombre'])
    expect(c.heure).toMatchObject({ type: 'timestamp with time zone', nullable: false })
    expect(c.nombre).toMatchObject({ type: 'integer', nullable: false, defaut: '1' })
    const primaire = Object.values(cs).find((x) => x.type === 'p')
    expect(primaire?.definition).toBe('PRIMARY KEY (heure, fournisseur, motif)')
    expect(Object.values(cs).filter((x) => x.type === 'f')).toHaveLength(0)
  })

  it('should count by upsert: the same hour, provider and reason is ONE row whose counter grows (bounded size under attack)', async () => {
    const heure = new Date('2026-11-14T10:00:00.000Z')

    for (let i = 0; i < 5; i += 1) await incrementerRefus(heure, 'kpay', 'SIGNATURE_INVALIDE')
    await incrementerRefus(heure, 'kpay', 'CORPS_TROP_GROS')
    await incrementerRefus(new Date('2026-11-14T11:00:00.000Z'), 'kpay', 'SIGNATURE_INVALIDE')

    const lignes = await db.select().from(webhooksRefuses)
    expect(lignes).toHaveLength(3)
    expect(lignes.find((l) => l.heure.getTime() === heure.getTime() && l.motif === 'SIGNATURE_INVALIDE')?.nombre).toBe(5)
    expect(lignes.filter((l) => l.nombre === 1)).toHaveLength(2)
  })

  it('should refuse a duplicate key by a plain INSERT (23505) and a counter below 1 (23514)', async () => {
    const heure = new Date('2026-11-14T10:00:00.000Z')
    await db.insert(webhooksRefuses).values({ heure, fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE' })

    const doublon = await rejet(db.insert(webhooksRefuses).values({ heure, fournisseur: 'kpay', motif: 'SIGNATURE_INVALIDE' }))
    const nul = await rejet(db.insert(webhooksRefuses).values({ heure, fournisseur: 'kpay', motif: 'CORPS_TROP_GROS', nombre: 0 }))
    const negatif = await rejet(db.insert(webhooksRefuses).values({ heure, fournisseur: 'kpay', motif: 'CORPS_TROP_GROS', nombre: -3 }))

    expect(erreurPostgres(doublon.brute).sqlstate).toBe(UNIQUE_VIOLATION)
    expect(erreurPostgres(nul.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'webhooks_refuses_nombre_check' })
    expect(erreurPostgres(negatif.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'webhooks_refuses_nombre_check' })
  })

  it.each(['FOURNISSEUR_INCONNU', 'signature_invalide', '', 'AUTRE'])('should refuse the reason %j (only SIGNATURE_INVALIDE and CORPS_TROP_GROS are counted)', async (motif) => {
    const erreur = await rejet(db.insert(webhooksRefuses).values({ heure: new Date(), fournisseur: 'kpay', motif }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'webhooks_refuses_motif_check' })
  })

  it.each(['KPAY', 'k pay', '', 'a'.repeat(41), 'kpay/../admin', 'kpay\n'])('should refuse the provider name %j (the URL segment is attacker-controlled: format enforced)', async (fournisseur) => {
    const erreur = await rejet(db.insert(webhooksRefuses).values({ heure: new Date(), fournisseur, motif: 'SIGNATURE_INVALIDE' }))

    expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'webhooks_refuses_fournisseur_check' })
  })

  it('should serve the alert query (refusals over the last hour) and the 90-day purge by the primary key (hour first)', async () => {
    const alerte = await planSansBalayageSequentiel(sql`SELECT sum(nombre) FROM webhooks_refuses WHERE heure >= now() - interval '1 hour'`)
    const purge = await planSansBalayageSequentiel(sql`DELETE FROM webhooks_refuses WHERE heure < now() - interval '90 days'`)

    expect(alerte).toContain('webhooks_refuses_heure_fournisseur_motif_pk')
    expect(purge).toContain('webhooks_refuses_heure_fournisseur_motif_pk')
  })
})

describe('migration 0030 : parité entre le schéma Drizzle et la base', () => {
  it.each([
    ['paiements', paiements],
    ['webhooks_refuses', webhooksRefuses],
  ] as const)('should declare in Drizzle exactly the columns of the table %s', async (nom, table) => {
    const enBase = Object.keys(await colonnes(nom)).sort()
    const enDrizzle = getTableConfig(table).columns.map((c) => c.name).sort()

    expect(enDrizzle).toEqual(enBase)
  })

  it('should declare in Drizzle the indexes and CHECK constraints added by 0030, under the names used in the database', async () => {
    const config = getTableConfig(paiements)
    const enBase = await indexDe('paiements')
    const checksEnBase = await contraintes('paiements')

    for (const nom of ['paiements_liste_admin_idx', 'paiements_encaisse_idx']) {
      expect(config.indexes.map((i) => i.config.name), nom).toContain(nom)
      expect(Object.keys(enBase), nom).toContain(nom)
    }
    for (const nom of ['paiements_source_check', 'paiements_source_coherence_check']) {
      expect(config.checks.map((c) => c.name), nom).toContain(nom)
      expect(Object.keys(checksEnBase), nom).toContain(nom)
    }
    expect(getTableConfig(webhooksRefuses).checks.map((c) => c.name).sort()).toEqual([
      'webhooks_refuses_fournisseur_check', 'webhooks_refuses_motif_check', 'webhooks_refuses_nombre_check',
    ])
  })
})

// P1 (migration 0033) : 0030 ne se rejoue plus SEUL sur l'état courant (ses CHECK n'admettent que 'kpay' | 'manuel' et la
// base contient des lignes 'fournisseur'). Le rejeu est donc éprouvé dans l'état d'avant 0033 : on exécute d'abord le
// retour arrière documenté de 0033, on rejoue 0030 deux fois, puis on rejoue 0033. Tout se passe dans UNE transaction
// ANNULÉE à la fin : rien n'est jamais validé dans la base commune, donc aucun état intermédiaire n'y survit.
describe('migration 0030 : rejouabilité (dans l\'état d\'avant 0033)', () => {
  const MIGRATION_0033 = path.join(MIGRATIONS_DIR, '0033_p1_paiements_source_fournisseur.sql')

  function instructionsDe0030(): string[] {
    const contenu = readFileSync(path.join(MIGRATIONS_DIR, fichierMigration()), 'utf-8')
    return contenu
      .split(BREAKPOINT)
      .map((bloc) => bloc.trim())
      .filter((bloc) => bloc.split('\n').some((ligne) => ligne.trim() !== '' && !ligne.trimStart().startsWith('--')))
  }

  function instructionsUp0033(): string[] {
    const contenu = readFileSync(MIGRATION_0033, 'utf-8')
    return contenu
      .slice(0, contenu.indexOf('-- ROLLBACK'))
      .split(BREAKPOINT)
      .map((bloc) => bloc.split('\n').filter((ligne) => !ligne.trimStart().startsWith('--')).join('\n').trim())
      .filter((bloc) => bloc !== '')
  }

  function instructionsRollback0033(): string[] {
    const lignes = readFileSync(MIGRATION_0033, 'utf-8').split('\n')
    const debut = lignes.findIndex((l) => l.trim() === '-- BEGIN;')
    const fin = lignes.findIndex((l) => l.trim() === '-- COMMIT;')
    if (debut === -1 || fin <= debut) throw new Error('Bloc ROLLBACK de 0033 introuvable.')
    return lignes.slice(debut + 1, fin).map((l) => l.replace(/^--\s?/, '').trim()).filter((l) => l !== '')
  }

  type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
  class AnnulationVolontaire extends Error {}

  async function executer(tx: Transaction, instructions: string[]): Promise<void> {
    for (const instruction of instructions) await tx.execute(sql.raw(instruction))
  }

  /** Joue `corps` dans l'état d'avant 0033, puis rétablit 0033, puis ANNULE toute la transaction. */
  async function dansEtatAvant0033(corps: (tx: Transaction) => Promise<void>): Promise<void> {
    const erreur = await rejet(db.transaction(async (tx) => {
      await executer(tx, instructionsRollback0033())
      await corps(tx)
      await executer(tx, instructionsUp0033())
      throw new AnnulationVolontaire('annulation volontaire de la transaction de test')
    }))
    expect(erreur.brute).toBeInstanceOf(AnnulationVolontaire)
  }

  async function contraintesDans(tx: Transaction): Promise<Record<string, Contrainte>> {
    const resultat = await tx.execute<{ conname: string, convalidated: boolean, def: string }>(sql`
      SELECT conname, convalidated, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = 'public.paiements'::regclass AND contype = 'c'`)
    return Object.fromEntries(resultat.rows.map((r) => [r.conname, { type: 'c', validee: r.convalidated, definition: r.def }]))
  }

  it('should replay twice without error and without losing any data (K-PAY payment, manual payment, refusal counter), then 0033 relabels the K-PAY row', async () => {
    const kpay = paiementKpay({ source: 'kpay' })
    const manuel = paiementManuel()
    const heure = new Date('2026-11-14T10:00:00.000Z')

    await dansEtatAvant0033(async (tx) => {
      await tx.insert(paiements).values([kpay, manuel])
      await tx.execute(sql`INSERT INTO webhooks_refuses (heure, fournisseur, motif, nombre) VALUES (${heure}, 'kpay', 'SIGNATURE_INVALIDE', 2)`)

      await executer(tx, instructionsDe0030())
      await executer(tx, instructionsDe0030())

      const apres0030 = await tx.select({ id: paiements.id, source: paiements.source }).from(paiements)
      expect(apres0030.sort((a, b) => a.source.localeCompare(b.source))).toEqual([{ id: kpay.id, source: 'kpay' }, { id: manuel.id, source: 'manuel' }])
      expect((await tx.select().from(webhooksRefuses)).map((l) => l.nombre)).toEqual([2])

      await executer(tx, instructionsUp0033())

      const apres0033 = await tx.select({ id: paiements.id, source: paiements.source }).from(paiements)
      expect(apres0033.sort((a, b) => a.source.localeCompare(b.source))).toEqual([{ id: kpay.id, source: 'fournisseur' }, { id: manuel.id, source: 'manuel' }])
    })
  })

  it('should keep the 0030 constraints validated and effective after a replay (a manual payment without reference is refused)', async () => {
    await dansEtatAvant0033(async (tx) => {
      await executer(tx, instructionsDe0030())

      const c = await contraintesDans(tx)
      expect(c.paiements_source_check?.validee).toBe(true)
      expect(c.paiements_source_check?.definition).toContain("'kpay'")
      expect(c.paiements_source_coherence_check?.validee).toBe(true)
      await tx.execute(sql`SAVEPOINT avant_refus`)
      const erreur = await rejet(tx.insert(paiements).values(paiementManuel({ referenceFournisseur: null })))
      expect(erreurPostgres(erreur.brute)).toMatchObject({ sqlstate: CHECK_VIOLATION, contrainte: 'paiements_source_coherence_check' })
      await tx.execute(sql`ROLLBACK TO SAVEPOINT avant_refus`)
    })
  })

  it('should leave the common database in the post-0033 state (nothing from the replays is committed)', async () => {
    const c = await contraintes('paiements')

    expect(c.paiements_source_check?.definition).toContain("'fournisseur'")
    expect(c.paiements_source_check?.definition).not.toContain("'kpay'")
    expect(c.paiements_source_coherence_check?.definition).toContain("'fournisseur'")
  })
})
