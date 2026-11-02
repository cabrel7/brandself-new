import { describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db } from '../../server/utils/db'
import { exigerModulesPresents, rejet } from './support/erreurs'
import { creerContexteAgenda } from './support/agenda'

// S7-bis, PG réel : services messages — CA8 (création transactionnelle message + outbox,
// téléphone facultatif), CA10 (limite de contact 3/24 h, Redis réel), CA15/CA16/CA18
// (studio : liste DTO propre, lu idempotent, isolation entre vitrines).
// Aucune fabrique de messages : ils passent par les services réels.

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
