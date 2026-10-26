import { eq } from 'drizzle-orm'
import { db } from '../utils/db'
import { realisations, services, users, vitrines } from '../../shared/db/schema'

// S5 — données de démonstration (PROJECT_CONTEXT.md §15).
// Profil : Dr Cabrel Nguesso, cardiologue interventionnel, Douala, XAF,
// username `dr-cabrel`, palette Terracotta.
// Témoignages et téléphone : laissés vides (espaces réservés, §15).
// Les durées et montants non précisés par §15 sont des VALEURS DE TRAVAIL,
// utilisées uniquement pour les tests — à confirmer avant toute mise en ligne.

const ID_UTILISATEUR = 'seed-dr-cabrel'
const ID_VITRINE = 'seed-vitrine-dr-cabrel'
const EMAIL_DEMO = 'cabrel@brandself.test'

const servicesDemo = [
  {
    id: 'seed-svc-consultation',
    slug: 'consultation-de-cardiologie',
    titre: 'Consultation de cardiologie',
    description: 'Première consultation, examen clinique et lecture de vos examens.',
    type: 'rdv',
    dureeMin: 45,
    tarif: 'payant',
    prixMontant: 15_000,
    prixDevise: 'XAF',
    ordre: 1,
    enVedette: true,
  },
  {
    id: 'seed-svc-bilan',
    slug: 'bilan-cardiovasculaire-complet',
    titre: 'Bilan cardiovasculaire complet',
    description: 'Examen clinique, électrocardiogramme et échographie cardiaque.',
    type: 'rdv',
    dureeMin: 60,
    tarif: 'payant',
    prixMontant: 35_000,
    prixDevise: 'XAF',
    ordre: 2,
    enVedette: false,
  },
  {
    id: 'seed-svc-suivi',
    slug: 'suivi-apres-infarctus',
    titre: 'Suivi après infarctus',
    description: 'Accompagnement en 6 séances de 30 minutes après un infarctus.',
    type: 'accompagnement',
    nbSeances: 6,
    rythme: 'Hebdomadaire',
    dureeMin: 30,
    tarif: 'payant',
    prixMontant: 60_000,
    prixDevise: 'XAF',
    ordre: 3,
    enVedette: false,
  },
  {
    id: 'seed-svc-echo',
    slug: 'echographie-cardiaque',
    titre: 'Échographie cardiaque',
    description: 'Échographie cardiaque avec compte rendu remis le jour même.',
    type: 'rdv',
    dureeMin: 30,
    tarif: 'payant',
    prixMontant: 25_000,
    prixDevise: 'XAF',
    ordre: 4,
    enVedette: false,
  },
  {
    id: 'seed-svc-teleconsultation',
    slug: 'teleconsultation',
    titre: 'Téléconsultation',
    description: 'Consultation en visioconférence, sans déplacement.',
    type: 'rdv',
    dureeMin: 30,
    tarif: 'gratuit',
    prixMontant: null,
    prixDevise: null,
    ordre: 5,
    enVedette: false,
  },
  {
    id: 'seed-svc-second-avis',
    slug: 'second-avis',
    titre: 'Second avis',
    description: "Deuxième lecture de votre dossier sur pièces, avec compte rendu écrit.",
    type: 'devis',
    dureeMin: 45,
    tarif: 'devis',
    prixMontant: null,
    prixDevise: null,
    ordre: 6,
    enVedette: false,
  },
] as const

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
    titre: 'Dr Cabrel Nguesso',
    prenom: 'Cabrel',
    nom: 'Nguesso',
    metier: 'Cardiologue interventionnel',
    ville: 'Douala',
    pays: 'Cameroun',
    accroche: 'Cardiologue interventionnel à Douala, rendez-vous en ligne.',
    bio: "J'accompagne mes patients du diagnostic au suivi, en cabinet et à l'hôpital.",
    emailContact: EMAIL_DEMO,
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

  for (const service of servicesDemo) {
    const ligne = { ...service, vitrineId: ID_VITRINE, actif: true }
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
