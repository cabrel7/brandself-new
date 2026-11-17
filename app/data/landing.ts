// Contenu de la page d'accueil marketing (`/`). Données typées : les composants n'écrivent aucun texte en dur.
// Tout ce qui est « exemple » (vitrine de démonstration, témoignages, métiers, villes) est étiqueté comme tel à l'écran.
// Les prix et les limites des plans ne sont PAS ici : ils viennent de `useTarifs()` (règle 4.11).

export interface LienNav {
  libelle: string
  ancre: string
}

export const NAV_LIENS: readonly LienNav[] = [
  { libelle: 'Fonctionnement', ancre: '#trouve' },
  { libelle: 'Votre vitrine', ancre: '#compris' },
  { libelle: 'Tarifs', ancre: '#tarifs' },
  { libelle: 'FAQ', ancre: '#faq' },
]

export const ROUTE_CONNEXION = '/connexion'
export const ROUTE_EXEMPLE = '/dr-cabrel'

/** Images de démonstration (photos provisoires de banque d'images, à remplacer ou à licencier avant la production). */
export const IMAGES = {
  medecin: { src: '/landing/doc.jpg', alt: 'Photo provisoire d’un médecin' },
  medecine: { src: '/landing/med.jpg', alt: 'Photo provisoire d’une médecin' },
  avocat: { src: '/landing/avo.jpg', alt: 'Photo provisoire d’un avocat' },
  coach: { src: '/landing/coa.jpg', alt: 'Photo provisoire d’un coach' },
  photographe: { src: '/landing/pho.jpg', alt: 'Photo provisoire d’un photographe' },
  stethoscope: { src: '/landing/ste.jpg', alt: 'Photo provisoire d’un stéthoscope' },
  vitrinePc: { src: '/landing/vit-d.jpg', alt: 'Vitrine de démonstration sur ordinateur' },
  google: { src: '/landing/google.svg', alt: 'Google' },
} as const

export interface ServiceDemo {
  titre: string
  description: string
  /** Durée ou nombre de séances : source unique, reprise par la carte du service et par l'agenda de démonstration. */
  duree: string
  prix: string
  /** « 45 min · 15 000 XAF » */
  meta: string
  image: keyof typeof IMAGES
}

export interface RealisationDemo {
  titre: string
  description: string
  etiquettes: readonly string[]
  images: readonly [keyof typeof IMAGES, keyof typeof IMAGES, keyof typeof IMAGES]
}

export interface TemoignageDemo {
  citation: string
  nom: string
  contexte: string
  initiale: string
}

export interface LienBioDemo {
  libelle: string
  ancre: string
  principal?: boolean
}

export const SERVICES_DEMO: readonly ServiceDemo[] = [
  { titre: 'Consultation de cardiologie', description: 'Examen clinique, électrocardiogramme et compte rendu remis le jour même.', duree: '45 min', prix: '15 000 XAF', meta: '45 min · 15 000 XAF', image: 'medecin' },
  { titre: 'Bilan cardiovasculaire complet', description: 'Échographie cardiaque, épreuve d’effort et prise de sang, résultats commentés.', duree: '60 min', prix: '35 000 XAF', meta: '60 min · 35 000 XAF', image: 'medecine' },
  { titre: 'Suivi après infarctus', description: 'Six séances sur trois mois : traitement, activité physique et alimentation.', duree: '6 séances', prix: '60 000 XAF', meta: '6 séances · 60 000 XAF', image: 'stethoscope' },
]

export const REALISATION_DEMO: RealisationDemo = {
  titre: 'Unité de cathétérisme, CHU de Douala',
  description: 'Mise en place d’une unité de cardiologie interventionnelle : choix du matériel, formation de l’équipe, premiers patients pris en charge en trois mois.',
  etiquettes: ['Chef de projet', 'Douala', '2023'],
  images: ['stethoscope', 'medecin', 'medecine'],
}

export const TEMOIGNAGES_DEMO: readonly TemoignageDemo[] = [
  { citation: 'J’ai enfin compris mon traitement. Le docteur a pris le temps de tout m’expliquer, et j’ai réservé en deux minutes depuis mon téléphone.', nom: 'Armand T.', contexte: 'Patient suivi depuis 2022', initiale: 'A' },
  { citation: 'Un confrère d’une grande rigueur : des comptes rendus clairs, qui arrivent vite.', nom: 'Dr Sandrine M.', contexte: 'Médecin généraliste', initiale: 'S' },
  { citation: 'Ponctuelle, à l’écoute, rassurante. Je recommande.', nom: 'Mireille K.', contexte: 'Patiente', initiale: 'M' },
]

