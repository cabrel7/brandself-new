import { createHash, randomUUID } from 'node:crypto'
import { and, asc, eq, notInArray } from 'drizzle-orm'
import sharp from 'sharp'
import { db } from '../utils/db'
import { deleteMediaIfUnreferenced, uploadMedia } from '../services/medias'
import {
  disponibilites,
  liens,
  medias,
  messages,
  promptsIa,
  realisationImages,
  realisations,
  reservations,
  services,
  temoignages,
  users,
  vitrines,
} from '../../shared/db/schema'
import { IA_TYPES } from '../../shared/ia'
import { GALERIE_MAX } from '../../shared/realisations'

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

async function creerPhotoDemo(fond: string = PHOTO_DEMO.fond): Promise<Buffer> {
  return sharp({
    create: { width: PHOTO_DEMO.largeur, height: PHOTO_DEMO.hauteur, channels: 3, background: fond },
  })
    .png()
    .toBuffer()
}

// Les 3 réalisations de §15 (docs/specs/S4-realisations.md §3, décision #64). Ids = UUID fixes : le seed
// reste idempotent et les routes du studio (`[id]` validé en uuid) peuvent modifier les réalisations de démo.
// Vedettes : Unité et Campagne (« 2 en vedette sur 3 », comme la maquette). `role` et `lien` restent NULL :
// §15 interdit d'inventer un rôle ou une URL. La description de la 1re vient de la maquette ; celles des 2
// autres sont des phrases neutres PROVISOIRES (sans chiffre), à faire fournir par Cabrel avant toute mise en ligne.
// `galerie` = nombre d'images de galerie générées (le plafond est GALERIE_MAX, garanti aussi par la base).
interface RealisationDemo {
  id: string
  slug: string
  titre: string
  description: string
  annee: number
  lieu: string
  ordre: number
  enVedette: boolean
  galerie: number
}

const realisationsDemo: readonly RealisationDemo[] = [
  {
    id: '8b3e5f20-4c6a-4e79-a852-1d0f7b4c9a01',
    slug: 'unite-de-catheterisme-chu-de-douala',
    titre: 'Unité de cathétérisme, CHU de Douala',
    description: "Mise en place et coordination d'une unité dédiée aux actes de cardiologie interventionnelle.",
    annee: 2025,
    lieu: 'CHU de Douala',
    ordre: 0,
    enVedette: true,
    galerie: 4,
  },
  {
    id: '8b3e5f20-4c6a-4e79-a852-1d0f7b4c9a02',
    slug: 'campagne-de-depistage-de-l-hypertension',
    titre: "Campagne de dépistage de l'hypertension",
    description: 'Campagne de dépistage ouverte à la population de Douala.',
    annee: 2024,
    lieu: 'Douala',
    ordre: 1,
    enVedette: true,
    galerie: 0,
  },
  {
    id: '8b3e5f20-4c6a-4e79-a852-1d0f7b4c9a03',
    slug: 'programme-de-readaptation-cardiaque',
    titre: 'Programme de réadaptation cardiaque',
    description: 'Programme de réadaptation pour les patients après un infarctus.',
    annee: 2022,
    lieu: 'Douala',
    ordre: 2,
    enVedette: false,
    galerie: 0,
  },
]

interface TemoignageDemo {
  id: string
  slug: string
  auteur: string
  fonction: string | null
  texte: string
  ordre: number
  enVedette: boolean
}

// §15 : témoignages laissés en espaces réservés tant que Cabrel ne les fournit pas. Aucun texte
// plausible n'est inventé (évite de prêter des propos à un patient qui n'a pas donné son accord).
const temoignagesDemo: readonly TemoignageDemo[] = [
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789011',
    slug: 'temoignage-espace-reserve-1',
    auteur: 'Un patient',
    fonction: null,
    texte: '[Témoignage d\'un patient]',
    ordre: 0,
    enVedette: true,
  },
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789012',
    slug: 'temoignage-espace-reserve-2',
    auteur: 'Un patient',
    fonction: null,
    texte: '[Témoignage d\'un patient]',
    ordre: 1,
    enVedette: true,
  },
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789013',
    slug: 'temoignage-espace-reserve-3',
    auteur: 'Un patient',
    fonction: null,
    texte: '[Témoignage d\'un patient]',
    ordre: 2,
    enVedette: false,
  },
]

