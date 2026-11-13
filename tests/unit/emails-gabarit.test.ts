import { describe, expect, it } from 'vitest'
import { PALETTES } from '../../shared/palettes'
import type { DocumentEmail } from '../../server/services/emails/gabarit/document'
import {
  ACCENTS,
  COULEUR_POINT_LOGO,
  IDENTITE_PLATEFORME,
  SITE,
  SITE_DEV,
  SUR_ACCENT,
  URL_AGENDA,
  docRiche,
  docSimple,
  extraireElement,
  htmlSansLiensAutorises,
  identitePro,
  ouvertureElement,
  styleCompact,
  texteVisible,
  tousLesHref,
} from './emails-support'

// ÉTAPE 1 (RED) — décision #26, e-mails HTML : critères EM-CA01 à EM-CA18 du gabarit
// `server/services/emails/gabarit/{echappement,jetons,document,rendu-texte,rendu-html,index}.ts`, qui N'EXISTENT PAS
// encore : ces tests doivent ÉCHOUER (module introuvable) jusqu'à l'implémentation. Le contrat des éléments est
// supposé dans `emails-support.ts` ; `index.ts` doit réexporter echapperHtml, nettoyerAffichage, urlEmail, rendreEmail.
// Les imports sont dynamiques : chaque critère échoue (et se vérifie) séparément.
//
// Table des critères :
//  CA01 échappement HTML · CA02 nettoyage d'affichage · CA03 urlEmail · CA04 texte = texte actuel
//  CA05 lien absent du texte · CA06 aucune ressource distante · CA07 liens · CA08 préheader · CA09 structure du document
//  CA10 bouton · CA11 code · CA12 récapitulatif · CA13 texte saisi · CA14 identité plateforme · CA15 identité professionnel
//  CA16 (contrastes) et CA17 (jetons, aucun hex ailleurs) : tests/unit/emails-jetons.test.ts · CA18 garde-fous de rendu

const gabarit = () => import('../../server/services/emails/gabarit/index')

async function html(doc: DocumentEmail): Promise<string> {
  const { rendreEmail } = await gabarit()
  return rendreEmail(doc).html
}

async function texte(doc: DocumentEmail): Promise<string> {
  const { rendreEmail } = await gabarit()
  return rendreEmail(doc).text
}

const ERREUR_PIEGE = '"><script>alert(1)</script><img src=x onerror=alert(1)>'

