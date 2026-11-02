import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test'
import { attendreHydration, ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, db, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

// S7-bis — parcours Contact/Messages (CA11, CA12, CA13, CA17, CA23).
//
// ATTENDU ROUGE : ces parcours exige des livrables S7-bis backend (POST
// /api/public/{u}/messages, GET /api/studio/messages, POST .../lu, table messages)
// et frontend (pages /contact et /studio/messages, composable usePublicMessage).
// Ils ne passeront qu'après ces livraisons — aucun .skip ni todo n'est utilisé.

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 800 }

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

  test('le honeypot rempli répond 400 VALIDATION sans créer de ligne (CA11)', async () => {
    await page.setViewportSize(MOBILE)
    await page.goto(`/${username}/contact`)
    await attendreHydration(page)

    const contact = contactUnique('Honeypot Message')
    emailsMessages.add(contact.email)
    await page.getByLabel('Nom complet', { exact: true }).fill(contact.nom)
    await page.getByLabel('Email', { exact: true }).fill(contact.email)
    await page.getByLabel('Message').fill('Message d’un robot simulé.')

    const siteWeb = page.locator('input[name="siteWeb"]')
    await expect(siteWeb).toBeHidden()
    await siteWeb.evaluate((element, valeur) => {
      (element as HTMLInputElement).value = valeur
      element.dispatchEvent(new Event('input', { bubbles: true }))
    }, 'https://robot.example')

    const envoiPromise = page.waitForResponse(reponse =>
      reponse.request().method() === 'POST'
      && new URL(reponse.url()).pathname === `/api/public/${username}/messages`,
    )
    await page.getByRole('button', { name: 'Envoyer mon message' }).click()
    const envoi = await envoiPromise
    expect(envoi.status()).toBe(400)
    expect(((await envoi.json()) as ErreurCorps).data?.code).toBe('VALIDATION')
    expect(await compterMessages(contact.email)).toBe(0)
  })

  test('la liste Studio Messages déplie, marque lu et met à jour le badge au retour (CA17, CA15)', async () => {
    const premier = contactUnique('Marie Ndzi')
    const second = contactUnique('Paul Essomba')
    emailsMessages.add(premier.email)
    emailsMessages.add(second.email)

    const sujet = 'demande_information' as const
    for (const contact of [premier, second]) {
      const reponse = await apiPublique.post(`/api/public/${username}/messages`, {
        data: {
          nom: contact.nom,
          email: contact.email,
          sujet,
          message: 'Deux lignes d’aperçu suffisent pour l’aperçu du studio.',
          siteWeb: '',
        },
      })
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

    const rangée = page.getByRole('article').filter({ hasText: premier.nom }).first()
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
    const rangéeRelue = page.getByRole('article').filter({ hasText: premier.nom }).first()
    await rangéeRelue.getByRole('button').first().click()
    await expect(rangéeRelue.getByRole('button').first()).toHaveAttribute('aria-expanded', 'true')
    expect(publicationsLu).toBe(0)
  })
})
