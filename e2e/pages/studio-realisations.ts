import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ouvrirStudio } from '../helpers/hydratation'

export interface FichierImage {
  name: string
  mimeType: string
  buffer: Buffer
}

/** Liste « Réalisations » du studio : /studio/realisations. */
export class StudioRealisationsListe {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await ouvrirStudio(this.page, '/studio/realisations')
  }

  ligne(titre: string): Locator {
    return this.page.getByRole('listitem').filter({ has: this.page.getByRole('link', { name: new RegExp(titre) }) })
  }

  interrupteurVisibilite(titre: string): Locator {
    return this.page.getByRole('switch', { name: `Visible sur la vitrine : ${titre}` })
  }

  poignee(titre: string): Locator {
    return this.page.getByRole('button', { name: `Déplacer ${titre} (flèches haut et bas)` })
  }

  /** Titres affichés, dans l'ordre de la liste. */
  async titres(): Promise<string[]> {
    const liens = this.page.getByRole('list').getByRole('link')
    await expect(liens.first()).toBeVisible()
    return (await liens.allInnerTexts()).map((t) => t.split('\n')[0].trim())
  }
}

/** Formulaire de réalisation : /studio/realisations/nouveau et /studio/realisations/<id>. */
export class StudioRealisationFormulaire {
  constructor(private readonly page: Page) {}

  async gotoNouveau(): Promise<void> {
    await ouvrirStudio(this.page, '/studio/realisations/nouveau')
    await expect(this.titre).toBeVisible()
  }

  async gotoModifier(id: string): Promise<void> {
    await ouvrirStudio(this.page, `/studio/realisations/${id}`)
    await expect(this.titre).toBeVisible()
  }

  get titre(): Locator {
    return this.page.getByLabel('Titre', { exact: true })
  }

  get annee(): Locator {
    return this.page.getByLabel('Année', { exact: true })
  }

  get lieu(): Locator {
    return this.page.getByLabel('Lieu ou client')
  }

  get enregistrer(): Locator {
    return this.page.getByRole('button', { name: 'Enregistrer' })
  }

  get interrupteurVedette(): Locator {
    return this.page.getByRole('switch', { name: /^En vedette sur l’accueil/ })
  }

  get interrupteurVisible(): Locator {
    return this.page.getByRole('switch', { name: /^Visible sur la vitrine/ })
  }

  get tuileImagePrincipale(): Locator {
    return this.page.getByRole('button', { name: /image principale/ })
  }

  get tuileAjoutGalerie(): Locator {
    return this.page.getByRole('button', { name: 'Ajouter des images à la galerie' })
  }

  vignette(n: number, sur: number): Locator {
    return this.page.getByRole('button', { name: `Image ${n} sur ${sur}`, exact: true })
  }

  retraitGalerie(n: number): Locator {
    return this.page.getByRole('button', { name: `Retirer l’image ${n} de la galerie` })
  }

  /** Choisit l'image principale par le sélecteur de fichier, comme le ferait l'utilisateur. */
  async choisirImagePrincipale(fichier: FichierImage): Promise<void> {
    const [selecteur] = await Promise.all([
      this.page.waitForEvent('filechooser'),
      this.tuileImagePrincipale.click(),
    ])
    await selecteur.setFiles(fichier)
    await expect(this.page.getByRole('button', { name: 'Changer l’image principale' })).toBeVisible()
  }

  /** Ajoute des images à la galerie (envoi séquentiel). */
  async ajouterGalerie(fichiers: FichierImage[]): Promise<void> {
    const [selecteur] = await Promise.all([
      this.page.waitForEvent('filechooser'),
      this.tuileAjoutGalerie.click(),
    ])
    await selecteur.setFiles(fichiers)
  }
}
