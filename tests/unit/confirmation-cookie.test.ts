import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeEvent } from '../support/h3'

afterEach(() => {
  vi.doUnmock('../../shared/env')
  vi.resetModules()
})

describe('cookie de confirmation de réservation', () => {
  it('should be available to the SSR page while remaining HttpOnly and same-site strict', async () => {
    const { CONFIRMATION_COOKIE, setConfirmationCookie } = await import('../../server/utils/confirmation-cookie')
    const event = fakeEvent()

    setConfirmationCookie(event, 'dr-cabrel', 'opaque-token')

    const header = String(event.node.res.getHeader('set-cookie'))
    const attributs = header.split('; ')
    expect(header).toContain(`${CONFIRMATION_COOKIE}=opaque-token`)
    expect(attributs).toContain('Path=/')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('SameSite=Strict')
    expect(header).not.toContain('Secure')
  })

  it('should add Secure in production', async () => {
    vi.doMock('../../shared/env', () => ({ env: { NODE_ENV: 'production' } }))
    const { setConfirmationCookie } = await import('../../server/utils/confirmation-cookie')
    const event = fakeEvent()

    setConfirmationCookie(event, 'dr-cabrel', 'opaque-token')

    expect(String(event.node.res.getHeader('set-cookie'))).toContain('Secure')
  })
})
