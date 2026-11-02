import { afterEach, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import type { H3Event } from 'h3'
import type { Pipeline } from 'ioredis'
import { db } from '../../server/utils/db'
import { redis } from '../../server/utils/redis'
import { MESSAGE_CONTACT_LIMIT, MESSAGE_PUBLIC_LIMIT, MESSAGE_VITRINE_LIMIT } from '../../shared/limites'
import { MESSAGES_LISTE_MAX } from '../../shared/message'
import { fakeEvent } from '../support/h3'
import { exigerModulesPresents, rejet } from './support/erreurs'
import { creerContexteAgenda } from './support/agenda'

// S7-bis, PG réel : services messages — CA8 (création transactionnelle message + outbox,
// téléphone facultatif), CA10 (limite de contact 3/24 h, Redis réel), CA15/CA16/CA18
// (studio : liste DTO propre, lu idempotent, isolation entre vitrines), plafond par vitrine
// (route réelle + Redis réel + PG réel) et plafond de la liste du studio (MESSAGES_LISTE_MAX).
// Les messages passent par les services réels, sauf les 200+ lignes du test de plafond de liste
// (insérées en SQL pour dater précisément chaque ligne : seul le tri/plafond est prouvé).

const messagesService = () => import('../../server/services/messages')
const ressourceMessage = () => import('../../server/resources/message')
const contactLimiteurService = () => import('../../server/services/contact-limiteur')

const VISITEUR_MESSAGES = {
  nom: 'Marie Ndzi',
  email: 'marie.ndzi@exemple.test',
  telephone: '+237699000001',
  sujet: 'question_avant_reservation' as const,
  message: 'Bonjour, le rendez-vous peut-il être décalé ?',
}

interface MessageDb {
  id: string
  vitrineId: string
  nom: string
  email: string
  telephone: string | null
  sujet: string
  message: string
  luLe: Date | null
  createdAt: Date
}

interface MessageSqlRow extends Omit<MessageDb, 'luLe' | 'createdAt'> {
  luLe: Date | string | null
  createdAt: Date | string
}

function normaliser(row: MessageSqlRow): MessageDb {
  return {
    ...row,
    telephone: row.telephone ?? null,
    luLe: row.luLe === null ? null : (row.luLe instanceof Date ? row.luLe : new Date(row.luLe)),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  }
}

async function lireMessages(vitrineId: string): Promise<MessageDb[]> {
  const resultat = await db.execute<MessageSqlRow>(sql`
    SELECT id, vitrine_id AS "vitrineId", nom, email, telephone, sujet, message,
      lu_le AS "luLe", created_at AS "createdAt"
    FROM messages
    WHERE vitrine_id = ${vitrineId}
    ORDER BY created_at DESC, id
  `)
  return resultat.rows.map(normaliser)
}

async function lireOutbox(entiteId: string): Promise<Array<{ type: string, entiteType: string, statut: string }>> {
  const resultat = await db.execute<{ type: string, entiteType: string, statut: string }>(sql`
    SELECT type, entite_type AS "entiteType", statut
    FROM emails_transactionnels
    WHERE entite_id = ${entiteId}
    ORDER BY type
  `)
  return resultat.rows
}

describe('messages : création publique transactionnelle (CA8, CA13)', () => {
  it('insère le message et l’email outbox dans la même transaction, téléphone absent → null en base', async () => {
    const { createMessage } = await messagesService()
    const { vitrine } = await creerContexteAgenda({ username: 'messages-creation' })
    const { telephone: _omis, ...sansTelephone } = VISITEUR_MESSAGES

    const { item } = await createMessage(vitrine.username, sansTelephone)

    expect(item.id).toMatch(/^[\w-]{8,}$/)
    expect(item.createdAt).toBeInstanceOf(Date)
    const lignes = await lireMessages(vitrine.id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]).toMatchObject({
      id: item.id,
      vitrineId: vitrine.id,
      nom: VISITEUR_MESSAGES.nom,
      email: VISITEUR_MESSAGES.email,
      telephone: null,
      sujet: VISITEUR_MESSAGES.sujet,
      message: VISITEUR_MESSAGES.message,
      luLe: null,
    })
    expect(lignes[0]!.createdAt).toBeInstanceOf(Date)

    const outbox = await lireOutbox(item.id)
    expect(outbox).toEqual([
      { type: 'message_professionnel_nouvelle', entiteType: 'message', statut: 'en_attente' },
    ])
  })

  it('garde le téléphone fourni tel quel (E.164), jamais transformé ni normalisé en base', async () => {
    const { createMessage } = await messagesService()
    const { vitrine } = await creerContexteAgenda({ username: 'messages-telephone' })

    await createMessage(vitrine.username, VISITEUR_MESSAGES)

    const lignes = await lireMessages(vitrine.id)
    expect(lignes).toHaveLength(1)
    expect(lignes[0]!.telephone).toBe(VISITEUR_MESSAGES.telephone)
  })

  it('refuse un message sur une vitrine inconnue ou non publiée (404 VITRINE_INTROUVABLE, aucune écriture)', async () => {
    const { createMessage } = await messagesService()
    const { vitrine } = await creerContexteAgenda({ username: 'messages-non-publiee' })
    await db.execute(sql`UPDATE vitrines SET publiee_le = NULL WHERE id = ${vitrine.id}`)

    const erreur = await rejet(createMessage(vitrine.username, VISITEUR_MESSAGES))

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('VITRINE_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect(await lireMessages(vitrine.id)).toEqual([])
  })

  it('annule l’outbox quand son insertion échoue : la transaction ne laisse aucune ligne message (CA8 atomicité)', async () => {
    const { createMessage } = await messagesService()
    const { vitrine } = await creerContexteAgenda({ username: 'messages-atomicite' })
    const bloqueOutbox = 'test_outbox_message_interdit'

    // La base d'intégration est partagée entre les tests du fichier : on purge les
    // événements du type ciblé pour que le CHECK bloquant puisse être posé.
    await db.execute(sql`DELETE FROM emails_transactionnels WHERE type = 'message_professionnel_nouvelle'`)

    try {
      await db.execute(sql.raw(
        `ALTER TABLE emails_transactionnels ADD CONSTRAINT ${bloqueOutbox} CHECK (type <> 'message_professionnel_nouvelle')`,
      ))
      await rejet(createMessage(vitrine.username, VISITEUR_MESSAGES))
    } finally {
      await db.execute(sql.raw(`ALTER TABLE emails_transactionnels DROP CONSTRAINT IF EXISTS ${bloqueOutbox}`))
    }

    expect(await lireMessages(vitrine.id)).toEqual([])
    const outboxRestants = await db.execute<{ n: number }>(sql`
      SELECT COUNT(*)::int AS n FROM emails_transactionnels WHERE entite_type = 'message'
    `)
    expect(outboxRestants.rows[0]?.n ?? 0).toBe(0)
  })
})

describe('messages : studio, liste et lu (CA15, CA16, CA18)', () => {
  it('liste trié par date décroissante, avec le compteur de non lus, sans clé technique d’ORM', async () => {
    const { createMessage, listOwnMessages, markMessageLu } = await messagesService()
    const a = await creerContexteAgenda({ username: 'messages-studio-a' })
    const { item: premier } = await createMessage(a.vitrine.username, {
      ...VISITEUR_MESSAGES, sujet: 'question_avant_reservation',
    })
    const { item: deuxieme } = await createMessage(a.vitrine.username, {
      ...VISITEUR_MESSAGES, email: 'autre@exemple.test', sujet: 'demande_information',
    })
    const { item: troisieme } = await createMessage(a.vitrine.username, {
      ...VISITEUR_MESSAGES, email: 'troisieme@exemple.test', sujet: 'autre',
    })
    await markMessageLu(a.user.id, deuxieme.id)

    const liste = await listOwnMessages(a.user.id)
    expect(liste.items.map((item) => item.id)).toEqual([troisieme.id, deuxieme.id, premier.id])
    expect(liste.nonLus).toBe(2)

    const { toMessagesStudioResource } = await ressourceMessage()
    const dto = toMessagesStudioResource(liste)
    expect(dto.nonLus).toBe(2)
    const cles = JSON.stringify(dto)
    for (const cleInterdite of ['vitrineId', 'userId', 'createdAt', 'updatedAt']) {
      expect(cles).not.toContain(`"${cleInterdite}"`)
    }
    expect(dto.items[1]).toMatchObject({
      id: deuxieme.id,
      nom: VISITEUR_MESSAGES.nom,
      email: 'autre@exemple.test',
      telephone: VISITEUR_MESSAGES.telephone,
      sujet: 'demande_information',
      message: VISITEUR_MESSAGES.message,
      luLe: expect.any(String),
      creeLe: expect.any(String),
    })
  })

  it('marque lu au premier dépliage puis reste idempotent : le marquage répété ne change pas luLe (CA16)', async () => {
    const { createMessage, markMessageLu } = await messagesService()
    const { vitrine, user } = await creerContexteAgenda({ username: 'messages-lu' })
    const { item: message } = await createMessage(vitrine.username, VISITEUR_MESSAGES)

    const { item: premiere } = await markMessageLu(user.id, message.id)
    expect(premiere.luLe).toBeInstanceOf(Date)

    const { item: seconde } = await markMessageLu(user.id, message.id)
    expect(seconde.luLe).not.toBeNull()
    expect((seconde.luLe as Date).getTime()).toBe((premiere.luLe as Date).getTime())

    const { toMessageLuResource } = await ressourceMessage()
    const dto = toMessageLuResource(seconde)
    expect(dto).toEqual({ item: { id: seconde.id, luLe: (seconde.luLe as Date).toISOString() } })
  })

  it('isole la liste et le marquage lu entre vitrines (CA18)', async () => {
    const { createMessage, listOwnMessages, markMessageLu } = await messagesService()
    const a = await creerContexteAgenda({ username: 'messages-isolation-a' })
    const b = await creerContexteAgenda({ username: 'messages-isolation-b' })
    const { item: messageA } = await createMessage(a.vitrine.username, VISITEUR_MESSAGES)

    expect((await listOwnMessages(b.user.id)).items).toEqual([])
    expect((await listOwnMessages(b.user.id)).nonLus).toBe(0)

    const erreur = await rejet(markMessageLu(b.user.id, messageA.id))
    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('MESSAGE_INTROUVABLE')
    expect(erreur.status).toBe(404)
    expect((await lireMessages(a.vitrine.id))[0]!.luLe).toBeNull()

    const inconnu = await rejet(markMessageLu(a.user.id, '0199a3b2-7c1d-7f0e-9b2a-3d4c5e6f7a8b'))
    expect(inconnu.code).toBe('MESSAGE_INTROUVABLE')
  })
})

describe('messages : ressource de création (201)', () => {
  it('produit un DTO de création { message: { id, sujet, creeLe } } sans clé technique', async () => {
    const { createMessage } = await messagesService()
    const { toMessageCreatedResource } = await ressourceMessage()
    const { vitrine } = await creerContexteAgenda({ username: 'messages-resource' })

    const { item } = await createMessage(vitrine.username, {
      ...VISITEUR_MESSAGES,
      sujet: 'demande_information' as const,
    })
    const dto = toMessageCreatedResource(item)

    expect(dto).toEqual({
      message: {
        id: item.id,
        sujet: 'demande_information',
        creeLe: item.createdAt.toISOString(),
      },
    })
    const clesProfondes = Object.entries(dto.message).map(([cle]) => cle)
    expect(clesProfondes).toEqual(['id', 'sujet', 'creeLe'])
  })
})

describe('messages : limite de contact (Redis réel, CA10)', () => {
  it('laisse passer exactement trois messages 24 h pour un même contact et rejette le 4e (429)', async () => {
    const { enforceContactLimit } = await contactLimiteurService()

    // Préchauffage : des contacts distincts d'une VITRINE distincte, pour ne pas
    // partager de compteur avec le contact éprouvé ci-dessous.
    for (let essai = 0; essai < 3; essai += 1) {
      await enforceContactLimit(
        'message-contact',
        'limite-echantillon',
        `echantillon-${essai}@exemple.test`,
        `+23769900010${essai}`,
      )
    }

    const contact = { username: 'limite-eprouve', email: 'limite-eprouve@exemple.test', telephone: '+237699000001' }
    for (let essai = 0; essai < 3; essai += 1) {
      await expect(
        enforceContactLimit('message-contact', contact.username, contact.email, contact.telephone),
      ).resolves.not.toThrow()
    }

    const erreur = await rejet(
      enforceContactLimit('message-contact', contact.username, contact.email, contact.telephone),
    )

    expect(erreur.estDomainError).toBe(true)
    expect(erreur.code).toBe('TROP_DE_REQUETES')
    expect(erreur.status).toBe(429)
    expect(erreur.retryAfter).toBeGreaterThan(0)
    expect(erreur.retryAfter).toBeLessThanOrEqual(86_400)
  })

  it('sépare les vitrines et les contacts : le blocage d’un contact ne touche pas les autres', async () => {
    const { enforceContactLimit } = await contactLimiteurService()
    const username = 'limite-isolation'

    for (let essai = 0; essai < 3; essai += 1) {
      await enforceContactLimit('message-contact', username, 'identique@exemple.test', null)
    }
    await rejet(enforceContactLimit('message-contact', username, 'identique@exemple.test', null))

    await expect(
      enforceContactLimit('message-contact', username, 'autre@exemple.test', null),
    ).resolves.not.toThrow()
    await expect(
      enforceContactLimit('message-contact', 'autre-vitrine', 'identique@exemple.test', null),
    ).resolves.not.toThrow()
  })

  it('incrémente deux compteurs distincts quand le téléphone est fourni', async () => {
    const { enforceContactLimit } = await contactLimiteurService()

    const resultats = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        enforceContactLimit('message-contact', 'limite-concurrent', 'concurrent@exemple.test', '+237699000003')),
    )
    exigerModulesPresents(resultats)

    const acceptes = resultats.filter((resultat) => resultat.status === 'fulfilled')
    expect(acceptes).toHaveLength(3)
    const refus = resultats.find((resultat): resultat is PromiseRejectedResult => resultat.status === 'rejected')
    expect((refus?.reason as { code?: string }).code).toBe('TROP_DE_REQUETES')
  })
})

