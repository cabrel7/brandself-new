import { describe, expect, it } from 'vitest'
import { buildOtpEmail } from '../../server/services/emails/otp-contenu'
import { extraireElement, tousLesHref, texteVisible } from './emails-support'

// ÉTAPE 1 (RED) — `buildOtpEmail` (otp-contenu.ts) doit, en plus du texte actuel (déjà extrait, vert en caractérisation),
// produire un HTML via le gabarit : encadré, préheader sans le code, code contigu. Ces tests échouent tant que `html` est absent.

const SITE = 'https://jesuis.pro'
const ENTREE = { destinataire: 'visiteur@exemple.test', code: '123456', dureeMinutes: 10, siteUrl: SITE }
const TEXTE_ACTUEL =
  "Bonjour,\n\nVotre code de connexion : 123456\n\nIl est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nÀ tout de suite,\njesuis.pro"

describe('buildOtpEmail', () => {
  it('should keep the current subject and the exact current text', () => {
    const message = buildOtpEmail(ENTREE)

    expect(message.to).toBe('visiteur@exemple.test')
    expect(message.subject).toBe('Votre code de connexion jesuis.pro')
    expect(message.text).toBe(TEXTE_ACTUEL)
  })

  it('should add an HTML part containing the code as contiguous digits', () => {
    const { html } = buildOtpEmail(ENTREE)

    expect(html).toBeDefined()
    expect(extraireElement(html ?? '', 'code')).toMatch(/>\s*123456\s*</)
  })

  it('should include an encadre (notice) in the HTML', () => {
    const { html } = buildOtpEmail(ENTREE)

    const encadre = extraireElement(html ?? '', 'encadre')
    expect(encadre).not.toBeNull()
    expect(texteVisible(encadre ?? '')).toContain('10 minutes')
  })

  it('should set the hidden preheader to « Valable 10 minutes. Ne communiquez ce code à personne. » without the code', () => {
    const { html } = buildOtpEmail(ENTREE)

    const apresBody = /<body\b[^>]*>([\s\S]*)/i.exec(html ?? '')?.[1] ?? ''
    const premier = /^\s*<[a-z][^>]*>([\s\S]*?)<\//i.exec(apresBody)?.[1] ?? ''
    expect(texteVisible(premier)).toContain('Valable 10 minutes. Ne communiquez ce code à personne.')
    expect(premier).not.toContain('123456')
  })

  it('should follow dureeMinutes in the preheader and the text', () => {
    const message = buildOtpEmail({ ...ENTREE, dureeMinutes: 5 })

    expect(message.text).toContain('Il est valable 5 minutes.')
    expect(message.html).toContain('Valable 5 minutes. Ne communiquez ce code à personne.')
  })

  it('should use the singular for one minute', () => {
    const message = buildOtpEmail({ ...ENTREE, dureeMinutes: 1 })

    expect(message.text).toContain('Il est valable 1 minute.')
    expect(message.html).toContain('Valable 1 minute. Ne communiquez ce code à personne.')
  })

  it('should keep a leading zero code as typed', () => {
    const message = buildOtpEmail({ ...ENTREE, code: '001234' })

    expect(message.text).toContain('Votre code de connexion : 001234')
    expect(extraireElement(message.html ?? '', 'code')).toMatch(/>\s*001234\s*</)
  })

  it.each(['12345', '1234567', 'abcdef', '12345a', '', ' 123456', '123456\n', '１２３４５６', '12 3456'])(
    'should throw OTP_CODE_INVALIDE when the code is %j (only ^\\d{6}$ is accepted)',
    (code) => {
      expect(() => buildOtpEmail({ ...ENTREE, code })).toThrow('OTP_CODE_INVALIDE')
    },
  )

  it('should not leak an invalid code or the recipient in the error message', () => {
    let message = ''
    try {
      buildOtpEmail({ ...ENTREE, code: '<script>' })
    }
    catch (erreur) {
      message = (erreur as Error).message
    }

    expect(message).toBe('OTP_CODE_INVALIDE')
  })

  it('should carry neither replyTo, nor List-Unsubscribe, nor attachment (security e-mail)', () => {
    const message = buildOtpEmail(ENTREE)

    expect(message.replyTo).toBeUndefined()
    expect(Object.keys(message.headers ?? {}).map((h) => h.toLowerCase())).not.toContain('list-unsubscribe')
    expect(message.attachments).toEqual([])
  })

  it('should link only to the site (the logotype) and load no remote resource', () => {
    const html = buildOtpEmail(ENTREE).html
    expect(html).toBeDefined()

    for (const href of tousLesHref(html ?? '')) expect(href.startsWith(SITE)).toBe(true)
    expect(html).not.toMatch(/<img|src=|url\(|<script|<link/i)
    expect(html).not.toMatch(/brandself/i)
  })

  it('should escape nothing in the text but stay safe in the HTML for an odd recipient', () => {
    const message = buildOtpEmail({ ...ENTREE, destinataire: '"><script>@exemple.test' })

    expect(message.html).not.toMatch(/<script/i)
  })
})
