// Page d'accueil : tests unitaires du branchement « adresse souhaitée » (cookie écrit par la page d'accueil,
// lu et REVALIDÉ par l'étape 4 de l'onboarding).
//
// Périmètre testé en comportement : `shared/adresse-souhaitee.ts`, `useAdresseSouhaitee` et `useOnboarding` (étape 4,
// effacement après publication). Les auto-imports Nuxt (ref, watch, useCookie, useRoute, $fetch…) sont remplacés
// par des doublures minimales basées sur `vue` (aucun serveur Nuxt), comme dans landing-agenda-demo.test.ts.
// `useAdresseSouhaitee` et `validateUsername` sont les VRAIS modules : seule la couche Nuxt (`useCookie`) est doublée.
//
// `Adresse.vue` (composant monofichier) ne peut pas être monté ici (pas de plugin Vue dans le projet Vitest, pas
// de @vue/test-utils) : son contrat est vérifié PAR LECTURE DE SOURCE (voir le dernier bloc).
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computed, nextTick, reactive, ref, watch, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  ADRESSE_SOUHAITEE_DUREE_SECONDES,
  COOKIE_ADRESSE_SOUHAITEE,
} from '../../shared/adresse-souhaitee'
import { useAdresseSouhaitee } from '../../app/composables/useAdresseSouhaitee'
import { useOnboarding } from '../../app/composables/useOnboarding'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SUGGESTION_SERVEUR = 'suggere-serveur'
const ROUTE_TERMINER = '/api/studio/onboarding/terminer'

interface OptionsCookie {
  maxAge?: number
  sameSite?: string
  path?: string
  secure?: boolean
  default?: () => unknown
}

interface AppelCookie {
  nom: string
  options: OptionsCookie
}

interface RequeteFetch {
  url: string
  options?: { method?: string, body?: unknown }
}

let cookies: Map<string, Ref<unknown>>
let appelsCookie: AppelCookie[]
let requetes: RequeteFetch[]
let route: { query: Record<string, string> }
let reponseTerminer: () => Promise<unknown>

function dtoOnboarding(surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    statut: 'en_cours',
    etapeReprise: 4,
    generationId: null,
    photo: null,
    proposition: null,
    usernameSuggere: SUGGESTION_SERVEUR,
    identite: { titre: null, prenom: null, nom: null, metier: null, ville: null, pays: null },
    ...surcharge,
  }
}

function installerGlobaux(): void {
  cookies = new Map()
  appelsCookie = []
  requetes = []
  route = reactive({ query: { etape: '4' } as Record<string, string> })
  reponseTerminer = async () => ({ vitrine: { username: 'mon-cabinet' }, resume: { prochaineEtape: null } })

  vi.stubGlobal('ref', ref)
  vi.stubGlobal('reactive', reactive)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('watch', watch)

  // useCookie : une valeur par nom ; absente, elle prend `default()` (comme Nuxt).
  vi.stubGlobal('useCookie', (nom: string, options: OptionsCookie): Ref<unknown> => {
    appelsCookie.push({ nom, options })
    if (!cookies.has(nom)) cookies.set(nom, ref(options.default ? options.default() : undefined))
    return cookies.get(nom) as Ref<unknown>
  })
  vi.stubGlobal('useAdresseSouhaitee', useAdresseSouhaitee)

  vi.stubGlobal('useRoute', () => route)
  vi.stubGlobal('useRouter', () => ({ push: vi.fn(async () => {}), replace: vi.fn(async () => {}) }))
  vi.stubGlobal('navigateTo', vi.fn(async () => {}))
  vi.stubGlobal('useMediaUpload', () => ({ enCours: ref(false), erreur: ref(null), televerser: vi.fn() }))
  vi.stubGlobal('useUsernameDisponible', () => ({ etat: ref('disponible') }))
  vi.stubGlobal('useGeneration', () => ({
    generation: ref(null),
    termine: ref(false),
    attenteLongue: ref(false),
    erreur: ref(null),
    relancer: vi.fn(),
    amorcer: vi.fn(),
  }))
  vi.stubGlobal('lireErreurApi', (e: unknown) => e)
  vi.stubGlobal('messageTropDeDemandes', () => 'Trop de demandes.')
  vi.stubGlobal('versTitre', (valeur: string) => valeur)
  vi.stubGlobal('TITRE_AUCUN', 'aucun')
  vi.stubGlobal('SOUS_TITRES_ECRAN', { 1: 'un', 2: 'deux', 3: 'trois', 4: 'quatre' })
  vi.stubGlobal('SOUS_TITRE_REPLI', 'repli')

  vi.stubGlobal('$fetch', vi.fn(async (url: string, options?: RequeteFetch['options']) => {
    requetes.push({ url, options })
    if (url === ROUTE_TERMINER) return await reponseTerminer()
    return { onboarding: dtoOnboarding() }
  }))
}

