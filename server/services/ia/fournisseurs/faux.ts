import { z } from 'zod'
import { redis } from '../../../utils/redis'
import { schemaEntreeAmelioration, schemaEntreeOnboarding, schemaEntreeSeo } from '../entrees'
import type { EntreeAmelioration, EntreeOnboarding } from '../entrees'
import { OUTIL_PROPOSER_SEO, OUTIL_PROPOSER_TEXTE, OUTIL_PROPOSER_VITRINE } from '../outils'
import { IaErreur } from '../types'
import type { IaProvider, IaReponse, IaRequete } from '../types'
import { ACCROCHE_MAX, BIO_MAX } from '../../../../shared/vitrine'

// S8 §4.2 : faux fournisseur DÉTERMINISTE, pour les tests et le développement (jamais en production :
// `resolveIaFournisseur` ne le choisit pas). Aucune donnée aléatoire : la sortie est calculée depuis les
// données reçues. Le mode (panne, lenteur, sortie invalide...) se règle dans Redis, clé `ia:faux:mode`.

export const FAUX_MODE_CLE = 'ia:faux:mode'
// `seo_invalide` : le bloc SEO est hors bornes (le reste est valide) ; `sans_accents` : tous les textes ont perdu
// leurs accents (décision #24).
export const FAUX_MODES = ['normal', 'panne', 'lent', 'invalide', 'invente', 'seo_invalide', 'sans_accents'] as const
export type FauxMode = (typeof FAUX_MODES)[number]

const FAUX_MODELE = 'faux'
const FAUX_TOKENS_ENTREE = 100
const FAUX_TOKENS_SORTIE = 300
const MARGE_LENTEUR_MS = 1
const BLOC_DONNEES = /<donnees>\s*([\s\S]*?)\s*<\/donnees>/

const schemaMode = z.enum(FAUX_MODES)

async function lireModeRedis(): Promise<FauxMode> {
  try {
    const brut = await redis.get(FAUX_MODE_CLE)
    const mode = schemaMode.safeParse(brut)
    return mode.success ? mode.data : 'normal'
  } catch {
    return 'normal'
  }
}

function attendreReel(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const minuteur = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(minuteur)
        resolve()
      },
      { once: true },
    )
  })
}

function extraireDonnees(message: string): unknown {
  const bloc = BLOC_DONNEES.exec(message)?.[1]
  if (!bloc) throw new IaErreur('fournisseur')
  try {
    return JSON.parse(bloc)
  } catch {
    throw new IaErreur('fournisseur')
  }
}

function enMinuscule(metier: string): string {
  const [premier = '', ...reste] = [...metier]
  const sigle = metier === metier.toLocaleUpperCase('fr') && metier.length > 1
  return sigle ? metier : `${premier.toLocaleLowerCase('fr')}${reste.join('')}`
}

const ACCROCHES_VALIDES = [
  'Un accompagnement attentif et clair pour avancer sereinement à chaque étape de votre parcours.',
  'Prenez rendez-vous simplement et avancez avec un professionnel à votre écoute.',
  'Une écoute sincère, des explications claires et un suivi pensé pour chaque personne.',
]

/** Cinq mots : sous le minimum de dix, la validation Zod les refuse. */
const ACCROCHES_INVALIDES = [
  'Un suivi clair et attentif.',
  'Une écoute sincère et calme.',
  'Un cadre simple et rassurant.',
]

const PARAGRAPHES_COMMUNS = [
  'Mon approche est simple. Nous prenons le temps d’échanger, de clarifier vos besoins et de choisir ensemble les prochaines étapes. Chaque rendez-vous se déroule dans un cadre calme, avec des explications claires et un suivi adapté à votre rythme.',
  'Lors d’un premier échange, vous pouvez poser toutes vos questions. Je vous explique comment je travaille, ce que vous pouvez attendre de nos rendez-vous et la manière de poursuivre si vous le souhaitez.',
]

const FAITS_INVENTES = 'Je compte 15 ans d’expérience. Je suis diplômé de l’Université de Yaoundé.'

function presentation(entree: EntreeOnboarding, mode: FauxMode): string {
  const introduction = `Je suis ${enMinuscule(entree.metier)} à ${entree.ville} (${entree.pays}). J’accueille chaque personne avec attention et je prends le temps de comprendre votre situation avant de vous proposer la suite.`
  const paragraphes = mode === 'invente' ? [FAITS_INVENTES, introduction] : [introduction]
  return [...paragraphes, ...PARAGRAPHES_COMMUNS].join('\n\n')
}

const MARQUES_ACCENTS = /\p{M}/gu

/** Texte sans accent (mode `sans_accents`) : la même phrase, comme un modèle qui oublierait les accents. */
function sansAccents(texte: string): string {
  return texte.normalize('NFD').replace(MARQUES_ACCENTS, '').replace(/œ/g, 'oe').replace(/Œ/g, 'OE')
}

