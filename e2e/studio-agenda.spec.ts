import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Dialog, Locator, Page, Request } from '@playwright/test'
import { attendreHydration, ouvrirStudio } from './helpers/hydratation'
import { BASE_URL, fermerConnexions, seConnecter } from './helpers/session'
import type { Session } from './helpers/session'

// S7 : une seule session OTP, une vitrine publiée fraîche et des écritures exclusivement via les API réelles.
// Les tests partagent volontairement ce parcours dans un describe sériel ; chaque mutation réseau est consommée
// avant la suivante pour éviter qu'un rechargement lise un état intermédiaire.

const MOBILE = { width: 390, height: 844 }
const TABLETTE = { width: 768, height: 900 }
const DESKTOP = { width: 1280, height: 800 }

const TITRE_SANS_CRENEAU = 'Consultation longue sans créneau'
const TITRE_RESERVATION = 'Consultation de cardiologie agenda'
const TITRE_DEMANDE = 'Atelier de prévention cardiovasculaire'
const NOM_RESERVATION = 'Patient Agenda E2E'
const NOM_RESERVATION_ANNULEE = 'Patiente Agenda E2E'
const NOM_DEMANDE = 'Participant Atelier E2E'
const RAISON_INDISPONIBILITE = 'Congé agenda E2E'

interface ReponseHttp {
  status(): number
  text(): Promise<string>
}

interface ServiceApi {
  id: string
  slug: string
  titre: string
  type: 'rdv' | 'accompagnement' | 'atelier' | 'devis'
  reservable: boolean
}

interface DisponibilitesApi {
  items: Array<{ id: string, jourSemaine: number, debut: string, fin: string }>
  reglages: {
    fuseau: string
    pasCreneauMin: number
    preavisHeures: number
    horizonJours: number
  }
}

interface CreneauxApi {
  service: { id: string, slug: string, titre: string, dureeMin: number }
  fuseau: string
  creneaux: Array<{ debut: string, fin: string }>
}

interface ReservationCreeeApi {
  reservation: { id: string, statut: 'en_attente', debut: string, fin: string }
  confirmation: { expireLe: string }
}

interface DemandeCreeeApi {
  demande: { id: string, statut: 'nouvelle' }
}

interface ActionApi<T extends string> {
  item: { id: string, statut: T }
}

async function verifierReponse(reponse: ReponseHttp, statut: number, contexte: string): Promise<string> {
  const corps = await reponse.text()
  expect(reponse.status(), `${contexte} : ${corps}`).toBe(statut)
  return corps
}

async function lireJsonReponse<T>(reponse: ReponseHttp, statut: number, contexte: string): Promise<T> {
  const corps = await verifierReponse(reponse, statut, contexte)
  expect(corps, `${contexte} doit répondre en JSON`).not.toBe('')
  return JSON.parse(corps) as T
}

function dateIsoDans(nombreJours: number): string {
  const date = new Date()
  date.setUTCHours(12, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() + nombreJours)
  return date.toISOString().slice(0, 10)
}

async function sansDebordementHorizontal(page: Page, largeur: number): Promise<void> {
  const debordement = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(debordement, `aucun débordement horizontal à ${largeur} px`).toBeLessThanOrEqual(0)
}

