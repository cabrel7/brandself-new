import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { attendreHydration, ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

const MOBILE = { width: 390, height: 844 }
const PC = { width: 1280, height: 800 }

interface LienApi {
  id: string
  slug: string
  libelle: string
  url: string
  clicsSemaine: number
}

async function sansDebordementHorizontal(page: Page): Promise<void> {
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(debordement, 'la page ne doit pas défiler horizontalement').toBeLessThanOrEqual(0)
}

test.describe('page publique de liens — dr-cabrel (vitrine de démonstration, seed)', () => {
  test('à 390 px : nom, métier/ville, bouton réserver et liens actifs uniquement', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    const reponse = await page.goto('/@dr-cabrel')
    expect(reponse?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Dr Cabrel Nguesso' })).toBeVisible()
    await expect(page.getByText('Cardiologue interventionnel · Douala')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Prendre rendez-vous' })).toHaveAttribute('href', '/dr-cabrel/agenda')
    await expect(page.getByRole('link', { name: 'Écrire sur WhatsApp' })).toHaveAttribute('href', 'https://wa.me/237699000001')
    await expect(page.getByRole('link', { name: 'Mon parcours sur LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/dr-cabrel-nguesso')
    await expect(page.getByRole('link', { name: 'Me contacter par courriel' })).toHaveAttribute('href', 'mailto:contact@dr-cabrel.test')
    // Le lien masqué (« Site de l’hôpital ») n’apparaît pas côté public.
    await expect(page.getByRole('link', { name: 'Site de l’hôpital' })).toHaveCount(0)
    // Jamais de carte « Votre page de liens » ni de QR code côté public (maquette : cette carte est studio).
    await expect(page.getByText('Votre page de liens', { exact: true })).toHaveCount(0)
    await sansDebordementHorizontal(page)
  })

  test('à 1280 px : même contenu, boutons en colonne centrée', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto('/@dr-cabrel')
    await expect(page.getByRole('heading', { level: 1, name: 'Dr Cabrel Nguesso' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Écrire sur WhatsApp' })).toHaveAttribute('href', 'https://wa.me/237699000001')
    await expect(page.getByRole('link', { name: 'Mon parcours sur LinkedIn' })).toHaveAttribute('href', 'https://www.linkedin.com/in/dr-cabrel-nguesso')
    await expect(page.getByText('Créé avec Brandself')).toBeVisible()
    await sansDebordementHorizontal(page)
  })

  test('jamais de javascript: dans un lien public', async ({ page }) => {
    await page.goto('/@dr-cabrel')
    const liens = page.locator('a[href^="javascript:"]')
    await expect(liens).toHaveCount(0)
  })
})

test.describe.serial('studio liens — vitrine fraîche', () => {
  let session: Session
  let contexte: BrowserContext
  let page: Page
  let username: string

  async function listerLiens(): Promise<LienApi[]> {
    const reponse = await session.api.get('/api/studio/liens')
    expect(reponse.status()).toBe(200)
    return ((await reponse.json()) as { liens: LienApi[] }).liens
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    username = `liens-ui-${randomUUID().slice(0, 8)}`
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)

    // Quatre liens dans l’ordre de création : 3 actifs, 1 masqué.
    const l1 = await session.api.post('/api/studio/liens', { data: { type: 'vitrine', libelle: 'Prendre rendez-vous', page: 'reserver' } })
    expect(l1.status()).toBe(201)
    const l2 = await session.api.post('/api/studio/liens', { data: { type: 'whatsapp', libelle: 'Écrire sur WhatsApp', numero: '+237 699 00 00 01' } })
    expect(l2.status(), await l2.text()).toBe(201)
    const l3 = await session.api.post('/api/studio/liens', {
      data: { type: 'reseau', libelle: 'Mon parcours sur LinkedIn', plateforme: 'linkedin', url: 'https://www.linkedin.com/in/dr-cabrel-nguesso' },
    })
    expect(l3.status(), await l3.text()).toBe(201)
    const l4 = await session.api.post('/api/studio/liens', { data: { type: 'libre', libelle: 'Site de l’hôpital', url: 'https://hopital.test', actif: false } })
    expect(l4.status(), await l4.text()).toBe(201)

    contexte = await browser.newContext({ baseURL: BASE_URL, storageState: await session.api.storageState(), viewport: MOBILE })
    page = await contexte.newPage()
  })

  test.afterAll(async () => {
    await contexte?.close()
    await session?.api.dispose()
    await fermerConnexions()
  })

  test('« Vos liens » : 4 liens, 3 visibles, carte page de liens (URL + copier + partager + QR)', async () => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async () => undefined },
      })
    })
    await ouvrirStudio(page, '/studio/liens')
    await expect(page.getByRole('heading', { level: 1, name: 'Liens' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Prendre rendez-vous' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Écrire sur WhatsApp' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Mon parcours sur LinkedIn' })).toBeVisible()
    await expect(page.getByText('4 liens · 3 visibles')).toBeVisible()

    // Carte « Votre page de liens » (maquette Studio · Liens).
    await expect(page.getByText('Votre page de liens', { exact: true })).toBeVisible()
    const urlPage = `${BASE_URL}/@${username}`
    await expect(page.getByText(urlPage)).toBeVisible()
    await expect(page.getByRole('button', { name: /Copier/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Partager/ })).toBeVisible()
    await page.getByRole('button', { name: 'Copier l’adresse de votre page de liens' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Adresse copiée' })).toHaveText('Adresse copiée')
    // QR code : affiché uniquement sur le bouton « QR code » (maquette), en modal centrée.
    await page.getByRole('button', { name: /QR code/ }).click()
    const dialogue = page.getByRole('dialog')
    await expect(dialogue).toBeVisible()
    await expect(dialogue.locator('svg').first()).toBeVisible()
    const telechargement = page.waitForEvent('download')
    await dialogue.getByRole('button', { name: 'Télécharger', exact: true }).click()
    expect((await telechargement).suggestedFilename()).toMatch(/\.svg$/)
    // Le pied de modal porte le texte « Fermer » ; le bouton d’en-tête intégré n’a qu’une étiquette ARIA.
    await dialogue.getByRole('button').filter({ hasText: 'Fermer' }).click()
    await expect(dialogue).not.toBeVisible()
    await expect(page.getByText('0 clics cette semaine')).toBeVisible()

    // Liste : 4 lignes, interrupteurs, poignée.
    await expect(page.getByRole('link', { name: 'Prendre rendez-vous' })).toBeVisible()
    await expect(page.getByRole('switch', { name: 'Visible sur votre page de liens : Prendre rendez-vous' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Visible sur votre page de liens : Écrire sur WhatsApp' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Visible sur votre page de liens : Mon parcours sur LinkedIn' })).toBeChecked()
    await expect(page.getByRole('switch', { name: 'Visible sur votre page de liens : Site de l’hôpital' })).not.toBeChecked()
    await expect(page.locator('[data-poignee]')).toHaveCount(4)
  })

  test('masquer un lien depuis le studio le retire de la page publique', async ({ browser }) => {
    await page.getByRole('switch', { name: 'Visible sur votre page de liens : Écrire sur WhatsApp' }).click()
    await expect(page.getByRole('switch', { name: 'Visible sur votre page de liens : Écrire sur WhatsApp' })).not.toBeChecked()

    const publique = await browser.newContext({ baseURL: BASE_URL })
    const pagePublique = await publique.newPage()
    await pagePublique.setViewportSize(PC)
    await pagePublique.goto(`/@${username}`)
    await expect(pagePublique.getByRole('link', { name: 'Écrire sur WhatsApp' })).toHaveCount(0)
    await expect(pagePublique.getByRole('link', { name: 'Mon parcours sur LinkedIn' })).toBeVisible()
    await publique.close()
  })

  test('l’ordre du studio se retrouve sur la page publique', async ({ browser }) => {
    // Déplacer le lien LinkedIn en tête (clavier sur sa poignée, dans la rangée du lien).
    // Chaque flèche envoie son propre réordonnancement : on attend la réponse avant la frappe
    // suivante, sinon la page publique peut être rendue entre les deux écritures.
    const reponseReordonnance = () =>
      page.waitForResponse((reponse) => reponse.url().includes('/reordonner') && reponse.status() === 200)
    const poignee = page.locator('li', { has: page.getByRole('link', { name: 'Mon parcours sur LinkedIn' }) }).locator('[data-poignee]')

    const premiereReponse = reponseReordonnance()
    await poignee.focus()
    await page.keyboard.press('ArrowUp')
    await premiereReponse

    const secondeReponse = reponseReordonnance()
    await page.keyboard.press('ArrowUp')
    await secondeReponse

    const publique = await browser.newContext({ baseURL: BASE_URL })
    const pagePublique = await publique.newPage()
    await pagePublique.setViewportSize(PC)
    await pagePublique.goto(`/@${username}`)
    const liens = pagePublique.getByRole('link')
    await expect(liens.first()).toHaveAttribute('href', 'https://www.linkedin.com/in/dr-cabrel-nguesso')
    await publique.close()
  })

  test('un clic public est compté sans bloquer la navigation', async ({ browser }) => {
    const rendezVous = (await listerLiens()).find((lien) => lien.libelle === 'Prendre rendez-vous')
    expect(rendezVous).toBeDefined()
    if (!rendezVous) throw new Error('Lien « Prendre rendez-vous » introuvable')

    const publique = await browser.newContext({ baseURL: BASE_URL })
    const pagePublique = await publique.newPage()
    await pagePublique.goto(`/@${username}`)
    await attendreHydration(pagePublique)

    const lienRendezVous = pagePublique.getByRole('link', { name: 'Prendre rendez-vous', exact: true })
    await expect(lienRendezVous).toHaveCount(1)
    const cheminClic = `/api/public/${username}/liens/${rendezVous.slug}/clic`
    const reponseClic = pagePublique.waitForResponse((reponse) =>
      reponse.request().method() === 'POST' && new URL(reponse.url()).pathname === cheminClic,
    )
    const navigation = pagePublique.waitForURL(`${BASE_URL}/${username}/agenda`)
    await lienRendezVous.click()

    const [clic] = await Promise.all([reponseClic, navigation])
    expect(clic.status()).toBe(200)
    await expect(pagePublique).toHaveURL(`${BASE_URL}/${username}/agenda`)

    const apresClic = (await listerLiens()).find((lien) => lien.id === rendezVous.id)
    expect(apresClic?.clicsSemaine).toBe(1)
    await publique.close()
  })

  test('créer puis modifier un lien Réseau persiste sa nouvelle URL', async () => {
    const libelle = 'Actualités sur Instagram'
    const urlInitiale = 'https://www.instagram.com/brandself_e2e'
    const urlModifiee = 'https://www.instagram.com/brandself_e2e_modifie'

    await ouvrirStudio(page, '/studio/liens/nouveau')
    await page.getByRole('combobox', { name: 'Type de lien' }).click()
    await page.getByRole('option', { name: 'Réseau social' }).click()

    const plateforme = page.getByRole('combobox', { name: 'Réseau social' })
    const url = page.getByLabel('Lien du profil')
    await expect(plateforme).toBeVisible()
    await expect(url).toBeVisible()
    await page.getByLabel('Libellé', { exact: true }).fill(libelle)
    await plateforme.click()
    await page.getByRole('option', { name: 'Instagram' }).click()
    await url.fill(urlInitiale)

    const creation = page.waitForResponse((reponse) =>
      reponse.request().method() === 'POST' && new URL(reponse.url()).pathname === '/api/studio/liens',
    )
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click()
    expect((await creation).status()).toBe(201)
    await expect(page).toHaveURL(/\/studio\/liens$/)
    const ligneCreee = page.getByRole('listitem').filter({ has: page.getByRole('link', { name: libelle }) })
    await expect(ligneCreee).toBeVisible()

    const lienCree = (await listerLiens()).find((lien) => lien.libelle === libelle)
    expect(lienCree).toBeDefined()
    if (!lienCree) throw new Error(`Lien « ${libelle} » introuvable`)

    await ligneCreee.getByRole('link', { name: libelle }).click()
    await expect(page).toHaveURL(new RegExp(`/studio/liens/${lienCree.id}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Modifier le lien' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Type de lien' })).toBeDisabled()
    await page.getByLabel('Lien du profil').fill(urlModifiee)

    const modification = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PUT' && new URL(reponse.url()).pathname === `/api/studio/liens/${lienCree.id}`,
    )
    await page.getByRole('button', { name: 'Enregistrer le lien', exact: true }).click()
    expect((await modification).status()).toBe(200)
    expect((await listerLiens()).find((lien) => lien.id === lienCree.id)?.url).toBe(urlModifiee)

    const supprimer = page.getByRole('button', { name: 'Supprimer ce lien', exact: true })
    await expect(supprimer).toBeEnabled()
    await supprimer.click()
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
    await expect(page).toHaveURL(/\/studio\/liens$/)
    expect((await listerLiens()).some((lien) => lien.id === lienCree.id)).toBe(false)
  })

  test('état vide : la carte de partage et l’action d’ajout restent disponibles', async () => {
    const liens = await listerLiens()
    for (const lien of liens) {
      const suppression = await session.api.delete(`/api/studio/liens/${lien.id}`)
      expect(suppression.status()).toBe(204)
    }

    await ouvrirStudio(page, '/studio/liens')
    await expect(page.getByRole('heading', { level: 1, name: 'Liens', exact: true })).toBeVisible()
    await expect(page.getByText('Votre page de liens', { exact: true })).toBeVisible()
    await expect(page.getByText(`${BASE_URL}/@${username}`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Partager', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'QR code', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ajouter un lien', exact: true })).toBeVisible()
    await expect(page.getByRole('switch', { name: /Visible sur votre page de liens/ })).toHaveCount(0)
  })
})

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