// S6 : 4 liens de démonstration (SPRINTS.md S6), dont un masqué — « 4 liens · 3 visibles ».
// Les numéros et adresses sont des VALEURS DE TRAVAIL : à remplacer avant toute mise en ligne.
// L'URL de chaque type est celle que construit le serveur (shared/liens.ts) : jamais de
// discordance entre le seed et la règle de construction.
interface LienDemo {
  id: string
  slug: string
  libelle: string
  url: string
  type: 'libre' | 'whatsapp' | 'reseau' | 'email'
  ordre: number
  actif: boolean
}

const liensDemo: readonly LienDemo[] = [
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789021',
    slug: 'ecrire-sur-whatsapp',
    libelle: 'Écrire sur WhatsApp',
    url: 'https://wa.me/237699000001',
    type: 'whatsapp',
    ordre: 0,
    actif: true,
  },
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789022',
    slug: 'mon-parcours-sur-linkedin',
    libelle: 'Mon parcours sur LinkedIn',
    url: 'https://www.linkedin.com/in/dr-cabrel-nguesso',
    type: 'reseau',
    ordre: 1,
    actif: true,
  },
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789023',
    slug: 'me-contacter-par-courriel',
    libelle: 'Me contacter par courriel',
    url: 'mailto:contact@dr-cabrel.test',
    type: 'email',
    ordre: 2,
    actif: true,
  },
  {
    id: 'f4a1b2c3-5678-90ab-cdef-123456789024',
    slug: 'site-de-l-hopital',
    libelle: 'Site de l’hôpital',
    url: 'https://hopital-central-douala.test',
    type: 'libre',
    ordre: 3,
    actif: false,
  },
]

const disponibilitesDemo = [
  { id: 'a7e1c210-1111-4111-8111-111111111111', jourSemaine: 1, debut: '09:00', fin: '12:00' },
  { id: 'a7e1c210-2222-4222-8222-222222222222', jourSemaine: 2, debut: '09:00', fin: '12:00' },
  { id: 'a7e1c210-3333-4333-8333-333333333333', jourSemaine: 3, debut: '09:00', fin: '12:00' },
  { id: 'a7e1c210-4444-4444-8444-444444444444', jourSemaine: 4, debut: '09:00', fin: '12:00' },
  { id: 'a7e1c210-5555-4555-8555-555555555555', jourSemaine: 5, debut: '09:00', fin: '12:00' },
] as const

const reservationsDemo = [
  {
    id: 'b8f2d320-1111-4111-8111-111111111111',
    serviceId: servicesDemo[0]!.id,
    nom: 'Visiteur de démonstration',
    email: 'visiteur-1@brandself.test',
    telephone: '+237699000001',
    note: 'Première consultation',
    debut: new Date('2026-11-03T08:00:00.000Z'),
    fin: new Date('2026-11-03T08:45:00.000Z'),
    statut: 'en_attente',
  },
  {
    id: 'b8f2d320-2222-4222-8222-222222222222',
    serviceId: servicesDemo[1]!.id,
    nom: 'Visiteur de démonstration',
    email: 'visiteur-2@brandself.test',
    telephone: '+237699000002',
    note: null,
    debut: new Date('2026-11-05T08:00:00.000Z'),
    fin: new Date('2026-11-05T09:00:00.000Z'),
    statut: 'confirmee',
  },
] as const

// S7-bis (CA27) : 3 messages de démonstration — 2 non lus (Marie Ndzi, Paul Essomba),
// 1 lu (Aïcha Bello). Les dates sont relatives au moment du seed (jours/heures avant
// maintenant) pour que « Aujourd'hui / Hier » reste vrai à chaque exécution.
// Le sujet et les bornes suivent shared/message.ts ; l'insertion est directe (comme les
// réservations) : aucun email outbox n'est déclenché par les données de démonstration.
interface MessageDemo {
  id: string
  nom: string
  email: string
  telephone: string | null
  sujet: 'question_avant_reservation' | 'demande_information' | 'suivi_reservation' | 'autre'
  message: string
  lu: boolean
  ilYaHeures: number
}

const messagesDemo: readonly MessageDemo[] = [
  {
    id: 'c9d3e430-1111-4111-8111-111111111111',
    nom: 'Marie Ndzi',
    email: 'marie.ndzi@brandself.test',
    telephone: '+237699000003',
    sujet: 'question_avant_reservation',
    message: 'Bonjour, le rendez-vous peut-il être décalé en fin de journée ? Je termine le travail à 17 h.',
    lu: false,
    ilYaHeures: 2,
  },
  {
    id: 'c9d3e430-2222-4222-8222-222222222222',
    nom: 'Paul Essomba',
    email: 'paul.essomba@brandself.test',
    telephone: null,
    sujet: 'suivi_reservation',
    message: 'Bonjour, je souhaiterais avancer mon suivi de la semaine prochaine à la semaine présente, si un créneau est libre.',
    lu: false,
    ilYaHeures: 26,
  },
  {
    id: 'c9d3e430-3333-4333-8333-333333333333',
    nom: 'Aïcha Bello',
    email: 'aicha.bello@brandself.test',
    telephone: '+237699000005',
    sujet: 'demande_information',
    message: 'Bonjour, vos consultations sont-elles accessibles sans ordonnance au préalable ?',
    lu: true,
    ilYaHeures: 52,
  },
] as const

