export interface ErreurEnvoiCode {
  status?: number
  statusText?: string
  message?: string
}

const ERREUR_ENVOI = 'Nous n’avons pas pu envoyer le code. Réessayez dans un instant.'
const ERREUR_TROP_DE_TENTATIVES = 'Trop de tentatives. Patientez une minute avant de recommencer.'
/** Message rédigé par le limiteur serveur (shared/limiteur.ts) : il contient le délai de renvoi, on l'affiche tel quel. */
const MESSAGE_RENVOI = /^Un code vient d['’]être envoyé\./

/** Message affiché quand l'envoi d'un code échoue : jamais de détail technique, sauf le message du limiteur. */
export function messageErreurEnvoiCode(erreur: ErreurEnvoiCode): string {
  const texte = (erreur.message || erreur.statusText || '').trim()
  if (MESSAGE_RENVOI.test(texte)) return texte
  if (erreur.status === 429 || /too many|rate limit/i.test(texte)) return ERREUR_TROP_DE_TENTATIVES
  return ERREUR_ENVOI
}
