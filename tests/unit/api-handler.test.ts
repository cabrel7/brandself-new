import { createError, isError } from 'h3'
import type { H3Error } from 'h3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ERROR_STATUS } from '../../shared/erreurs'
import type { ErrorCode } from '../../shared/erreurs'
import { fakeEvent } from '../support/h3'

// U11 — defineApiHandler (server/utils/api.ts) : traduit les erreurs métier en H3Error,
// sans jamais fuiter le message d'une erreur inconnue.
// Imports paresseux : tant que les modules n'existent pas, chaque test échoue pour la bonne raison.
const apiModule = () => import('../../server/utils/api')
const httpModule = () => import('../../server/exceptions/http')

const MESSAGE_ACCENTUE = 'Cette vitrine n’existe pas ou n’est plus publiée : vérifiez l’adresse, très cordialement.'
const ASCII_IMPRIMABLE = /^[\x20-\x7E]+$/

async function erreurLancee(execution: () => unknown): Promise<H3Error> {
  try {
    await execution()
  } catch (erreur) {
    expect(isError(erreur)).toBe(true)
    return erreur as H3Error
  }
  throw new Error('Une H3Error était attendue mais rien n’a été lancé.')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('defineApiHandler (U11)', () => {
  it('should return the value of the wrapped handler untouched', async () => {
    const { defineApiHandler } = await apiModule()
    const handler = defineApiHandler(async () => ({ vitrine: { username: 'dr-test' } }))

    expect(await handler(fakeEvent())).toEqual({ vitrine: { username: 'dr-test' } })
  })

  it('should pass the event to the wrapped handler', async () => {
    const { defineApiHandler } = await apiModule()
    const evenement = fakeEvent({ url: '/api/studio/vitrine' })
    const handler = defineApiHandler(async (event) => event.path)

    expect(await handler(evenement)).toBe('/api/studio/vitrine')
  })

  describe('erreurs métier', () => {
    it('should turn a DomainError into an H3Error that keeps the French message with its accents intact', async () => {
      const { defineApiHandler } = await apiModule()
      const { DomainError } = await httpModule()
      const handler = defineApiHandler(async () => {
        throw new DomainError('VITRINE_INTROUVABLE', MESSAGE_ACCENTUE, 404)
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusCode).toBe(404)
      expect(erreur.message).toBe(MESSAGE_ACCENTUE)
      expect(erreur.data).toMatchObject({ code: 'VITRINE_INTROUVABLE' })
    })

    it('should expose an ASCII-only statusMessage (h3 strips non-ASCII characters from it)', async () => {
      const { defineApiHandler } = await apiModule()
      const { DomainError } = await httpModule()
      const handler = defineApiHandler(async () => {
        throw new DomainError('VITRINE_INTROUVABLE', MESSAGE_ACCENTUE, 404)
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusMessage).toMatch(ASCII_IMPRIMABLE)
    })

    it('should forward the extra data of the error next to its code (champs, manquants)', async () => {
      const { defineApiHandler } = await apiModule()
      const { DomainError } = await httpModule()
      const handler = defineApiHandler(async () => {
        throw new DomainError('PUBLICATION_INCOMPLETE', 'Complétez votre vitrine avant de la publier.', 422, { manquants: ['ville', 'pays'] })
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusCode).toBe(422)
      expect(erreur.data).toEqual({ code: 'PUBLICATION_INCOMPLETE', manquants: ['ville', 'pays'] })
    })

    it.each<[string, ErrorCode, (http: Awaited<ReturnType<typeof httpModule>>) => Error]>([
      ['NotFoundError', 'MEDIA_INTROUVABLE', (h) => new h.NotFoundError('MEDIA_INTROUVABLE')],
      ['ConflictError', 'USERNAME_PRIS', (h) => new h.ConflictError('USERNAME_PRIS')],
      ['UnprocessableError', 'MEDIA_INVALIDE', (h) => new h.UnprocessableError('MEDIA_INVALIDE')],
      ['ForbiddenError', 'SESSION_TROP_ANCIENNE', (h) => new h.ForbiddenError('SESSION_TROP_ANCIENNE')],
      ['PayloadTooLargeError', 'FICHIER_TROP_LOURD', (h) => new h.PayloadTooLargeError()],
      ['LengthRequiredError', 'TAILLE_REQUISE', (h) => new h.LengthRequiredError()],
      ['UnsupportedMediaTypeError', 'TYPE_NON_SUPPORTE', (h) => new h.UnsupportedMediaTypeError()],
    ])('should map %s (%s) to the HTTP status of the §5 table', async (_nom, code, fabriquer) => {
      const { defineApiHandler } = await apiModule()
      const http = await httpModule()
      const handler = defineApiHandler(async () => {
        throw fabriquer(http)
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusCode).toBe(ERROR_STATUS[code])
      expect(erreur.data).toMatchObject({ code })
      expect(erreur.statusMessage).toMatch(ASCII_IMPRIMABLE)
      expect(erreur.message.length).toBeGreaterThan(0)
    })

    it('should map TooManyRequestsError to 429 with retryAfter in the body and a Retry-After header', async () => {
      const { defineApiHandler } = await apiModule()
      const { TooManyRequestsError } = await httpModule()
      const evenement = fakeEvent()
      const handler = defineApiHandler(async () => {
        throw new TooManyRequestsError(42)
      })

      const erreur = await erreurLancee(() => handler(evenement))

      expect(erreur.statusCode).toBe(429)
      expect(erreur.data).toMatchObject({ code: 'TROP_DE_REQUETES', retryAfter: 42 })
      expect(evenement.node.res.getHeader('retry-after')).toBe('42')
    })
  })

  describe('erreurs déjà HTTP', () => {
    it('should let an H3Error through unchanged (e.g. 401 from requireUserSession)', async () => {
      const { defineApiHandler } = await apiModule()
      const origine = createError({ statusCode: 401, statusMessage: 'Unauthorized', message: 'Connexion requise.' })
      const handler = defineApiHandler(async () => {
        throw origine
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur).toBe(origine)
    })
  })

  describe('erreurs inconnues', () => {
    const SECRET = 'connexion refusée pour jean@exemple.com (+237600000000)'

    it('should answer 500 ERREUR_INTERNE with a generic message that never contains the original one', async () => {
      const { defineApiHandler } = await apiModule()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const handler = defineApiHandler(async () => {
        throw new TypeError(SECRET)
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusCode).toBe(500)
      expect(erreur.data).toMatchObject({ code: 'ERREUR_INTERNE' })
      expect(erreur.message).not.toContain('jean@exemple.com')
      expect(erreur.message).not.toContain(SECRET)
      expect(erreur.statusMessage).toMatch(ASCII_IMPRIMABLE)
      expect(JSON.stringify(erreur.data)).not.toContain('jean@exemple.com')
    })

    it('should log the route path and the error name, but neither its message nor personal data', async () => {
      const { defineApiHandler } = await apiModule()
      const espions = (['error', 'warn', 'info', 'log'] as const).map((methode) =>
        vi.spyOn(console, methode).mockImplementation(() => undefined),
      )
      const handler = defineApiHandler(async () => {
        throw new TypeError(SECRET)
      })

      await erreurLancee(() => handler(fakeEvent({ url: '/api/studio/vitrine' })))

      const journal = espions.flatMap((espion) => espion.mock.calls).map((appel) => JSON.stringify(appel)).join('\n')
      expect(journal).toContain('/api/studio/vitrine')
      expect(journal).toContain('TypeError')
      expect(journal).not.toContain('jean@exemple.com')
      expect(journal).not.toContain('+237600000000')
    })

    it.each([
      ['une chaîne', 'boom'],
      ['null', null],
      ['un objet sans classe', { raison: 'inconnue', email: 'jean@exemple.com' }],
    ])('should answer 500 ERREUR_INTERNE when %s is thrown instead of an Error', async (_libelle, valeur) => {
      const { defineApiHandler } = await apiModule()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const handler = defineApiHandler(async () => {
        throw valeur
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusCode).toBe(500)
      expect(erreur.data).toMatchObject({ code: 'ERREUR_INTERNE' })
      expect(JSON.stringify(erreur)).not.toContain('jean@exemple.com')
    })

    it('should not turn a pg-style error (object carrying a SQLSTATE code) into a business error', async () => {
      const { defineApiHandler } = await apiModule()
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const erreurSql = Object.assign(new Error('duplicate key value violates unique constraint "vitrines_username_unique"'), { code: '23505' })
      const handler = defineApiHandler(async () => {
        throw erreurSql
      })

      const erreur = await erreurLancee(() => handler(fakeEvent()))

      expect(erreur.statusCode).toBe(500)
      expect(erreur.data).toMatchObject({ code: 'ERREUR_INTERNE' })
      expect(erreur.message).not.toContain('vitrines_username_unique')
    })
  })
})
