export const TITRES = ['dr', 'pr', 'me', 'm', 'mme'] as const

export type Titre = (typeof TITRES)[number]

export const TITRE_LABELS: Record<Titre, string> = {
  dr: 'Dr',
  pr: 'Pr',
  me: 'Me',
  m: 'M.',
  mme: 'Mme',
}

export interface Pays {
  code: string
  label: string
}

export const PAYS: readonly Pays[] = [
  { code: 'CM', label: 'Cameroun' },
  { code: 'SN', label: 'Sénégal' },
  { code: 'CI', label: 'Côte d’Ivoire' },
  { code: 'GA', label: 'Gabon' },
  { code: 'CG', label: 'Congo' },
  { code: 'CD', label: 'République démocratique du Congo' },
  { code: 'BJ', label: 'Bénin' },
  { code: 'TG', label: 'Togo' },
  { code: 'BF', label: 'Burkina Faso' },
  { code: 'ML', label: 'Mali' },
  { code: 'NE', label: 'Niger' },
  { code: 'TD', label: 'Tchad' },
  { code: 'CF', label: 'République centrafricaine' },
  { code: 'GN', label: 'Guinée' },
  { code: 'MG', label: 'Madagascar' },
  { code: 'RW', label: 'Rwanda' },
  { code: 'BI', label: 'Burundi' },
  { code: 'DJ', label: 'Djibouti' },
  { code: 'KM', label: 'Comores' },
  { code: 'FR', label: 'France' },
  { code: 'BE', label: 'Belgique' },
  { code: 'CH', label: 'Suisse' },
  { code: 'CA', label: 'Canada' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'MA', label: 'Maroc' },
  { code: 'TN', label: 'Tunisie' },
  { code: 'DZ', label: 'Algérie' },
  { code: 'US', label: 'États-Unis' },
  { code: 'GB', label: 'Royaume-Uni' },
  { code: 'DE', label: 'Allemagne' },
]

export const PAYS_CODES = PAYS.map((p) => p.code) as [string, ...string[]]

export const PRENOM_MAX = 60
export const NOM_MAX = 60
export const METIER_MAX = 80
export const VILLE_MAX = 80
export const ACCROCHE_MAX = 160
export const BIO_MAX = 2000

export const PUBLICATION_REQUIRED_FIELDS = ['prenom', 'nom', 'metier', 'ville', 'pays'] as const

export type PublicationField = (typeof PUBLICATION_REQUIRED_FIELDS)[number]

export const NEXT_STEPS = ['photo', 'service', 'disponibilites', 'realisation', 'partager'] as const

export type NextStep = (typeof NEXT_STEPS)[number]

export function displayName(titre: Titre | null, prenom: string, nom: string): string {
  const prefix = titre ? TITRE_LABELS[titre] : ''
  return [prefix, prenom, nom]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ')
}