describe('EM-CA01 echapperHtml', () => {
  it('should escape the five HTML-significant characters', async () => {
    const { echapperHtml } = await gabarit()

    expect(echapperHtml('<a href="x">Tom & Jerry\'s</a>')).toMatch(/^&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry(&#39;|&#x27;)s&lt;\/a&gt;$/)
  })

  it('should leave no raw angle bracket, quote or ampersand-not-entity in the output', async () => {
    const { echapperHtml } = await gabarit()

    const sortie = echapperHtml(ERREUR_PIEGE)

    expect(sortie).not.toMatch(/[<>"']/)
    expect(sortie).not.toMatch(/&(?!(amp|lt|gt|quot|#39|#x27);)/)
  })

  it('should escape an already escaped entity once more (no decoding, no double-trust)', async () => {
    const { echapperHtml } = await gabarit()

    expect(echapperHtml('&amp;')).toBe('&amp;amp;')
  })

  it('should return the empty string unchanged and keep accents and emoji as they are', async () => {
    const { echapperHtml } = await gabarit()

    expect(echapperHtml('')).toBe('')
    expect(echapperHtml('Élodie À bientôt 🙂')).toBe('Élodie À bientôt 🙂')
  })
})

describe('EM-CA02 nettoyerAffichage', () => {
  it('should remove control characters but keep line feeds', async () => {
    const { nettoyerAffichage } = await gabarit()

    expect(nettoyerAffichage('a\u0000b\u0007c\u001Bd\u007Fe')).toBe('abcde')
    expect(nettoyerAffichage('ligne 1\nligne 2')).toBe('ligne 1\nligne 2')
  })

  it('should turn a CRLF into a single line feed (the carriage return is a control character)', async () => {
    const { nettoyerAffichage } = await gabarit()

    expect(nettoyerAffichage('a\r\nb\r\n\r\nc')).toBe('a\nb\n\nc')
  })

  it('should remove bidirectional overrides and isolates (U+202A to U+202E, U+2066 to U+2069)', async () => {
    const { nettoyerAffichage } = await gabarit()
    const bidi = ['‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩']

    for (const caractere of bidi) expect(nettoyerAffichage(`a${caractere}b`), caractere.codePointAt(0)?.toString(16)).toBe('ab')
  })

  it('should leave ordinary text, accents, apostrophes and emoji untouched', async () => {
    const { nettoyerAffichage } = await gabarit()

    expect(nettoyerAffichage('Élodie N’Guesso — 15 000 FCFA 🙂')).toBe('Élodie N’Guesso — 15 000 FCFA 🙂')
  })

  it('should leave no control character other than a line feed, whatever the input', async () => {
    const { nettoyerAffichage } = await gabarit()
    const toutesLesCommandes = Array.from({ length: 0x20 }, (_, i) => String.fromCodePoint(i)).join('')

    const sortie = nettoyerAffichage(`x${toutesLesCommandes}\u0085\u009Fy`)

    expect(sortie.replaceAll('\n', '')).not.toMatch(/\p{Cc}/u)
    expect(sortie.startsWith('x')).toBe(true)
    expect(sortie.endsWith('y')).toBe(true)
  })

  it('should return the empty string for the empty string', async () => {
    const { nettoyerAffichage } = await gabarit()

    expect(nettoyerAffichage('')).toBe('')
  })
})

describe('EM-CA03 urlEmail', () => {
  it('should build an absolute URL on the site origin from a path', async () => {
    const { urlEmail } = await gabarit()

    expect(urlEmail(SITE, '/dr-cabrel')).toBe(`${SITE}/dr-cabrel`)
    expect(urlEmail(`${SITE}/`, '/dr-cabrel/agenda')).toBe(`${SITE}/dr-cabrel/agenda`)
    expect(urlEmail(SITE_DEV, '/studio')).toBe(`${SITE_DEV}/studio`)
  })

  it('should encode every path segment with encodeURIComponent and keep the slashes', async () => {
    const { urlEmail } = await gabarit()

    expect(urlEmail(SITE, '/dr cabrel/agenda é')).toBe(`${SITE}/dr%20cabrel/agenda%20%C3%A9`)
    expect(urlEmail(SITE, '/a?b/c#d')).toBe(`${SITE}/a%3Fb/c%23d`)
  })

  it('should encode query keys and values with encodeURIComponent (no raw & = # in a value)', async () => {
    const { urlEmail } = await gabarit()

    expect(urlEmail(SITE, '/studio/compte', { periode: '3' })).toBe(`${SITE}/studio/compte?periode=3`)
    expect(urlEmail(SITE, '/desabonnement', { jeton: 'a b&c=d#e' })).toBe(`${SITE}/desabonnement?jeton=a%20b%26c%3Dd%23e`)
  })

  it('should omit the question mark when the query is absent or empty', async () => {
    const { urlEmail } = await gabarit()

    expect(urlEmail(SITE, '/studio', {})).toBe(`${SITE}/studio`)
    expect(urlEmail(SITE, '/studio')).not.toContain('?')
  })

  it.each([
    ['an absolute URL on another origin', 'https://evil.test/x'],
    ['a userinfo trick', '@evil.test'],
    ['a path without leading slash glued to the host', 'evil'],
    ['a port change', ':8080/x'],
    ['a javascript: scheme', 'javascript:alert(1)'],
  ])('should throw URL_EMAIL_INTERDITE when the path is %s', async (_libelle, chemin) => {
    const { urlEmail } = await gabarit()

    expect(() => urlEmail(SITE, chemin)).toThrow('URL_EMAIL_INTERDITE')
  })

  it.each([
    ['an ftp scheme', 'ftp://jesuis.pro'],
    ['a javascript scheme', 'javascript:alert(1)'],
    ['a data scheme', 'data:text/html,x'],
    ['a relative site URL', '/dr-cabrel'],
    ['an empty site URL', ''],
  ])('should throw when siteUrl is %s (only http and https are allowed)', async (_libelle, siteUrl) => {
    const { urlEmail } = await gabarit()

    expect(() => urlEmail(siteUrl, '/x')).toThrow()
  })

  it('should keep the result on the same origin even for a path made of dots or slashes', async () => {
    const { urlEmail } = await gabarit()

    for (const chemin of ['/../../x', '//evil.test/x', '/\\evil.test']) {
      expect(new URL(urlEmail(SITE, chemin)).origin, chemin).toBe(SITE)
    }
  })
})

describe('EM-CA04 le texte reproduit le texte actuel', () => {
  it('should reproduce the current OTP text byte for byte (code line + notice)', async () => {
    const doc = docSimple({
      objet: 'Votre code de connexion jesuis.pro',
      elements: [
        { type: 'code', libelle: 'Votre code de connexion', code: '123456' },
        { type: 'encadre', texte: "Il est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message." },
      ],
      cloture: 'À tout de suite,',
    })

    expect(await texte(doc)).toBe(
      "Bonjour,\n\nVotre code de connexion : 123456\n\nIl est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.\n\nÀ tout de suite,\njesuis.pro",
    )
  })

  it('should render the visitor confirmation text with the professional signature (recap lines, name, job, vitrine URL, « Envoyé via »)', async () => {
    const doc = docSimple({
      identite: identitePro('sauge'),
      elements: [
        { type: 'paragraphe', texte: 'Votre réservation est confirmée. Nous vous attendons avec plaisir.' },
        { type: 'recapitulatif', lignes: [
          { libelle: 'Service', valeur: 'Consultation de cardiologie' },
          { libelle: 'Professionnel', valeur: 'Dr Cabrel Nguesso' },
          { libelle: 'Date', valeur: 'jeudi 12 novembre 2026 à 10:00' },
        ] },
      ],
    })

    expect(await texte(doc)).toBe(
      'Bonjour,\n\nVotre réservation est confirmée. Nous vous attendons avec plaisir.\n\nService : Consultation de cardiologie\nProfessionnel : Dr Cabrel Nguesso\nDate : jeudi 12 novembre 2026 à 10:00\n\nÀ bientôt,\nDr Cabrel Nguesso\nCardiologue\nhttps://jesuis.pro/dr-cabrel\n\n—\nEnvoyé via jesuis.pro',
    )
  })

  it('should reproduce the current day reminder text (bullets, button text lines, footer with links)', async () => {
    const desabo = `${SITE}/desabonnement?jeton=v1.abc.def`
    const doc = docSimple({
      salutation: 'Bonjour Cabrel,',
      elements: [
        { type: 'paragraphe', texte: 'Voici votre journée : 1 rendez-vous.' },
        { type: 'liste', lignes: ['14:00 — Suivi — Paul Ewane'] },
        { type: 'bouton', libelle: 'Ouvrir mon agenda', url: `${SITE}/studio/agenda`, lignesTexte: [`Le détail est dans votre agenda : ${SITE}/studio/agenda`] },
      ],
      cloture: 'Belle journée,',
      pied: [
        { texte: "Vous recevez cet e-mail parce que vous avez des rendez-vous aujourd'hui." },
        { texte: `Ne plus recevoir cet e-mail, en un clic : ${desabo}`, url: desabo },
        { texte: `Gérer vos e-mails : ${SITE}/studio/compte`, url: `${SITE}/studio/compte` },
      ],
    })

    expect(await texte(doc)).toBe(
      `Bonjour Cabrel,\n\nVoici votre journée : 1 rendez-vous.\n\n• 14:00 — Suivi — Paul Ewane\n\nLe détail est dans votre agenda : ${SITE}/studio/agenda\n\nBelle journée,\njesuis.pro\n\n—\nVous recevez cet e-mail parce que vous avez des rendez-vous aujourd'hui.\nNe plus recevoir cet e-mail, en un clic : ${desabo}\nGérer vos e-mails : ${SITE}/studio/compte`,
    )
  })

  it('should reproduce the current visitor reminder text (two-line button text, professional footer)', async () => {
    const doc = docSimple({
      identite: identitePro('indigo'),
      elements: [
        { type: 'paragraphe', texte: 'Petit rappel : votre rendez-vous avec Dr Cabrel Nguesso approche.' },
        { type: 'recapitulatif', lignes: [{ libelle: 'Service', valeur: 'Consultation' }] },
        { type: 'bouton', libelle: 'Ouvrir la vitrine', url: `${SITE}/dr-cabrel`, lignesTexte: ['Un empêchement ? Prévenez Dr Cabrel Nguesso dès que possible depuis sa vitrine :', `${SITE}/dr-cabrel`] },
      ],
      pied: [{ texte: "Vous recevez ce rappel parce que vous l'avez demandé en réservant sur la vitrine de Dr Cabrel Nguesso. C'est le seul rappel prévu pour ce rendez-vous." }],
    })

    expect(await texte(doc)).toBe(
      "Bonjour,\n\nPetit rappel : votre rendez-vous avec Dr Cabrel Nguesso approche.\n\nService : Consultation\n\nUn empêchement ? Prévenez Dr Cabrel Nguesso dès que possible depuis sa vitrine :\nhttps://jesuis.pro/dr-cabrel\n\nÀ bientôt,\nDr Cabrel Nguesso\nCardiologue\nhttps://jesuis.pro/dr-cabrel\n\n—\nVous recevez ce rappel parce que vous l'avez demandé en réservant sur la vitrine de Dr Cabrel Nguesso. C'est le seul rappel prévu pour ce rendez-vous.\nEnvoyé via jesuis.pro",
    )
  })

  it('should end with the signature alone (after a blank line) when cloture is null, and add no footer when pied is null', async () => {
    const doc = docSimple({ elements: [{ type: 'paragraphe', texte: 'Vous avez reçu un message.' }], cloture: null, pied: null })

    expect(await texte(doc)).toBe('Bonjour,\n\nVous avez reçu un message.\n\njesuis.pro')
  })

  it('should not put the title in the text (the current texts have none) nor the HTML-only visual elements', async () => {
    const doc = docSimple({ elements: [{ type: 'titre', texte: 'TITRE-SEULEMENT-HTML' }, { type: 'paragraphe', texte: 'Corps.' }] })

    expect(await texte(doc)).toBe('Bonjour,\n\nCorps.\n\nÀ bientôt,\njesuis.pro')
  })

  it('should not HTML-escape anything in the text part (visitor text is verbatim, ampersands and tags included)', async () => {
    const saisi = 'Bonjour <b>Docteur</b> & "merci"\nà samedi'
    const doc = docSimple({ elements: [{ type: 'texteSaisi', texte: saisi }, { type: 'paragraphe', texte: 'Tom & Jerry <3' }] })

    const rendu = await texte(doc)

    expect(rendu).toContain(saisi)
    expect(rendu).toContain('Tom & Jerry <3')
    expect(rendu).not.toMatch(/&(amp|lt|gt|quot|#39);/)
  })

  it('should use the objet as the subject, untouched when it is a clean single line', async () => {
    const { rendreEmail } = await gabarit()

    expect(rendreEmail(docSimple({ objet: 'Votre rendez-vous du jeudi 12 novembre' })).subject).toBe('Votre rendez-vous du jeudi 12 novembre')
  })

  it('should never produce a subject containing a CR or LF (header injection), by flattening or by refusing', async () => {
    const { rendreEmail } = await gabarit()

    let sujet: string | null
    try {
      sujet = rendreEmail(docSimple({ objet: 'Rappel\r\nBcc: pirate@exemple.test' })).subject
    }
    catch {
      sujet = null
    }

    if (sujet !== null) expect(sujet).not.toMatch(/[\r\n]/)
  })

  it('should render a document without any element (greeting, closing and signature only)', async () => {
    const rendu = await texte(docSimple({ elements: [] }))

    expect(rendu).toContain('Bonjour,')
    expect(rendu).toContain('jesuis.pro')
  })
})

describe('EM-CA05 un lien doit figurer dans le texte', () => {
  it('should throw LIEN_ABSENT_DU_TEXTE when a button URL is missing from its text lines', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'bouton', libelle: 'Ouvrir', url: URL_AGENDA, lignesTexte: ['Ouvrez votre agenda.'] }] })

    expect(() => rendreEmail(doc)).toThrow('LIEN_ABSENT_DU_TEXTE')
  })

  it('should throw LIEN_ABSENT_DU_TEXTE when an encadre carries a URL absent from its text lines', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'encadre', texte: 'Un lien existe.', url: URL_AGENDA, lignesTexte: ['Un lien existe.'] }] })

    expect(() => rendreEmail(doc)).toThrow('LIEN_ABSENT_DU_TEXTE')
  })

  it('should throw LIEN_ABSENT_DU_TEXTE when a footer line carries a URL absent from its text', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ pied: [{ texte: 'Gérer vos e-mails.', url: `${SITE}/studio/compte` }] })

    expect(() => rendreEmail(doc)).toThrow('LIEN_ABSENT_DU_TEXTE')
  })

  it('should not throw when every URL appears in the text lines (button, encadre with URL, footer)', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({
      elements: [
        { type: 'bouton', libelle: 'Ouvrir', url: URL_AGENDA, lignesTexte: [`Agenda : ${URL_AGENDA}`] },
        { type: 'encadre', texte: 'Un lien existe.', url: URL_AGENDA, lignesTexte: ['Un lien existe :', URL_AGENDA] },
      ],
      pied: [{ texte: `Gérer vos e-mails : ${SITE}/studio/compte`, url: `${SITE}/studio/compte` }],
    })

    expect(() => rendreEmail(doc)).not.toThrow()
  })

  it('should compare the URL as written in the text, not an escaped form (a query with & stays raw in the text)', async () => {
    const { rendreEmail } = await gabarit()
    const url = `${SITE}/studio/compte?periode=3&x=1`
    const doc = docSimple({ elements: [{ type: 'bouton', libelle: 'Renouveler', url, lignesTexte: [`Renouveler : ${url}`] }] })

    expect(rendreEmail(doc).text).toContain(`Renouveler : ${url}`)
  })
})

