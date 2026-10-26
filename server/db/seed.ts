import { and, eq, notInArray } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from '../utils/db'
import { uploadMedia } from '../services/medias'
import { medias, realisations, services, users, vitrines } from '../../shared/db/schema'

// S5 — données de démonstration (PROJECT_CONTEXT.md §15).
// Profil : Dr Cabrel Nguesso, cardiologue interventionnel, Douala, XAF,
// username `dr-cabrel`, palette Terracotta.
// Témoignages et téléphone : laissés vides (espaces réservés, §15).
// Les durées et montants non précisés par §15 sont des VALEURS DE TRAVAIL,
// utilisées uniquement pour les tests — à confirmer avant toute mise en ligne.

const ID_UTILISATEUR = 'seed-dr-cabrel'
const ID_VITRINE = 'seed-vitrine-dr-cabrel'
const EMAIL_DEMO = 'cabrel@brandself.test'

// Les 6 services de la maquette (docs/specs/S3-services.md §3). Ids = UUID fixes : le seed reste
// idempotent et les routes du studio (`[id]` validé en uuid) peuvent modifier les services de démo.
// Vedettes : Consultation, Bilan, Suivi (VEDETTE_MAX = 3). `photo` : image de démonstration générée.
// Prix : VALEURS DE TRAVAIL conservées telles quelles (décision #37) — §15 interdit les chiffres inventés,
// à faire confirmer par Cabrel avant toute mise en ligne.
interface ServiceDemo {
  id: string
  slug: string
  titre: string
  description: string
  type: 'rdv' | 'accompagnement' | 'devis'
  nbSeances: number | null
  rythme: 'hebdomadaire' | null
  dureeMin: number
  tarif: 'gratuit' | 'payant' | 'devis'
  prixMontant: number | null
  prixDevise: 'XAF' | null
  paiementMode: 'sur_place' | null
  inclus: string[]
  ordre: number
  enVedette: boolean
  photo: boolean
}

const servicesDemo: readonly ServiceDemo[] = [
  {
    id: '6f1c2a10-3b7e-4d58-9a41-0c5e8b2d7a01',
    slug: 'consultation-de-cardiologie',
    titre: 'Consultation de cardiologie',
    description:
      "Un temps d'écoute et d'examen pour comprendre votre situation, répondre à vos questions et vous orienter vers la meilleure prise en charge.",
    type: 'rdv',
    nbSeances: null,
    rythme: null,
    dureeMin: 45,
    tarif: 'payant',
    prixMontant: 15_000,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    inclus: [
      'Un entretien et un examen cardiologique',
      'Une explication claire de votre situation',
      'Des recommandations adaptées à votre quotidien',
    ],
    ordre: 0,
    enVedette: true,
    photo: true,
  },
  {
    id: '6f1c2a10-3b7e-4d58-9a41-0c5e8b2d7a02',
    slug: 'bilan-cardiovasculaire-complet',
    titre: 'Bilan cardiovasculaire complet',
    description: 'Un bilan structuré, des résultats expliqués clairement.',
    type: 'rdv',
    nbSeances: null,
    rythme: null,
    dureeMin: 60,
    tarif: 'payant',
    prixMontant: 35_000,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    inclus: [],
    ordre: 1,
    enVedette: true,
    photo: true,
  },
  {
    id: '6f1c2a10-3b7e-4d58-9a41-0c5e8b2d7a03',
    slug: 'suivi-apres-infarctus',
    titre: 'Suivi après infarctus',
    description:
      'Un accompagnement régulier pour reprendre confiance, comprendre votre traitement et retrouver une vie active, étape par étape.',
    type: 'accompagnement',
    nbSeances: 6,
    rythme: 'hebdomadaire',
    dureeMin: 30,
    tarif: 'payant',
    prixMontant: 60_000,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    inclus: [
      'Bilan de départ et définition de vos objectifs',
      "Reprise d'activité progressive",
      'Alimentation et hygiène de vie',
      'Gestion du stress et du sommeil',
      'Suivi des traitements',
      'Bilan final et plan pour la suite',
    ],
    ordre: 2,
    enVedette: true,
    photo: false,
  },
  {
    id: '6f1c2a10-3b7e-4d58-9a41-0c5e8b2d7a04',
    slug: 'echographie-cardiaque',
    titre: 'Échographie cardiaque',
    description: "Un examen d'imagerie réalisé et expliqué sur place.",
    type: 'rdv',
    nbSeances: null,
    rythme: null,
    dureeMin: 30,
    tarif: 'payant',
    prixMontant: 25_000,
    prixDevise: 'XAF',
    paiementMode: 'sur_place',
    inclus: [],
    ordre: 3,
    enVedette: false,
    photo: true,
  },
  {
    id: '6f1c2a10-3b7e-4d58-9a41-0c5e8b2d7a05',
    slug: 'teleconsultation',
    titre: 'Téléconsultation',
    description: 'Un premier avis à distance, où que vous soyez.',
    type: 'rdv',
    nbSeances: null,
    rythme: null,
    dureeMin: 20,
    tarif: 'gratuit',
    prixMontant: null,
    prixDevise: null,
    paiementMode: null,
    inclus: [],
    ordre: 4,
    enVedette: false,
    photo: false,
  },
  {
    id: '6f1c2a10-3b7e-4d58-9a41-0c5e8b2d7a06',
    slug: 'second-avis',
    titre: 'Second avis',
    description: 'Une relecture de votre dossier par un spécialiste.',
    type: 'devis',
    nbSeances: null,
    rythme: null,
    dureeMin: 40,
    tarif: 'devis',
    prixMontant: null,
    prixDevise: null,
    paiementMode: null,
    inclus: [],
    ordre: 5,
    enVedette: false,
    photo: false,
  },
]

