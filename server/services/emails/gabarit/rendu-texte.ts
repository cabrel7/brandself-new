import { MARQUE } from '../../../../shared/brand'
import type { DocumentEmail, ElementEmail } from './document'
import { nettoyerAffichage, nettoyerLigne, verifierUrlEmail } from './echappement'

export const ERREUR_LIEN_ABSENT = 'LIEN_ABSENT_DU_TEXTE'
const SEPARATEUR_PIED = '—'
const PUCE = '•'
const TEXTE_ENVOYE_VIA = 'Envoyé via'

function exigerLien(url: string | undefined, lignes: readonly string[]): void {
  if (url !== undefined && !lignes.some((ligne) => ligne.includes(url))) throw new Error(ERREUR_LIEN_ABSENT)
}

function lignesElement(element: ElementEmail): string[] {
  switch (element.type) {
    case 'titre': {
      return []
    }
    case 'paragraphe':
    case 'texteSaisi': {
      return element.texte === '' ? [] : [element.texte]
    }
    case 'code': {
      return [`${element.libelle} : ${element.code}`]
    }
    case 'recapitulatif': {
      return element.lignes.map((ligne) => `${ligne.libelle} : ${ligne.valeur}`)
    }
    case 'liste': {
      return element.lignes.map((ligne) => `${PUCE} ${ligne}`)
    }
    case 'bouton': {
      exigerLien(element.url, element.lignesTexte)
      return [...element.lignesTexte]
    }
    case 'encadre': {
      const lignes = element.lignesTexte ?? [element.texte]
      exigerLien(element.url, lignes)
      return [...lignes]
    }
  }
}

/**
 * Signature : identité plateforme = nom de la marque ; identité professionnelle (décision #26) = nom, métier
 * (s'il existe) et adresse de la vitrine, comme dans la signature HTML.
 */
function lignesSignature(doc: DocumentEmail): string[] {
  const { identite, cloture, siteUrl } = doc
  const fermeture = cloture === null ? [] : [cloture]
  if (identite.type === 'plateforme') return [...fermeture, MARQUE.signature]
  const metier = nettoyerLigne(identite.metier)
  return [...fermeture, nettoyerLigne(identite.nom), ...(metier === '' ? [] : [metier]), verifierUrlEmail(siteUrl, identite.vitrineUrl)]
}

/** Texte brut : aucun échappement HTML, un lien du HTML est toujours lisible ici (sinon LIEN_ABSENT_DU_TEXTE). */
export function rendreTexte(doc: DocumentEmail): string {
  const sections: string[][] = [[doc.salutation]]
  for (const element of doc.elements) {
    const lignes = lignesElement(element)
    if (lignes.length > 0) sections.push(lignes)
  }
  sections.push(lignesSignature(doc))
  const pied = doc.pied ?? []
  for (const ligne of pied) exigerLien(ligne.url, [ligne.texte])
  // « Envoyé via » : les e-mails au nom d'un professionnel disent qui les envoie (jamais pour la plateforme elle-même).
  const marque = doc.identite.type === 'professionnel' ? [`${TEXTE_ENVOYE_VIA} ${MARQUE.nom}`] : []
  if (pied.length > 0 || marque.length > 0) sections.push([SEPARATEUR_PIED, ...pied.map((ligne) => ligne.texte), ...marque])
  return nettoyerAffichage(sections.map((lignes) => lignes.join('\n')).join('\n\n'))
}
