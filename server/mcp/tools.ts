// S16 : définitions des 9 outils MCP. Noms, descriptions et annotations en français.
// Chaque outil déclare ses portées requises et s'il accepte une clé d'idempotence.

import { z } from 'zod'
import type { OutilMcpDefinition, Scope } from './types'

export const OUTILS_MCP: readonly OutilMcpDefinition[] = [
  {
    nom: 'obtenir_vitrine',
    description: "État de la vitrine (publiée ou non), plan, nombre de services et de réalisations, prochaines étapes.",
    annotation: 'lecture seule',
    scopes: ['vitrine:lecture'],
    idempotence: false,
    schema: z.object({}).strict(),
  },
  {
    nom: 'lister_services',
    description: 'Liste tous les services de la vitrine, publiés ou brouillons.',
    annotation: 'lecture seule',
    scopes: ['vitrine:lecture'],
    idempotence: false,
    schema: z.object({}).strict(),
  },
  {
    nom: 'creer_service',
    description: 'Crée un service en brouillon (masqué, interrupteur « Visible » désactivé). Le service est créé par l’assistant : il apparaît dans le studio avec l’étiquette « Créé par l’assistant » et doit y être activé manuellement avant d’être visible sur la vitrine publique.',
    annotation: 'écriture',
    scopes: ['contenu:ecriture'],
    idempotence: true,
    schema: z.object({
      titre: z.string().trim().min(1, 'Le titre est requis.').max(80, 'Le titre est limité à 80 caractères.'),
      description: z.string().max(1000, 'La description est limitée à 1000 caractères.').optional().nullable(),
      type: z.enum(['rdv', 'accompagnement', 'atelier', 'devis'], 'Type de service inconnu.'),
      nbSeances: z.number().int().min(2).max(52).optional().nullable(),
      rythme: z.enum(['hebdomadaire', 'bimensuel', 'mensuel', 'libre'], 'Rythme inconnu.').optional().nullable(),
      dureeMin: z.number().int().min(5).max(1440, 'La durée maximale est de 1440 minutes.').optional().nullable(),
      tarif: z.enum(['gratuit', 'payant', 'devis'], 'Tarif inconnu.'),
      prixMontant: z.number().int().min(1).max(1000000000, 'Ce prix est trop élevé.').optional().nullable(),
      prixDevise: z.enum(['XAF', 'EUR', 'USD'], 'Devise inconnue.').optional().nullable(),
      paiementMode: z.enum(['en_ligne', 'sur_place', 'au_choix'], 'Mode de règlement inconnu.').optional().nullable(),
      paiementInstructions: z.string().max(500, 'Les instructions sont limitées à 500 caractères.').optional().nullable(),
      inclus: z.array(z.string().max(160, 'Chaque ligne est limitée à 160 caractères.')).max(12, 'Vous pouvez saisir 12 lignes au maximum.').optional(),
      reservable: z.boolean().optional(),
      enVedette: z.boolean().optional(),
      actif: z.boolean().optional(),
      cle_idempotence: z.string().min(1, 'La clé d idempotence est requise.').max(128, 'La clé d idempotence est limitée à 128 caractères.'),
    }).strict(),
  },
  {
    nom: 'modifier_service',
    description: "Modifie un service existant. Si le service est déjà visible sur la vitrine publique, l'argument confirmation_utilisateur doit être vrai : l'assistant doit d'abord demander confirmation à l'utilisateur dans la conversation. Les valeurs précédentes sont retournées et l'opération est journalisée.",
    annotation: 'écriture',
    scopes: ['contenu:ecriture'],
    idempotence: true,
    schema: z.object({
      id: z.string().uuid('Identifiant de service invalide.'),
      titre: z.string().trim().min(1).max(80).optional(),
      description: z.string().max(1000).optional().nullable(),
      type: z.enum(['rdv', 'accompagnement', 'atelier', 'devis']).optional(),
      nbSeances: z.number().int().min(2).max(52).optional().nullable(),
      rythme: z.enum(['hebdomadaire', 'bimensuel', 'mensuel', 'libre']).optional().nullable(),
      dureeMin: z.number().int().min(5).max(1440).optional().nullable(),
      tarif: z.enum(['gratuit', 'payant', 'devis']).optional(),
      prixMontant: z.number().int().min(1).max(1000000000).optional().nullable(),
      prixDevise: z.enum(['XAF', 'EUR', 'USD']).optional().nullable(),
      paiementMode: z.enum(['en_ligne', 'sur_place', 'au_choix']).optional().nullable(),
      paiementInstructions: z.string().max(500).optional().nullable(),
      inclus: z.array(z.string().max(160)).max(12).optional(),
      reservable: z.boolean().optional(),
      enVedette: z.boolean().optional(),
      actif: z.boolean().optional(),
      confirmation_utilisateur: z.boolean().default(false),
      cle_idempotence: z.string().min(1).max(128).optional(),
    }).strict(),
  },
  {
    nom: 'lister_realisations',
    description: 'Liste toutes les réalisations de la vitrine, publiées ou brouillons.',
    annotation: 'lecture seule',
    scopes: ['vitrine:lecture'],
    idempotence: false,
    schema: z.object({}).strict(),
  },
  {
    nom: 'creer_realisation',
    description: 'Crée une réalisation en brouillon (masquée). Une réalisation sans image principale est créée masquée et ne peut pas être activée tant que l image principale n est pas ajoutée dans le studio. Elle est marquée « Créé par l’assistant » et doit y être relue et activée manuellement.',
    annotation: 'écriture',
    scopes: ['contenu:ecriture'],
    idempotence: true,
    schema: z.object({
      titre: z.string().trim().min(1, 'Le titre est requis.').max(100, 'Le titre est limité à 100 caractères.'),
      description: z.string().max(2000, 'La description est limitée à 2000 caractères.').optional().nullable(),
      imageMediaId: z.string().uuid('Identifiant d image invalide.').optional().nullable(),
      galerie: z.array(z.string().uuid('Identifiant d image invalide.')).max(6, 'La galerie compte 6 images au maximum.').optional(),
      annee: z.number().int().min(1900).max(2100, 'L année doit être comprise entre 1900 et 2100.').optional().nullable(),
      lieu: z.string().max(100, 'Le lieu est limité à 100 caractères.').optional().nullable(),
      role: z.string().max(100, 'Le rôle est limité à 100 caractères.').optional().nullable(),
      lien: z.string().url('Saisissez une adresse web valide.').max(500, 'Le lien est limité à 500 caractères.').optional().nullable(),
      enVedette: z.boolean().optional(),
      actif: z.boolean().optional(),
      cle_idempotence: z.string().min(1).max(128, 'La clé d idempotence est limitée à 128 caractères.'),
    }).strict(),
  },
  {
    nom: 'modifier_realisation',
    description: "Modifie une réalisation existante. Si la réalisation est déjà visible sur la vitrine publique, l'argument confirmation_utilisateur doit être vrai : l'assistant doit d'abord demander confirmation à l'utilisateur dans la conversation. Les valeurs précédentes sont retournées et l'opération est journalisée.",
    annotation: 'écriture',
    scopes: ['contenu:ecriture'],
    idempotence: true,
    schema: z.object({
      id: z.string().uuid('Identifiant de réalisation invalide.'),
      titre: z.string().trim().min(1).max(100).optional(),
      description: z.string().max(2000).optional().nullable(),
      imageMediaId: z.string().uuid('Identifiant d image invalide.').optional().nullable(),
      galerie: z.array(z.string().uuid('Identifiant d image invalide.')).max(6).optional(),
      annee: z.number().int().min(1900).max(2100).optional().nullable(),
      lieu: z.string().max(100).optional().nullable(),
      role: z.string().max(100).optional().nullable(),
      lien: z.string().url('Saisissez une adresse web valide.').max(500).optional().nullable(),
      enVedette: z.boolean().optional(),
      actif: z.boolean().optional(),
      confirmation_utilisateur: z.boolean().default(false),
      cle_idempotence: z.string().min(1).max(128).optional(),
    }).strict(),
  },
  {
    nom: 'lister_reservations',
    description: "Liste les réservations de la vitrine : date, heure, service, statut, prénom et initiale du nom, mode de règlement. L'email, le téléphone et le motif ne sont inclus que si le réglage « Autoriser mon assistant à lire le détail des réservations et des messages » est activé dans Compte → Assistants (désactivé par défaut).",
    annotation: 'lecture seule',
    scopes: ['reservations:lecture'],
    idempotence: false,
    schema: z.object({}).strict(),
  },
  {
    nom: 'lister_messages',
    description: "Liste les messages de la vitrine : date, prénom et initiale, sujet, lu ou non lu. Le texte du message n'est pas inclus sauf si le réglage « Autoriser mon assistant à lire le détail des réservations et des messages » est activé dans Compte → Assistants (désactivé par défaut).",
    annotation: 'lecture seule',
    scopes: ['messages:lecture'],
    idempotence: false,
    schema: z.object({}).strict(),
  },
] as const

export type NomOutilMcp = (typeof OUTILS_MCP)[number]['nom']

export function trouverOutil(nom: string): OutilMcpDefinition | undefined {
  return OUTILS_MCP.find((outil) => outil.nom === nom)
}

export function portéesDe(nom: string): readonly Scope[] {
  const outil = trouverOutil(nom)
  return outil ? outil.scopes : []
}

export function accepteIdempotence(nom: string): boolean {
  const outil = trouverOutil(nom)
  return Boolean(outil?.idempotence)
}

export function annotationDe(nom: string): 'lecture seule' | 'écriture' | undefined {
  const outil = trouverOutil(nom)
  return outil?.annotation
}