// Photo de démonstration : aplat de couleur généré par sharp (aucun binaire commité), téléversé par
// le service médias comme n'importe quelle image (variantes WebP, ligne `medias`).
const PHOTO_DEMO = { largeur: 1600, hauteur: 1200, fond: '#ecd3c7' } as const

async function creerPhotoDemo(): Promise<Buffer> {
  return sharp({
    create: { width: PHOTO_DEMO.largeur, height: PHOTO_DEMO.hauteur, channels: 3, background: PHOTO_DEMO.fond },
  })
    .png()
    .toBuffer()
}

const realisationsDemo = [
  {
    id: 'seed-real-catheterisme',
    slug: 'unite-de-catheterisme',
    titre: 'Unité de cathétérisme',
    description: "Mise en place de l'unité de cathétérisme du CHU de Douala.",
    annee: 2025,
    lieu: 'CHU de Douala',
    role: 'Cardiologue interventionnel',
    ordre: 1,
    enVedette: true,
  },
  {
    id: 'seed-real-depistage',
    slug: 'campagne-de-depistage-de-l-hypertension',
    titre: "Campagne de dépistage de l'hypertension",
    description: 'Campagne de dépistage ouverte à la population de Douala.',
    annee: 2024,
    lieu: 'Douala',
    role: 'Coordinateur',
    ordre: 2,
    enVedette: false,
  },
  {
    id: 'seed-real-readaptation',
    slug: 'programme-de-readaptation-cardiaque',
    titre: 'Programme de réadaptation cardiaque',
    description: 'Programme de réadaptation pour les patients après un infarctus.',
    annee: 2022,
    lieu: 'Douala',
    role: 'Cardiologue',
    ordre: 3,
    enVedette: false,
  },
] as const

