import { nettoyerLigne } from './echappement'
import type { DocumentEmail, EmailRendu } from './document'
import { rendreHtml } from './rendu-html'
import { rendreTexte } from './rendu-texte'

export { echapperHtml, nettoyerAffichage, urlEmail } from './echappement'
export { JETONS_PALETTES } from './jetons'
export { rendreHtml } from './rendu-html'
export { rendreTexte } from './rendu-texte'
export type { DocumentEmail, ElementEmail, EmailRendu, IdentiteEmail, LignePied, LigneRecapitulatif } from './document'

/** Rendu unique : le texte est produit en premier (il impose que chaque lien du HTML y figure). */
export function rendreEmail(doc: DocumentEmail): EmailRendu {
  const text = rendreTexte(doc)
  const html = rendreHtml(doc)
  return { subject: nettoyerLigne(doc.objet), text, html }
}