export const LIEN_BIO_DEMO = {
  nom: 'Dr Cabrel',
  precision: 'Cardiologue · Douala',
  liens: [
    { libelle: 'Prendre rendez-vous', ancre: '#contact', principal: true },
    { libelle: 'Voir mes services', ancre: '#compris' },
    { libelle: 'Écrire sur WhatsApp', ancre: '#compris' },
    { libelle: 'Mon profil LinkedIn', ancre: '#compris' },
    { libelle: 'Envoyer un e-mail', ancre: '#compris' },
  ] satisfies readonly LienBioDemo[],
} as const

export interface EtapeComprise {
  titre: string
  description: string
  points: readonly [string, string, string]
}

export const ETAPES_COMPRIS: readonly EtapeComprise[] = [
  {
    titre: 'Vos services',
    description: 'Chaque service a sa page : ce qu’il comprend, la durée, le prix. Le visiteur sait tout avant de réserver.',
    points: ['Une description claire et ce qui est inclus', 'Durée et tarif affichés', 'Un bouton pour réserver, sur chaque service'],
  },
  {
    titre: 'Vos réalisations',
    description: 'Vos travaux en images, avec votre rôle, le lieu et l’année. On voit ce que vous avez fait, pas seulement ce que vous dites faire.',
    points: ['Plusieurs photos par réalisation', 'Votre rôle et le contexte', 'Les trois plus belles en tête de vitrine'],
  },
  {
    titre: 'Vos témoignages',
    description: 'La parole de ceux que vous avez accompagnés, avec leur prénom et leur situation. Vous choisissez ce qui s’affiche.',
    points: ['Une citation, un nom, un contexte', 'Vous en mettez en avant, vous en masquez', 'Seuls les témoignages actifs sont visibles'],
  },
  {
    titre: 'Votre lien en bio',
    description: 'Une seule adresse à coller dans Instagram, TikTok ou WhatsApp : votre rendez-vous, vos services et vos coordonnées, à portée de pouce.',
    points: ['Prendre rendez-vous en un geste', 'Vos réseaux et votre WhatsApp', 'Une adresse courte, facile à retenir'],
  },
]

export interface MetierDemo {
  metier: string
  ville: string
  phrase: string
  image: keyof typeof IMAGES
}

export const METIERS_DEMO: readonly MetierDemo[] = [
  { metier: 'Cardiologue', ville: 'Douala', phrase: 'Consultations, bilans, suivi : on réserve en ligne.', image: 'medecin' },
  { metier: 'Médecin', ville: 'Yaoundé', phrase: 'Horaires, tarifs et prise de rendez-vous au même endroit.', image: 'medecine' },
  { metier: 'Avocat', ville: 'Abidjan', phrase: 'Domaines d’intervention, honoraires, premier contact.', image: 'avocat' },
  { metier: 'Coach', ville: 'Dakar', phrase: 'Séances, ateliers et agenda partagé.', image: 'coach' },
  { metier: 'Photographe', ville: 'Libreville', phrase: 'Réalisations en grand, devis en un message.', image: 'photographe' },
]

export interface QuestionFaq {
  question: string
  reponse: string
}

export const FAQ: readonly QuestionFaq[] = [
  { question: 'Combien ça coûte ?', reponse: 'Gratuit pour commencer. Le plan payant lève les limites.' },
  { question: 'Faut-il un mot de passe ?', reponse: 'Non. Vous recevez un code par e-mail ou par téléphone.' },
  { question: 'Comment mes clients me trouvent-ils ?', reponse: 'Sur Google : chaque vitrine a son titre, sa description et son adresse.' },
  { question: 'Mes clients peuvent-ils réserver ?', reponse: 'Oui. Ils choisissent un service, un jour et une heure.' },
  { question: 'Puis-je choisir mon adresse ?', reponse: 'Oui, tant qu’elle est libre : jesuis.pro/votre-nom.' },
  { question: 'Et sur téléphone ?', reponse: 'Les vitrines sont pensées d’abord pour le téléphone.' },
]

/** Exemples d'adresses qui défilent dans le champ du hero (placeholder). */
export const ADRESSES_EXEMPLES: readonly string[] = ['dr-nom', 'maitre-nom', 'prenom-coach', 'studio-photo']
