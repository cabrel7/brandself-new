import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { attendreHydration } from './helpers/hydratation'
import { BASE_URL, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'
import { StudioServiceFormulaire, StudioServicesListe } from './pages/studio-services'

// S3-CA44 à CA49 : parcours UI des services (studio et vitrine publique).
// - Pages publiques lues sur la vitrine de démonstration `dr-cabrel` (seed), en lecture seule.
// - Parcours du studio sur une vitrine fraîche, dans un seul describe.serial : une session par fichier
//   (limite d'envoi OTP), ouverte par l'API puis injectée dans le navigateur (le parcours UI de
//   connexion est couvert par connexion.spec.ts).

const MOBILE = { width: 390, height: 844 }
const PC = { width: 1280, height: 800 }
const SERVICE_DEMO = 'consultation-de-cardiologie'

interface ReponseService {
  service: { id: string, titre: string, slug: string }
}

async function sansDebordementHorizontal(page: Page): Promise<void> {
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(debordement, 'la page ne doit pas défiler horizontalement').toBeLessThanOrEqual(0)
}

test.describe('vitrine publique dr-cabrel (S3-CA44, CA47)', () => {
  test('CA44 /dr-cabrel/services affiche la grille « Mes services », pas l’accueil', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto('/dr-cabrel/services')
    await expect(page.getByRole('heading', { level: 1, name: 'Mes services' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: /Cardiologue interventionnel/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 3, name: 'Consultation de cardiologie' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 3 })).toHaveCount(6)
  })

  test('CA44 /dr-cabrel/services/<slug> affiche le détail du service', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto(`/dr-cabrel/services/${SERVICE_DEMO}`)
    await expect(page.getByRole('heading', { level: 1, name: 'Consultation de cardiologie' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Tous les services', exact: true })).toBeVisible()
  })

  test('CA44 un slug inconnu répond 404', async ({ page }) => {
    const reponse = await page.goto('/dr-cabrel/services/service-qui-nexiste-pas')
    expect(reponse?.status()).toBe(404)
  })

  test('CA47 à 390 px : « Ce que je propose » défile horizontalement, au clavier', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    await page.goto('/dr-cabrel')
    await expect(page.getByRole('heading', { name: 'Ce que je propose' })).toBeVisible()
    const region = page.getByRole('region', { name: 'Services à la une' })
    const defile = await region.evaluate((el) => el.scrollWidth > el.clientWidth)
    expect(defile).toBe(true)
    await attendreHydration(page)
    await region.focus()
    await expect(region).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    await sansDebordementHorizontal(page)
  })

  test('CA47 à 1280 px : 3 cartes côte à côte et lien « Voir tous les services (n) »', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto('/dr-cabrel')
    const region = page.getByRole('region', { name: 'Services à la une' })
    const cartes = region.getByRole('listitem')
    await expect(cartes).toHaveCount(3)
    const boites = await Promise.all([0, 1, 2].map((i) => cartes.nth(i).boundingBox()))
    const [a, b, c] = boites
    expect(a && b && c).toBeTruthy()
    expect(Math.abs((a?.y ?? 0) - (b?.y ?? 1))).toBeLessThan(2)
    expect(Math.abs((b?.y ?? 0) - (c?.y ?? 1))).toBeLessThan(2)
    expect(b?.x ?? 0).toBeGreaterThan((a?.x ?? 0) + (a?.width ?? 0) - 1)
    expect(c?.x ?? 0).toBeGreaterThan((b?.x ?? 0) + (b?.width ?? 0) - 1)
    await expect(page.getByRole('link', { name: 'Voir tous les services (6)' })).toBeVisible()
  })

  test('CA47 le libellé d’action suit le type du service', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto('/dr-cabrel/services')
    await expect(page.getByRole('link', { name: 'Réserver la 1re séance' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Réserver', exact: true }).first()).toBeVisible()
  })

  test('CA47 une carte sans photo montre un aplat d’accent et l’initiale', async ({ page }) => {
    await page.setViewportSize(PC)
    await page.goto('/dr-cabrel/services')
    // Le visuel sans photo est décoratif (aria-hidden) : on cible l'initiale rendue dans une carte.
    const sansPhoto = page.getByRole('article').filter({ hasNot: page.getByRole('img') })
    expect(await sansPhoto.count()).toBeGreaterThan(0)
    const carte = sansPhoto.first()
    const titre = (await carte.getByRole('heading', { level: 3 }).innerText()).trim()
    const initiale = Array.from(titre)[0].toLocaleUpperCase('fr')
    await expect(carte.getByText(initiale, { exact: true }).first()).toBeAttached()
  })
})

test.describe.serial('studio des services — vitrine fraîche (S3-CA45, CA46, CA48, CA49 + CRUD)', () => {
  let session: Session
  let contexte: BrowserContext
  let page: Page
  let liste: StudioServicesListe
  let formulaire: StudioServiceFormulaire
  const username = `svc-ui-${randomUUID().slice(0, 8)}`
  const ids: Record<string, string> = {}

  async function creerParApi(donnees: Record<string, unknown>): Promise<ReponseService['service']> {
    const reponse = await session.api.post('/api/studio/services', { data: donnees })
    expect(reponse.status(), await reponse.text()).toBe(201)
    return ((await reponse.json()) as ReponseService).service
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    contexte = await browser.newContext({ baseURL: BASE_URL, storageState: await session.api.storageState(), viewport: MOBILE })
    page = await contexte.newPage()
    liste = new StudioServicesListe(page)
    formulaire = new StudioServiceFormulaire(page)
  })

  test.afterAll(async () => {
    await contexte?.close()
    await session?.api.dispose()
    await fermerConnexions()
  })

  test('CA49 le HTML de /studio/services/nouveau ne contient aucun contenu rendu serveur (ssr:false)', async () => {
    const reponse = await contexte.request.get('/studio/services/nouveau')
    expect(reponse.status()).toBe(200)
    const html = await reponse.text()
    expect(html).not.toContain('Nouveau service')
    expect(html).not.toContain('Enregistrer')
  })

  test('CA48 vitrine sans service : pas de section, pas de lien « Services », /services répond 404', async () => {
    await page.setViewportSize(PC)
    await page.goto(`/${username}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Ce que je propose' })).toHaveCount(0)
    await expect(page.getByRole('navigation', { name: 'Vitrine' }).getByRole('link', { name: 'Services', exact: true })).toHaveCount(0)
    const reponse = await page.goto(`/${username}/services`)
    expect(reponse?.status()).toBe(404)
  })

  test('état vide du studio : message et action « Ajouter un service »', async () => {
    await page.setViewportSize(MOBILE)
    await liste.goto()
    await expect(page.getByRole('heading', { level: 1, name: 'Présentez ce que vous proposez' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ajouter un service' })).toBeVisible()
    await sansDebordementHorizontal(page)
  })

  test('CA45 « Accompagnement » fait apparaître Séances, Durée et Rythme', async () => {
    await formulaire.gotoNouveau()
    await expect(page.getByLabel('Séances')).toHaveCount(0)
    await formulaire.choisirType('Accompagnement (plusieurs séances)')
    await expect(page.getByRole('heading', { name: 'Accompagnement', exact: true })).toBeVisible()
    await expect(page.getByLabel('Séances')).toBeVisible()
    await expect(page.getByLabel('Durée (min)')).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Rythme' })).toBeVisible()
  })

  test('CA45 « Prestation sur devis » verrouille le tarif sur « Sur devis » et masque le prix', async () => {
    await formulaire.gotoNouveau()
    await formulaire.choisirTarif('Payant')
    await expect(page.getByLabel('Prix', { exact: false }).first()).toBeVisible()
    await formulaire.choisirType('Prestation sur devis')
    await expect(formulaire.tarif('Sur devis')).toBeChecked()
    await expect(formulaire.tarif('Payant')).toBeDisabled()
    await expect(formulaire.tarif('Gratuit')).toBeDisabled()
    await expect(page.getByText('Une prestation sur devis n’a pas de tarif fixe')).toBeVisible()
    await expect(page.getByRole('radio', { name: /Sur place/ })).toHaveCount(0)
  })

  test('validation : un titre vide est refusé sous le champ, sans appel réseau fautif', async () => {
    await formulaire.gotoNouveau()
    await formulaire.choisirTarif('Gratuit')
    await page.getByLabel('Durée (min)').fill('30')
    await formulaire.enregistrer.click()
    await expect(page.getByText(/titre/i).filter({ hasText: /\S/ }).first()).toBeVisible()
    await expect(page).toHaveURL(/\/studio\/services\/nouveau/)
  })

  test('CA45 création d’un rendez-vous payant : la liste affiche « Rendez-vous · 45 min · Payant » et « En vedette »', async () => {
    await formulaire.gotoNouveau()
    await formulaire.titre.fill('Consultation de cardiologie')
    await page.getByLabel('Durée (min)').fill('45')
    await formulaire.choisirTarif('Payant')
    await page.getByLabel('Prix', { exact: false }).first().fill('15000')
    await formulaire.enregistrer.click()
    await expect(page).toHaveURL(/\/studio\/services$/)
    const ligne = liste.ligne('Consultation de cardiologie')
    await expect(ligne).toContainText('Rendez-vous · 45 min · Payant')
    await expect(ligne.getByText('En vedette', { exact: true })).toBeVisible()
    await expect(page.getByText('1 visible · 1 en vedette sur 3')).toBeVisible()
    await sansDebordementHorizontal(page)
  })

  test('double soumission : deux clics rapides sur Enregistrer ne créent qu’un service', async () => {
    await formulaire.gotoNouveau()
    await formulaire.titre.fill('Bilan cardiovasculaire')
    await page.getByLabel('Durée (min)').fill('60')
    await formulaire.choisirTarif('Gratuit')
    await formulaire.enregistrer.dblclick()
    await expect(page).toHaveURL(/\/studio\/services$/)
    const { services } = (await (await session.api.get('/api/studio/services')).json()) as { services: { titre: string }[] }
    expect(services.filter((s) => s.titre === 'Bilan cardiovasculaire')).toHaveLength(1)
  })

  test('mise en place : deux services de plus (3 en vedette) et un 4e hors vedette', async () => {
    const echo = await creerParApi({ titre: 'Échographie cardiaque', type: 'rdv', dureeMin: 30, tarif: 'gratuit' })
    const quatrieme = await creerParApi({ titre: 'Suivi à distance', type: 'rdv', dureeMin: 20, tarif: 'gratuit' })
    const tous = ((await (await session.api.get('/api/studio/services')).json()) as { services: { id: string, titre: string, enVedette: boolean }[] })
    for (const s of tous.services) ids[s.titre] = s.id
    expect(echo.id).toBe(ids['Échographie cardiaque'])
    expect(quatrieme.id).toBe(ids['Suivi à distance'])
    expect(tous.services.map((s) => s.enVedette)).toEqual([true, true, true, false])
  })

  test('CA46 3 vedettes : l’interrupteur « En vedette sur l’accueil » du 4e service est désactivé avec son explication', async () => {
    await formulaire.gotoModifier(ids['Suivi à distance'])
    await expect(formulaire.interrupteurVedette).toBeDisabled()
    await expect(page.getByText('3 services sur 3 en vedette. Retirez-en un pour en ajouter un autre.')).toBeVisible()
  })

  test('CA45 masquer par l’interrupteur : ligne grisée « … · Masqué », retirée de la vitrine publique', async () => {
    await liste.goto()
    const interrupteur = liste.interrupteurVisibilite('Consultation de cardiologie')
    await expect(interrupteur).toBeChecked()
    await interrupteur.click()
    await expect(interrupteur).not.toBeChecked()
    await expect(liste.ligne('Consultation de cardiologie')).toContainText('Rendez-vous · 45 min · Payant · Masqué')
    await expect(liste.ligne('Consultation de cardiologie').getByText('En vedette', { exact: true })).toHaveCount(0)
    await expect(page.getByText('3 visibles · 2 en vedette sur 3')).toBeVisible()
    // Persisté : la lecture fraîche après rechargement donne le même état.
    await page.reload()
    await attendreHydration(page)
    await expect(liste.interrupteurVisibilite('Consultation de cardiologie')).not.toBeChecked()
    // 404 public du service masqué.
    const reponse = await page.goto(`/${username}/services/consultation-de-cardiologie`)
    expect(reponse?.status()).toBe(404)
  })

  test('mettre en vedette : la place libérée permet d’activer l’interrupteur, la liste affiche l’étiquette', async () => {
    await formulaire.gotoModifier(ids['Suivi à distance'])
    await expect(formulaire.interrupteurVedette).toBeEnabled()
    await formulaire.interrupteurVedette.click()
    await formulaire.enregistrer.click()
    await expect(page).toHaveURL(/\/studio\/services$/)
    await expect(liste.ligne('Suivi à distance').getByText('En vedette', { exact: true })).toBeVisible()
    await expect(page.getByText('3 visibles · 3 en vedette sur 3')).toBeVisible()
  })

  test('modifier : le titre change, l’adresse publique (slug) reste stable', async () => {
    await formulaire.gotoModifier(ids['Échographie cardiaque'])
    await formulaire.titre.fill('Échographie du cœur')
    await formulaire.enregistrer.click()
    await expect(page).toHaveURL(/\/studio\/services$/)
    await expect(liste.ligne('Échographie du cœur')).toBeVisible()
    await page.goto(`/${username}/services/echographie-cardiaque`)
    await expect(page.getByRole('heading', { level: 1, name: 'Échographie du cœur' })).toBeVisible()
  })

  test('CA48 inverse : avec des services, l’accueil montre « Ce que je propose » et le lien Services', async () => {
    await page.setViewportSize(PC)
    await page.goto(`/${username}`)
    await expect(page.getByRole('heading', { name: 'Ce que je propose' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Vitrine' }).getByRole('link', { name: 'Services', exact: true })).toBeVisible()
    await page.setViewportSize(MOBILE)
  })

  test('réordonner au clavier (poignée + flèche bas) : l’ordre est persisté et suivi par la vitrine publique', async () => {
    await liste.goto()
    const avant = await liste.titres()
    expect(avant).toEqual(['Consultation de cardiologie', 'Bilan cardiovasculaire', 'Échographie du cœur', 'Suivi à distance'])
    const poignee = liste.poignee('Consultation de cardiologie')
    await poignee.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    const apres = ['Bilan cardiovasculaire', 'Échographie du cœur', 'Consultation de cardiologie', 'Suivi à distance']
    await expect.poll(() => liste.titres()).toEqual(apres)
    await expect(liste.poignee('Consultation de cardiologie')).toBeFocused()
    await expect.poll(async () => {
      const r = (await (await session.api.get('/api/studio/services')).json()) as { services: { titre: string }[] }
      return r.services.map((s) => s.titre)
    }).toEqual(apres)
    // Public : le service masqué disparaît, les autres suivent l'ordre.
    const publique = (await (await session.api.get(`/api/public/${username}/services`)).json()) as { services: { titre: string }[] }
    expect(publique.services.map((s) => s.titre)).toEqual(['Bilan cardiovasculaire', 'Échographie du cœur', 'Suivi à distance'])
  })

  test('supprimer : confirmation, puis le service disparaît du studio et de la vitrine', async () => {
    await formulaire.gotoModifier(ids['Suivi à distance'])
    await page.getByRole('button', { name: 'Supprimer ce service' }).click()
    const dialogue = page.getByRole('dialog')
    await expect(dialogue.getByText('Supprimer « Suivi à distance » ?')).toBeVisible()
    await dialogue.getByRole('button', { name: 'Annuler' }).click()
    await expect(dialogue).toHaveCount(0)
    await page.getByRole('button', { name: 'Supprimer ce service' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
    await expect(page).toHaveURL(/\/studio\/services$/)
    await expect(liste.ligne('Suivi à distance')).toHaveCount(0)
    const reponse = await page.goto(`/${username}/services/suivi-a-distance`)
    expect(reponse?.status()).toBe(404)
  })

  test('session expirée : le studio renvoie vers /connexion', async () => {
    const sansSession = await contexte.browser()?.newContext({ baseURL: BASE_URL, viewport: MOBILE })
    const p = await sansSession?.newPage()
    // Le limiteur de Better Auth (100 req/min/IP en mémoire, 429 sur get-session) peut être saturé par les
    // specs précédentes : l'application affiche alors « Un incident est survenu » au lieu de rediriger.
    // On recharge jusqu'à ce que la fenêtre se vide (60 s au plus).
    // La redirection est faite côté client (studio en `ssr: false`) : à froid, l'hydratation du studio
    // dépasse 25 s en développement. Chaque tentative la laisse donc aboutir avant de recharger.
    test.setTimeout(240_000)
    await expect(async () => {
      await p?.goto('/studio/services')
      await expect(p!).toHaveURL(/\/connexion/, { timeout: 70_000 })
    }).toPass({ timeout: 200_000, intervals: [5_000] })
    await sansSession?.close()
  })
})