// Teintes des images de galerie de démonstration (une par vignette, pour distinguer l'ordre).
const FONDS_GALERIE: readonly string[] = ['#e3c4b4', '#d9b9a6', '#cfae9a', '#c5a38f', '#bb9884', '#b18d79']
/**
 * Galerie de démonstration : remplacée seulement si elle ne compte pas déjà `attendu` lignes
 * (idempotent). Les anciennes images, une fois la galerie vidée, sont supprimées si plus rien ne les référence.
 */
async function assurerGalerieDemo(realisationId: string, attendu: number): Promise<void> {
  if (attendu > GALERIE_MAX) throw new Error(`La galerie de démonstration dépasse ${GALERIE_MAX} images.`)
  const lignes = await db
    .select({ mediaId: realisationImages.mediaId })
    .from(realisationImages)
    .where(eq(realisationImages.realisationId, realisationId))
    .orderBy(asc(realisationImages.ordre))
  if (lignes.length === attendu) return

  await db.delete(realisationImages).where(eq(realisationImages.realisationId, realisationId))
  for (const { mediaId } of lignes) {
    await deleteMediaIfUnreferenced(ID_UTILISATEUR, mediaId)
  }
  for (let ordre = 0; ordre < attendu; ordre++) {
    const media = await uploadMedia(ID_UTILISATEUR, await creerPhotoDemo(FONDS_GALERIE[ordre]))
    await db.insert(realisationImages).values({ id: randomUUID(), realisationId, mediaId: media.id, ordre })
  }
}

/**
 * S8 (spec §2.4) : les prompts IA v1 sont insérés par la migration 0018, seule source (elle arrive aussi en
 * production, ce que le seed ne fait pas). Le seed ne réinsère AUCUN texte : il vérifie seulement que chaque
 * type de IA_TYPES a une version active, et échoue sinon. Lecture seule, donc idempotent.
 */
async function assertActivePrompts(): Promise<void> {
  const actifs = await db.select({ type: promptsIa.type }).from(promptsIa).where(eq(promptsIa.actif, true))
  const presents = new Set(actifs.map((prompt) => prompt.type))
  const manquants = IA_TYPES.filter((type) => !presents.has(type))
  if (manquants.length > 0) {
    throw new Error(
      `Prompts IA actifs manquants : ${manquants.join(', ')}. Appliquez les migrations (pnpm db:migrate) : la 0018 les insère.`,
    )
  }
  console.info(`[seed] prompts IA actifs présents (${IA_TYPES.join(', ')})`)
}

