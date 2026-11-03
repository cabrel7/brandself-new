import { describe, expect, it } from 'vitest'
import { schemaMoiUpdate } from '../../shared/schemas/moi'
import {
  schemaDesabonnementCorps,
  schemaDesabonnementQuery,
  schemaEtapeIgnorer,
  schemaJetonDesabonnement,
} from '../../shared/schemas/notifications'
import { NEXT_STEPS } from '../../shared/vitrine'
import { DESABONNEMENT_JETON_LONGUEUR_MAX } from '../../shared/notifications'

// S9 §3.6 / CA48 / CA55 : schémas Zod stricts (aucune clé inconnue, aucune coercition).

const JETON = `v1.${'a'.repeat(30)}.${'B'.repeat(43)}`

function jetonDeLongueur(longueur: number): string {
  const entete = 'v1.'
  const reste = longueur - entete.length - 1
  return `${entete}${'a'.repeat(Math.ceil(reste / 2))}.${'b'.repeat(Math.floor(reste / 2))}`
}

describe('schemaEtapeIgnorer', () => {
  it.each(NEXT_STEPS)('should accept the step %s', (etape) => {
    expect(schemaEtapeIgnorer.safeParse({ etape })).toMatchObject({ success: true, data: { etape } })
  })

  it('should accept the five steps and nothing else (partager included)', () => {
    expect([...NEXT_STEPS]).toEqual(['photo', 'service', 'disponibilites', 'realisation', 'partager'])
  })

  it.each([
    ['étape inconnue (CA55)', { etape: 'temoignage' }],
    ['majuscule', { etape: 'Photo' }],
    ['avec espace', { etape: 'photo ' }],
    ['vide', { etape: '' }],
    ['absente', {}],
    ['nombre', { etape: 1 }],
    ['null', { etape: null }],
    ['tableau', { etape: ['photo'] }],
    ['clé en trop', { etape: 'photo', userId: 'autre' }],
    ['null brut', null],
    ['chaîne brute', 'photo'],
    ['tableau brut', ['photo']],
  ])('should refuse %s', (_libelle, entree) => {
    expect(schemaEtapeIgnorer.safeParse(entree).success).toBe(false)
  })
})

describe('schemaJetonDesabonnement', () => {
  it('should accept a well-formed v1 token', () => {
    expect(schemaJetonDesabonnement.safeParse(JETON).success).toBe(true)
  })

  it('should accept the base64url alphabet including - and _', () => {
    expect(schemaJetonDesabonnement.safeParse(`v1.${'a-_Z09'.repeat(5)}.${'x_-Y12'.repeat(7)}`).success).toBe(true)
  })

  it('should accept a token of exactly the maximum length and refuse one character more', () => {
    expect(schemaJetonDesabonnement.safeParse(jetonDeLongueur(DESABONNEMENT_JETON_LONGUEUR_MAX)).success).toBe(true)
    expect(schemaJetonDesabonnement.safeParse(jetonDeLongueur(DESABONNEMENT_JETON_LONGUEUR_MAX + 1)).success).toBe(false)
  })

  it('should refuse a token shorter than 20 characters and accept exactly 20', () => {
    expect(schemaJetonDesabonnement.safeParse(jetonDeLongueur(19)).success).toBe(false)
    expect(schemaJetonDesabonnement.safeParse(jetonDeLongueur(20)).success).toBe(true)
  })

  it.each([
    ['version inconnue', `v2.${'a'.repeat(30)}.${'b'.repeat(30)}`],
    ['sans version', `${'a'.repeat(30)}.${'b'.repeat(30)}`],
    ['version en majuscule', `V1.${'a'.repeat(30)}.${'b'.repeat(30)}`],
    ['trois segments après la version', `v1.${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(10)}`],
    ['charge vide', `v1..${'b'.repeat(30)}`],
    ['signature vide', `v1.${'a'.repeat(30)}.`],
    ['remplissage base64 (=)', `v1.${'a'.repeat(30)}.${'b'.repeat(29)}=`],
    ['signe plus', `v1.${'a'.repeat(30)}.${'b'.repeat(29)}+`],
    ['barre oblique', `v1.${'a'.repeat(30)}.${'b'.repeat(29)}/`],
    ['espace', `v1.${'a'.repeat(30)}.${'b'.repeat(29)} `],
    ['saut de ligne final', `v1.${'a'.repeat(30)}.${'b'.repeat(30)}\n`],
    ['espace initial', ` v1.${'a'.repeat(30)}.${'b'.repeat(30)}`],
    ['caractère accentué', `v1.${'a'.repeat(30)}.${'é'.repeat(30)}`],
    ['nombre', 1234567890123456],
    ['null', null],
    ['objet', { jeton: JETON }],
  ])('should refuse %s', (_libelle, entree) => {
    expect(schemaJetonDesabonnement.safeParse(entree).success).toBe(false)
  })
})

