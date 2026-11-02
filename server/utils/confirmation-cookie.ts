import { getCookie, setCookie } from 'h3'
import type { H3Event } from 'h3'
import { CONFIRMATION_DUREE_MINUTES } from '../../shared/agenda'
import { env } from '../../shared/env'

export const CONFIRMATION_COOKIE = 'brandself_confirmation'

export function setConfirmationCookie(event: H3Event, _username: string, token: string): void {
  setCookie(event, CONFIRMATION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    maxAge: CONFIRMATION_DUREE_MINUTES * 60,
    path: '/',
  })
}

export function getConfirmationCookie(event: H3Event): string | undefined {
  return getCookie(event, CONFIRMATION_COOKIE)
}