// ---------------------------------------------------------------------------------------------
// Plafond par vitrine (revue sécurité S7-bis) : la route réelle enchaîne
//   limite IP → plafond de vitrine (Redis `limite:message-vitrine:{username}`) → Zod → limite
//   contact → service. Aucun mock : Redis réel, PG réel, handler Nitro réel sur un événement h3 réel.
// ---------------------------------------------------------------------------------------------

const routeMessagePublique = () => import('../../server/api/public/[username]/messages/index.post')

interface ReponseRoute {
  status: number
  code: string | undefined
  retryAfter: string | undefined
}

/** Adresse IPv4 unique par index : chaque appel part d'une IP différente pour ne pas buter sur la limite IP. */
function ipDe(index: number): string {
  return `10.20.${Math.floor(index / 250)}.${(index % 250) + 1}`
}

function corpsVisiteur(index: number): Record<string, unknown> {
  return {
    nom: `Visiteur ${index}`,
    email: `visiteur-${index}@exemple.test`,
    sujet: 'autre',
    message: `Message numéro ${index}.`,
    siteWeb: '',
  }
}

async function posterMessage(username: string, corps: Record<string, unknown>, ip: string): Promise<ReponseRoute> {
  const event: H3Event = fakeEvent({
    method: 'POST',
    params: { username },
    headers: { 'x-forwarded-for': ip },
    body: JSON.stringify(corps),
  })
  // Le proxy de confiance (loopback) transmet l'IP du visiteur : même chemin qu'en production.
  Object.defineProperty(event.node.req.socket, 'remoteAddress', { configurable: true, value: '127.0.0.1' })
  const { default: handler } = await routeMessagePublique()
  try {
    await handler(event)
    return { status: event.node.res.statusCode, code: undefined, retryAfter: undefined }
  } catch (erreur) {
    const h3 = erreur as { statusCode?: number, data?: { code?: string } }
    const retryAfter = event.node.res.getHeader('retry-after')
    return {
      status: h3.statusCode ?? -1,
      code: h3.data?.code,
      retryAfter: typeof retryAfter === 'string' ? retryAfter : undefined,
    }
  }
}