describe('EM-CA06 aucune ressource distante', () => {
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ['<img', /<img/i],
    ['src=', /\bsrc\s*=/i],
    ['<link', /<link/i],
    ['url(', /url\s*\(/i],
    ['@import', /@import/i],
    ['<script', /<script/i],
    ['<form', /<form/i],
    ['<iframe', /<iframe/i],
  ]
  const IDENTITES = [
    ['plateforme', IDENTITE_PLATEFORME] as const,
    ...PALETTES.map((palette) => [`professionnel ${palette}`, identitePro(palette)] as const),
  ]

  it.each(IDENTITES)('should contain none of the forbidden constructs for the %s identity', async (_libelle, identite) => {
    const rendu = await html(docRiche(identite))

    for (const [nom, motif] of FORBIDDEN) expect(rendu, nom).not.toMatch(motif)
  })

  it('should carry no absolute URL outside href attributes (no remote font, image, tracking)', async () => {
    const rendu = await html(docRiche(identitePro('sauge')))

    expect(htmlSansLiensAutorises(rendu)).not.toMatch(/https?:\/\//i)
  })

  it('should not turn visitor-provided markup into live elements (img onerror, script, quote break-out)', async () => {
    const piege = ERREUR_PIEGE
    const doc = docRiche(identitePro('sauge', { nom: piege, metier: piege }))
    doc.elements = [
      { type: 'titre', texte: piege },
      { type: 'paragraphe', texte: piege },
      { type: 'texteSaisi', texte: piege },
      { type: 'recapitulatif', lignes: [{ libelle: piege, valeur: piege }] },
      { type: 'liste', lignes: [piege] },
      { type: 'encadre', texte: piege },
      { type: 'bouton', libelle: piege, url: URL_AGENDA, lignesTexte: [URL_AGENDA] },
    ]
    doc.salutation = piege
    doc.objet = piege
    doc.preheader = piege
    doc.cloture = piege
    doc.pied = [{ texte: piege }]

    const rendu = await html(doc)

    expect(rendu).not.toMatch(/<script/i)
    expect(rendu).not.toMatch(/<img/i)
    expect(rendu).not.toContain('"><')
    expect(rendu).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('EM-CA07 liens', () => {
  it('should start every href with siteUrl, whatever the identity', async () => {
    for (const identite of [IDENTITE_PLATEFORME, identitePro('indigo')]) {
      const hrefs = tousLesHref(await html(docRiche(identite)))

      expect(hrefs.length).toBeGreaterThan(0)
      for (const href of hrefs) expect(href.startsWith(SITE), href).toBe(true)
    }
  })

  it('should start every href with the local site URL in development (http://localhost:3000)', async () => {
    const hrefs = tousLesHref(await html(docRiche(IDENTITE_PLATEFORME, SITE_DEV)))

    expect(hrefs.length).toBeGreaterThan(0)
    for (const href of hrefs) expect(href.startsWith(SITE_DEV), href).toBe(true)
  })

  it('should escape ampersands in href attributes (&amp;) while the text keeps the raw URL', async () => {
    const { rendreEmail } = await gabarit()
    const url = `${SITE}/studio/compte?periode=3&x=1`
    const doc = docSimple({ elements: [{ type: 'bouton', libelle: 'Renouveler', url, lignesTexte: [`Renouveler : ${url}`] }] })

    const rendu = rendreEmail(doc)

    expect(rendu.html).toContain(`href="${SITE}/studio/compte?periode=3&amp;x=1"`)
    expect(rendu.html).not.toContain('periode=3&x=1')
    expect(rendu.text).toContain(url)
  })

  it.each([
    ['another origin', 'https://evil.test/x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a lookalike host', 'https://jesuis.pro.evil.test/x'],
    ['a userinfo trick', 'https://jesuis.pro@evil.test/x'],
  ])('should refuse a button pointing to %s', async (_libelle, url) => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'bouton', libelle: 'Ouvrir', url, lignesTexte: [url] }] })

    expect(() => rendreEmail(doc)).toThrow()
  })

  it('should refuse a vitrine URL or a footer URL on another origin', async () => {
    const { rendreEmail } = await gabarit()

    expect(() => rendreEmail(docSimple({ identite: identitePro('sauge', { vitrineUrl: 'https://evil.test/dr-cabrel' }) }))).toThrow()
    expect(() => rendreEmail(docSimple({ pied: [{ texte: 'https://evil.test/x', url: 'https://evil.test/x' }] }))).toThrow()
  })
})