describe('schemaDesabonnementQuery', () => {
  it('should accept an object with only a valid jeton', () => {
    expect(schemaDesabonnementQuery.safeParse({ jeton: JETON })).toMatchObject({ success: true, data: { jeton: JETON } })
  })

  it.each([
    ['jeton absent', {}],
    ['jeton invalide', { jeton: 'abc' }],
    ['clé en trop', { jeton: JETON, utilisateur: 'autre' }],
    ['jeton répété (tableau h3)', { jeton: [JETON, JETON] }],
    ['null', null],
  ])('should refuse %s', (_libelle, entree) => {
    expect(schemaDesabonnementQuery.safeParse(entree).success).toBe(false)
  })
})

describe('schemaDesabonnementCorps', () => {
  it('should accept the JSON form { jeton }', () => {
    expect(schemaDesabonnementCorps.safeParse({ jeton: JETON }).success).toBe(true)
  })

  it('should accept the RFC 8058 one-click form List-Unsubscribe=One-Click', () => {
    expect(schemaDesabonnementCorps.safeParse({ 'List-Unsubscribe': 'One-Click' }).success).toBe(true)
  })

  it.each([
    ['valeur différente', { 'List-Unsubscribe': 'one-click' }],
    ['valeur vide', { 'List-Unsubscribe': '' }],
    ['valeur oui', { 'List-Unsubscribe': 'yes' }],
    ['les deux formes ensemble', { jeton: JETON, 'List-Unsubscribe': 'One-Click' }],
    ['clé en trop', { 'List-Unsubscribe': 'One-Click', preference: 'email_hebdo' }],
    ['jeton invalide', { jeton: 'abc' }],
    ['objet vide', {}],
    ['null', null],
    ['chaîne brute', 'List-Unsubscribe=One-Click'],
  ])('should refuse %s', (_libelle, entree) => {
    expect(schemaDesabonnementCorps.safeParse(entree).success).toBe(false)
  })
})

describe('schemaMoiUpdate : préférences d’e-mails (CA47, CA48)', () => {
  it.each([
    [{ emailHebdo: false }],
    [{ emailHebdo: true }],
    [{ emailRappelJour: false }],
    [{ emailHebdo: false, emailRappelJour: true }],
    [{ emailHebdo: true, fuseau: 'Europe/Paris' }],
  ])('should accept %j and return only the keys sent', (entree) => {
    const resultat = schemaMoiUpdate.safeParse(entree)

    expect(resultat.success).toBe(true)
    expect(Object.keys(resultat.data ?? {}).sort()).toEqual(Object.keys(entree).sort())
  })

  it.each([
    ['chaîne non booléenne (CA48)', { emailHebdo: 'non' }],
    ['chaîne "true"', { emailHebdo: 'true' }],
    ['nombre 1', { emailHebdo: 1 }],
    ['nombre 0', { emailRappelJour: 0 }],
    ['null', { emailHebdo: null }],
    ['tableau', { emailHebdo: [true] }],
    ['clé inconnue (CA48)', { emailHebdo: true, newsletter: true }],
    ['nom de colonne en base (snake_case)', { email_hebdo: false }],
    ['colonne en base email_rappel_jour', { email_rappel_jour: false }],
  ])('should refuse %s', (_libelle, entree) => {
    expect(schemaMoiUpdate.safeParse(entree).success).toBe(false)
  })

  it('should give a French, user-facing message on an invalid choice', () => {
    const resultat = schemaMoiUpdate.safeParse({ emailHebdo: 'non' })

    expect(resultat.success).toBe(false)
    expect(JSON.stringify(resultat.error?.issues)).toMatch(/Choix invalide/)
  })
})
