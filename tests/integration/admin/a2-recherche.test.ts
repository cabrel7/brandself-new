import { inArray, sql } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  schemaListeUtilisateursDto,
  schemaListeVitrinesDto,
  schemaRechercheDto,
  schemaUtilisateurFicheDto,
  schemaVitrineFicheDto,
} from '../../../shared/schemas/admin-a2'
import { users } from '../../../shared/db/schema'
import { db } from '../../../server/utils/db'
import { ouvrirAdmin, preparerSuiteAdmin } from '../support/admin'
import {
  CANARIS_VISITEUR,
  appelerA2,
  bloquerEnBase,
  compterEcritures,
  creerCompteSimple,
  creerMondeA2,
  depublierParLePro,
  poserAssistant,
  suspendreEnBase,
  viderClientsOauth,
} from '../support/admin-a2'
import { createSession } from '../support/fabriques'
import { poserAbonnement } from '../support/abonnements'

// A2 CA09, D-A2-11, D-A2-12 : recherche globale, listes (pagination, tri en liste blanche, filtres) et fiches, sur
// PostgreSQL réel. Les réponses sont relues par les schémas STRICTS partagés : une clé en trop échoue.

const suite = preparerSuiteAdmin()
const JOUR_MS = 86_400_000
let cookie: string

beforeEach(async () => {
  await viderClientsOauth()
  ;({ cookie } = await ouvrirAdmin(suite.auth()))
})

const rechercher = (q: string | undefined, extra: Record<string, string> = {}) =>
  appelerA2('recherche', { cookie, query: { ...(q === undefined ? {} : { q }), ...extra } })

interface Resultats {
  utilisateurs: Array<{ id: string, email: string, username: string | null, suspendu: boolean }>
  vitrines: Array<{ id: string, username: string, utilisateurId: string }>
}
const lire = (reponse: { corps: unknown }): Resultats => schemaRechercheDto.parse(reponse.corps) as unknown as Resultats
const ids = (reponse: { corps: unknown }): string[] => lire(reponse).utilisateurs.map((u) => u.id)

describe('recherche : e-mail, téléphone, username, nom (CA09, D-A2-11)', () => {
  it('should find an account by its e-mail, case-insensitive, and NOT by a fragment of it', async () => {
    const { user } = await creerCompteSimple({ email: 'Alice.Recherche@Exemple.Test' })

    const exacte = await rechercher('alice.recherche@exemple.test')
    const casse = await rechercher('ALICE.RECHERCHE@EXEMPLE.TEST')
    const fragment = await rechercher('alice.recherche@exem')

    expect(exacte.status).toBe(200)
    expect(ids(exacte)).toContain(user.id)
    expect(ids(casse)).toContain(user.id)
    expect(ids(fragment)).not.toContain(user.id)
  })

  it.each(['+237699111222', '237699111222', '+237 699 111 222', '237-699-111-222'])('should find an account by its phone number typed as « %s » (digits compared)', async (saisie) => {
    const { user } = await creerCompteSimple({ phoneNumber: '+237699111222' })

    expect(ids(await rechercher(saisie))).toContain(user.id)
  })

  it('should NOT find a phone number by a partial or by the national part alone (equality, not a LIKE)', async () => {
    const { user } = await creerCompteSimple({ phoneNumber: '+237699111222' })

    expect(ids(await rechercher('699111222'))).not.toContain(user.id)
    expect(ids(await rechercher('+23769911'))).not.toContain(user.id)
  })

  it('should find an account by the PREFIX of its username, not by a fragment inside it', async () => {
    const { user } = await creerCompteSimple({}, { username: 'dr-recherche-prefixe' })

    const prefixe = await rechercher('dr-recherche')
    const milieu = await rechercher('recherche-pre')

    expect(ids(prefixe)).toContain(user.id)
    expect(lire(prefixe).vitrines.map((v) => v.username)).toContain('dr-recherche-prefixe')
    expect(lire(milieu).vitrines.map((v) => v.username)).not.toContain('dr-recherche-prefixe')
  })

  it('should find an account by a fragment of its name (contains, case-insensitive)', async () => {
    const { user } = await creerCompteSimple({ name: 'Zorglub Martinez-Ouedraogo' })

    expect(ids(await rechercher('glub martin'))).toContain(user.id)
    expect(ids(await rechercher('OUEDRAOGO'))).toContain(user.id)
  })

  it('should find a vitrine by a fragment of the professional\'s name', async () => {
    await creerCompteSimple({}, { username: 'vitrine-nommee', nom: 'Quasimodo-Tchatchoua' })

    const resultat = lire(await rechercher('tchatchoua'))

    expect(resultat.vitrines.map((v) => v.username)).toContain('vitrine-nommee')
  })

  it('should return suspended accounts, flagged as such, and accounts without vitrine', async () => {
    const suspendu = await creerCompteSimple({ name: 'Suspendue Trouvable' })
    const sans = await creerCompteSimple({ name: 'Sans-Vitrine Trouvable' }, null)
    await suspendreEnBase(suspendu.user.id)

    const trouves = lire(await rechercher('Trouvable')).utilisateurs

    expect(trouves.find((u) => u.id === suspendu.user.id)?.suspendu).toBe(true)
    expect(trouves.find((u) => u.id === sans.user.id)?.username).toBeNull()
  })

  it('should return at most 10 results per group', async () => {
    for (let i = 0; i < 12; i += 1) await creerCompteSimple({ name: `Duplicata Numero ${i}` }, { username: `duplicata-${i}` })

    const resultat = lire(await rechercher('Duplicata'))

    expect(resultat.utilisateurs).toHaveLength(10)
    expect(resultat.vitrines.length).toBeLessThanOrEqual(10)
  })

  it('should return empty groups (200) for a term that matches nothing', async () => {
    expect((await rechercher('zzzaucunresultatzzz')).corps).toEqual({ utilisateurs: [], vitrines: [] })
  })
})