async function compteur(cle: string): Promise<number> {
  return Number((await redis.get(`limite:${cle}`)) ?? 0)
}

async function compterMessagesVitrine(vitrineId: string): Promise<number> {
  return (await lireMessages(vitrineId)).length
}

async function compterCleContact(): Promise<number> {
  return (await redis.keys('limite:message-contact:*')).length
}

/** Panne de Redis limitée aux commandes INCR dont la clé contient `fragment` ; le reste reste réel. */
function couperRedisPourCle(fragment: string) {
  const multiReel = redis.multi.bind(redis) as unknown as () => Pipeline
  return vi.spyOn(redis, 'multi').mockImplementation((() => {
    const pipeline = multiReel()
    const incrReel = pipeline.incr.bind(pipeline)
    pipeline.incr = ((cle: string) => {
      if (cle.includes(fragment)) throw new Error('Redis indisponible (panne simulée)')
      return incrReel(cle)
    }) as typeof pipeline.incr
    return pipeline
  }) as unknown as typeof redis.multi)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('messages : plafond par vitrine (route réelle, Redis réel)', () => {
  it('expose un plafond de 30 messages par heure (MESSAGE_VITRINE_LIMIT)', () => {
    expect(MESSAGE_VITRINE_LIMIT).toEqual({ limit: 30, windowS: 3600 })
  })

  it('accepte 30 messages d’emails et d’IP différents puis refuse le 31e en 429 avec Retry-After, sans rien écrire', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'messages-plafond' })

    for (let index = 1; index <= MESSAGE_VITRINE_LIMIT.limit; index += 1) {
      const reponse = await posterMessage(vitrine.username, corpsVisiteur(index), ipDe(index))
      expect(reponse.status, `message ${index}`).toBe(201)
    }
    expect(await compterMessagesVitrine(vitrine.id)).toBe(MESSAGE_VITRINE_LIMIT.limit)

    const refus = await posterMessage(vitrine.username, corpsVisiteur(31), ipDe(31))

    expect(refus.status).toBe(429)
    expect(refus.code).toBe('TROP_DE_REQUETES')
    expect(Number(refus.retryAfter)).toBeGreaterThan(0)
    expect(Number(refus.retryAfter)).toBeLessThanOrEqual(MESSAGE_VITRINE_LIMIT.windowS)
    expect(await compterMessagesVitrine(vitrine.id)).toBe(MESSAGE_VITRINE_LIMIT.limit)
    expect(await compteur('message-vitrine:messages-plafond')).toBe(MESSAGE_VITRINE_LIMIT.limit + 1)
    const ttl = await redis.ttl('limite:message-vitrine:messages-plafond')
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(MESSAGE_VITRINE_LIMIT.windowS)
  })

  it('applique le plafond AVANT la limite contact : le message refusé n’incrémente aucun compteur de contact', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'messages-plafond-ordre' })
    await redis.set('limite:message-vitrine:messages-plafond-ordre', String(MESSAGE_VITRINE_LIMIT.limit), 'EX', 3600)

    const refus = await posterMessage(vitrine.username, corpsVisiteur(1), ipDe(1))

    expect(refus.status).toBe(429)
    expect(await compterCleContact()).toBe(0)
    expect(await compterMessagesVitrine(vitrine.id)).toBe(0)
  })

  it('applique le plafond APRÈS la limite IP : une IP déjà refusée n’incrémente pas le compteur de la vitrine', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'messages-plafond-ip' })
    const ip = ipDe(7)

    for (let index = 1; index <= MESSAGE_PUBLIC_LIMIT.limit; index += 1) {
      expect((await posterMessage(vitrine.username, corpsVisiteur(index), ip)).status).toBe(201)
    }
    const refusIp = await posterMessage(vitrine.username, corpsVisiteur(99), ip)

    expect(refusIp.status).toBe(429)
    expect(await compteur('message-vitrine:messages-plafond-ip')).toBe(MESSAGE_PUBLIC_LIMIT.limit)
  })

  it('n’affecte pas une autre vitrine : la vitrine B reçoit son message alors que la vitrine A est au plafond', async () => {
    const a = await creerContexteAgenda({ username: 'messages-plafond-a' })
    const b = await creerContexteAgenda({ username: 'messages-plafond-b' })
    await redis.set('limite:message-vitrine:messages-plafond-a', String(MESSAGE_VITRINE_LIMIT.limit), 'EX', 3600)

    const refusA = await posterMessage(a.vitrine.username, corpsVisiteur(1), ipDe(1))
    const accepteB = await posterMessage(b.vitrine.username, corpsVisiteur(2), ipDe(2))

    expect(refusA.status).toBe(429)
    expect(accepteB.status).toBe(201)
    expect(await compterMessagesVitrine(a.vitrine.id)).toBe(0)
    expect(await compterMessagesVitrine(b.vitrine.id)).toBe(1)
    expect(await compteur('message-vitrine:messages-plafond-b')).toBe(1)
  })

  it('compte le username sans tenir compte de la casse : « Messages-Casse » et « messages-casse » partagent le plafond', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'messages-casse' })

    const premier = await posterMessage('Messages-Casse', corpsVisiteur(1), ipDe(1))
    const second = await posterMessage('messages-casse', corpsVisiteur(2), ipDe(2))

    expect(premier.status).toBe(201)
    expect(second.status).toBe(201)
    expect(await compteur('message-vitrine:messages-casse')).toBe(2)
    expect(await redis.keys('limite:message-vitrine:*')).toEqual(['limite:message-vitrine:messages-casse'])
    expect(await compterMessagesVitrine(vitrine.id)).toBe(2)
  })

  it('échoue fermé (503 LIMITEUR_INDISPONIBLE) quand Redis tombe sur le plafond de vitrine : aucun message, aucun compteur de contact', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'messages-plafond-panne' })
    couperRedisPourCle('message-vitrine:')
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const reponse = await posterMessage(vitrine.username, corpsVisiteur(1), ipDe(1))

    expect(reponse.status).toBe(503)
    expect(reponse.code).toBe('LIMITEUR_INDISPONIBLE')
    vi.restoreAllMocks()
    expect(await compterMessagesVitrine(vitrine.id)).toBe(0)
    expect(await compterCleContact()).toBe(0)
  })

  it('conserve la limite contact (3 / 24 h par email) sous le plafond de vitrine', async () => {
    const { vitrine } = await creerContexteAgenda({ username: 'messages-plafond-contact' })
    const memeContact = { ...corpsVisiteur(1), email: 'meme-contact@exemple.test' }

    for (let essai = 1; essai <= MESSAGE_CONTACT_LIMIT.limit; essai += 1) {
      expect((await posterMessage(vitrine.username, memeContact, ipDe(essai))).status).toBe(201)
    }
    const refus = await posterMessage(vitrine.username, memeContact, ipDe(10))

    expect(refus.status).toBe(429)
    expect(await compterMessagesVitrine(vitrine.id)).toBe(MESSAGE_CONTACT_LIMIT.limit)
  })
})

