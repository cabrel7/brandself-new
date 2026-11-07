// S14 (#17) : source unique de la marque.
// Elle sert UNIQUEMENT là où le code construit un texte : modèles d'e-mail et de SMS,
// balises SEO, données structurées. Aucun identifiant ne s'en sert : tables, colonnes,
// variables d'environnement, clés Redis, files BullMQ, cookies, sessions, paquets et
// noms de fonctions gardent l'ancien nom (catégorie E de l'inventaire S14).

/** Nom de la marque : toujours en minuscules, avec le point. */
export const MARQUE = {
  /** Affichage courant : textes d'e-mail, titres, données structurées. */
  nom: 'jesuis.pro',
  /** Domaine public : URLs, liens, QR codes, origines de confiance. */
  domaine: 'jesuis.pro',
  /** Ligne de signature des e-mails : une ligne de nom, pas un slogan. */
  signature: 'jesuis.pro',
  /** Adresse d'expéditeur hors production ; la production lit `EMAIL_EXPEDITEUR` (nom figé par S14). */
  emailExpediteurDev: 'jesuis.pro <onboarding@resend.dev>',
  /** Identifiant d'expéditeur SMS : le fournisseur n'accepte pas le point (à confirmer). */
  smsExpediteur: 'jesuispro',
} as const