describe('recherche : bornes (CA09)', () => {
  it.each([
    ['2 characters', 'ab'],
    ['2 characters padded with spaces', '  ab  '],
    ['only spaces', '        '],
    ['empty', ''],
    ['101 characters', 'a'.repeat(101)],
  ])('should answer 422 for a query of %s', async (_cas, q) => {
    expect((await rechercher(q)).status).toBe(422)
  })

  it('should answer 422 when q is missing, repeated, or accompanied by an unknown parameter', async () => {
    expect((await rechercher(undefined)).status).toBe(422)
    expect((await rechercher('abc', { page: '1' })).status).toBe(422)
  })

  it.each(['abc', 'a'.repeat(100)])('should accept a query of exactly 3 and 100 characters (%#)', async (q) => {
    expect((await rechercher(q)).status).toBe(200)
  })
})

describe('recherche : aucune injection (ILIKE `%` et `_`, SQL)', () => {
  beforeEach(async () => {
    for (const nom of ['Alpha Beta', 'Gamma Delta', 'Abc Def']) await creerCompteSimple({ name: nom }, null)
  })

  it.each(['%%%', '___', '%_%', '\\\\\\', '% %', 'a%c', 'a_c'])('should treat %j as literal text: no wildcard expansion, no error', async (q) => {
    const reponse = await rechercher(q)

    expect(reponse.status).toBe(200)
    const trouves = ids(reponse)
    const noms = trouves.length === 0 ? [] : (await db.select({ name: users.name }).from(users).where(inArray(users.id, trouves))).map((r) => r.name)
    for (const nom of noms) expect(nom.toLowerCase(), `« ${nom} » ne contient pas littéralement ${q}`).toContain(q.toLowerCase())
  })

  it('should find a name that contains a literal percent sign or underscore', async () => {
    const pourcent = await creerCompteSimple({ name: 'Remise 100% Garantie' }, null)
    const souligne = await creerCompteSimple({ name: 'Jean_Pierre Special' }, null)

    expect(ids(await rechercher('100%'))).toContain(pourcent.user.id)
    expect(ids(await rechercher('an_pi'))).toContain(souligne.user.id)
    expect(ids(await rechercher('an_pi'))).not.toContain(pourcent.user.id)
  })

  it('should neutralise SQL fragments: 200 with no result, and the tables are intact', async () => {
    const avant = (await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM users`)).rows[0]?.n

    for (const q of ['\'; DROP TABLE users; --', '" OR 1=1 --', 'abc\' UNION SELECT * FROM sessions --', '${process.env.SECRET}']) {
      const reponse = await rechercher(q)
      expect(reponse.status, q).toBe(200)
      expect(ids(reponse), q).toEqual([])
    }

    expect((await db.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM users`)).rows[0]?.n).toBe(avant)
  })
})