describe('EM-CA08 préheader', () => {
  it('should be the first child of body, hidden with display:none and mso-hide:all', async () => {
    const rendu = await html(docSimple({ preheader: 'Valable 10 minutes. Ne communiquez ce code à personne.' }))

    const apresBody = /<body\b[^>]*>([\s\S]*)/i.exec(rendu)?.[1] ?? ''
    const premiere = /^\s*<([a-z][a-z0-9]*)\b([^>]*)>/i.exec(apresBody)
    expect(premiere, 'une balise suit <body>').not.toBeNull()
    const style = styleCompact(premiere?.[2] ?? '')
    expect(style).toContain('display:none')
    expect(style).toContain('mso-hide:all')
    expect(texteVisible(apresBody.slice(0, 600))).toMatch(/^Valable 10 minutes\. Ne communiquez ce code à personne\./)
  })

  it('should escape the preheader', async () => {
    const rendu = await html(docSimple({ preheader: 'A & B <b>' }))

    expect(rendu).toContain('A &amp; B &lt;b&gt;')
  })

  it('should render an empty preheader without breaking the document (still first, still hidden)', async () => {
    const rendu = await html(docSimple({ preheader: '' }))

    const premiere = /<body\b[^>]*>\s*<([a-z][a-z0-9]*)\b([^>]*)>/i.exec(rendu)
    expect(styleCompact(premiere?.[2] ?? '')).toContain('display:none')
  })
})

