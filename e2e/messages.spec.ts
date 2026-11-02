import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, APIResponse, BrowserContext, Page } from '@playwright/test'
import { SUJET_LIBELLES } from '../shared/message'
import type { SujetMessage } from '../shared/message'
import { attendreHydration, ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, db, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

// S7-bis — parcours Contact/Messages (CA11, CA12, CA13, CA17, CA23) et régressions des revues :
// succès persistant (watch), libellé du sujet au dépliage, honeypot, injection d'en-tête par le nom.
// Aucun .skip ni todo. Les tests sont sérialisés et partagent UNE vitrine : chacun crée ses
// propres messages (emails uniques) et le test du compteur repart d'un état « tout est lu ».

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }
/** Durée pendant laquelle le message de succès doit rester affiché (régression du watch qui l'effaçait). */
const PERSISTANCE_SUCCES_MS = 1_000
const TEXTE_SUCCES = 'Votre message est envoyé.'
const TEXTE_ERREUR_FORMULAIRE = 'Vérifiez les informations saisies.'

interface MessageCreeApi {
  message: { id: string, sujet: string, creeLe: string }
}

interface ErreurCorps {
  data?: { code?: string }
}

test.describe.serial('Contact et Messages S7-bis', () => {
  let session: Session
  let apiPublique: APIRequestContext
  let contexte: BrowserContext
  let page: Page
  let username: string

  const emailsMessages = new Set<string>()

  function contactUnique(prefixe: string): { nom: string, email: string, telephone?: string } {
    const identifiant = randomUUID().replaceAll('-', '')
    return {
      nom: `${prefixe} ${identifiant.slice(0, 8)}`,
      email: `e2e-s7b-${identifiant}@example.com`,
      telephone: undefined,
    }
  }

  let compteurIp = 0

  /**
   * POST public direct. Le serveur de développement est derrière le loopback : comme en production
   * derrière nginx, il lit l'IP du visiteur dans `X-Forwarded-For`. Une IP distincte par appel évite
   * que la limite IP (5 / 10 min) ne fasse échouer ces parcours pour une raison étrangère à leur objet.
   */
  async function posterMessageApi(
    contact: { nom: string, email: string },
    sujet: SujetMessage,
    extra: Record<string, unknown> = {},
  ): Promise<APIResponse> {
    compteurIp += 1
    emailsMessages.add(contact.email)
    return apiPublique.post(`/api/public/${username}/messages`, {
      headers: { 'X-Forwarded-For': `10.88.${Math.floor(compteurIp / 250)}.${(compteurIp % 250) + 1}` },
      data: {
        nom: contact.nom,
        email: contact.email,
        sujet,
        message: 'Deux lignes d’aperçu suffisent pour l’aperçu du studio.',
        siteWeb: '',
        ...extra,
      },
    })
  }

  async function remplirFormulaire(contact: { nom: string, email: string }, message: string): Promise<void> {
    await page.getByLabel('Nom complet', { exact: true }).fill(contact.nom)
    await page.getByLabel('Email', { exact: true }).fill(contact.email)
    await page.getByLabel('Message').fill(message)
  }

  async function compterMessages(email: string): Promise<number> {
    const resultat = await db().query<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM messages WHERE email = $1',
      [email],
    )
    return resultat.rows[0]?.n ?? 0
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    username = `messages-ui-${randomUUID().slice(0, 8)}`

    await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })
    await session.api.post('/api/studio/vitrine/publier')

    apiPublique = await playwright.request.newContext({
      baseURL: BASE_URL,
      extraHTTPHeaders: { Origin: BASE_URL },
    })
    contexte = await browser.newContext({
      baseURL: BASE_URL,
      storageState: await session.api.storageState(),
      viewport: MOBILE,
    })
    page = await contexte.newPage()
  })

  test.afterAll(async () => {
    const emails = [...emailsMessages]
    if (emails.length > 0) {
      const messages = await db().query<{ id: string }>(
        'SELECT id FROM messages WHERE email = ANY($1::text[])',
        [emails],
      )
      const ids = messages.rows.map((row) => row.id)
      if (ids.length > 0) {
        await db().query(
          "DELETE FROM emails_transactionnels WHERE entite_type = 'message' AND entite_id = ANY($1::text[])",
          [ids],
        )
        await db().query('DELETE FROM messages WHERE id = ANY($1::text[])', [ids])
      }
    }
    await contexte?.close()
    await apiPublique?.dispose()
    await session?.api.dispose()
    await fermerConnexions()
  })

  test('la page Contact expose la carte agenda et son formulaire complet (CA23)', async () => {
    await page.setViewportSize(DESKTOP)
    await page.goto(`/${username}/contact`)

    await expect(page.getByRole('heading', { level: 1, name: 'Me contacter' })).toBeVisible()
    // Vitrine de test sans WhatsApp : le bouton WhatsApp est absent, sans jamais masquer la carte « Cabinet ».
    await expect(page.getByRole('link', { name: 'Écrire sur WhatsApp' })).toHaveCount(0)
    await expect(page.getByText(/Douala, Cameroun|Douala/).first()).toBeVisible()

    const carteAgenda = page.getByRole('link', { name: 'Voir l’agenda ›' })
    await expect(carteAgenda).toBeVisible()
    await expect(carteAgenda).toHaveAttribute('href', `/${username}/agenda`)
    await carteAgenda.click()
    await expect(page).toHaveURL(new RegExp(`/${username}/agenda$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

    // La vitrine de démonstration dr-cabrel (seed) expose la même page pour CA23/CA12.
    await page.setViewportSize(DESKTOP)
    await page.goto('/dr-cabrel/contact')
    await expect(page.getByRole('heading', { level: 1, name: 'Me contacter' })).toBeVisible()
  })

  test('le formulaire Contact crée un message : 201 sans PII ni téléphone requis (CA12, CA13)', async () => {
    await page.setViewportSize(MOBILE)
    await page.goto(`/${username}/contact`)
    await attendreHydration(page)

    const contact = contactUnique('Parcours Message')
    emailsMessages.add(contact.email)

    await page.getByLabel('Nom complet', { exact: true }).fill(contact.nom)
    await page.getByLabel('Email', { exact: true }).fill(contact.email)
    // CA13 : le téléphone est facultatif — le champ reste vide de bout en bout.
    const sujet = page.getByRole('combobox', { name: 'Sujet' })
    await sujet.click()
    await page.getByRole('option', { name: /Une question avant de réserver/ }).click()
    await page.getByLabel('Message').fill('Bonjour, puis-je décaler mon rendez-vous ?')

    const creationPromise = page.waitForResponse(reponse =>
      reponse.request().method() === 'POST'
      && new URL(reponse.url()).pathname === `/api/public/${username}/messages`,
    )
    await page.getByRole('button', { name: 'Envoyer mon message' }).click()
    const creation = await creationPromise
    expect(creation.status(), await creation.text()).toBe(201)
    const corps = (await creation.json()) as MessageCreeApi
    expect(corps.message.sujet).toBe('question_avant_reservation')
    expect(corps.message.creeLe).toEqual(expect.any(String))

    // Succès : un unique message d'état, jamais un second bandeau.
    await expect(page.getByRole('status')).toContainText('Votre message est envoyé.')

    // Aucune PII dans l'URL ni dans localStorage (pattern `verifierAbsencePii`).
    const url = decodeURIComponent(page.url())
    const stockage = await page.evaluate(() =>
      JSON.stringify(Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, index) => {
          const cle = localStorage.key(index) ?? ''
          return [cle, localStorage.getItem(cle)]
        }),
      )),
    )
    for (const valeur of [contact.nom, contact.email]) {
      expect(url).not.toContain(valeur)
      expect(stockage).not.toContain(valeur)
    }
  })

  test('le message de succès reste affiché au-delà d’une seconde puis disparaît à la nouvelle saisie (régression watch)', async () => {
    await page.setViewportSize(MOBILE)
    await page.goto(`/${username}/contact`)
    await attendreHydration(page)

    const contact = contactUnique('Succès Persistant')
    emailsMessages.add(contact.email)
    await remplirFormulaire(contact, 'Un message qui doit laisser sa confirmation visible.')

    const creationPromise = page.waitForResponse(reponse =>
      reponse.request().method() === 'POST'
      && new URL(reponse.url()).pathname === `/api/public/${username}/messages`,
    )
    await page.getByRole('button', { name: 'Envoyer mon message' }).click()
    expect((await creationPromise).status()).toBe(201)

    const succes = page.getByRole('status').filter({ hasText: TEXTE_SUCCES })
    await expect(succes).toBeVisible()
    // Seule une attente réelle prouve la persistance : le watch fautif effaçait le message au flush suivant.
    await page.waitForTimeout(PERSISTANCE_SUCCES_MS)
    await expect(succes).toBeVisible()
    // Formulaire réinitialisé pendant que la confirmation reste affichée.
    await expect(page.getByLabel('Nom complet', { exact: true })).toHaveValue('')
    await expect(page.getByLabel('Email', { exact: true })).toHaveValue('')
    expect(await compterMessages(contact.email)).toBe(1)

    // Une nouvelle saisie remplace la confirmation (un seul message à l'écran).
    await page.getByLabel('Nom complet', { exact: true }).fill('N')
    await expect(succes).toHaveCount(0)
  })

  test('un honeypot rempli dans le navigateur n’envoie rien : aucun succès, aucune ligne créée (CA11)', async () => {
    await page.setViewportSize(MOBILE)
    await page.goto(`/${username}/contact`)
    await attendreHydration(page)

    const contact = contactUnique('Honeypot Navigateur')
    emailsMessages.add(contact.email)
    await remplirFormulaire(contact, 'Message d’un robot simulé.')
    // Champ-piège : hors écran, exclu de l'ordre de tabulation et invisible aux lecteurs d'écran.
    const siteWeb = page.getByLabel('Site web', { exact: true })
    await expect(siteWeb).toHaveAttribute('tabindex', '-1')
    await siteWeb.fill('https://robot.example')

    let envois = 0
    page.on('request', (requete) => {
      if (requete.method() === 'POST' && new URL(requete.url()).pathname === `/api/public/${username}/messages`) {
        envois += 1
      }
    })
    await page.getByRole('button', { name: 'Envoyer mon message' }).click()

    // Point de synchronisation déterministe : l'unique erreur affichée, jamais le message de succès.
    await expect(page.getByRole('alert').filter({ hasText: TEXTE_ERREUR_FORMULAIRE })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: TEXTE_SUCCES })).toHaveCount(0)
    expect(envois).toBe(0)
    expect(await compterMessages(contact.email)).toBe(0)
  })

  test('le serveur refuse un honeypot rempli en 400 VALIDATION sans créer de ligne, même hors navigateur (CA11)', async () => {
    const contact = contactUnique('Honeypot Serveur')

    const reponse = await posterMessageApi(contact, 'autre', { siteWeb: 'https://robot.example' })

    expect(reponse.status()).toBe(400)
    expect(((await reponse.json()) as ErreurCorps).data?.code).toBe('VALIDATION')
    expect(await compterMessages(contact.email)).toBe(0)
  })

  test('le serveur refuse un nom contenant un saut de ligne (injection d’en-tête) sans créer de ligne', async () => {
    const contact = contactUnique('Injection')

    const reponse = await posterMessageApi({ ...contact, nom: 'A\r\nBcc: attaquant@example.com' }, 'autre')

    expect(reponse.status()).toBe(400)
    expect(((await reponse.json()) as ErreurCorps).data?.code).toBe('VALIDATION')
    expect(await compterMessages(contact.email)).toBe(0)
  })

  test('la liste Studio Messages déplie, marque lu et met à jour le badge au retour (CA17, CA15)', async () => {
    const premier = contactUnique('Marie Ndzi')
    const second = contactUnique('Paul Essomba')

    // Les messages des tests précédents (même vitrine) sont marqués lus : le compteur repart de zéro.
    await db().query(
      'UPDATE messages SET lu_le = now() WHERE lu_le IS NULL AND vitrine_id = (SELECT id FROM vitrines WHERE username = $1)',
      [username],
    )
    for (const contact of [premier, second]) {
      const reponse = await posterMessageApi(contact, 'demande_information')
      expect(reponse.status(), await reponse.text()).toBe(201)
    }

    await ouvrirStudio(page, '/studio')
    // La ligne Messages de l'écran Vitrine porte le compteur de non lus.
    const ligneMessages = page.getByRole('link', { name: /Messages/ })
    await expect(ligneMessages).toBeVisible()
    await expect(ligneMessages).toContainText('2 non lus')

    await ligneMessages.click()
    await expect(page).toHaveURL(/\/studio\/messages$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible()
    await expect(page.getByText('2 non lus', { exact: true })).toBeVisible()

    const rangée = page.getByRole('listitem').filter({ hasText: premier.nom }).first()
    const boutonRangée = rangée.getByRole('button')
    await expect(boutonRangée).toHaveAttribute('aria-expanded', 'false')
    await boutonRangée.click()
    await expect(boutonRangée).toHaveAttribute('aria-expanded', 'true')
    await expect(rangée).toContainText(premier.email)

    // CA17 : le compte passe de 2 à 1 et le sous-titre suit ; le badge de l'écran
    // Vitrine est mis à jour au retour.
    await expect(page.getByText('1 non lu', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: '← Vitrine' }).click()
    await expect(ligneMessages).toContainText('1 non lu')

    // Idempotence visible : re-déplier le message déjà lu ne re-poste pas « lu ».
    let publicationsLu = 0
    page.on('request', (requete) => {
      if (requete.method() === 'POST' && /\/api\/studio\/messages\/[\w-]+\/lu$/.test(new URL(requete.url()).pathname)) {
        publicationsLu += 1
      }
    })
    await ouvrirStudio(page, '/studio/messages')
    const rangéeRelue = page.getByRole('listitem').filter({ hasText: premier.nom }).first()
    await rangéeRelue.getByRole('button').first().click()
    await expect(rangéeRelue.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
    expect(publicationsLu).toBe(0)
  })

  test('le dépliage affiche le libellé du sujet et jamais sa valeur technique (SUJET_LIBELLES)', async () => {
    const contact = contactUnique('Libellé Sujet')
    const reponse = await posterMessageApi(contact, 'question_avant_reservation')
    expect(reponse.status(), await reponse.text()).toBe(201)

    await ouvrirStudio(page, '/studio/messages')
    const rangee = page.getByRole('listitem').filter({ hasText: contact.nom }).first()
    await rangee.getByRole('button').click()

    await expect(rangee.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    await expect(rangee).toContainText(SUJET_LIBELLES.question_avant_reservation)
    await expect(rangee).toContainText('Une question avant de réserver')
    await expect(page.getByText('question_avant_reservation')).toHaveCount(0)
  })
})