async function main(): Promise<void> {
  await assertActivePrompts()

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

  for (const disponibilite of disponibilitesDemo) {
    const ligne = { ...disponibilite, vitrineId: ID_VITRINE }
    await db
      .insert(disponibilites)
      .values(ligne)
      .onConflictDoUpdate({ target: disponibilites.id, set: ligne })
  }
  console.info(`[seed] ${disponibilitesDemo.length} disponibilités à jour`)

  for (const reservation of reservationsDemo) {
    const ligne = {
      ...reservation,
      vitrineId: ID_VITRINE,
      paiementChoisi: 'sur_place',
      paiementStatut: 'non_requis',
      rappelEmail: false,
      confirmationTokenHash: createHash('sha256').update(`seed-${reservation.id}`).digest('hex'),
      confirmationExpireLe: new Date('2026-11-30T00:00:00.000Z'),
    }
    await db
      .insert(reservations)
      .values(ligne)
      .onConflictDoUpdate({ target: reservations.id, set: { ...ligne, updatedAt: new Date() } })
  }
  console.info(`[seed] ${reservationsDemo.length} réservations à jour`)

  // Les anciens messages de démonstration sont supprimés avant l'upsert : la vitrine de démo
  // ne garde que les messages ci-dessus (2 non lus, 1 lu).
  const idsMessagesDemo = messagesDemo.map((message) => message.id)
  const messagesSupprimes = await db
    .delete(messages)
    .where(and(eq(messages.vitrineId, ID_VITRINE), notInArray(messages.id, idsMessagesDemo)))
    .returning({ id: messages.id })
  console.info(`[seed] ${messagesSupprimes.length} ancien(s) message(s) de démonstration supprimé(s)`)

  for (const message of messagesDemo) {
    const creeLe = new Date(Date.now() - message.ilYaHeures * 3_600_000)
    const ligne = {
      id: message.id,
      vitrineId: ID_VITRINE,
      nom: message.nom,
      email: message.email,
      telephone: message.telephone,
      sujet: message.sujet,
      message: message.message,
      luLe: message.lu ? new Date(creeLe.getTime() + 3_600_000) : null,
      createdAt: creeLe,
    }
    await db
      .insert(messages)
      .values(ligne)
      .onConflictDoUpdate({ target: messages.id, set: { ...ligne, updatedAt: new Date() } })
  }
  console.info(`[seed] ${messagesDemo.length} messages à jour`)

  // Les anciennes réalisations de démonstration (ids `seed-real-*`, rôles inventés) sont supprimées avant
  // l'upsert : la vitrine de démo ne garde que la liste ci-dessus.
  const idsRealisationsDemo = realisationsDemo.map((realisation) => realisation.id)
  const realisationsSupprimees = await db
    .delete(realisations)
    .where(and(eq(realisations.vitrineId, ID_VITRINE), notInArray(realisations.id, idsRealisationsDemo)))
    .returning({ id: realisations.id })
  console.info(`[seed] ${realisationsSupprimees.length} ancienne(s) réalisation(s) de démonstration supprimée(s)`)

  for (const { galerie, ...realisation } of realisationsDemo) {
    // Idempotent : l'image principale déjà liée (et toujours présente) est réutilisée.
    const existante = await db.query.realisations.findFirst({ where: eq(realisations.id, realisation.id) })
    const mediaExistant = existante?.imageMediaId
      ? await db.query.medias.findFirst({ where: eq(medias.id, existante.imageMediaId) })
      : undefined
    const imageMediaId = mediaExistant?.id ?? (await uploadMedia(ID_UTILISATEUR, await creerPhotoDemo())).id
    const ligne = { ...realisation, imageMediaId, role: null, lien: null, vitrineId: ID_VITRINE, actif: true }
    await db
      .insert(realisations)
      .values(ligne)
      .onConflictDoUpdate({ target: realisations.id, set: { ...ligne, updatedAt: new Date() } })
    await assurerGalerieDemo(realisation.id, galerie)
  }
  console.info(`[seed] ${realisationsDemo.length} réalisations à jour`)

  // Les anciens témoignages de démonstration sont supprimés avant l'upsert : la vitrine de démo ne
  // garde que les espaces réservés ci-dessus.
  const idsTemoignagesDemo = temoignagesDemo.map((temoignage) => temoignage.id)
  const temoignagesSupprimes = await db
    .delete(temoignages)
    .where(and(eq(temoignages.vitrineId, ID_VITRINE), notInArray(temoignages.id, idsTemoignagesDemo)))
    .returning({ id: temoignages.id })
  console.info(`[seed] ${temoignagesSupprimes.length} ancien(s) témoignage(s) de démonstration supprimé(s)`)

  for (const temoignage of temoignagesDemo) {
    const ligne = { ...temoignage, vitrineId: ID_VITRINE, actif: true }
    await db
      .insert(temoignages)
      .values(ligne)
      .onConflictDoUpdate({ target: temoignages.id, set: { ...ligne, updatedAt: new Date() } })
  }
  console.info(`[seed] ${temoignagesDemo.length} témoignages à jour`)

  // Les anciens liens de démonstration sont supprimés avant l'upsert : la vitrine de démo
  // ne garde que les liens ci-dessus.
  const idsLiensDemo = liensDemo.map((lien) => lien.id)
  const liensSupprimes = await db
    .delete(liens)
    .where(and(eq(liens.vitrineId, ID_VITRINE), notInArray(liens.id, idsLiensDemo)))
    .returning({ id: liens.id })
  console.info(`[seed] ${liensSupprimes.length} ancien(s) lien(s) de démonstration supprimé(s)`)

  for (const lien of liensDemo) {
    const ligne = { ...lien, vitrineId: ID_VITRINE }
    await db
      .insert(liens)
      .values(ligne)
      .onConflictDoUpdate({ target: liens.id, set: { ...ligne, updatedAt: new Date() } })
  }
  console.info(`[seed] ${liensDemo.length} liens à jour`)
  console.info('[seed] connexion : /connexion → email ' + EMAIL_DEMO)
}

main()
  .then(() => process.exit(0))
  .catch((erreur: unknown) => {
    console.error('Seed en échec :', erreur)
    process.exit(1)
  })
