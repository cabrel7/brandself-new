import { MARQUE } from '../../../../shared/brand'
import type { DocumentEmail, ElementEmail, IdentiteEmail, LignePied } from './document'
import { echapperHtml, nettoyerAffichage, nettoyerLigne, verifierUrlEmail } from './echappement'
import { JETONS_PALETTES, LARGEUR_EMAIL, MARQUE_EMAIL, POLICES, TAILLES } from './jetons'
import type { JetonsPalette } from './jetons'

// Rendu HTML : tables role="presentation", styles en ligne, aucune ressource distante (ni image, ni police web,
// ni feuille externe). Tout texte variable passe par `s()` (nettoyage + échappement), attributs compris.

const NB_REMPLISSAGE_PREHEADER = 30
const REMPLISSAGE_PREHEADER = '&nbsp;&zwnj;'.repeat(NB_REMPLISSAGE_PREHEADER)
const RAYON = 6
const PROTOCOLE = /^https?:\/\//i

const s = (valeur: string): string => echapperHtml(nettoyerAffichage(valeur))

interface Contexte {
  jetons: JetonsPalette
  siteUrl: string
  premierTitre: boolean
}

const police = (taille: number, couleur: string): string =>
  `font-family:${POLICES.texte};font-size:${taille}px;line-height:${Math.round(taille * 1.5)}px;color:${couleur};`

function lien(href: string, libelle: string, jetons: JetonsPalette): string {
  return `<a href="${s(href)}" style="color:${jetons.accent};text-decoration:underline;">${libelle}</a>`
}

const sansProtocole = (adresse: string): string => adresse.replace(PROTOCOLE, '').replace(/\/$/, '')

/**
 * Texte d'un encadré ou d'un pied avec son lien. Si l'URL figure dans le texte, elle est remplacée par un lien dont
 * le libellé est le texte qui la précède (sans « : ») ; sinon le lien est ajouté après le texte. L'URL brute
 * n'est jamais affichée avec son protocole.
 */
function texteAvecLien(texte: string, url: string | undefined, ctx: Contexte): string {
  if (url === undefined) return s(texte)
  const adresse = verifierUrlEmail(ctx.siteUrl, url)
  const position = texte.indexOf(adresse)
  if (position === -1) return `${s(texte)} ${lien(adresse, s(sansProtocole(adresse)), ctx.jetons)}`
  const libelle = texte.slice(0, position).replace(/\s*:?\s*$/, '')
  const apres = texte.slice(position + adresse.length)
  return `${lien(adresse, s(libelle === '' ? sansProtocole(adresse) : libelle), ctx.jetons)}${s(apres)}`
}

function ligneElement(contenu: string, ctx: Contexte, type: string, remplissage = '0 0 16px'): string {
  return `<tr data-element="${type}"><td style="padding:${remplissage};${police(TAILLES.corps, ctx.jetons.encre)}">${contenu}</td></tr>`
}

function rendreElement(element: ElementEmail, ctx: Contexte): string {
  const { jetons } = ctx
  switch (element.type) {
    case 'titre': {
      const niveau = ctx.premierTitre ? 'h1' : 'h2'
      ctx.premierTitre = false
      return `<tr data-element="titre"><td style="padding:0 0 16px;"><${niveau} style="margin:0;font-family:${POLICES.titre};font-size:${TAILLES.titre}px;line-height:32px;font-weight:700;font-style:normal;color:${jetons.encre};">${s(element.texte)}</${niveau}></td></tr>`
    }
    case 'paragraphe': {
      return ligneElement(`<p style="margin:0;">${s(element.texte)}</p>`, ctx, 'paragraphe')
    }
    case 'texteSaisi': {
      if (element.texte === '') return ''
      const lignes = nettoyerAffichage(element.texte).split('\n').map((ligne) => echapperHtml(ligne)).join('<br>')
      return `<tr data-element="texteSaisi"><td style="padding:0 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid ${jetons.bordure};padding:4px 0 4px 12px;${police(TAILLES.corps, jetons.encre)}">${lignes}</td></tr></table></td></tr>`
    }
    case 'code': {
      return `<tr data-element="code"><td align="center" bgcolor="${jetons.surface}" style="padding:16px;border-radius:${RAYON}px;background-color:${jetons.surface};"><p style="margin:0 0 8px;${police(TAILLES.petit, jetons.texteSecondaire)}">${s(element.libelle)}</p><p style="margin:0;font-family:${POLICES.code};font-size:${TAILLES.code}px;line-height:40px;font-weight:700;letter-spacing:4px;color:${jetons.encre};">${s(element.code)}</p></td></tr>
<tr><td style="font-size:0;line-height:16px;height:16px;">&nbsp;</td></tr>`
    }
    case 'recapitulatif': {
      if (element.lignes.length === 0) return ''
      const lignes = element.lignes.map((ligne) => `<tr><td valign="top" style="padding:6px 12px 6px 0;${police(TAILLES.corps, jetons.texteSecondaire)}">${s(ligne.libelle)}</td><td valign="top" style="padding:6px 0;${police(TAILLES.corps, jetons.encre)}font-weight:600;">${s(ligne.valeur)}</td></tr>`).join('')
      return `<tr data-element="recapitulatif"><td style="padding:0 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lignes}</table></td></tr>`
    }
    case 'liste': {
      if (element.lignes.length === 0) return ''
      const lignes = element.lignes.map((ligne) => `<tr><td valign="top" width="16" style="${police(TAILLES.corps, jetons.accent)}">&bull;</td><td style="padding:0 0 4px;${police(TAILLES.corps, jetons.encre)}">${s(ligne)}</td></tr>`).join('')
      return `<tr data-element="liste"><td style="padding:0 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${lignes}</table></td></tr>`
    }
    case 'bouton': {
      const href = verifierUrlEmail(ctx.siteUrl, element.url)
      const hauteur = TAILLES.boutonHauteur
      return `<tr data-element="bouton"><td style="padding:8px 0 24px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${jetons.accent}" height="${hauteur}" style="background-color:${jetons.accent};border-radius:${RAYON}px;height:${hauteur}px;"><a href="${s(href)}" style="display:inline-block;padding:0 28px;font-family:${POLICES.texte};font-size:${TAILLES.corps}px;line-height:${hauteur}px;font-weight:700;color:${jetons.surAccent};text-decoration:none;">${s(element.libelle)}</a></td></tr></table></td></tr>`
    }
    case 'encadre': {
      const contenu = texteAvecLien(element.texte, element.url, ctx)
      return `<tr data-element="encadre"><td style="padding:0 0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="${jetons.surface}" style="background-color:${jetons.surface};border-left:4px solid ${jetons.accent};padding:12px 16px;${police(TAILLES.corps, jetons.encre)}">${contenu}</td></tr></table></td></tr>`
    }
  }
}

