import type { Locator, Page } from '@playwright/test'

/** Pages publiques : accueil (à la une), liste et détail des réalisations d'une vitrine. */
export class VitrineRealisations {
  constructor(private readonly page: Page, private readonly username: string) {}

  gotoAccueil() {
    return this.page.goto(`/${this.username}`)
  }

  gotoListe() {
    return this.page.goto(`/${this.username}/realisations`)
  }

  gotoDetail(slug: string) {
    return this.page.goto(`/${this.username}/realisations/${slug}`)
  }

  get navigation(): Locator {
    return this.page.getByRole('navigation', { name: 'Vitrine' })
  }

  lienNav(nom: string): Locator {
    return this.navigation.getByRole('link', { name: nom, exact: true })
  }

  get sectionALaUne(): Locator {
    return this.page.getByRole('region', { name: 'À la une', exact: true })
  }

  get galerie(): Locator {
    return this.page.getByRole('region', { name: 'Galerie' })
  }

  get voirToutes(): Locator {
    return this.page.getByRole('link', { name: /^Voir toutes les réalisations/ })
  }
}