async function main(): Promise<void> {
  const utilisateurExistant = await db.query.users.findFirst({
    where: eq(users.id, ID_UTILISATEUR),
  })

  if (!utilisateurExistant) {
    await db.insert(users).values({
      id: ID_UTILISATEUR,
      name: 'Dr Cabrel Nguesso',
      email: EMAIL_DEMO,
      emailVerified: true,
      nom: 'Cabrel Nguesso',
      locale: 'fr',
      devise: 'XAF',
      fuseau: 'Africa/Douala',
    })
    console.info(`[seed] utilisateur ${EMAIL_DEMO} créé`)
  } else {
    console.info(`[seed] utilisateur ${EMAIL_DEMO} déjà présent`)
  }

  const vitrineExistante = await db.query.vitrines.findFirst({
    where: eq(vitrines.id, ID_VITRINE),
  })

  const vitrineDemo = {
    id: ID_VITRINE,
    userId: ID_UTILISATEUR,
    username: 'dr-cabrel',
    // titre = code ('dr'), pays = code ISO ('CM') : contraintes CHECK de la migration 0009.
    titre: 'dr',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    metier: 'Cardiologue interventionnel',
    ville: 'Douala',
    pays: 'CM',
    accroche: 'Cardiologue interventionnel à Douala, rendez-vous en ligne.',
    bio: "J'accompagne mes patients du diagnostic au suivi, en cabinet et à l'hôpital.",
    photoMediaId: null,
    emailContact: null,
    telephone: null,
    whatsapp: null,
    palette: 'terracotta',
    publieeLe: new Date(),
  } as const

  if (!vitrineExistante) {
    await db.insert(vitrines).values(vitrineDemo)
    console.info('[seed] vitrine dr-cabrel créée et publiée')
  } else {
    await db
      .update(vitrines)
      .set({ ...vitrineDemo, updatedAt: new Date() })
      .where(eq(vitrines.id, ID_VITRINE))
    console.info('[seed] vitrine dr-cabrel mise à jour')
  }

  // Les anciens services de démonstration (ids non UUID, slugs en collision avec l'unicité par vitrine)
  // sont supprimés avant l'insertion : la vitrine de démo ne garde que la liste ci-dessus.
  const idsDemo = servicesDemo.map((service) => service.id)
  const supprimes = await db
    .delete(services)
    .where(and(eq(services.vitrineId, ID_VITRINE), notInArray(services.id, idsDemo)))
    .returning({ id: services.id })
  console.info(`[seed] ${supprimes.length} ancien(s) service(s) de démonstration supprimé(s)`)

  for (const { photo, ...service } of servicesDemo) {
    // Idempotent : une image déjà liée au service (et toujours présente) est réutilisée.
    const existant = await db.query.services.findFirst({ where: eq(services.id, service.id) })
    let imageMediaId: string | null = null
    if (photo) {
      const mediaExistant = existant?.imageMediaId
        ? await db.query.medias.findFirst({ where: eq(medias.id, existant.imageMediaId) })
        : undefined
      imageMediaId = mediaExistant?.id ?? (await uploadMedia(ID_UTILISATEUR, await creerPhotoDemo())).id
    }
    const ligne = { ...service, imageMediaId, vitrineId: ID_VITRINE, reservable: true, actif: true }
    await db
      .insert(services)
      .values(ligne)
      .onConflictDoUpdate({ target: services.id, set: { ...ligne, updatedAt: new Date() } })
  }
  console.info(`[seed] ${servicesDemo.length} services à jour`)

  for (const realisation of realisationsDemo) {
    const ligne = { ...realisation, vitrineId: ID_VITRINE, actif: true }
    await db
      .insert(realisations)
      .values(ligne)
      .onConflictDoUpdate({ target: realisations.id, set: { ...ligne, updatedAt: new Date() } })
  }
  console.info(`[seed] ${realisationsDemo.length} réalisations à jour`)
  console.info('[seed] connexion : /connexion → email ' + EMAIL_DEMO)
}

main()
  .then(() => process.exit(0))
  .catch((erreur: unknown) => {
    console.error('Seed en échec :', erreur)
    process.exit(1)
  })