/** Logotype texte : aucune image (le SVG n'est pas supporté par Gmail/Outlook). */
function logotype(jetons: JetonsPalette, taille: number): string {
  const [debut, fin] = MARQUE.nom.split('.') as [string, string]
  return `<span style="font-family:${POLICES.titre};font-size:${taille}px;font-weight:700;font-style:normal;color:${jetons.encre};">${echapperHtml(debut)}<span style="color:${MARQUE_EMAIL.point};">.</span>${echapperHtml(fin)}</span>`
}

function entete(identite: IdentiteEmail, jetons: JetonsPalette): string {
  const contenu = identite.type === 'plateforme'
    ? logotype(jetons, TAILLES.logo)
    : `<span style="font-family:${POLICES.titre};font-size:${TAILLES.corps + 4}px;font-weight:700;color:${jetons.accent};">${s(nettoyerLigne(identite.nom))}</span>${identite.metier === '' ? '' : `<br><span style="${police(TAILLES.petit, jetons.texteSecondaire)}">${s(nettoyerLigne(identite.metier))}</span>`}`
  return `<tr><td style="padding:0 8px 16px;">${contenu}</td></tr>`
}

function signature(doc: DocumentEmail, ctx: Contexte): string {
  const { identite, cloture } = doc
  const { jetons } = ctx
  const fermeture = cloture === null ? '' : `<p style="margin:0 0 4px;">${s(cloture)}</p>`
  if (identite.type === 'plateforme') return ligneElement(`${fermeture}${logotype(jetons, TAILLES.corps + 2)}`, ctx, 'signature', '8px 0 0')
  const adresse = verifierUrlEmail(ctx.siteUrl, identite.vitrineUrl)
  const affichee = adresse.replace(PROTOCOLE, '').replace(/\/$/, '')
  const metier = identite.metier === '' ? '' : `<br><span style="color:${jetons.texteSecondaire};">${s(identite.metier)}</span>`
  return ligneElement(`${fermeture}<strong>${s(identite.nom)}</strong>${metier}<br>${lien(adresse, s(affichee), jetons)}`, ctx, 'signature', '8px 0 0')
}

function pied(doc: DocumentEmail, ctx: Contexte): string {
  const lignes: LignePied[] = [...(doc.pied ?? [])]
  const { jetons } = ctx
  const corps = lignes.map((ligne) => `<p style="margin:0 0 8px;">${texteAvecLien(ligne.texte, ligne.url, ctx)}</p>`)
  if (doc.identite.type === 'professionnel') corps.push(`<p style="margin:0;">Envoyé via ${echapperHtml(MARQUE.nom)}</p>`)
  if (corps.length === 0) return ''
  return `<tr><td bgcolor="${jetons.surface}" style="background-color:${jetons.surface};padding:16px 24px;${police(TAILLES.petit, jetons.texteSecondaire)}">${corps.join('')}</td></tr>`
}

/** Rendu HTML complet : document autonome, 600 px, préheader caché en premier enfant de body. */
export function rendreHtml(doc: DocumentEmail): string {
  const jetons = JETONS_PALETTES[doc.identite.type === 'professionnel' ? doc.identite.palette : 'terracotta']
  const ctx: Contexte = { jetons, siteUrl: doc.siteUrl, premierTitre: true }
  const elements = doc.elements.map((element) => rendreElement(element, ctx)).join('')
  const salutation = ligneElement(`<p style="margin:0;">${s(doc.salutation)}</p>`, ctx, 'salutation')
  const largeur = LARGEUR_EMAIL
  const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${s(nettoyerLigne(doc.objet))}</title>
<style>
:root{color-scheme:light;supported-color-schemes:light}
body{margin:0;padding:0}
table{border-collapse:collapse}
h1,h2{font-style:normal}
</style>
</head>
<body style="margin:0;padding:0;background-color:${jetons.fond};">
<div style="display:none;mso-hide:all;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${s(nettoyerLigne(doc.preheader))}${REMPLISSAGE_PREHEADER}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${jetons.fond}" style="background-color:${jetons.fond};"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${largeur}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:${largeur}px;">
${entete(doc.identite, jetons)}
<tr><td bgcolor="${jetons.champ}" style="background-color:${jetons.champ};border:1px solid ${jetons.bordure};border-radius:${RAYON}px;padding:24px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${salutation}${elements}${signature(doc, ctx)}
</table></td></tr>
${pied(doc, ctx)}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>
`
  // Retours à la ligne entre balises : lignes courtes (limite des serveurs de messagerie) et aucune attache `"><`.
  return html.replaceAll('"><', '">\n<')
}