describe('EM-CA09 structure du document', () => {
  it('should declare lang="fr", the utf-8 charset and a color-scheme', async () => {
    const rendu = await html(docSimple())

    expect(rendu).toMatch(/<html\b[^>]*\blang="fr"/i)
    expect(rendu).toMatch(/<meta\b[^>]*charset="?utf-8"?/i)
    expect(rendu).toMatch(/<meta\b[^>]*name="color-scheme"/i)
    expect(rendu).toMatch(/color-scheme\s*:/i)
  })

  it('should use the escaped objet as the title', async () => {
    const rendu = await html(docSimple({ objet: 'Vos rendez-vous & <rappels>' }))

    expect(rendu).toMatch(/<title>\s*Vos rendez-vous &amp; &lt;rappels&gt;\s*<\/title>/i)
  })

  it('should give role="presentation" to every table, including the Outlook ghost table', async () => {
    const rendu = await html(docRiche(identitePro('sauge')))

    const tables = rendu.match(/<table\b[^>]*>/gi) ?? []
    expect(tables.length).toBeGreaterThan(0)
    for (const table of tables) expect(table, table).toMatch(/\brole="presentation"/i)
  })

  it('should limit the content to 600 px with max-width and add an MSO ghost table of width 600', async () => {
    const rendu = await html(docSimple())

    expect(styleCompact(rendu)).toContain('max-width:600px')
    expect(rendu).toMatch(/<!--\[if\s+(gte\s+)?mso[^\]]*\]>[\s\S]*?<table\b[^>]*\bwidth="600"/i)
  })

  it('should start with a doctype and contain a single html, head and body', async () => {
    const rendu = await html(docSimple())

    expect(rendu.trimStart().toLowerCase().startsWith('<!doctype html')).toBe(true)
    expect(rendu.match(/<body\b/gi)).toHaveLength(1)
    expect(rendu.match(/<head\b/gi)).toHaveLength(1)
  })
})