/** Titre et description SEO valides : la ville dans les deux, aucun fait ajouté. Hors bornes en `seo_invalide`. */
function seoPour(metier: string, ville: string, mode: FauxMode): { titre: string, description: string } {
  if (mode === 'seo_invalide') return { titre: 'Trop court', description: 'Description trop courte.' }
  const lieu = ville === '' ? '' : ` à ${ville}`
  const seo = {
    titre: `${metier}${lieu}`,
    description: `Consultations de ${enMinuscule(metier)}${lieu} pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.`,
  }
  if (mode === 'invente') seo.description = `${metier}${lieu} avec 15 ans d’expérience au service de votre cœur et de votre santé.`
  return mode === 'sans_accents' ? { titre: sansAccents(seo.titre), description: sansAccents(seo.description) } : seo
}

function proposition(entree: EntreeOnboarding, mode: FauxMode): unknown {
  const sortie = propositionSansSeo(entree, mode)
  return { ...sortie, seo: seoPour(entree.metier, entree.ville, mode) }
}

function propositionSansSeo(entree: EntreeOnboarding, mode: FauxMode): Record<string, unknown> {
  const sortie = propositionNormale(entree, mode)
  if (mode !== 'sans_accents') return sortie
  return JSON.parse(sansAccents(JSON.stringify(sortie))) as Record<string, unknown>
}

function propositionNormale(entree: EntreeOnboarding, mode: FauxMode): Record<string, unknown> {
  return {
    accroches: mode === 'invalide' ? ACCROCHES_INVALIDES : ACCROCHES_VALIDES,
    presentation: presentation(entree, mode),
    services: [
      {
        titre: 'Premier rendez-vous',
        description: 'Un premier échange pour faire le point sur votre situation et définir ensemble la suite à donner.',
        type: 'rdv',
        dureeMin: 60,
        nbSeances: null,
      },
      {
        titre: 'Accompagnement personnalisé',
        description: 'Plusieurs séances pour avancer pas à pas, avec des objectifs clairs et un suivi régulier de votre progression.',
        type: 'accompagnement',
        dureeMin: 45,
        nbSeances: 6,
      },
      {
        titre: 'Prestation sur mesure',
        description: 'Une prestation adaptée à votre demande. Décrivez votre besoin et je vous réponds avec une proposition claire.',
        type: 'devis',
        dureeMin: null,
        nbSeances: null,
      },
    ],
  }
}

/** « Reformulation » minimale et reproductible : le point final est ajouté ou retiré, jamais un mot. */
function texteAmeliore(entree: EntreeAmelioration, mode: FauxMode): unknown {
  if (mode === 'invalide') return { texte: '' }
  const max = entree.champ === 'bio' ? BIO_MAX : ACCROCHE_MAX
  const base = entree.texte.trim()
  const propose = base.endsWith('.') ? base.slice(0, -1) : `${base}.`
  const texte = propose.length > max || propose === '' ? base : propose
  return { texte: mode === 'invente' ? `${texte} J’ai 15 ans d’expérience.` : texte }
}

export interface OptionsFauxProvider {
  lireMode?: () => Promise<FauxMode>
  /** Attente de la lenteur simulée (réelle par défaut, interrompue par le signal). */
  attendre?: (ms: number, signal: AbortSignal) => Promise<void>
}

export class FauxProvider implements IaProvider {
  readonly nom = 'faux'
  /** Nombre d'appels reçus (les tests vérifient qu'un repli n'appelle jamais le fournisseur). */
  appels = 0
  private readonly lireMode: () => Promise<FauxMode>
  private readonly attendre: (ms: number, signal: AbortSignal) => Promise<void>

  constructor(options: OptionsFauxProvider = {}) {
    this.lireMode = options.lireMode ?? lireModeRedis
    this.attendre = options.attendre ?? attendreReel
  }

  async generer(requete: IaRequete): Promise<IaReponse> {
    this.appels += 1
    const mode = await this.lireMode()
    if (mode === 'panne') throw new IaErreur('fournisseur')
    if (mode === 'lent') {
      await this.attendre(requete.delaiMs + MARGE_LENTEUR_MS, requete.signal)
      throw new IaErreur('delai')
    }
    const donnees = extraireDonnees(requete.message)
    let sortie: unknown
    if (requete.outil.nom === OUTIL_PROPOSER_VITRINE) {
      const entree = schemaEntreeOnboarding.safeParse(donnees)
      if (!entree.success) throw new IaErreur('fournisseur')
      sortie = proposition(entree.data, mode)
    } else if (requete.outil.nom === OUTIL_PROPOSER_SEO) {
      const entree = schemaEntreeSeo.safeParse(donnees)
      if (!entree.success) throw new IaErreur('fournisseur')
      sortie = seoPour(entree.data.metier, entree.data.ville, mode === 'invalide' ? 'seo_invalide' : mode)
    } else if (requete.outil.nom === OUTIL_PROPOSER_TEXTE) {
      const entree = schemaEntreeAmelioration.safeParse(donnees)
      if (!entree.success) throw new IaErreur('fournisseur')
      sortie = texteAmeliore(entree.data, mode)
    } else {
      throw new IaErreur('fournisseur')
    }
    return {
      donnees: sortie,
      tokensEntree: FAUX_TOKENS_ENTREE,
      tokensSortie: FAUX_TOKENS_SORTIE,
      modele: FAUX_MODELE,
    }
  }
}

export function creerFauxProvider(options: OptionsFauxProvider = {}): FauxProvider {
  return new FauxProvider(options)
}
