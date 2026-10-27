import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { ouvrirStudio } from '../helpers/hydratation'

/** Liste « Services » du studio : /studio/services. */
export class StudioServicesListe {
  constructor(private readonly page: Page) {}

  async goto(): Promise<void> {
    await ouvrirStudio(this.page, '/studio/services')
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

/** Formulaire de service : /studio/services/nouveau et /studio/services/<id>. */
export class StudioServiceFormulaire {
  constructor(private readonly page: Page) {}

  async gotoNouveau(): Promise<void> {
    await ouvrirStudio(this.page, '/studio/services/nouveau')
    await expect(this.titre).toBeVisible()
  }

  async gotoModifier(id: string): Promise<void> {
    await ouvrirStudio(this.page, `/studio/services/${id}`)
    await expect(this.titre).toBeVisible()
  }

  get titre(): Locator {
    return this.page.getByLabel('Titre', { exact: true })
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

  tarif(nom: 'Gratuit' | 'Payant' | 'Sur devis'): Locator {
    return this.page.getByRole('radio', { name: nom })
  }

  /** Clic sur le libellé du segment (le bouton radio est recouvert par son libellé : c'est ce que touche l'utilisateur). */
  async choisirTarif(nom: 'Gratuit' | 'Payant' | 'Sur devis'): Promise<void> {
    await this.page.getByRole('radiogroup').first().getByText(nom, { exact: true }).click()
    await expect(this.tarif(nom)).toBeChecked()
  }

  async choisirType(libelle: string): Promise<void> {
    await this.page.getByRole('combobox', { name: 'Type de service' }).click()
    await this.page.getByRole('option', { name: libelle }).click()
  }
}
