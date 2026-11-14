import { describe, expect, it } from 'vitest'
import {
  ERREUR_ADMIN_REAUTH_CODE_INVALIDE,
  LIBELLE_ACTION_REPLI,
  OBJET_ADMIN_REAUTH,
  buildAdminReauthEmail,
  libelleAction,
} from '../../../server/services/emails/admin-reauth-contenu'
import { ADMIN_ACTIONS, ADMIN_REAUTH_TTL_S } from '../../../shared/admin'

// A1 : e-mail du code de réauthentification (contenu PUR : aucun accès réseau ni base). Le code n'apparaît que dans
// le corps ; l'e-mail ne porte aucune donnée de la cible de l'action.

const entree = {
  destinataire: 'admin-test@exemple.test',
  code: '482915',
  libelleAction: 'suppression d’un compte',
  dureeMinutes: ADMIN_REAUTH_TTL_S / 60,
  siteUrl: 'https://jesuis.pro',
}

describe('buildAdminReauthEmail', () => {
  it('should address the message to the given recipient, with the fixed French subject', () => {
    const message = buildAdminReauthEmail(entree)

    expect(message.to).toBe('admin-test@exemple.test')
    expect(message.subject).toBe(OBJET_ADMIN_REAUTH)
    expect(message.subject).toBe('Code de confirmation d’une action d’administration')
    expect(message.attachments).toEqual([])
  })

  it('should put the code in the text and the HTML bodies', () => {
    const message = buildAdminReauthEmail(entree)

    expect(message.text).toContain('482915')
    expect(message.html).toContain('482915')
  })

  it('should keep the code out of the subject (it would show in notifications and mail lists)', () => {
    const message = buildAdminReauthEmail(entree)

    expect(message.subject).not.toContain('482915')
  })

  it('should name the action to confirm and the validity in minutes', () => {
    const message = buildAdminReauthEmail(entree)

    expect(message.text).toContain('suppression d’un compte')
    expect(message.text).toMatch(/10 minutes/)
  })

  it('should speak French with the formal « vous »', () => {
    const { text } = buildAdminReauthEmail(entree)

    expect(text).toMatch(/Votre code de confirmation/)
    expect(text).toMatch(/Si vous n’êtes pas à l’origine de cette demande/)
    // \b est ASCII seulement : « n’êtes » contiendrait « tes ». On borne par les lettres Unicode.
    expect(text).not.toMatch(/(?<![\p{L}])(tu|ton|ta|tes)(?![\p{L}])/iu)
  })

  it('should say the singular for one minute', () => {
    expect(buildAdminReauthEmail({ ...entree, dureeMinutes: 1 }).text).toMatch(/1 minute(?!s)/)
  })

  it('should not leak the recipient address into the visible body (it only goes in the To header)', () => {
    const { text, html } = buildAdminReauthEmail(entree)

    expect(text).not.toContain('admin-test@exemple.test')
    expect(html).not.toContain('admin-test@exemple.test')
  })

  it.each([['12345'], ['1234567'], ['abcdef'], [' 123456'], ['123456 '], [''], ['12 456'], ['１２３４５６']])(
    'should refuse the malformed code %j (nothing is rendered)',
    (code) => {
      expect(() => buildAdminReauthEmail({ ...entree, code })).toThrow(ERREUR_ADMIN_REAUTH_CODE_INVALIDE)
    },
  )

  it('should not put the invalid code into the error message', () => {
    try {
      buildAdminReauthEmail({ ...entree, code: '12345x' })
    } catch (erreur) {
      expect(String((erreur as Error).message)).not.toContain('12345x')
      return
    }
    throw new Error('Le code invalide devait être refusé.')
  })

  it('should escape an action label that contains markup (the label comes from a table, but nothing must ever be injected)', () => {
    const message = buildAdminReauthEmail({ ...entree, libelleAction: '<img src=x onerror=alert(1)>' })

    expect(message.html).not.toContain('<img src=x')
  })
})

describe('libelleAction', () => {
  it.each(Object.values(ADMIN_ACTIONS))('should give a readable label to the journalled action %s', (action) => {
    const libelle = libelleAction(action)

    expect(libelle).not.toBe(LIBELLE_ACTION_REPLI)
    expect(libelle).not.toContain(action)
  })

  it('should fall back to a neutral label for an action that is not in the table (the code is never blocked)', () => {
    expect(libelleAction('plan.changer')).toBe(LIBELLE_ACTION_REPLI)
    expect(libelleAction('')).toBe(LIBELLE_ACTION_REPLI)
  })

  it('should never echo an unknown action name or a target', () => {
    expect(libelleAction('compte.supprimer')).not.toContain('compte')
    expect(libelleAction('__proto__')).toBe(LIBELLE_ACTION_REPLI)
    expect(libelleAction('constructor')).toBe(LIBELLE_ACTION_REPLI)
  })
})