test.describe.serial('Studio Agenda S7 - vitrine fraîche', () => {
  let session: Session
  let apiPublique: APIRequestContext
  let contexte: BrowserContext
  let page: Page

  test.beforeEach(() => {
    test.setTimeout(240_000)
  })
  let username: string
  let serviceSansCreneau: ServiceApi
  let serviceReservation: ServiceApi
  let serviceDemande: ServiceApi

  function disponibilites(): Locator {
    return page.getByRole('region', { name: 'Disponibilités' })
  }

  function indisponibilites(): Locator {
    return page.getByRole('region', { name: 'Indisponibilités' })
  }

  function activite(titreService: string, nomVisiteur: string): Locator {
    return page
      .getByRole('article')
      .filter({ has: page.getByRole('heading', { level: 4, name: titreService }) })
      .filter({ hasText: nomVisiteur })
  }

  async function ouvrirAgenda(): Promise<void> {
    await ouvrirStudio(page, '/studio/agenda')
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
  }

  async function ouvrirDisponibilites(): Promise<void> {
    await ouvrirStudio(page, '/studio/agenda/disponibilites')
    await expect(page.getByRole('heading', { level: 1, name: 'Vos disponibilités' })).toBeVisible()
  }

  async function creerService(data: Record<string, unknown>): Promise<ServiceApi> {
    const reponse = await session.api.post('/api/studio/services', { data })
    return (await lireJsonReponse<{ service: ServiceApi }>(reponse, 201, 'création du service')).service
  }

  async function lireDisponibilites(): Promise<DisponibilitesApi> {
    const reponse = await session.api.get('/api/studio/agenda/disponibilites')
    return lireJsonReponse<DisponibilitesApi>(reponse, 200, 'lecture des disponibilités')
  }

  test.beforeAll(async ({ playwright, browser }) => {
    session = await seConnecter(playwright)
    username = `agenda-ui-${randomUUID().slice(0, 8)}`

    await lireJsonReponse(
      await session.api.post('/api/studio/vitrine', {
        data: { titre: 'dr', prenom: 'Cabrel', nom: 'Nguesso', metier: 'Cardiologue', username },
      }),
      201,
      'création de la vitrine',
    )
    await lireJsonReponse(
      await session.api.put('/api/studio/vitrine', { data: { ville: 'Douala', pays: 'CM' } }),
      200,
      'complétion de la vitrine',
    )
    await lireJsonReponse(
      await session.api.post('/api/studio/vitrine/publier'),
      200,
      'publication de la vitrine',
    )

    serviceSansCreneau = await creerService({
      titre: TITRE_SANS_CRENEAU,
      type: 'rdv',
      dureeMin: 1440,
      tarif: 'gratuit',
      reservable: true,
      actif: true,
    })
    expect(serviceSansCreneau).toMatchObject({ titre: TITRE_SANS_CRENEAU, type: 'rdv', reservable: true })

    serviceReservation = await creerService({
      titre: TITRE_RESERVATION,
      type: 'rdv',
      dureeMin: 30,
      tarif: 'gratuit',
      reservable: true,
      actif: true,
    })
    expect(serviceReservation).toMatchObject({ titre: TITRE_RESERVATION, type: 'rdv', reservable: true })

    serviceDemande = await creerService({
      titre: TITRE_DEMANDE,
      type: 'atelier',
      dureeMin: 90,
      tarif: 'gratuit',
      reservable: true,
      actif: true,
    })
    expect(serviceDemande).toMatchObject({ titre: TITRE_DEMANDE, type: 'atelier', reservable: true })

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
    await contexte?.close()
    await apiPublique?.dispose()
    await session?.api.dispose()
    await fermerConnexions()
  })

  test('l’agenda éclaté : trois onglets à vide, page Disponibilités sans barre du bas, plages persistées', async () => {
    await page.setViewportSize(MOBILE)
    await ouvrirAgenda()

    // S7-bis : l'agenda du studio ne montre plus les asides disponibilités ;
    // trois onglets segmentés (compteur masqué à zéro), le bouton Disponibilités mène à la page dédiée.
    await expect(page.getByRole('tab', { name: 'À venir', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Demandes', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Passées', exact: true })).toBeVisible()
    // Sous-titre compteurs de l'en-tête : sans demandes, la mention « demandes » est masquée.
    await expect(page.getByText('0 à venir', { exact: true })).toBeVisible()
    // S7-bis : les asides Disponibilités/Indisponibilités ne sont plus sur /studio/agenda.
    await expect(page.getByRole('region', { name: 'Disponibilités' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Indisponibilités' })).toHaveCount(0)

    // États vides déclinés par onglet (S7-bis §7.4).
    await expect(page.getByText('Aucun rendez-vous à venir', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Demandes', exact: true }).click()
    await expect(page.getByText('Aucune demande', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Passées', exact: true }).click()
    await expect(page.getByText('Rien de passé — tout est traité', { exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'À venir', exact: true }).click()

    await page.getByRole('link', { name: 'Disponibilités', exact: true }).click()
    await expect(page).toHaveURL(/\/studio\/agenda\/disponibilites$/)

    // Écran enfant : la barre du bas mobile est masquée ; seul un retour « ← Agenda » reste.
    await expect(page.getByRole('navigation', { name: 'Navigation du studio' })).toBeHidden()
    const retourAgenda = page.getByRole('main').getByRole('link', { name: 'Agenda', exact: true })
    await expect(retourAgenda).toBeVisible()

    const boutonEnregistrer = page.getByRole('button', { name: /^Enregistrer/ })
    await expect(boutonEnregistrer).toBeDisabled()

    // Un interrupteur par jour : fermé au départ, l'ouvrir propose la plage par défaut.
    const interrupteurLundi = disponibilites().getByRole('switch', { name: 'Lundi : jour ouvert' })
    const ajouterLundi = disponibilites().getByRole('button', { name: 'Ajouter une plage le lundi' })
    await expect(interrupteurLundi).not.toBeChecked()
    await expect(ajouterLundi).toHaveCount(0)
    await interrupteurLundi.click()
    await expect(interrupteurLundi).toBeChecked()
    await expect(disponibilites().getByLabel('Début')).toHaveCount(1)
    await ajouterLundi.click()
    await expect(disponibilites().getByLabel('Début')).toHaveCount(2)
    await expect(disponibilites().getByLabel('Fin')).toHaveCount(2)

    await disponibilites().getByLabel('Début').nth(0).fill('09:00')
    await disponibilites().getByLabel('Fin').nth(0).fill('12:00')
    await disponibilites().getByLabel('Début').nth(1).fill('14:00')
    await disponibilites().getByLabel('Fin').nth(1).fill('17:00')

    await disponibilites().getByText('Réglages avancés', { exact: true }).click()
    const fuseau = disponibilites().getByRole('combobox', { name: 'Fuseau horaire' })
    await fuseau.click()
    await page.getByRole('option', { name: /^Europe\/Paris \(UTC/ }).click()

    const pas = disponibilites().getByRole('combobox', { name: 'Pas des créneaux' })
    await pas.click()
    await page.getByRole('option', { name: '60 minutes', exact: true }).click()
    await disponibilites().getByLabel('Préavis (heures)').fill('1')
    await disponibilites().getByLabel('Horizon (jours)').fill('45')
    await expect(boutonEnregistrer).toBeEnabled()

    const reponseFuseauPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PUT' && new URL(reponse.url()).pathname === '/api/studio/moi',
    )
    const reponseDisponibilitesPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PUT'
      && new URL(reponse.url()).pathname === '/api/studio/agenda/disponibilites',
    )
    await boutonEnregistrer.click()

    const reponseFuseau = await lireJsonReponse<{ moi: { fuseau: string } }>(
      await reponseFuseauPromise,
      200,
      'enregistrement du fuseau',
    )
    expect(reponseFuseau.moi.fuseau).toBe('Europe/Paris')
    const enregistrees = await lireJsonReponse<DisponibilitesApi>(
      await reponseDisponibilitesPromise,
      200,
      'enregistrement des disponibilités',
    )
    expect(enregistrees.items.map(({ jourSemaine, debut, fin }) => ({ jourSemaine, debut, fin }))).toEqual([
      { jourSemaine: 1, debut: '09:00', fin: '12:00' },
      { jourSemaine: 1, debut: '14:00', fin: '17:00' },
    ])
    expect(enregistrees.reglages).toEqual({
      fuseau: 'Europe/Paris',
      pasCreneauMin: 60,
      preavisHeures: 1,
      horizonJours: 45,
    })
    await expect(page.getByRole('status').filter({ hasText: 'Vos disponibilités sont enregistrées.' })).toBeVisible()

    await page.reload()
    await attendreHydration(page)
    await expect(page.getByRole('heading', { level: 1, name: 'Vos disponibilités' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Navigation du studio' })).toBeHidden()
    await expect(disponibilites().getByLabel('Début').nth(0)).toHaveValue('09:00')
    await expect(disponibilites().getByLabel('Fin').nth(0)).toHaveValue('12:00')
    await expect(disponibilites().getByLabel('Début').nth(1)).toHaveValue('14:00')
    await expect(disponibilites().getByLabel('Fin').nth(1)).toHaveValue('17:00')
    await expect(disponibilites().getByText('Fermé', { exact: true })).toHaveCount(6)

    await disponibilites().getByText('Réglages avancés', { exact: true }).click()
    await expect(disponibilites().getByRole('combobox', { name: 'Fuseau horaire' })).toContainText('Europe/Paris')
    await expect(disponibilites().getByRole('combobox', { name: 'Pas des créneaux' })).toContainText('60 minutes')
    await expect(disponibilites().getByLabel('Préavis (heures)')).toHaveValue('1')
    await expect(disponibilites().getByLabel('Horizon (jours)')).toHaveValue('45')
    expect(await lireDisponibilites()).toEqual(enregistrees)

    await retourAgenda.click()
    await expect(page).toHaveURL(/\/studio\/agenda$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Navigation du studio' })).toBeVisible()
  })

  test('l’écran Vitrine liste les Messages avec leur compteur de non lus (0 → « Tout est lu »)', async () => {
    // S7-bis §7.6 : la ligne Messages vit sur l'écran Vitrine (/studio), jamais dans la barre du bas.
    await ouvrirStudio(page, '/studio')

    const ligneMessages = page.getByRole('link', { name: /Messages/ })
    await expect(ligneMessages).toBeVisible()
    await expect(ligneMessages).toContainText('Tout est lu')

    await ligneMessages.click()
    await expect(page).toHaveURL(/\/studio\/messages$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Messages' })).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Vitrine', exact: true })).toBeVisible()
    // Écran enfant : la barre du bas est masquée ici aussi.
    await expect(page.getByRole('navigation', { name: 'Navigation du studio' })).toBeHidden()
  })

  test('la nav publique mène aux pages Agenda et Contact ; l’accueil reste gelé avec son ancre', async () => {
    const agendaStudio = await lireDisponibilites()
    if (agendaStudio.items.length === 0) {
      await lireJsonReponse<DisponibilitesApi>(
        await session.api.put('/api/studio/agenda/disponibilites', {
          data: { items: [{ jourSemaine: 1, debut: '09:00', fin: '10:00' }] },
        }),
        200,
        'mise en place d’une disponibilité publique',
      )
    }

    const vitrinePublique = await lireJsonReponse<{ contenus: { agenda: boolean } }>(
      await apiPublique.get(`/api/public/${username}`),
      200,
      'lecture des contenus publics',
    )
    expect(vitrinePublique.contenus.agenda).toBe(true)

    const creneaux = await lireJsonReponse<CreneauxApi>(
      await apiPublique.get(`/api/public/${username}/creneaux`, {
        params: { service: serviceSansCreneau.slug, du: dateIsoDans(0), au: dateIsoDans(28) },
      }),
      200,
      'lecture de l’agenda public vide',
    )
    expect(creneaux.creneaux).toEqual([])

    await page.setViewportSize(DESKTOP)
    await page.goto(`/${username}`)

    // L'accueil reste gelé : le bloc agenda y reste visible et l'ancre #contact du pied aussi.
    const agendaPublic = page.getByRole('region', { name: 'Réservez votre rendez-vous' })
    await expect(agendaPublic).toBeVisible()
    await expect(agendaPublic.getByRole('combobox', { name: 'Service à réserver' })).toContainText(TITRE_SANS_CRENEAU)
    await expect(agendaPublic.getByRole('status')).toHaveText('Aucun créneau n’est disponible pour ce service actuellement.')
    await expect(page.locator('#contact')).toHaveCount(1)

    // S7-bis §7.6 : la nav pointe vers les pages dédiées, plus vers les ancres.
    const navigation = page.getByRole('navigation', { name: 'Vitrine' })
    const lienAgenda = navigation.getByRole('link', { name: 'Agenda', exact: true })
    await expect(lienAgenda).toHaveAttribute('href', `/${username}/agenda`)
    await lienAgenda.click()
    await expect(page).toHaveURL(new RegExp(`/${username}/agenda$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

    const lienContact = navigation.getByRole('link', { name: 'Contact', exact: true })
    await expect(lienContact).toHaveAttribute('href', `/${username}/contact`)
    await lienContact.click()
    await expect(page).toHaveURL(new RegExp(`/${username}/contact$`))
    await expect(page.getByRole('heading', { level: 1, name: 'Me contacter' })).toBeVisible()

    // La page agenda et la page contact restent lisibles à chaque largeur.
    for (const taille of [MOBILE, TABLETTE, DESKTOP]) {
      await page.setViewportSize(taille)

      await page.goto(`/${username}/agenda`)
      await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()

      await page.goto(`/${username}/contact`)
      await expect(page.getByRole('heading', { level: 1, name: 'Me contacter' })).toBeVisible()

      // L'accueil (gelé) garde son état vide lisible et son ancre #contact à chaque largeur.
      await page.goto(`/${username}`)
      const agendaPublicParTaille = page.getByRole('region', { name: 'Réservez votre rendez-vous' })
      await expect(agendaPublicParTaille).toBeVisible()
      await expect(agendaPublicParTaille.getByRole('status')).toHaveText('Aucun créneau n’est disponible pour ce service actuellement.')
      await expect(page.locator('#contact')).toHaveCount(1)

      // Les liens de nav sont masqués sous md (hidden md:inline-flex) : sur mobile,
      // seule la marque et « Réserver » sont visibles (inchangé).
      const lienContactParTaille = page
        .getByRole('navigation', { name: 'Vitrine' })
        .getByRole('link', { name: 'Contact', exact: true })
      if (taille === MOBILE) {
        await expect(lienContactParTaille).toBeHidden()
      }
      else {
        await expect(lienContactParTaille).toBeVisible()
      }
    }
  })

  test('une plage invalide affiche les erreurs sans requête d’écriture ni modification persistée', async () => {
    await ouvrirDisponibilites()
    const avant = await lireDisponibilites()
    await disponibilites().getByLabel('Fin').nth(0).fill('08:00')

    let ecritures = 0
    const compterEcriture = (requete: Request): void => {
      if (requete.method() === 'PUT'
        && new URL(requete.url()).pathname === '/api/studio/agenda/disponibilites') {
        ecritures += 1
      }
    }
    page.on('request', compterEcriture)
    try {
      await page.getByRole('button', { name: /^Enregistrer/ }).click()
      await expect(disponibilites().getByText(
        'La fin doit être après le début, le même jour.',
        { exact: true },
      )).toBeVisible()
      await expect(page.getByText(
        'Vérifiez les disponibilités et les réglages signalés.',
        { exact: true },
      )).toBeVisible()
      expect(ecritures).toBe(0)
    }
    finally {
      page.off('request', compterEcriture)
    }

    expect(await lireDisponibilites()).toEqual(avant)
    await page.reload()
    await attendreHydration(page)
    await expect(disponibilites().getByLabel('Fin').nth(0)).toHaveValue('12:00')
  })

  test('une indisponibilité est ajoutée puis supprimée par une confirmation accessible, sans confirm natif', async () => {
    await ouvrirDisponibilites()
    const date = dateIsoDans(35)
    await indisponibilites().getByLabel('Date').fill(date)
    await indisponibilites().getByLabel('Raison (facultative)').fill(RAISON_INDISPONIBILITE)

    const ajoutPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'POST'
      && new URL(reponse.url()).pathname === '/api/studio/agenda/indisponibilites',
    )
    await indisponibilites().getByRole('button', { name: 'Ajouter une indisponibilité' }).click()
    const ajout = await lireJsonReponse<{ item: { id: string, date: string, raison: string | null } }>(
      await ajoutPromise,
      201,
      'ajout de l’indisponibilité',
    )
    expect(ajout.item).toMatchObject({ date, raison: RAISON_INDISPONIBILITE })

    const ligne = indisponibilites().getByRole('listitem').filter({ hasText: RAISON_INDISPONIBILITE })
    await expect(ligne).toHaveCount(1)

    let dialoguesNatifs = 0
    const fermerDialogueNatif = async (dialogue: Dialog): Promise<void> => {
      dialoguesNatifs += 1
      await dialogue.dismiss()
    }
    page.on('dialog', fermerDialogueNatif)
    try {
      await ligne.getByRole('button', { name: /Supprimer l’indisponibilité du/ }).click()
      expect(dialoguesNatifs).toBe(0)

      const confirmation = indisponibilites().getByRole('group', { name: 'Supprimer cette indisponibilité ?' })
      await expect(confirmation).toBeVisible()
      await expect(confirmation.getByText(
        'Les créneaux habituels seront de nouveau proposés ce jour-là.',
        { exact: true },
      )).toBeVisible()
      const confirmer = confirmation.getByRole('button', { name: 'Supprimer', exact: true })
      await expect(confirmer).toBeFocused()

      const suppressionPromise = page.waitForResponse((reponse) =>
        reponse.request().method() === 'DELETE'
        && new URL(reponse.url()).pathname === `/api/studio/agenda/indisponibilites/${ajout.item.id}`,
      )
      await confirmer.click()
      expect((await suppressionPromise).status(), 'suppression de l’indisponibilité').toBe(204)
    }
    finally {
      page.off('dialog', fermerDialogueNatif)
    }

    await expect(ligne).toHaveCount(0)
    await expect(indisponibilites().getByText('Aucune date fermée', { exact: true })).toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'L’indisponibilité est supprimée.' })).toBeVisible()
  })

  test('une réservation en attente se refuse (étiquette Refusée, re-refus 422) puis une confirmée s’annule', async () => {
    const creneaux = await lireJsonReponse<CreneauxApi>(
      await apiPublique.get(`/api/public/${username}/creneaux`, {
        params: { service: serviceReservation.slug, du: dateIsoDans(0), au: dateIsoDans(28) },
      }),
      200,
      'lecture publique des créneaux',
    )
    expect(creneaux.service).toMatchObject({ id: serviceReservation.id, slug: serviceReservation.slug })
    expect(creneaux.fuseau).toBe('Europe/Paris')
    expect(creneaux.creneaux.length).toBeGreaterThan(0)
    const creneau = creneaux.creneaux[0]
    if (!creneau) throw new Error('Aucun créneau public disponible pour la réservation E2E.')

    const creation = await lireJsonReponse<ReservationCreeeApi>(
      await apiPublique.post(`/api/public/${username}/reservations`, {
        data: {
          serviceId: serviceReservation.id,
          debut: creneau.debut,
          nom: NOM_RESERVATION,
          email: 'patient-agenda@exemple.com',
          telephone: '+237699000001',
          siteWeb: '',
          motif: 'Contrôle cardiovasculaire E2E.',
          rappelEmail: true,
          paiementChoisi: 'sur_place',
        },
      }),
      201,
      'création publique de la réservation',
    )
    expect(creation.reservation).toMatchObject({ statut: 'en_attente', debut: creneau.debut, fin: creneau.fin })

    await ouvrirAgenda()
    await expect(page.getByRole('tab', { name: 'À venir', exact: true })).toHaveAttribute('aria-selected', 'true')
    const carte = activite(TITRE_RESERVATION, NOM_RESERVATION)
    await expect(carte).toHaveCount(1)
    await expect(carte.getByText('En attente', { exact: true })).toBeVisible()
    // S7-bis §7.4 : En attente = Confirmer (accent) + Refuser (contour) ; « Annuler » disparaît.
    await expect(carte.getByRole('button', { name: 'Confirmer', exact: true })).toBeVisible()
    await expect(carte.getByRole('button', { name: 'Refuser', exact: true })).toBeVisible()
    await expect(carte.getByRole('button', { name: 'Annuler', exact: true })).toHaveCount(0)

    const refusPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PATCH'
      && new URL(reponse.url()).pathname === `/api/studio/reservations/${creation.reservation.id}/refuser`,
    )
    await carte.getByRole('button', { name: 'Refuser', exact: true }).click()
    const groupeRefus = carte.getByRole('group', { name: 'Refuser cette réservation ? Le créneau redeviendra disponible.' })
    await expect(groupeRefus).toBeVisible()
    await expect(groupeRefus.getByRole('button', { name: 'Refuser la réservation' })).toBeFocused()

    await groupeRefus.getByRole('button', { name: 'Refuser la réservation' }).click()
    const refus = await lireJsonReponse<ActionApi<'refusee'>>(
      await refusPromise,
      200,
      'refus de la réservation',
    )
    expect(refus.item).toEqual({ id: creation.reservation.id, statut: 'refusee' })

    // CA7 : l'étiquette devient « Refusée », la carte passe dans Passées, sans bouton.
    await expect(page.getByRole('tab', { name: 'À venir', exact: true })).toBeVisible()
    await page.getByRole('tab', { name: 'Passées', exact: true }).click()
    await expect(carte.getByText('Refusée', { exact: true })).toBeVisible()
    await expect(carte.getByRole('button')).toHaveCount(0)

    // §4.3 : le refus est terminal — un re-PATCH répond 422 TRANSITION_RESERVATION_INVALIDE.
    const reRefus = await session.api.patch(
      `/api/studio/reservations/${creation.reservation.id}/refuser`,
      { data: {} },
    )
    expect(reRefus.status(), await reRefus.text()).toBe(422)
    expect(((await reRefus.json()) as { data?: { code?: string } }).data?.code).toBe('TRANSITION_RESERVATION_INVALIDE')

    // CA4 côté UI : le créneau refusé redevient réservable — une seconde réservation le prend.
    const seconde = await lireJsonReponse<ReservationCreeeApi>(
      await apiPublique.post(`/api/public/${username}/reservations`, {
        data: {
          serviceId: serviceReservation.id,
          debut: creneau.debut,
          nom: NOM_RESERVATION_ANNULEE,
          email: 'patiente-agenda@exemple.com',
          telephone: '+237699000002',
          siteWeb: '',
          motif: 'Seconde consultation E2E.',
          rappelEmail: false,
          paiementChoisi: 'sur_place',
        },
      }),
      201,
      'création publique de la seconde réservation',
    )

    await page.reload()
    await attendreHydration(page)
    await expect(page.getByRole('tab', { name: 'À venir', exact: true })).toHaveAttribute('aria-selected', 'true')
    const carteConfirmable = activite(TITRE_RESERVATION, NOM_RESERVATION_ANNULEE)
    await expect(carteConfirmable).toHaveCount(1)

    const confirmationPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PATCH'
      && new URL(reponse.url()).pathname === `/api/studio/reservations/${seconde.reservation.id}/confirmer`,
    )
    await carteConfirmable.getByRole('button', { name: 'Confirmer', exact: true }).click()
    const confirmation = await lireJsonReponse<ActionApi<'confirmee'>>(
      await confirmationPromise,
      200,
      'confirmation de la réservation',
    )
    expect(confirmation.item).toEqual({ id: seconde.reservation.id, statut: 'confirmee' })
    await expect(carteConfirmable.getByText('Confirmée', { exact: true })).toBeVisible()

    // §7.4 : une carte confirmée propose la ligne pleine largeur « Annuler ce rendez-vous ».
    const annulationPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PATCH'
      && new URL(reponse.url()).pathname === `/api/studio/reservations/${seconde.reservation.id}/annuler`,
    )
    await carteConfirmable.getByRole('button', { name: 'Annuler ce rendez-vous', exact: true }).click()
    const groupeAnnulation = carteConfirmable.getByRole('group', { name: 'Annuler cette réservation ? Le créneau redeviendra disponible.' })
    await expect(groupeAnnulation).toBeVisible()
    await expect(groupeAnnulation.getByRole('button', { name: 'Annuler la réservation' })).toBeFocused()
    await groupeAnnulation.getByRole('button', { name: 'Annuler la réservation' }).click()
    const annulation = await lireJsonReponse<ActionApi<'annulee'>>(
      await annulationPromise,
      200,
      'annulation de la réservation',
    )
    expect(annulation.item).toEqual({ id: seconde.reservation.id, statut: 'annulee' })
    await expect(page.getByRole('tab', { name: 'À venir', exact: true })).toBeVisible()

    await page.getByRole('tab', { name: 'Passées', exact: true }).click()
    await expect(carte.getByText('Refusée', { exact: true })).toBeVisible()
    await expect(carteConfirmable.getByText('Annulée', { exact: true })).toBeVisible()
    await expect(carte.getByRole('button')).toHaveCount(0)
    await expect(carteConfirmable.getByRole('button')).toHaveCount(0)
  })

  test('une demande publique d’atelier apparaît et passe au statut En cours', async () => {
    const creation = await lireJsonReponse<DemandeCreeeApi>(
      await apiPublique.post(`/api/public/${username}/demandes`, {
        data: {
          service: serviceDemande.slug,
          nom: NOM_DEMANDE,
          email: 'atelier-agenda@exemple.com',
          telephone: '+237699000002',
          siteWeb: '',
          message: 'Je souhaite participer au prochain atelier E2E.',
        },
      }),
      201,
      'création publique de la demande',
    )
    expect(creation.demande.statut).toBe('nouvelle')

    await ouvrirAgenda()
    // S7-bis : les demandes ont leur propre onglet (l'onglet par défaut reste « À venir »).
    await expect(page.getByRole('tab', { name: 'À venir', exact: true })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /^Demandes/ }).click()
    const carte = activite(TITRE_DEMANDE, NOM_DEMANDE)
    await expect(carte).toHaveCount(1)
    await expect(carte.getByText('Nouvelle', { exact: true })).toBeVisible()
    await expect(carte.getByRole('button', { name: 'En cours', exact: true })).toBeVisible()
    await expect(carte.getByRole('button', { name: 'Traiter', exact: true })).toBeVisible()
    await expect(carte.getByRole('button', { name: 'Refuser', exact: true })).toBeVisible()

    const changementPromise = page.waitForResponse((reponse) =>
      reponse.request().method() === 'PATCH'
      && new URL(reponse.url()).pathname === `/api/studio/demandes/${creation.demande.id}`,
    )
    await carte.getByRole('button', { name: 'En cours', exact: true }).click()
    const changement = await lireJsonReponse<ActionApi<'en_cours'>>(
      await changementPromise,
      200,
      'passage de la demande en cours',
    )
    expect(changement.item).toEqual({ id: creation.demande.id, statut: 'en_cours' })
    await expect(carte.getByText('En cours', { exact: true })).toBeVisible()
    await expect(carte.getByRole('button', { name: 'En cours', exact: true })).toHaveCount(0)
    await expect(carte.getByRole('button', { name: 'Traiter', exact: true })).toBeVisible()
  })

  test('390, 768 et 1280 px : aucun overflow, compte accessible et Agenda actif à la racine', async () => {
    await page.setViewportSize(MOBILE)
    await ouvrirAgenda()

    for (const taille of [MOBILE, TABLETTE, DESKTOP]) {
      await page.setViewportSize(taille)
      await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible()
      await expect(page.getByRole('link', { name: 'Votre compte' })).toBeVisible()

      const navigation = page.getByRole('navigation', { name: 'Navigation du studio' })
      await expect(navigation).toBeVisible()
      await expect(navigation.getByRole('link')).toHaveCount(5)
      await expect(navigation.getByRole('link', { name: 'Agenda', exact: true })).toHaveAttribute('aria-current', 'page')
      await sansDebordementHorizontal(page, taille.width)

      if (taille.width === MOBILE.width) {
        const boite = await navigation.boundingBox()
        expect(boite, 'la barre de navigation du bas doit être mesurable').not.toBeNull()
        expect(Math.abs((boite?.y ?? 0) + (boite?.height ?? 0) - taille.height)).toBeLessThanOrEqual(1)
      }
    }
  })
})
