import { expect, test } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { donnerPlanPayant } from './helpers/abonnement'
import { attendreHydration, ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

// S5 — critère de réception : parcours complet d’un témoignage, du formulaire du studio jusqu’à la
// page publique (création, liste, modification, masquage, ordre, accessibilité).
// Même patron que e2e/liens.spec.ts : UNE session OTP (describe.serial), vitrine fraîche publiée,
// contexte navigateur avec `storageState`, page publique lue dans un second contexte sans session.

const MOBILE = { width: 390, height: 844 }
const PC = { width: 1280, height: 800 }

// Un suffixe par exécution garde les libellés et slugs des données E2E faciles à isoler dans la base.
const AUTEURS: Record<'vedette' | 'visible' | 'masque' | 'cree', string> = {
  /** Vedette visible (fixture). */
  vedette: '',
  /** Visible sans vedette (fixture) : c'est elle qu'on modifie puis qu'on masque. */
  visible: '',
  /** Masqué dès la fixture : il ne figure jamais sur la page publique. */
  masque: '',
  /** Créé par le formulaire du studio. */
  cree: '',
}

const FONCTION_CREEE = 'Cliente satisfaite'
const TEXTE_CREE = 'Un accompagnement impeccable du premier au dernier jour.'
const TEXTE_AVANT = 'Diagnostic rapide et suivi sérieux.'
const TEXTE_APRES = 'Diagnostic rapide, suivi sérieux et humain.'

interface TemoignageApi {
  id: string
  slug: string
  auteur: string
  fonction: string | null
  texte: string
  enVedette: boolean
  actif: boolean
  ordre: number
}

async function sansDebordementHorizontal(page: Page): Promise<void> {
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(debordement, 'la page ne doit pas défiler horizontalement').toBeLessThanOrEqual(0)
}

test.describe.serial('studio témoignages — vitrine fraîche (S5 : parcours complet)', () => {
  let session: Session
  let contexte: BrowserContext
  let page: Page
  let username: string
  /** Témoignage modifiable : son slug final vient de l’API. */
  let bruno: TemoignageApi

  function ligne(auteur: string): Locator {
    return page
      .getByRole('listitem')
      .filter({ has: page.getByRole('switch', { name: `Visible sur la vitrine : ${auteur}` }) })
  }

  /** Auteurs affichés, dans l’ordre de la liste du studio (libellés des interrupteurs). */
  async function auteursAffiches(): Promise<string[]> {
    const etiquettes = await page.getByRole('switch').evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('aria-label') ?? ''),
    )
    return etiquettes.map((etiquette) => etiquette.replace('Visible sur la vitrine : ', ''))
  }

  async function creerParApi(corps: Record<string, unknown>): Promise<TemoignageApi> {
    const reponse = await session.api.post('/api/studio/temoignages', { data: corps })
    expect(reponse.status(), `POST /api/studio/temoignages : ${await reponse.text()}`).toBe(200)
    return ((await reponse.json()) as { temoignage: TemoignageApi }).temoignage
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    username = `temoignage-ui-${randomUUID().slice(0, 8)}`
    // Le suffixe relie sans ambiguïté les données créées par cette exécution.
    const suffixe = username.slice(-8)
    AUTEURS.vedette = `Alice Mbarga ${suffixe}`
    AUTEURS.visible = `Bruno Njoya ${suffixe}`
    AUTEURS.masque = `Chantal Ekwalla ${suffixe}`
    AUTEURS.cree = `Claire Owona ${suffixe}`
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status(), await creation.text()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    // Ce parcours crée un 4e témoignage par le formulaire : il ne porte pas sur le quota (3 au plan gratuit, S10 #124).
    // Le compte a donc un abonnement payant actif.
    await donnerPlanPayant(session.userId)

    // Trois témoignages : 1 vedette visible, 1 visible non vedette, 1 masqué.
    const alice = await creerParApi({
      slug: `alice-mbarga-${suffixe}`,
      auteur: AUTEURS.vedette,
      fonction: 'Cliente',
      texte: 'Toujours à l’écoute, un vrai professionnalisme.',
      enVedette: true,
      actif: true,
    })
    expect(alice).toMatchObject({ auteur: AUTEURS.vedette, enVedette: true, actif: true, ordre: 0 })

    bruno = await creerParApi({
      slug: `bruno-njoya-${suffixe}`,
      auteur: AUTEURS.visible,
      texte: TEXTE_AVANT,
      enVedette: false,
      actif: true,
    })
    expect(bruno).toMatchObject({ auteur: AUTEURS.visible, enVedette: false, actif: true, ordre: 1 })

    const chantal = await creerParApi({
      slug: `chantal-ekwalla-${suffixe}`,
      auteur: AUTEURS.masque,
      fonction: 'Directrice',
      texte: 'Équipe à l’écoute et rendez-vous tenus.',
      enVedette: false,
      actif: false,
    })
    expect(chantal).toMatchObject({ auteur: AUTEURS.masque, enVedette: false, actif: false, ordre: 2 })

    contexte = await browser.newContext({ baseURL: BASE_URL, storageState: await session.api.storageState(), viewport: MOBILE })
    page = await contexte.newPage()
  })

  test.afterAll(async () => {
    await contexte?.close()
    await session?.api.dispose()
    await fermerConnexions()
  })

  test('création par le formulaire : enregistrement sans message d’erreur (correctif des refs envoyées sans .value)', async () => {
    await ouvrirStudio(page, '/studio/temoignages/nouveau')
    await expect(page.getByRole('heading', { level: 1, name: 'Nouveau témoignage' })).toBeVisible()

    await page.getByLabel('Auteur').fill(AUTEURS.cree)
    await page.getByLabel('Fonction').fill(FONCTION_CREEE)
    await page.getByLabel('Texte du témoignage').fill(TEXTE_CREE)

    const creation = page.waitForResponse(
      (reponse) => reponse.request().method() === 'POST' && reponse.url().includes('/api/studio/temoignages'),
    )
    await page.getByRole('button', { name: 'Enregistrer' }).click()
    const reponse = await creation
    const corps = await reponse.text()
    // Une ref Vue envoyée sans .value répondait 400 « Données invalides » : la sortie brute est collée en cas d’échec.
    expect(reponse.status(), `POST /api/studio/temoignages : ${corps}`).toBe(200)

    await expect(page).toHaveURL(/\/studio\/temoignages$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Témoignages' })).toBeVisible()
    await expect(ligne(AUTEURS.cree)).toHaveCount(1)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('liste : h1, sous-titre des compteurs, 4 lignes, interrupteurs et badge « En vedette »', async () => {
    await ouvrirStudio(page, '/studio/temoignages')
    await expect(page.getByRole('heading', { level: 1, name: 'Témoignages' })).toBeVisible()
    // resumeListeTemoignages(3 visibles, 2 en vedette, plafond 3)
    await expect(page.getByText('3 visibles · 2 en vedette sur 3')).toBeVisible()

    await expect(page.getByRole('listitem').filter({ has: page.getByRole('switch') })).toHaveCount(4)
    await expect(page.getByRole('switch', { name: `Visible sur la vitrine : ${AUTEURS.vedette}` })).toBeChecked()
    await expect(page.getByRole('switch', { name: `Visible sur la vitrine : ${AUTEURS.visible}` })).toBeChecked()
    await expect(page.getByRole('switch', { name: `Visible sur la vitrine : ${AUTEURS.masque}` })).not.toBeChecked()
    await expect(page.getByRole('switch', { name: `Visible sur la vitrine : ${AUTEURS.cree}` })).toBeChecked()

    await expect(ligne(AUTEURS.vedette).getByText('En vedette', { exact: true })).toBeVisible()
    await expect(ligne(AUTEURS.cree).getByText('En vedette', { exact: true })).toBeVisible()
    await expect(ligne(AUTEURS.visible).getByText('En vedette', { exact: true })).toHaveCount(0)
    await expect(ligne(AUTEURS.masque).getByText('En vedette', { exact: true })).toHaveCount(0)

    await expect(page.locator('[data-poignee]')).toHaveCount(4)
    await expect
      .poll(auteursAffiches)
      .toEqual([AUTEURS.vedette, AUTEURS.visible, AUTEURS.masque, AUTEURS.cree])
  })

  test('modification : le texte enregistré revient à la liste', async () => {
    await ouvrirStudio(page, '/studio/temoignages')
    await ligne(AUTEURS.visible).getByRole('link').click()
    await expect(page).toHaveURL(new RegExp(`/studio/temoignages/${bruno.slug}$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Modifier le témoignage' })).toBeVisible()

    const champTexte = page.getByLabel('Texte du témoignage')
    await expect(champTexte).toBeVisible()
    await champTexte.fill(TEXTE_APRES)
    await page.getByRole('button', { name: 'Enregistrer' }).click()

    await expect(page).toHaveURL(/\/studio\/temoignages$/)
    await expect(ligne(AUTEURS.visible)).toContainText(TEXTE_APRES)
    await expect(ligne(AUTEURS.visible)).not.toContainText(TEXTE_AVANT)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })

  test('masquage : le témoignage disparaît de la page publique, les visibles restent', async ({ browser }) => {
    await ouvrirStudio(page, '/studio/temoignages')
    const interrupteur = page.getByRole('switch', { name: `Visible sur la vitrine : ${AUTEURS.visible}` })
    await interrupteur.click()
    await expect(interrupteur).not.toBeChecked()

    const publique = await browser.newContext({ baseURL: BASE_URL })
    const pagePublique = await publique.newPage()
    await pagePublique.setViewportSize(PC)
    const reponse = await pagePublique.goto(`/${username}`)
    expect(reponse?.status()).toBe(200)
    await attendreHydration(pagePublique)
    const temoignagesPublics = pagePublique.locator('section[aria-label="Témoignages à la une"]')
    await expect(temoignagesPublics).toBeVisible()

    await expect(temoignagesPublics.getByText(AUTEURS.visible, { exact: true })).toHaveCount(0)
    await expect(temoignagesPublics.getByText(AUTEURS.vedette, { exact: true })).toBeVisible()
    await expect(temoignagesPublics.getByText(AUTEURS.masque, { exact: true })).toHaveCount(0)

    await temoignagesPublics.getByRole('button', { name: "Lire d'autres avis (1)" }).click()
    await expect(temoignagesPublics.getByText(AUTEURS.cree, { exact: true })).toBeVisible()
    await publique.close()
  })

  test('ordre : le déplacement au clavier de la liste se retrouve sur la page publique', async ({ browser }) => {
    await ouvrirStudio(page, '/studio/temoignages')
    // Chaque flèche envoie son propre réordonnancement : on attend la réponse 200 avant la frappe
    // suivante, sinon la page publique peut être rendue entre deux écritures (patron liens.spec).
    const reponseReordonnance = () =>
      page.waitForResponse((reponse) => reponse.url().includes('/temoignages/reordonner') && reponse.status() === 200)
    const poignee = page.getByRole('button', { name: `Déplacer ${AUTEURS.cree} (flèches haut et bas)` })
    await expect(poignee).toBeVisible()
    await poignee.focus()

    for (let saut = 0; saut < 3; saut += 1) {
      const reponse = reponseReordonnance()
      await page.keyboard.press('ArrowUp')
      await reponse
      await expect(poignee).toBeFocused()
    }

    await expect
      .poll(auteursAffiches)
      .toEqual([AUTEURS.cree, AUTEURS.vedette, AUTEURS.visible, AUTEURS.masque])

    const publique = await browser.newContext({ baseURL: BASE_URL })
    const pagePublique = await publique.newPage()
    await pagePublique.setViewportSize(PC)
    const reponse = await pagePublique.goto(`/${username}`)
    expect(reponse?.status()).toBe(200)
    await attendreHydration(pagePublique)
    const temoignagesPublics = pagePublique.locator('section[aria-label="Témoignages à la une"]')
    await expect(temoignagesPublics).toBeVisible()
    await expect(temoignagesPublics.locator('blockquote')).toContainText(TEXTE_CREE)
    await expect(temoignagesPublics.getByText(AUTEURS.cree, { exact: true })).toBeVisible()
    await expect(temoignagesPublics.getByText(AUTEURS.vedette, { exact: true })).toHaveCount(0)

    await temoignagesPublics.getByRole('button', { name: "Lire d'autres avis (1)" }).click()
    await expect(temoignagesPublics.getByText(AUTEURS.vedette, { exact: true })).toBeVisible()
    await publique.close()
  })

  test('à 390 px : la liste du studio ne défile pas horizontalement', async () => {
    await page.setViewportSize(MOBILE)
    await ouvrirStudio(page, '/studio/temoignages')
    await expect(page.getByRole('heading', { level: 1, name: 'Témoignages' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ has: page.getByRole('switch') })).toHaveCount(4)
    await sansDebordementHorizontal(page)
  })
})

function randomUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}
