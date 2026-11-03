import { beforeEach, describe, expect, it } from 'vitest'
import { getEmailsNotificationsQueue } from '../../server/jobs/queues'
import { dispatchPendingTransactionalEmails, transactionalEmailJobId } from '../../server/jobs/email-outbox'
import { RecordingTransport, creerPro, lireOutbox, viderOutbox } from './support/notifications'
import { modulesEmailOutbox } from './support/planification'

// CA63 (« e-mail de contact reçu », SPRINTS) : un message envoyé sur la vitrine publiée aboutit, par le dispatcher et
// le traitement de l'outbox avec un transport d'enregistrement, à un e-mail `message_professionnel_nouvelle` envoyé
// au professionnel, ligne `envoye`. Services réels, PostgreSQL et Redis réels ; seul Resend est remplacé.

const messagesService = () => import('../../server/services/messages')
const queue = getEmailsNotificationsQueue()

beforeEach(async () => {
  await viderOutbox()
  await queue.obliterate({ force: true })
})

describe('contact reçu par le professionnel (CA63)', () => {
  it('should deliver the visitor message to the professional and mark the line envoye', async () => {
    const { createMessage } = await messagesService()
    const { processTransactionalEmail } = await modulesEmailOutbox()
    const pro = await creerPro({ username: 'contact-recu', email: 'docteur@exemple.test' })
    const { item } = await createMessage(pro.vitrine.username, {
      nom: 'Marie Ndzi', email: 'marie.ndzi@exemple.test', telephone: null, sujet: 'autre', message: 'Bonjour, avez-vous une place jeudi ?',
    })

    const maintenant = new Date()
    expect(await dispatchPendingTransactionalEmails(queue, maintenant)).toBe(1)
    const [travail] = await queue.getJobs(['waiting', 'delayed'])
    const [ligne] = await lireOutbox({ entiteId: item.id })
    expect(travail?.id).toBe(transactionalEmailJobId(ligne!.id))
    const transport = new RecordingTransport()
    const resultat = await processTransactionalEmail((travail!.data as { outboxId: string }).outboxId, transport, maintenant)

    expect(resultat.statut).toBe('envoye')
    expect(transport.sends).toHaveLength(1)
    expect(transport.dernier.to).toBe('docteur@exemple.test')
    expect(transport.dernier.text).toContain('Bonjour, avez-vous une place jeudi ?')
    expect(transport.dernier.text).toContain('Marie Ndzi')
    expect((await lireOutbox({ entiteId: item.id }))[0]).toMatchObject({ type: 'message_professionnel_nouvelle', statut: 'envoye', erreurCode: null })
  })

  it('should deliver to the contact e-mail when the account was created by phone, and never to anyone else', async () => {
    const { createMessage } = await messagesService()
    const { processTransactionalEmail } = await modulesEmailOutbox()
    const pro = await creerPro({ emailTemporaire: true, emailContact: 'cabinet@exemple.test' })
    const { item } = await createMessage(pro.vitrine.username, { nom: 'Paul', email: 'paul@exemple.test', telephone: null, sujet: 'autre', message: 'Bonjour' })
    const [ligne] = await lireOutbox({ entiteId: item.id })
    const transport = new RecordingTransport()

    await processTransactionalEmail(ligne!.id, transport, new Date())

    expect(transport.sends.map((s) => s.message.to)).toEqual(['cabinet@exemple.test'])
  })

  it('should keep the S7 failure path for a message when the provider fails: the line stays en_attente with a safe code', async () => {
    const { createMessage } = await messagesService()
    const { processTransactionalEmail } = await modulesEmailOutbox()
    const pro = await creerPro()
    const { item } = await createMessage(pro.vitrine.username, { nom: 'Paul', email: 'paul@exemple.test', telephone: null, sujet: 'autre', message: 'Bonjour' })
    const [ligne] = await lireOutbox({ entiteId: item.id })

    await expect(processTransactionalEmail(ligne!.id, new RecordingTransport({ echecs: 1 }), new Date())).rejects.toMatchObject({ code: 'ENVOI_INCONNU' })

    expect((await lireOutbox({ entiteId: item.id }))[0]).toMatchObject({ statut: 'en_attente', tentatives: 1, erreurCode: 'ENVOI_INCONNU' })
  })
})