describe('EM-CA10 bouton', () => {
  it('should be a td with bgcolor = the palette accent and a link colored with the text-on-accent color', async () => {
    const rendu = await html(docRiche(identitePro('sauge')))

    const bouton = extraireElement(rendu, 'bouton')
    expect(bouton, 'élément bouton').not.toBeNull()
    expect(bouton).toMatch(new RegExp(`<td\\b[^>]*bgcolor="${ACCENTS.sauge}"`, 'i'))
    const lien = /<a\b[^>]*>/i.exec(bouton ?? '')?.[0] ?? ''
    expect(styleCompact(lien)).toContain(`color:${SUR_ACCENT.toLowerCase()}`)
    expect(lien).toContain(`href="${URL_AGENDA}"`)
  })

  it('should be at least 48 px high (explicit height or line-height on the td or the link)', async () => {
    const bouton = extraireElement(await html(docRiche(identitePro('sauge'))), 'bouton') ?? ''

    const balises = (/<td\b[^>]*>/i.exec(bouton)?.[0] ?? '') + (/<a\b[^>]*>/i.exec(bouton)?.[0] ?? '')
    const hauteurs = [
      ...[...balises.matchAll(/\bheight="(\d+)"/gi)].map((m) => Number(m[1])),
      ...[...styleCompact(balises).matchAll(/(?<![a-z-])(?:line-)?height:(\d+)px/g)].map((m) => Number(m[1])),
    ]
    expect(Math.max(0, ...hauteurs)).toBeGreaterThanOrEqual(48)
  })

  it.each(PALETTES)('should use the %s accent for the button when the sender is that professional', async (palette) => {
    const bouton = extraireElement(await html(docRiche(identitePro(palette))), 'bouton') ?? ''

    expect(bouton.toLowerCase()).toContain(`bgcolor="${ACCENTS[palette].toLowerCase()}"`)
  })

  it('should use the terracotta accent for the platform identity', async () => {
    const bouton = extraireElement(await html(docRiche(IDENTITE_PLATEFORME)), 'bouton') ?? ''

    expect(bouton.toLowerCase()).toContain(`bgcolor="${ACCENTS.terracotta.toLowerCase()}"`)
  })

  it('should escape the button label', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'bouton', libelle: 'Réserver <maintenant> & vite', url: URL_AGENDA, lignesTexte: [URL_AGENDA] }] })

    expect(extraireElement(rendreEmail(doc).html, 'bouton')).toContain('Réserver &lt;maintenant&gt; &amp; vite')
  })
})

describe('EM-CA11 code de connexion', () => {
  it('should show the digits contiguously in a single text node', async () => {
    const code = extraireElement(await html(docRiche()), 'code') ?? ''

    expect(code).toMatch(/>\s*123456\s*</)
  })

  it('should be monospace and at least 28 px', async () => {
    const rendu = await html(docRiche())

    const balises = [ouvertureElement(rendu, 'code') ?? '', ...(extraireElement(rendu, 'code') ?? '').match(/<[a-z][^>]*>/gi) ?? []]
    const styles = styleCompact(balises.join(' '))
    expect(styles).toContain('monospace')
    const tailles = [...styles.matchAll(/font-size:(\d+)px/g)].map((m) => Number(m[1]))
    expect(Math.max(0, ...tailles)).toBeGreaterThanOrEqual(28)
  })

  it('should keep the code readable by screen readers (no per-digit markup, no letter-spacing split into spans)', async () => {
    const code = extraireElement(await html(docRiche()), 'code') ?? ''

    expect(code).not.toMatch(/1\s*<[^>]+>\s*2\s*<[^>]+>\s*3/)
  })

  it('should keep a code with a leading zero as typed', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'code', libelle: 'Votre code de connexion', code: '012345' }] })

    expect(extraireElement(rendreEmail(doc).html, 'code')).toMatch(/>\s*012345\s*</)
    expect(rendreEmail(doc).text).toContain('Votre code de connexion : 012345')
  })
})