// ---------------------------------------------------------------------------------------------
// Plafond de la liste du studio : MESSAGES_LISTE_MAX lignes les plus récentes d'abord ;
// le compteur de non lus porte sur TOUS les messages, pas sur la page plafonnée.
// ---------------------------------------------------------------------------------------------

async function inserer(vitrineId: string, total: number, nombreLusRecents: number): Promise<void> {
  // n = 1 (le plus ancien) … total (le plus récent), une minute d'écart. Les `nombreLusRecents`
  // plus récents sont lus ; tous les autres, y compris ceux au-delà du plafond, sont non lus.
  await db.execute(sql`
    INSERT INTO messages (id, vitrine_id, nom, email, sujet, message, lu_le, created_at, updated_at)
    SELECT
      'liste-' || lpad(n::text, 4, '0'),
      ${vitrineId},
      'Visiteur ' || n,
      'visiteur-' || n || '@exemple.test',
      'autre',
      'Message ' || n,
      CASE WHEN n > ${total - nombreLusRecents} THEN TIMESTAMPTZ '2026-02-01 00:00:00+00' ELSE NULL END,
      TIMESTAMPTZ '2026-01-01 00:00:00+00' + (n * INTERVAL '1 minute'),
      TIMESTAMPTZ '2026-01-01 00:00:00+00' + (n * INTERVAL '1 minute')
    FROM generate_series(1, ${total}) AS n
  `)
}