describe('recherche : jamais dans le contenu des visiteurs (D-A2-11)', () => {
  it('should find nothing when the term is the name, e-mail, phone, motif or message of a visitor, and leak none of them', async () => {
    const m = await creerMondeA2()
    const { createMessage } = await import('../../../server/services/messages')
    await createMessage(m.vitrine.username, { nom: CANARIS_VISITEUR.nom, email: CANARIS_VISITEUR.email, telephone: CANARIS_VISITEUR.telephone, sujet: 'autre', message: CANARIS_VISITEUR.message })
    expect((await compterEcritures(m.vitrine.id)).messages).toBe(1)

    for (const terme of [CANARIS_VISITEUR.nom, CANARIS_VISITEUR.email, CANARIS_VISITEUR.telephone, CANARIS_VISITEUR.motif, CANARIS_VISITEUR.message]) {
      const reponse = await rechercher(terme)
      expect(reponse.status, terme).toBe(200)
      expect(reponse.corps, terme).toEqual({ utilisateurs: [], vitrines: [] })
    }
  })
})

describe('liste des utilisateurs : pagination, tri, filtres (D-A2-12)', () => {
  const liste = (query: Record<string, string> = {}) => appelerA2('utilisateursListe', { cookie, query })
  const lireListe = (reponse: { corps: unknown }) => schemaListeUtilisateursDto.parse(reponse.corps)

  it('should answer 25 per page by default, newest first, with the real total, and every row passes the strict schema', async () => {
    for (let i = 0; i < 29; i += 1) await creerCompteSimple({ createdAt: new Date(Date.UTC(2026, 0, 1 + i)) }, i % 2 === 0 ? {} : null)

    const page1 = lireListe(await liste())
    const page2 = lireListe(await liste({ page: '2' }))

    expect(page1).toMatchObject({ total: 30, page: 1, limite: 25 })
    expect(page1.elements).toHaveLength(25)
    expect(page2.elements).toHaveLength(5)
    const dates = page1.elements.map((e) => Date.parse(e.inscritLe))
    expect([...dates].sort((a, b) => b - a)).toEqual(dates)
    expect(new Set([...page1.elements, ...page2.elements].map((e) => e.id)).size).toBe(30)
  })

  it('should honour limite=100 and reject 0, 101, a non-number, page 0 and a page above the maximum', async () => {
    await creerCompteSimple()

    expect((await liste({ limite: '100' })).status).toBe(200)
    for (const query of [{ limite: '0' }, { limite: '101' }, { limite: 'abc' }, { limite: '2.5' }, { page: '0' }, { page: '-1' }, { page: '10001' }]) {
      expect((await liste(query)).status, JSON.stringify(query)).toBe(422)
    }
  })

  it('should return an empty page (not an error) beyond the last page', async () => {
    await creerCompteSimple()

    const reponse = await liste({ page: '50' })

    expect(reponse.status).toBe(200)
    expect(lireListe(reponse).elements).toEqual([])
  })

  it('should sort by e-mail in both directions', async () => {
    for (const email of ['b@exemple.test', 'a@exemple.test', 'c@exemple.test']) await creerCompteSimple({ email }, null)

    const asc = lireListe(await liste({ tri: 'email', ordre: 'asc' })).elements.map((e) => e.email)

    expect(asc).toEqual([...asc].sort())
    expect(lireListe(await liste({ tri: 'email', ordre: 'desc' })).elements.map((e) => e.email)).toEqual([...asc].reverse())
  })

  it.each(['cree_le', 'email', 'derniere_connexion', 'plan'])('should accept the whitelisted sort %s', async (tri) => {
    await creerCompteSimple()

    expect((await liste({ tri })).status).toBe(200)
  })

  it.each(['password', 'name', 'id', 'cree_le; DROP TABLE users', 'cree_le,email', '', 'CREE_LE'])('should answer 422 for the sort %j (whitelist only, nothing reaches SQL)', async (tri) => {
    expect((await liste({ tri })).status).toBe(422)
    expect((await liste({ ordre: tri })).status).toBe(422)
  })

  it('should filter by plan and by state, deriving the state from the subscription (actif, grâce, gratuit)', async () => {
    const actif = await creerCompteSimple({}, null)
    const grace = await creerCompteSimple({}, null)
    const termine = await creerCompteSimple({}, null)
    const gratuit = await creerCompteSimple({}, null)
    await poserAbonnement(actif.user.id, new Date(Date.now() + 20 * JOUR_MS))
    await poserAbonnement(grace.user.id, new Date(Date.now() - 3 * JOUR_MS))
    await poserAbonnement(termine.user.id, new Date(Date.now() - 30 * JOUR_MS))

    const idsDe = async (query: Record<string, string>) => lireListe(await liste(query)).elements.map((e) => e.id)

    expect(await idsDe({ etat: 'actif' })).toEqual([actif.user.id])
    expect(await idsDe({ etat: 'grace' })).toEqual([grace.user.id])
    expect((await idsDe({ plan: 'payant' })).sort()).toEqual([actif.user.id, grace.user.id].sort())
    expect(await idsDe({ plan: 'gratuit' })).toEqual(expect.arrayContaining([termine.user.id, gratuit.user.id]))
    expect(await idsDe({ plan: 'gratuit' })).not.toContain(actif.user.id)
  })

  it('should filter suspended accounts, and by vitrine state (publiee, bloquee, aucune)', async () => {
    const publiee = await creerCompteSimple({}, { publiee: true })
    const bloquee = await creerCompteSimple({}, { publiee: true })
    const sans = await creerCompteSimple({}, null)
    const brouillon = await creerCompteSimple({}, { publiee: false })
    await bloquerEnBase(bloquee.vitrine!.id)
    await suspendreEnBase(sans.user.id)
    const idsDe = async (query: Record<string, string>) => lireListe(await liste(query)).elements.map((e) => e.id)

    expect(await idsDe({ suspendu: 'true' })).toEqual([sans.user.id])
    expect(await idsDe({ vitrine: 'bloquee' })).toEqual([bloquee.user.id])
    expect(await idsDe({ vitrine: 'aucune' })).toEqual(expect.arrayContaining([sans.user.id]))
    expect(await idsDe({ vitrine: 'aucune' })).not.toContain(publiee.user.id)
    expect(await idsDe({ vitrine: 'publiee' })).toEqual(expect.arrayContaining([publiee.user.id]))
    expect(await idsDe({ vitrine: 'publiee' })).not.toContain(brouillon.user.id)
    const ligne = lireListe(await liste({ vitrine: 'bloquee' })).elements[0]
    expect(ligne?.vitrine).toEqual({ publiee: true, bloquee: true })
  })

  it('should filter by registration range (du, au) inclusive of both days, and refuse a malformed date', async () => {
    const dedans = await creerCompteSimple({ createdAt: new Date('2026-03-15T12:00:00.000Z') }, null)
    const dehors = await creerCompteSimple({ createdAt: new Date('2026-04-20T12:00:00.000Z') }, null)

    const trouves = lireListe(await liste({ du: '2026-03-01', au: '2026-03-31' })).elements.map((e) => e.id)

    expect(trouves).toContain(dedans.user.id)
    expect(trouves).not.toContain(dehors.user.id)
    for (const query of [{ du: '2026-13-45' }, { au: 'demain' }, { du: '15/03/2026' }]) expect((await liste(query)).status, JSON.stringify(query)).toBe(422)
  })

  it('should combine the search term of the list with the filters, and keep the 3-character minimum', async () => {
    const cible = await creerCompteSimple({ name: 'Combinaison Cherchee' }, null)
    await creerCompteSimple({ name: 'Combinaison Autre' }, null)
    await suspendreEnBase(cible.user.id)

    const reponse = await liste({ q: 'Combinaison', suspendu: 'true' })

    expect(lireListe(reponse).elements.map((e) => e.id)).toEqual([cible.user.id])
    expect((await liste({ q: 'ab' })).status).toBe(422)
  })
})

