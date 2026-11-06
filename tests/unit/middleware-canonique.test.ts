import { describe, expect, it } from 'vitest'
import type { H3Event } from 'h3'
import { fakeEvent } from '../support/h3'

// S12 (#146) — redirection canonique (server/middleware/canonique.ts).
// Ce middleware tourne sur CHAQUE GET/HEAD : une erreur dedans met le site entier en 500,
// la page de liens du studio comprise. D'où le test de non-régression sur l'exécution.
const middleware = () => import('../../server/middleware/canonique').then((module) => module.default)

function localisation(evenement: H3Event): string | undefined {
  const valeur = evenement.node.res.getHeader('location')
  return Array.isArray(valeur) ? valeur[0] : valeur
}

function sansRedirection(evenement: H3Event): void {
  expect(evenement.node.res.statusCode).toBe(200)
  expect(localisation(evenement)).toBeUndefined()
}

describe('middleware canonique (S12 #146)', () => {
  it('should run on a GET without reading a property of the raw Node request', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ url: '/dr-cabrel/contact' })

    expect(() => handler(evenement)).not.toThrow()
    sansRedirection(evenement)
  })

  it('should redirect a mixed-case public path to its lowercase form with 301', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ url: '/Dr-Cabrel/Contact' })

    handler(evenement)

    expect(evenement.node.res.statusCode).toBe(301)
    expect(localisation(evenement)).toBe('/dr-cabrel/contact')
  })

  it('should drop the trailing slash with 301', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ url: '/dr-cabrel/contact/' })

    handler(evenement)

    expect(evenement.node.res.statusCode).toBe(301)
    expect(localisation(evenement)).toBe('/dr-cabrel/contact')
  })

  it('should keep the query string on the redirect', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ url: '/Dr-Cabrel?utm_source=news' })

    handler(evenement)

    expect(evenement.node.res.statusCode).toBe(301)
    expect(localisation(evenement)).toBe('/dr-cabrel?utm_source=news')
  })

  it.each([
    ['studio', '/studio/liens'],
    ['api', '/api/studio/liens'],
    ['medias', '/medias/avatar.webp'],
    ['connexion', '/connexion'],
  ])('should leave /%s alone', async (_segment, url) => {
    const handler = await middleware()
    const evenement = fakeEvent({ url })

    expect(() => handler(evenement)).not.toThrow()
    sansRedirection(evenement)
  })

  it('should leave a path whose last segment contains a dot alone', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ url: '/dr-cabrel/photo.PNG' })

    handler(evenement)

    sansRedirection(evenement)
  })

  it('should leave an already canonical path alone', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ url: '/dr-cabrel/contact?x=1' })

    handler(evenement)

    sansRedirection(evenement)
  })

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'])('should ignore a %s request', async (method) => {
    const handler = await middleware()
    const evenement = fakeEvent({ method, url: '/Dr-Cabrel' })

    expect(() => handler(evenement)).not.toThrow()
    sansRedirection(evenement)
  })

  it('should redirect a HEAD request like a GET', async () => {
    const handler = await middleware()
    const evenement = fakeEvent({ method: 'HEAD', url: '/Dr-Cabrel' })

    handler(evenement)

    expect(evenement.node.res.statusCode).toBe(301)
    expect(localisation(evenement)).toBe('/dr-cabrel')
  })
})