describe('messages : plafond de la liste du studio (MESSAGES_LISTE_MAX)', () => {
  it('fixe le plafond à 200 lignes', () => {
    expect(MESSAGES_LISTE_MAX).toBe(200)
  })

  it('renvoie 200 messages, les plus récents d’abord, et compte TOUS les non lus quand la vitrine en a 205', async () => {
    const { listOwnMessages } = await messagesService()
    const { vitrine, user } = await creerContexteAgenda({ username: 'messages-liste-205' })
    await inserer(vitrine.id, 205, 3)

    const liste = await listOwnMessages(user.id)

    expect(liste.items).toHaveLength(MESSAGES_LISTE_MAX)
    expect(liste.items[0]?.id).toBe('liste-0205')
    expect(liste.items.at(-1)?.id).toBe('liste-0006')
    const ids = liste.items.map((item) => item.id)
    for (const exclu of ['liste-0001', 'liste-0002', 'liste-0003', 'liste-0004', 'liste-0005']) {
      expect(ids).not.toContain(exclu)
    }
    expect(ids).toEqual([...ids].sort().reverse())
    // 205 messages dont les 3 plus récents lus : 202 non lus, bien au-delà de la page de 200.
    expect(liste.nonLus).toBe(202)
  })

  it.each([
    [MESSAGES_LISTE_MAX - 1, MESSAGES_LISTE_MAX - 1],
    [MESSAGES_LISTE_MAX, MESSAGES_LISTE_MAX],
    [MESSAGES_LISTE_MAX + 1, MESSAGES_LISTE_MAX],
  ])('renvoie %i items pour %i messages et un compteur de non lus exact (bornes du plafond)', async (total, attendu) => {
    const { listOwnMessages } = await messagesService()
    const { vitrine, user } = await creerContexteAgenda({ username: `messages-liste-${total}` })
    await inserer(vitrine.id, total, 0)

    const liste = await listOwnMessages(user.id)

    expect(liste.items).toHaveLength(attendu)
    expect(liste.nonLus).toBe(total)
  })

  it('compte à zéro les non lus quand tous les messages au-delà de la page ont été lus', async () => {
    const { listOwnMessages } = await messagesService()
    const { vitrine, user } = await creerContexteAgenda({ username: 'messages-liste-tous-lus' })
    await inserer(vitrine.id, 205, 205)

    const liste = await listOwnMessages(user.id)

    expect(liste.items).toHaveLength(MESSAGES_LISTE_MAX)
    expect(liste.nonLus).toBe(0)
  })

  it('ne mélange pas les vitrines : le plafond et le compteur ne portent que sur la vitrine du propriétaire', async () => {
    const { listOwnMessages } = await messagesService()
    const a = await creerContexteAgenda({ username: 'messages-liste-iso-a' })
    const b = await creerContexteAgenda({ username: 'messages-liste-iso-b' })
    await inserer(a.vitrine.id, 205, 0)

    const listeB = await listOwnMessages(b.user.id)

    expect(listeB.items).toEqual([])
    expect(listeB.nonLus).toBe(0)
  })
})