describe('fiche d\'un utilisateur (D-A2-12, §5)', () => {
  const fiche = (id: string) => appelerA2('utilisateurFiche', { id, cookie })

  it('should describe the account, its subscription, counters, activity, live sessions and assistants through the strict schema', async () => {
    const m = await creerMondeA2({ payantJours: 30 })
    await createSession(m.user.id)
    await poserAssistant(m.user.id, { nom: 'Mon assistant', scopes: ['vitrine:lecture'] })

    const reponse = await fiche(m.user.id)

    expect(reponse.status).toBe(200)
    const dto = schemaUtilisateurFicheDto.parse(reponse.corps)
    expect(dto).toMatchObject({
      id: m.user.id,
      email: m.user.email,
      suspendu: false,
      motifSuspension: null,
      username: m.vitrine.username,
      plan: 'payant',
      etat: 'actif',
      devise: 'XAF',
      fuseau: 'Africa/Douala',
      abonnement: { origine: 'paiement' },
      compteurs: { services: 2, realisations: 1, temoignages: 1, liens: 1 },
    })
    expect(dto.activite30j.reservations).toBe(1)
    expect(dto.sessionsActives).toHaveLength(1)
    expect(dto.assistants).toHaveLength(1)
    expect(dto.assistants[0]).toMatchObject({ client: 'Mon assistant', portees: ['vitrine:lecture'] })
  })

  it('should show the motif of a suspension, and the state of the vitrine', async () => {
    const m = await creerMondeA2()
    await suspendreEnBase(m.user.id, 'Un motif de suspension visible')

    const dto = schemaUtilisateurFicheDto.parse((await fiche(m.user.id)).corps)

    expect(dto).toMatchObject({ suspendu: true, motifSuspension: 'Un motif de suspension visible', vitrine: { publiee: true, bloquee: false } })
  })

  it('should never contain the identity or the content of a visitor, a session token, an IP address or an OAuth token', async () => {
    const m = await creerMondeA2()
    const { createMessage } = await import('../../../server/services/messages')
    await createMessage(m.vitrine.username, { nom: CANARIS_VISITEUR.nom, email: CANARIS_VISITEUR.email, telephone: CANARIS_VISITEUR.telephone, sujet: 'autre', message: CANARIS_VISITEUR.message })
    await createSession(m.user.id)
    await poserAssistant(m.user.id)

    const brut = JSON.stringify((await fiche(m.user.id)).corps)

    for (const interdit of [...Object.values(CANARIS_VISITEUR), m.confirmationToken, 'jeton-secret', '203.0.113.7', 'Mozilla', 'refresh-', 'acces-']) {
      expect(brut, interdit).not.toContain(interdit)
    }
  })

  it('should count the activity of the last 30 days only, with numbers only', async () => {
    const m = await creerMondeA2()
    await db.execute(sql`UPDATE reservations SET created_at = now() - interval '45 days' WHERE vitrine_id = ${m.vitrine.id}`)

    const dto = schemaUtilisateurFicheDto.parse((await fiche(m.user.id)).corps)

    expect(dto.activite30j.reservations).toBe(0)
  })

  it('should answer 404 UTILISATEUR_INTROUVABLE for an unknown id, and 422 for an id longer than 64 characters', async () => {
    expect(await fiche('00000000-0000-4000-8000-000000000000')).toMatchObject({ status: 404, code: 'UTILISATEUR_INTROUVABLE' })
    expect((await fiche('x'.repeat(65))).status).toBe(422)
  })

  it('should neither fail nor expose SQL for an identifier built to inject', async () => {
    const reponse = await fiche('\' OR \'1\'=\'1')

    expect([404, 422]).toContain(reponse.status)
    expect(JSON.stringify(reponse)).not.toMatch(/select|syntax|pg_|relation/i)
  })
})

