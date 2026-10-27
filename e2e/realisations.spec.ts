import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { makePng } from '../tests/support/images'
import { attendreHydration } from './helpers/hydratation'
import { BASE_URL, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'
import { StudioRealisationFormulaire, StudioRealisationsListe } from './pages/studio-realisations'
import type { FichierImage } from './pages/studio-realisations'
import { VitrineRealisations } from './pages/vitrine-realisations'

// S4-CA48 à CA55 : parcours UI des réalisations (studio et vitrine publique).
// - Pages publiques lues sur la vitrine de démonstration `dr-cabrel` (seed), en lecture seule.
// - Parcours du studio sur une vitrine fraîche, dans un seul describe.serial : une session par fichier
//   (limite d'envoi OTP), ouverte par l'API puis injectée dans le navigateur. Les images sont fabriquées avec
//   sharp (aucun binaire commité) ; les téléversements sont comptés (30 par heure) : on en consomme une dizaine.

const MOBILE = { width: 390, height: 844 }
const TABLETTE = { width: 768, height: 1024 }
const PC = { width: 1280, height: 800 }
const CIBLE_TACTILE_PX = 44
const SLUG_DEMO = 'unite-de-catheterisme-chu-de-douala'
const TITRE_DEMO = 'Unité de cathétérisme, CHU de Douala'

interface MediaApi {
  id: string
  largeur: number
}

interface RealisationApi {
  id: string
  slug: string
  titre: string
  enVedette: boolean
  actif: boolean
  galerie: MediaApi[]
  image: MediaApi | null
}

async function sansDebordementHorizontal(page: Page): Promise<void> {
  const debordement = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(debordement, 'la page ne doit pas défiler horizontalement').toBeLessThanOrEqual(0)
}

/** PNG de largeur donnée : la largeur sert d'empreinte pour reconnaître l'ordre de la galerie après traitement. */
async function image(nom: string, largeur: number): Promise<FichierImage> {
  return { name: `${nom}.png`, mimeType: 'image/png', buffer: await makePng(largeur, 200) }
}

test.describe('vitrine publique dr-cabrel (S4-CA50 à CA53, CA55)', () => {
  test('CA50 accueil à 1280 : section « À la une » avec la 1re vedette, lien « Voir toutes les réalisations (3) »', async ({ page }) => {
    await page.setViewportSize(PC)
    const vitrine = new VitrineRealisations(page, 'dr-cabrel')
    await vitrine.gotoAccueil()
    const section = vitrine.sectionALaUne
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { level: 2, name: 'À la une' })).toBeVisible()
    await expect(section.getByRole('heading', { level: 3 })).toHaveCount(1)
    await expect(section.getByRole('heading', { level: 3, name: TITRE_DEMO })).toBeVisible()
    await expect(section.getByText('Mise en place et coordination')).toBeVisible()
    await expect(section.getByRole('link', { name: TITRE_DEMO })).toHaveAttribute('href', `/dr-cabrel/realisations/${SLUG_DEMO}`)
    await expect(vitrine.voirToutes).toHaveText(/Voir toutes les réalisations \(3\)/)
    // CA53 : surtitre et lien « Voir toutes… » en text-accent-texte.
    await expect(section.getByText('Réalisations', { exact: true })).toHaveClass(/text-accent-texte/)
    await expect(vitrine.voirToutes).toHaveClass(/text-accent-texte/)
  })

  test('CA52 navigation à 1280 : « Services », « Réalisations » et « Contact » visibles', async ({ page }) => {
    await page.setViewportSize(PC)
    const vitrine = new VitrineRealisations(page, 'dr-cabrel')
    await vitrine.gotoAccueil()
    for (const nom of ['Services', 'Réalisations', 'Contact']) {
      await expect(vitrine.lienNav(nom)).toBeVisible()
    }
  })

  test('CA52 navigation à 768 : les 3 liens tiennent sans débordement horizontal', async ({ page }) => {
    await page.setViewportSize(TABLETTE)
    const vitrine = new VitrineRealisations(page, 'dr-cabrel')
    await vitrine.gotoAccueil()
    for (const nom of ['Services', 'Réalisations', 'Contact']) {
      await expect(vitrine.lienNav(nom)).toBeVisible()
    }
    await sansDebordementHorizontal(page)
  })

  test('CA52 la liste /realisations marque « Réalisations » actif ; le détail aussi', async ({ page }) => {
    await page.setViewportSize(PC)
    const vitrine = new VitrineRealisations(page, 'dr-cabrel')
    await vitrine.gotoListe()
    await expect(vitrine.lienNav('Réalisations')).toHaveAttribute('aria-current', 'page')
    await expect(vitrine.lienNav('Services')).not.toHaveAttribute('aria-current', 'page')
    await vitrine.gotoDetail(SLUG_DEMO)
    await expect(vitrine.lienNav('Réalisations')).toHaveAttribute('aria-current', 'page')
  })

  test('CA55 la liste : h1 « Mes réalisations », 3 cartes, titre de page, carte cliquable', async ({ page }) => {
    await page.setViewportSize(PC)
    const vitrine = new VitrineRealisations(page, 'dr-cabrel')
    await vitrine.gotoListe()
    await expect(page.getByRole('heading', { level: 1, name: 'Mes réalisations' })).toBeVisible()
    await expect(page.getByRole('article')).toHaveCount(3)
    await expect(page.getByRole('article').getByRole('heading', { level: 2 })).toHaveCount(3)
    // Le gabarit de titre du site ajoute « | Brandself ».
    await expect(page).toHaveTitle(/^Réalisations — Dr Cabrel Nguesso( \| Brandself)?$/)
    await page.getByRole('link', { name: 'Programme de réadaptation cardiaque' }).click()
    await expect(page).toHaveURL(/\/dr-cabrel\/realisations\/programme-de-readaptation-cardiaque$/)
  })

  test('CA51 CA53 CA55 détail à 390 : ordre des blocs, galerie en 2 colonnes, alt, titre et données structurées', async ({ page }) => {
    await page.setViewportSize(MOBILE)
    const vitrine = new VitrineRealisations(page, 'dr-cabrel')
    await vitrine.gotoDetail(SLUG_DEMO)
    const retour = page.getByRole('link', { name: 'Toutes les réalisations', exact: true })
    const visuel = page.getByRole('img', { name: `Image de la réalisation ${TITRE_DEMO}` })
    const surtitre = page.getByText('Réalisation · 2025', { exact: true }) // majuscules par CSS
    const h1 = page.getByRole('heading', { level: 1, name: TITRE_DEMO })
    const faits = page.getByText('CHU de Douala', { exact: true }).first()
    const description = page.getByText('Mise en place et coordination')
    const autres = page.getByRole('heading', { level: 2, name: 'Autres réalisations' })
    const appel = page.getByRole('heading', { level: 2, name: 'Un projet en tête ? Parlons-en.' })
    const blocs = [retour, visuel, surtitre, h1, faits, description, vitrine.galerie, autres, appel]
    const ys: number[] = []
    for (const bloc of blocs) {
      await expect(bloc).toBeVisible()
      ys.push((await bloc.boundingBox())!.y)
    }
    expect(ys, 'ordre vertical des blocs').toEqual([...ys].sort((a, b) => a - b))
    // Pas de lien dans le seed : pas de bouton « Voir le projet ».
    await expect(page.getByRole('link', { name: /Voir le projet/ })).toHaveCount(0)
    // Galerie : 4 images, 2 colonnes, alt explicite.
    const images = vitrine.galerie.getByRole('img')
    await expect(images).toHaveCount(4)
    for (let n = 1; n <= 4; n++) {
      await expect(vitrine.galerie.getByRole('img', { name: `Image ${n} sur 4 : ${TITRE_DEMO}` })).toBeVisible()
    }
    const [a, b, c] = await Promise.all([0, 1, 2].map((i) => images.nth(i).boundingBox()))
    expect(Math.abs(a!.y - b!.y)).toBeLessThan(2)
    expect(c!.y).toBeGreaterThan(a!.y + a!.height - 1)
    expect(a!.width).toBeGreaterThanOrEqual(CIBLE_TACTILE_PX)
    // Autres : lien « Voir toutes… » ; bandeau vers /reserver.
    await expect(page.getByRole('link', { name: /Voir toutes les réalisations \(3\)/ })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Prendre rendez-vous' })).toHaveAttribute('href', '/dr-cabrel/reserver')
    await sansDebordementHorizontal(page)
    // CA55 : SEO.
    const seo = (await (await page.request.get(`/api/public/dr-cabrel/realisations/${SLUG_DEMO}`)).json()) as { realisation: { seo: { titre: string, description: string } } }
    await expect(page).toHaveTitle(new RegExp(`^${seo.realisation.seo.titre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( \\| Brandself)?$`))
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', seo.realisation.seo.description)
    const donnees = await page.locator('script[type="application/ld+json"]').allTextContents()
    expect(donnees.join('')).toContain('CreativeWork')
  })

  test('CA53 la vignette de galerie publique prend un contour au focus clavier', async ({ page }) => {
    await page.setViewportSize(PC)
    await new VitrineRealisations(page, 'dr-cabrel').gotoDetail(SLUG_DEMO)
    const lien = page.getByRole('link', { name: /Voir l’image 1 sur 4 en grand \(nouvel onglet\)/ })
    await lien.scrollIntoViewIfNeeded()
    await lien.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(lien).toBeFocused()
    expect(await lien.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none')
  })

  test('une réalisation inconnue répond 404 ; /DR-CABREL/realisations est normalisé côté serveur (S2-CA13)', async ({ page }) => {
    const inconnue = await page.goto('/dr-cabrel/realisations/projet-qui-nexiste-pas')
    expect(inconnue?.status()).toBe(404)
    await page.setViewportSize(PC)
    const majuscules = await page.goto('/DR-CABREL/realisations')
    expect(majuscules?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Mes réalisations' })).toBeVisible()
    // Le nom est normalisé pour la lecture (pas de redirection) : les cartes de la vitrine s'affichent.
    await expect(page.getByRole('article')).toHaveCount(3)
  })
})

test.describe.serial('studio des réalisations — vitrine fraîche (S4-CA48, CA49, CA50, CA53, CA54 + CRUD)', () => {
  let session: Session
  let contexte: BrowserContext
  let page: Page
  let liste: StudioRealisationsListe
  let formulaire: StudioRealisationFormulaire
  let vitrine: VitrineRealisations
  let photo: string
  const username = `real-ui-${randomUUID().slice(0, 8)}`
  const ids: Record<string, string> = {}
  const anneeCourante = String(new Date().getFullYear())

  async function lister(): Promise<RealisationApi[]> {
    const reponse = await session.api.get('/api/studio/realisations')
    expect(reponse.status()).toBe(200)
    return ((await reponse.json()) as { realisations: RealisationApi[] }).realisations
  }

  async function creerParApi(titre: string): Promise<RealisationApi> {
    const reponse = await session.api.post('/api/studio/realisations', { data: { titre, imageMediaId: photo, annee: 2024, lieu: 'Douala' } })
    expect(reponse.status(), await reponse.text()).toBe(201)
    return ((await reponse.json()) as { realisation: RealisationApi }).realisation
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    const creation = await session.api.post('/api/studio/vitrine', {
      data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
    })
    expect(creation.status()).toBe(201)
    expect((await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } })).status()).toBe(200)
    expect((await session.api.post('/api/studio/vitrine/publier')).status()).toBe(200)
    // Image partagée des réalisations créées par l'API : photo de la vitrine, donc jamais supprimée avec elles.
    const televersement = await session.api.post('/api/studio/medias', { multipart: { fichier: await image('photo', 400) } })
    expect(televersement.status(), await televersement.text()).toBe(201)
    photo = ((await televersement.json()) as { media: { id: string } }).media.id
    expect((await session.api.put('/api/studio/vitrine', { data: { photoMediaId: photo } })).status()).toBe(200)
    contexte = await browser.newContext({ baseURL: BASE_URL, storageState: await session.api.storageState(), viewport: MOBILE })
    page = await contexte.newPage()
    liste = new StudioRealisationsListe(page)
    formulaire = new StudioRealisationFormulaire(page)
    vitrine = new VitrineRealisations(page, username)
  })

  test.afterAll(async () => {
    await contexte?.close()
    await session?.api.dispose()
    await fermerConnexions()
  })

  test('CA54 le HTML de /studio/realisations/nouveau ne contient aucun contenu rendu serveur (ssr:false)', async () => {
    const reponse = await contexte.request.get('/studio/realisations/nouveau')
    expect(reponse.status()).toBe(200)
    const html = await reponse.text()
    expect(html).not.toContain('Nouvelle réalisation')
    expect(html).not.toContain('Enregistrer')
  })

  test('CA50 vitrine sans réalisation : pas de section, pas de lien « Réalisations », /realisations répond 404', async () => {
    await page.setViewportSize(PC)
    await vitrine.gotoAccueil()
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(vitrine.sectionALaUne).toHaveCount(0)
    await expect(vitrine.lienNav('Réalisations')).toHaveCount(0)
    const reponse = await vitrine.gotoListe()
    expect(reponse?.status()).toBe(404)
    await page.setViewportSize(MOBILE)
  })

  test('état vide du studio : message et action « Ajouter une réalisation »', async () => {
    await liste.goto()
    await expect(page.getByRole('heading', { level: 1, name: 'Montrez votre travail' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ajouter une réalisation' })).toBeVisible()
    await sansDebordementHorizontal(page)
  })

  test('CA49 « Enregistrer » sans image principale : message sous la tuile, aucune requête', async () => {
    await formulaire.gotoNouveau()
    await formulaire.titre.fill('Projet sans image')
    const envois: string[] = []
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/api/studio/realisations')) envois.push(r.url())
    })
    await formulaire.enregistrer.click()
    await expect(page.getByRole('alert').filter({ hasText: 'Ajoutez une image principale.' })).toBeVisible()
    expect(envois).toEqual([])
    await expect(page).toHaveURL(/\/studio\/realisations\/nouveau/)
    page.removeAllListeners('request')
  })

  test('CA49 création : année préremplie, galerie (3 ajouts, 1 retrait, déplacement au clavier), double clic sans doublon', async () => {
    await formulaire.gotoNouveau()
    await expect(formulaire.annee).toHaveValue(anneeCourante)
    await formulaire.choisirImagePrincipale(await image('principale', 800))
    await formulaire.ajouterGalerie([await image('g1', 300), await image('g2', 400), await image('g3', 500)])
    await expect(formulaire.vignette(3, 3)).toBeVisible()
    // Retrait : cible tactile ≥ 44 px ; l'image 2 (400 px) disparaît.
    const retrait = formulaire.retraitGalerie(2)
    const zone = await retrait.boundingBox()
    expect(zone!.width).toBeGreaterThanOrEqual(CIBLE_TACTILE_PX)
    expect(zone!.height).toBeGreaterThanOrEqual(CIBLE_TACTILE_PX)
    await retrait.click()
    await expect(formulaire.vignette(2, 2)).toBeVisible()
    await expect(formulaire.vignette(3, 3)).toHaveCount(0)
    // Déplacement : l'image 3 (500 px) passe en tête avec ArrowLeft.
    await formulaire.vignette(2, 2).focus()
    await page.keyboard.press('ArrowLeft')
    await expect(formulaire.vignette(1, 2)).toBeFocused()
    await formulaire.titre.fill('Unité de dépistage')
    await formulaire.lieu.fill('CHU de Douala')
    await page.getByLabel('Votre rôle').fill('Coordination médicale')
    await page.getByLabel('Lien externe').fill('www.chu-douala.cm')
    await formulaire.enregistrer.dblclick()
    await expect(page).toHaveURL(/\/studio\/realisations$/)
    const toutes = await lister()
    expect(toutes).toHaveLength(1)
    expect(toutes[0].galerie.map((m) => m.largeur)).toEqual([500, 300])
    ids.R1 = toutes[0].id
    expect(toutes[0].enVedette).toBe(true)
    expect(toutes[0].slug).toBe('unite-de-depistage')
  })

  test('CA48 liste : miniature, titre, méta, « En vedette », sous-titre, barre du bas', async () => {
    await expect(page.getByRole('heading', { level: 1, name: 'Réalisations' })).toBeVisible()
    await expect(page.getByText('1 visible · 1 en vedette sur 3')).toBeVisible()
    const ligne = liste.ligne('Unité de dépistage')
    await expect(ligne).toContainText(`${anneeCourante} · CHU de Douala`)
    await expect(ligne.getByText('En vedette', { exact: true })).toBeVisible()
    expect(await ligne.locator('img').count()).toBe(1)
    const barre = page.getByRole('navigation').filter({ has: page.getByRole('link', { name: 'Réalisations' }) }).last()
    await expect(barre.getByRole('link', { name: 'Réalisations' })).toHaveAttribute('aria-current', 'page')
    await sansDebordementHorizontal(page)
  })

  test('mise en place : 3 réalisations de plus par l’API (vedettes automatiques : 3 au total)', async () => {
    for (const titre of ['Campagne de dépistage', 'Programme de réadaptation', 'Formation des infirmiers']) {
      const r = await creerParApi(titre)
      ids[titre] = r.id
    }
    const toutes = await lister()
    expect(toutes.map((r) => r.enVedette)).toEqual([true, true, true, false])
  })

  test('CA49 3 vedettes : l’interrupteur « En vedette sur l’accueil » de la 4e est désactivé avec son explication', async () => {
    await formulaire.gotoModifier(ids['Formation des infirmiers'])
    await expect(formulaire.interrupteurVedette).toBeDisabled()
    await expect(page.getByText('3 réalisations sur 3 en vedette. Retirez-en une pour en ajouter une autre.')).toBeVisible()
  })

  test('CA48 masquer par l’interrupteur : ligne « … · Masqué », sans vedette, 404 public ; la place libérée sert à la 4e', async () => {
    await liste.goto()
    const interrupteur = liste.interrupteurVisibilite('Unité de dépistage')
    await expect(interrupteur).toBeChecked()
    await interrupteur.click()
    await expect(interrupteur).not.toBeChecked()
    await expect(liste.ligne('Unité de dépistage')).toContainText('· Masqué')
    await expect(liste.ligne('Unité de dépistage').getByText('En vedette', { exact: true })).toHaveCount(0)
    await expect(page.getByText('3 visibles · 2 en vedette sur 3')).toBeVisible()
    await page.reload()
    await attendreHydration(page)
    await expect(liste.interrupteurVisibilite('Unité de dépistage')).not.toBeChecked()
    const reponse = await vitrine.gotoDetail('unite-de-depistage')
    expect(reponse?.status()).toBe(404)
    // Mettre en vedette la 4e : possible, puis la liste affiche 3 sur 3.
    await formulaire.gotoModifier(ids['Formation des infirmiers'])
    await expect(formulaire.interrupteurVedette).toBeEnabled()
    await formulaire.interrupteurVedette.click()
    await formulaire.enregistrer.click()
    await expect(page).toHaveURL(/\/studio\/realisations$/)
    await expect(page.getByText('3 visibles · 3 en vedette sur 3')).toBeVisible()
    // La réalisation masquée rendue visible n'est plus en vedette, et ne peut pas l'être : 3 sur 3.
    await liste.interrupteurVisibilite('Unité de dépistage').click()
    await expect(liste.interrupteurVisibilite('Unité de dépistage')).toBeChecked()
    await expect(page.getByText('4 visibles · 3 en vedette sur 3')).toBeVisible()
    await formulaire.gotoModifier(ids.R1)
    await expect(formulaire.interrupteurVedette).toBeDisabled()
  })

  test('modifier : le titre change, l’adresse (slug) reste stable ; galerie à 6 images sans tuile « + », retrait persisté', async () => {
    await formulaire.gotoModifier(ids.R1)
    await expect(formulaire.vignette(1, 2)).toBeVisible()
    await formulaire.titre.fill('Unité de dépistage rural')
    await formulaire.ajouterGalerie([await image('g4', 310), await image('g5', 320), await image('g6', 330), await image('g7', 340)])
    await expect(formulaire.vignette(6, 6)).toBeVisible()
    await expect(formulaire.tuileAjoutGalerie).toHaveCount(0)
    await expect(page.getByText('6 sur 6')).toBeVisible()
    await formulaire.retraitGalerie(6).click()
    await expect(formulaire.tuileAjoutGalerie).toBeVisible()
    await formulaire.enregistrer.click()
    await expect(page).toHaveURL(/\/studio\/realisations$/)
    const r1 = (await lister()).find((r) => r.id === ids.R1)!
    expect(r1.slug).toBe('unite-de-depistage')
    expect(r1.titre).toBe('Unité de dépistage rural')
    expect(r1.galerie.map((m) => m.largeur)).toEqual([500, 300, 310, 320, 330])
  })

  test('CA48 réordonner au clavier (poignée + flèche bas) : ordre persisté, suivi par la liste publique', async () => {
    await liste.goto()
    expect(await liste.titres()).toEqual([
      'Unité de dépistage rural', 'Campagne de dépistage', 'Programme de réadaptation', 'Formation des infirmiers',
    ])
    await liste.poignee('Unité de dépistage rural').focus()
    await page.keyboard.press('ArrowDown')
    const apres = ['Campagne de dépistage', 'Unité de dépistage rural', 'Programme de réadaptation', 'Formation des infirmiers']
    await expect.poll(() => liste.titres()).toEqual(apres)
    await expect(liste.poignee('Unité de dépistage rural')).toBeFocused()
    await expect.poll(async () => (await lister()).map((r) => r.titre)).toEqual(apres)
    const publique = (await (await session.api.get(`/api/public/${username}/realisations`)).json()) as { realisations: { titre: string }[] }
    expect(publique.realisations.map((r) => r.titre)).toEqual(apres)
  })

  test('CA50 CA51 CA52 CA53 vitrine : à la une, nav « Réalisations » active, détail avec « Voir le projet » (nouvel onglet)', async () => {
    await page.setViewportSize(PC)
    await vitrine.gotoAccueil()
    await expect(vitrine.lienNav('Réalisations')).toBeVisible()
    await expect(vitrine.sectionALaUne.getByRole('heading', { level: 3 })).toHaveCount(1)
    await expect(vitrine.sectionALaUne.getByRole('heading', { level: 3, name: 'Campagne de dépistage' })).toBeVisible()
    await expect(vitrine.voirToutes).toHaveText(/Voir toutes les réalisations \(4\)/)
    await vitrine.gotoDetail('unite-de-depistage')
    await expect(page.getByRole('heading', { level: 1, name: 'Unité de dépistage rural' })).toBeVisible()
    await expect(vitrine.lienNav('Réalisations')).toHaveAttribute('aria-current', 'page')
    const projet = page.getByRole('link', { name: 'Voir le projet (nouvel onglet)' }).first()
    await expect(projet).toHaveAttribute('href', 'https://www.chu-douala.cm')
    await expect(projet).toHaveAttribute('target', '_blank')
    await expect(projet).toHaveAttribute('rel', /noopener/)
    await expect(vitrine.galerie.getByRole('img')).toHaveCount(5)
    await expect(page.getByRole('heading', { level: 2, name: 'Autres réalisations' })).toBeVisible()
    await page.setViewportSize(MOBILE)
  })

  test('supprimer : confirmation, puis la réalisation disparaît du studio et de la vitrine (404)', async () => {
    await formulaire.gotoModifier(ids['Formation des infirmiers'])
    await page.getByRole('button', { name: 'Supprimer cette réalisation' }).click()
    const dialogue = page.getByRole('dialog')
    await expect(dialogue.getByText('Supprimer « Formation des infirmiers » ?')).toBeVisible()
    await dialogue.getByRole('button', { name: 'Annuler' }).click()
    await expect(dialogue).toHaveCount(0)
    await page.getByRole('button', { name: 'Supprimer cette réalisation' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer', exact: true }).click()
    await expect(page).toHaveURL(/\/studio\/realisations$/)
    await expect(liste.ligne('Formation des infirmiers')).toHaveCount(0)
    const reponse = await vitrine.gotoDetail('formation-des-infirmiers')
    expect(reponse?.status()).toBe(404)
  })

  test('session expirée : le studio renvoie vers /connexion', async () => {
    const sansSession = await contexte.browser()?.newContext({ baseURL: BASE_URL, viewport: MOBILE })
    const p = await sansSession?.newPage()
    await expect(async () => {
      await p?.goto('/studio/realisations')
      await expect(p!).toHaveURL(/\/connexion/, { timeout: 8_000 })
    }).toPass({ timeout: 90_000, intervals: [5_000] })
    await sansSession?.close()
  })
})