describe('EM-CA12 récapitulatif', () => {
  it('should render one two-column row per line, label then value', async () => {
    const recap = extraireElement(await html(docRiche()), 'recapitulatif') ?? ''

    expect(recap).toMatch(/<tr\b[^>]*>\s*<t[dh]\b[^>]*>\s*Service\s*:?\s*<\/t[dh]>\s*<t[dh]\b[^>]*>\s*Consultation\s*<\/t[dh]>\s*<\/tr>/i)
    expect(recap).toMatch(/<tr\b[^>]*>\s*<t[dh]\b[^>]*>\s*Date\s*:?\s*<\/t[dh]>\s*<t[dh]\b[^>]*>\s*jeudi 12 novembre 2026 à 10:00\s*<\/t[dh]>\s*<\/tr>/i)
    expect(recap.match(/<tr\b/gi)).toHaveLength(2)
  })

  it('should escape labels and values', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'recapitulatif', lignes: [{ libelle: 'Service <1>', valeur: 'Tom & "Jerry"' }] }] })

    const recap = extraireElement(rendreEmail(doc).html, 'recapitulatif') ?? ''

    expect(recap).toContain('Service &lt;1&gt;')
    expect(recap).toContain('Tom &amp; &quot;Jerry&quot;')
  })

  it('should not crash on an empty recap or an empty value', async () => {
    const { rendreEmail } = await gabarit()

    expect(() => rendreEmail(docSimple({ elements: [{ type: 'recapitulatif', lignes: [] }] }))).not.toThrow()
    expect(() => rendreEmail(docSimple({ elements: [{ type: 'recapitulatif', lignes: [{ libelle: 'Lieu', valeur: '' }] }] }))).not.toThrow()
  })
})

describe('EM-CA13 texte saisi', () => {
  it('should escape each line and join them with <br>, keeping blank lines', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'texteSaisi', texte: 'Ligne <1>\r\nLigne & 2\n\nLigne 3' }] })

    const saisi = (extraireElement(rendreEmail(doc).html, 'texteSaisi') ?? '').replaceAll(/<br\s*\/?>/gi, '<br>')

    expect(saisi).toContain('Ligne &lt;1&gt;<br>Ligne &amp; 2<br><br>Ligne 3')
  })

  it('should never add a link: URLs, www and e-mail addresses stay plain text', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({ elements: [{ type: 'texteSaisi', texte: 'Voir http://evil.test/x et www.evil.test ou mail@evil.test' }] })

    const rendu = rendreEmail(doc)

    expect(extraireElement(rendu.html, 'texteSaisi')).not.toMatch(/<a\b/i)
    expect(tousLesHref(rendu.html)).toEqual([])
    expect(rendu.html).not.toMatch(/mailto:|tel:/i)
  })

  it('should remove bidirectional controls and control characters from every displayed value', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docSimple({
      identite: identitePro('sauge', { nom: 'Dr ‮trebac‬', metier: 'Cardio⁦logue⁩' }),
      salutation: 'Bonjour ‭x,',
      elements: [
        { type: 'texteSaisi', texte: 'abc‮def⁧ghi\u0000jkl\u0007' },
        { type: 'paragraphe', texte: 'Para‮graphe\u0000' },
        { type: 'recapitulatif', lignes: [{ libelle: 'Nom‮', valeur: 'Va⁩leur' }] },
      ],
    })

    const rendu = rendreEmail(doc).html

    expect(rendu).not.toMatch(/[‪-‮⁦-⁩]/)
    // Aucun caractère de contrôle (hors tabulation, LF, CR) : contrôle par code, sans classe de caractères de contrôle.
    const caracteresDeControle = [...rendu].filter((caractere) => {
      const code = caractere.charCodeAt(0)
      return code <= 8 || (code >= 11 && code <= 31) || code === 127
    })
    expect(caracteresDeControle).toEqual([])
    expect(rendu).toContain('abcdefghijkl')
  })

  it('should render an empty visitor text without a stray element', async () => {
    const { rendreEmail } = await gabarit()

    expect(() => rendreEmail(docSimple({ elements: [{ type: 'texteSaisi', texte: '' }] }))).not.toThrow()
  })
})