/** Pose le cookie AVANT la création de l'onboarding (le composable le lit à l'initialisation). */
function poserCookie(valeur: unknown): Ref<unknown> {
  const cookie = ref<unknown>(valeur)
  cookies.set(COOKIE_ADRESSE_SOUHAITEE, cookie)
  return cookie
}

function lireCookie(): unknown {
  return cookies.get(COOKIE_ADRESSE_SOUHAITEE)?.value
}

/** Charge l'onboarding (étape 4 atteinte) et laisse les observateurs se déclencher. */
async function arriverEtape4(surcharge: Record<string, unknown> = {}, avant?: (o: ReturnType<typeof useOnboarding>) => void) {
  vi.stubGlobal('$fetch', vi.fn(async (url: string, options?: RequeteFetch['options']) => {
    requetes.push({ url, options })
    if (url === ROUTE_TERMINER) return await reponseTerminer()
    return { onboarding: dtoOnboarding(surcharge) }
  }))
  const onboarding = useOnboarding()
  avant?.(onboarding)
  await onboarding.charger()
  await nextTick()
  return onboarding
}

beforeEach(() => {
  installerGlobaux()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('constantes de l\'adresse souhaitée', () => {
  it('should name the cookie adresse_souhaitee', () => {
    expect(COOKIE_ADRESSE_SOUHAITEE).toBe('adresse_souhaitee')
  })

  it('should keep the cookie for one hour (3600 seconds) as a whole number', () => {
    expect(ADRESSE_SOUHAITEE_DUREE_SECONDES).toBe(3600)
    expect(Number.isInteger(ADRESSE_SOUHAITEE_DUREE_SECONDES)).toBe(true)
  })
})

describe('useAdresseSouhaitee', () => {
  it('should open the cookie under the shared name when called', () => {
    useAdresseSouhaitee()

    expect(appelsCookie).toHaveLength(1)
    expect(appelsCookie[0]?.nom).toBe(COOKIE_ADRESSE_SOUHAITEE)
  })

  it('should configure a one-hour lifetime, lax, site-wide path and secure outside dev', () => {
    useAdresseSouhaitee()

    const options = appelsCookie[0]?.options
    expect(options?.maxAge).toBe(ADRESSE_SOUHAITEE_DUREE_SECONDES)
    expect(options?.sameSite).toBe('lax')
    expect(options?.path).toBe('/')
    // `import.meta.dev` n'est pas défini sous Vitest : on est « hors dev », donc `secure` est actif.
    // La branche dev (secure: false) n'est pas atteignable ici.
    expect(options?.secure).toBe(true)
  })

  it('should return null when the cookie is absent', () => {
    const cookie = useAdresseSouhaitee()

    expect(cookie.value).toBeNull()
    expect(appelsCookie[0]?.options.default?.()).toBeNull()
  })

  it('should return the stored address when the cookie exists', () => {
    poserCookie('mon-cabinet')

    expect(useAdresseSouhaitee().value).toBe('mon-cabinet')
  })

  it('should share the same cookie between two calls (page d\'accueil et onboarding)', () => {
    const ecriture = useAdresseSouhaitee()
    const lecture = useAdresseSouhaitee()

    ecriture.value = 'mon-cabinet'

    expect(lecture.value).toBe('mon-cabinet')
  })
})

describe('useOnboarding — étape 4 : adresse souhaitée valide', () => {
  it('should propose the cookie address when the field is empty', async () => {
    poserCookie('mon-cabinet')

    const o = await arriverEtape4()

    expect(o.username.value).toBe('mon-cabinet')
  })

  it.each([
    ['majuscules', 'Mon-Cabinet', 'mon-cabinet'],
    ['espaces autour', '  mon-cabinet  ', 'mon-cabinet'],
    ['chiffres et tirets', 'cabinet-2-lumiere', 'cabinet-2-lumiere'],
    ['longueur minimale (3)', 'abc', 'abc'],
    ['longueur maximale (30)', 'a'.repeat(30), 'a'.repeat(30)],
  ])('should propose the normalized address when the cookie holds %s', async (_cas, brut, attendu) => {
    poserCookie(brut)

    const o = await arriverEtape4()

    expect(o.username.value).toBe(attendu)
  })

  it('should keep the cookie after proposing the address (cleared only after publication)', async () => {
    poserCookie('mon-cabinet')

    await arriverEtape4()

    expect(lireCookie()).toBe('mon-cabinet')
  })

  it('should ignore the cookie when the field already holds an entry', async () => {
    poserCookie('mon-cabinet')

    const o = await arriverEtape4({}, (onboarding) => {
      onboarding.username.value = 'deja-saisie'
    })

    expect(o.username.value).toBe('deja-saisie')
  })

  it('should not erase a valid cookie when the field already holds an entry', async () => {
    poserCookie('mon-cabinet')

    await arriverEtape4({}, (onboarding) => {
      onboarding.username.value = 'deja-saisie'
    })

    expect(lireCookie()).toBe('mon-cabinet')
  })

  it('should prefer the cookie over the server suggestion when the field is empty', async () => {
    poserCookie('mon-cabinet')

    const o = await arriverEtape4({ usernameSuggere: 'autre-suggestion' })

    expect(o.username.value).toBe('mon-cabinet')
  })

  it('should not touch the username before step 4 is reached', async () => {
    poserCookie('mon-cabinet')
    route.query.etape = '2'

    const o = await arriverEtape4({ etapeReprise: 2 })

    expect(o.username.value).toBe('')
    expect(lireCookie()).toBe('mon-cabinet')
  })

  // Régression corrigée : en revenant à l'étape 4 après un « Retour », l'adresse du cookie (mémorisée comme
  // « suggestion ») était remplacée par la suggestion serveur alors que la personne n'y avait pas touché.
  it('should keep the cookie address when the person goes back to step 3 and returns to step 4 untouched', async () => {
    poserCookie('mon-cabinet')
    const o = await arriverEtape4()
    expect(o.username.value).toBe('mon-cabinet')

    route.query.etape = '3'
    await nextTick()
    route.query.etape = '4'
    await nextTick()

    expect(o.username.value).toBe('mon-cabinet')
  })
})

describe('useOnboarding — étape 4 : adresse souhaitée invalide ou forgée', () => {
  const INVALIDES: ReadonlyArray<[string, unknown]> = [
    ['mot réservé admin', 'admin'],
    ['mot réservé landing', 'landing'],
    ['mot réservé en majuscules', 'ADMIN'],
    ['mot réservé avec espaces', ' landing '],
    ['trop court (2)', 'ab'],
    ['trop long (31)', 'a'.repeat(31)],
    ['chaîne vide', ''],
    ['espaces seuls', '   '],
    ['underscore', 'mon_cabinet'],
    ['accent', 'cabinet-é'],
    ['tiret au début', '-cabinet'],
    ['tiret à la fin', 'cabinet-'],
    ['double tiret', 'cabi--net'],
    ['traversée de chemin', '../x'],
    ['traversée de chemin profonde', '../../etc/passwd'],
    ['balise script', '<script>alert(1)</script>'],
    ['injection d\'attribut', '"><img src=x onerror=alert(1)>'],
    ['paramètre d\'URL', 'abc?x=1'],
    ['saut de ligne', 'abc\ndef'],
    ['octet nul', 'abc\u0000'],
    ['nombre (cookie JSON forgé)', 123],
    ['booléen (cookie JSON forgé)', true],
    ['objet (cookie JSON forgé)', { adresse: 'mon-cabinet' }],
    ['tableau (cookie JSON forgé)', ['mon-cabinet']],
  ]

  it.each(INVALIDES)('should erase the cookie and use the server suggestion when it holds %s', async (_cas, forge) => {
    poserCookie(forge)

    const o = await arriverEtape4()

    expect(lireCookie()).toBeNull()
    expect(o.username.value).toBe(SUGGESTION_SERVEUR)
  })

  it('should not throw when the cookie holds a forged non-string value', async () => {
    poserCookie({ toString: () => { throw new Error('boom') } })

    await expect(arriverEtape4()).resolves.toBeDefined()
    expect(lireCookie()).toBeNull()
  })

  it('should never put a forged value in the username field', async () => {
    poserCookie('<script>alert(1)</script>')

    const o = await arriverEtape4()

    expect(o.username.value).not.toContain('<')
    expect(o.username.value).toBe(SUGGESTION_SERVEUR)
  })

  it('should erase an invalid cookie even when the field already holds an entry', async () => {
    poserCookie('admin')

    const o = await arriverEtape4({}, (onboarding) => {
      onboarding.username.value = 'deja-saisie'
    })

    expect(lireCookie()).toBeNull()
    expect(o.username.value).toBe('deja-saisie')
  })
})

describe('useOnboarding — étape 4 : sans adresse souhaitée', () => {
  it('should use the server suggestion when there is no cookie', async () => {
    const o = await arriverEtape4()

    expect(o.username.value).toBe(SUGGESTION_SERVEUR)
  })

  it('should leave the cookie null when there is no cookie', async () => {
    await arriverEtape4()

    expect(lireCookie()).toBeNull()
  })

  it('should keep a manual entry over the server suggestion when there is no cookie', async () => {
    const o = await arriverEtape4({}, (onboarding) => {
      onboarding.username.value = 'deja-saisie'
    })

    expect(o.username.value).toBe('deja-saisie')
  })
})

describe('useOnboarding — effacement après publication', () => {
  it('should erase the cookie when the publication succeeds', async () => {
    poserCookie('mon-cabinet')
    const o = await arriverEtape4()

    const ok = await o.continuer()

    expect(ok).toBe(true)
    expect(lireCookie()).toBeNull()
    // E1 : `essai` (null quand la réponse n'en porte pas) accompagne l'état « en ligne ».
    expect(o.enLigne.value).toEqual({ username: 'mon-cabinet', prochaineEtape: null, essai: null })
  })

  it('should publish the normalized username (trimmed, lowercase) when the field was filled from the cookie', async () => {
    poserCookie('  Mon-Cabinet ')
    const o = await arriverEtape4()

    await o.continuer()

    const publication = requetes.find((r) => r.url === ROUTE_TERMINER)
    expect(publication?.options?.method).toBe('POST')
    expect((publication?.options?.body as { username: string }).username).toBe('mon-cabinet')
  })

  it('should erase the cookie when the publication succeeds even if the person typed another address', async () => {
    poserCookie('mon-cabinet')
    const o = await arriverEtape4()
    o.username.value = 'autre-adresse'

    const ok = await o.continuer()

    expect(ok).toBe(true)
    expect(lireCookie()).toBeNull()
  })

  it('should keep the cookie when the publication fails (address taken)', async () => {
    poserCookie('mon-cabinet')
    reponseTerminer = async () => {
      throw { code: 'USERNAME_PRIS', champs: {} }
    }
    const o = await arriverEtape4()

    const ok = await o.continuer()

    expect(ok).toBe(false)
    expect(lireCookie()).toBe('mon-cabinet')
    expect(o.enLigne.value).toBeNull()
  })

  it('should keep the cookie when the publication fails on a network error', async () => {
    poserCookie('mon-cabinet')
    reponseTerminer = async () => {
      throw { code: 'RESEAU', champs: {} }
    }
    const o = await arriverEtape4()

    const ok = await o.continuer()

    expect(ok).toBe(false)
    expect(lireCookie()).toBe('mon-cabinet')
  })

  it('should not fail when there was no cookie to erase', async () => {
    const o = await arriverEtape4()

    const ok = await o.continuer()

    expect(ok).toBe(true)
    expect(lireCookie()).toBeNull()
  })
})

describe('Adresse.vue — contrat de source (le composant n\'est pas montable sans plugin Vue)', () => {
  const sourceAdresse = readFileSync(path.join(RACINE, 'app/components/marketing/Adresse.vue'), 'utf8')

  /** Tous les fichiers de `dossier`, récursivement (hors node_modules). */
  function fichiers(dossier: string): string[] {
    return readdirSync(dossier).flatMap((nom) => {
      const chemin = path.join(dossier, nom)
      if (nom === 'node_modules') return []
      return statSync(chemin).isDirectory() ? fichiers(chemin) : [chemin]
    })
  }

  it('should not build any ?adresse= query anywhere under app/', () => {
    const fautifs = fichiers(path.join(RACINE, 'app'))
      .filter((chemin) => /\.(vue|ts|js|mjs)$/.test(chemin))
      .filter((chemin) => readFileSync(chemin, 'utf8').includes('?adresse='))

    expect(fautifs).toEqual([])
  })

  it('should navigate to /connexion without any parameter', () => {
    expect(sourceAdresse).toContain('const ROUTE_CONNEXION = \'/connexion\'')
    expect(sourceAdresse).toContain('navigateTo(ROUTE_CONNEXION)')
    expect(sourceAdresse).not.toMatch(/navigateTo\([^)]*[?`$]/)
  })

  it('should write the validated address in the cookie before navigating', () => {
    const ecriture = sourceAdresse.indexOf('adresseSouhaitee.value = valeur.value')
    const navigation = sourceAdresse.indexOf('navigateTo(ROUTE_CONNEXION)')

    expect(sourceAdresse).toContain('useAdresseSouhaitee()')
    expect(ecriture).toBeGreaterThan(-1)
    expect(navigation).toBeGreaterThan(ecriture)
  })

  it('should return before writing the cookie when the address is empty or invalid', () => {
    const garde = sourceAdresse.indexOf('if (message.value !== \'\')')
    const ecriture = sourceAdresse.indexOf('adresseSouhaitee.value = valeur.value')

    expect(garde).toBeGreaterThan(-1)
    expect(garde).toBeLessThan(ecriture)
    expect(sourceAdresse.slice(garde, ecriture)).toContain('return')
  })

  it('should validate with the real username schema (reserved words included)', () => {
    expect(sourceAdresse).toContain('validateUsername(valeur.value)')
  })
})