describe('liste et fiche des vitrines', () => {
  const liste = (query: Record<string, string> = {}) => appelerA2('vitrinesListe', { cookie, query })

  it('should filter by statut (publiee, bloquee, non_publiee), expose the block motif and the owner\'s suspension', async () => {
    const publiee = await creerCompteSimple({}, { username: 'vit-publiee', publiee: true })
    const bloquee = await creerCompteSimple({}, { username: 'vit-bloquee', publiee: true })
    const brouillon = await creerCompteSimple({}, { username: 'vit-brouillon', publiee: false })
    const suspendue = await creerCompteSimple({}, { username: 'vit-suspendue', publiee: true })
    await bloquerEnBase(bloquee.vitrine!.id, 'Motif de blocage affiché')
    await suspendreEnBase(suspendue.user.id)
    const usernames = async (statut: string) => schemaListeVitrinesDto.parse((await liste({ statut })).corps).elements.map((v) => v.username)

    expect(await usernames('bloquee')).toEqual(['vit-bloquee'])
    expect(await usernames('non_publiee')).toEqual(expect.arrayContaining(['vit-brouillon']))
    expect(await usernames('non_publiee')).not.toContain('vit-publiee')
    expect(await usernames('publiee')).toEqual(expect.arrayContaining(['vit-publiee']))
    const tous = schemaListeVitrinesDto.parse((await liste()).corps).elements
    expect(tous.find((v) => v.username === 'vit-bloquee')).toMatchObject({ bloquee: true, publiee: true, blocageMotif: 'Motif de blocage affiché', proprietaireSuspendu: false })
    expect(tous.find((v) => v.username === 'vit-suspendue')).toMatchObject({ proprietaireSuspendu: true, bloquee: false })
    expect(publiee.user.id).toBeTruthy()
    expect(brouillon.user.id).toBeTruthy()
  })

  it('should sort by username and nom (whitelist), and refuse any other sort', async () => {
    await creerCompteSimple({}, { username: 'tri-b' })
    await creerCompteSimple({}, { username: 'tri-a' })

    const asc = schemaListeVitrinesDto.parse((await liste({ tri: 'username', ordre: 'asc' })).corps).elements.map((v) => v.username)

    expect(asc).toEqual([...asc].sort())
    expect((await liste({ tri: 'nom' })).status).toBe(200)
    expect((await liste({ tri: 'email' })).status).toBe(422)
    expect((await liste({ statut: 'inconnu' })).status).toBe(422)
  })

  it('should search a vitrine by username prefix, with the 3-character minimum', async () => {
    await creerCompteSimple({}, { username: 'boulangerie-du-coin' })

    expect(schemaListeVitrinesDto.parse((await liste({ q: 'boulang' })).corps).elements.map((v) => v.username)).toEqual(['boulangerie-du-coin'])
    expect((await liste({ q: 'bo' })).status).toBe(422)
  })

  it('should give the fiche with counters and publication date through the strict schema, never visitor content', async () => {
    const m = await creerMondeA2()
    await depublierParLePro(m.vitrine.id)

    const reponse = await appelerA2('vitrineFiche', { id: m.vitrine.id, cookie })

    expect(reponse.status).toBe(200)
    const dto = schemaVitrineFicheDto.parse(reponse.corps)
    expect(dto).toMatchObject({ id: m.vitrine.id, utilisateurId: m.user.id, username: m.vitrine.username, publiee: false, publieeLe: null, compteurs: { services: 2, realisations: 1, temoignages: 1, liens: 1 } })
    const brut = JSON.stringify(reponse.corps)
    for (const interdit of [...Object.values(CANARIS_VISITEUR), m.confirmationToken]) expect(brut).not.toContain(interdit)
  })

  it('should answer 404 for an unknown vitrine', async () => {
    expect((await appelerA2('vitrineFiche', { id: '00000000-0000-4000-8000-000000000000', cookie })).status).toBe(404)
  })
})