describe('EM-CA14 identité plateforme', () => {
  it('should show the text logotype « jesuis.pro » with the dot in #C1512A and nothing as an image', async () => {
    const rendu = await html(docSimple())

    expect(rendu).toMatch(new RegExp(`jesuis\\s*<(\\w+)\\b[^>]*${COULEUR_POINT_LOGO}[^>]*>\\s*\\.\\s*</\\1>\\s*pro`, 'i'))
    expect(rendu).not.toMatch(/<img|src=|url\(/i)
  })

  it('should never mention the former brand name, in the HTML or the text', async () => {
    const { rendreEmail } = await gabarit()

    const rendu = rendreEmail(docRiche())

    expect(rendu.html).not.toMatch(/brandself/i)
    expect(rendu.text).not.toMatch(/brandself/i)
  })

  it('should use the terracotta palette (accent and page background) for the platform', async () => {
    const rendu = (await html(docRiche())).toLowerCase()

    expect(rendu).toContain(ACCENTS.terracotta.toLowerCase())
    expect(rendu).toContain('#fbf7f0')
  })
})

describe('EM-CA15 identité du professionnel', () => {
  it.each(PALETTES)('should use the accent of the %s palette and not the terracotta accent', async (palette) => {
    const rendu = (await html(docRiche(identitePro(palette)))).toLowerCase()

    expect(rendu).toContain(ACCENTS[palette].toLowerCase())
    if (palette !== 'terracotta') expect(rendu).not.toContain(ACCENTS.terracotta.toLowerCase())
  })

  it('should sign with the name, the job and the vitrine without protocol on screen (the href keeps it)', async () => {
    const rendu = await html(docRiche(identitePro('sauge')))

    const visible = texteVisible(rendu)
    expect(visible).toContain('Dr Cabrel Nguesso')
    expect(visible).toContain('Cardiologue')
    expect(visible).toContain('jesuis.pro/dr-cabrel')
    expect(visible).not.toMatch(/https?:\/\//)
    expect(tousLesHref(rendu)).toContain(`${SITE}/dr-cabrel`)
  })

  it('should end the footer with « Envoyé via jesuis.pro » in the HTML and in the text (professional identity only)', async () => {
    const { rendreEmail } = await gabarit()

    const rendu = rendreEmail(docRiche(identitePro('sauge')))

    expect(texteVisible(rendu.html)).toContain('Envoyé via jesuis.pro')
    expect(rendu.text).toContain('Envoyé via jesuis.pro')
    expect(rendu.text.endsWith('\nEnvoyé via jesuis.pro')).toBe(true)
    expect(rendreEmail(docRiche()).text).not.toContain('Envoyé via')
  })

  it('should not show « Envoyé via » for the platform identity (the platform is already the sender)', async () => {
    expect(texteVisible(await html(docRiche()))).not.toContain('Envoyé via')
  })

  it('should escape the professional name, job and the vitrine address', async () => {
    const rendu = await html(docSimple({ identite: identitePro('sauge', { nom: 'Dr <Cabrel> & Fils', metier: 'Médecin "généraliste"' }) }))

    expect(rendu).toContain('Dr &lt;Cabrel&gt; &amp; Fils')
    expect(rendu).toContain('Médecin &quot;généraliste&quot;')
  })

  it('should survive a professional without job', async () => {
    const { rendreEmail } = await gabarit()

    expect(() => rendreEmail(docSimple({ identite: identitePro('ocre', { metier: '' }) }))).not.toThrow()
  })
})

describe('EM-CA18 garde-fous de rendu', () => {
  function rappelDe20Lignes(identite: DocumentEmail['identite']): DocumentEmail {
    return docSimple({
      identite,
      elements: [
        { type: 'paragraphe', texte: 'Voici votre journée : 20 rendez-vous.' },
        { type: 'liste', lignes: Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'} — Consultation de cardiologie ${i + 1} — Visiteur Numéro ${i + 1}`) },
        { type: 'bouton', libelle: 'Ouvrir mon agenda', url: URL_AGENDA, lignesTexte: [`Agenda : ${URL_AGENDA}`] },
      ],
    })
  }

  it.each([
    ['plateforme', IDENTITE_PLATEFORME],
    ['professionnel', identitePro('bordeaux')],
  ] as const)('should stay under 100 000 bytes for a 20-line reminder (%s)', async (_libelle, identite) => {
    const rendu = await html(rappelDe20Lignes(identite))

    expect(Buffer.byteLength(rendu, 'utf8')).toBeLessThan(100_000)
  })

  it('should render the title as a heading without italic and without any inline emphasis or colored word', async () => {
    const rendu = await html(docRiche())

    const titre = extraireElement(rendu, 'titre') ?? ''
    expect(titre).toMatch(/<h[12]\b/i)
    const titres = rendu.match(/<h[1-6]\b[\s\S]*?<\/h[1-6]>/gi) ?? []
    expect(titres.length).toBeGreaterThan(0)
    for (const bloc of titres) {
      expect(bloc).not.toMatch(/italic|oblique/i)
      expect(bloc).not.toMatch(/<(em|i|span|strong|b|font)\b/i)
    }
  })

  it('should never use italic on any h1 even when the style comes from a style sheet rule', async () => {
    const rendu = await html(docRiche())

    expect(rendu).not.toMatch(/h1\s*\{[^}]*italic/i)
  })

  it('should not show the forbidden user-facing words (bloc, module, widget, section) in the visible text', async () => {
    const { rendreEmail } = await gabarit()

    const rendu = rendreEmail(docRiche(identitePro('sauge')))

    expect(texteVisible(rendu.html)).not.toMatch(/\b(bloc|module|widget|section)s?\b/i)
    expect(rendu.text).not.toMatch(/\b(bloc|module|widget|section)s?\b/i)
  })

  it('should render the same document identically twice (pure, no clock, no randomness)', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docRiche(identitePro('indigo'))

    expect(rendreEmail(doc)).toEqual(rendreEmail(doc))
  })

  it('should not mutate the document it renders', async () => {
    const { rendreEmail } = await gabarit()
    const doc = docRiche(identitePro('indigo'))
    const avant = structuredClone(doc)

    rendreEmail(doc)

    expect(doc).toEqual(avant)
  })

  it('should return exactly subject, text and html', async () => {
    const { rendreEmail } = await gabarit()

    expect(Object.keys(rendreEmail(docSimple())).sort()).toEqual(['html', 'subject', 'text'])
  })
})
