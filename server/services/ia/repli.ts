import type { z } from 'zod'
import type { AmeliorationDTO } from '../../../shared/dto/ia'
import { ACCROCHE_MAX } from '../../../shared/vitrine'
import type { schemaPropositionRepli } from '../../../shared/schemas/ia'
import type { EntreeAmelioration, EntreeOnboarding } from './entrees'

// S8 §4.7 et §0 #79 : repli déterministe. Ce ne sont PAS des prompts mais des textes écrits dans le code,
// qui ne citent que le métier, la ville et le pays de l'utilisateur : aucun fait inventé, aucun chiffre.
// Une vitrine ne reste jamais vide, même quand le fournisseur est absent, en panne ou piégé.

export type PropositionRepli = z.infer<typeof schemaPropositionRepli>

const MIN_LETTRES_SIGLE = 2
const PREMIER_MOT = /\s+/u

function premiereLettre(texte: string, majuscule: boolean): string {
  const [premier = '', ...reste] = [...texte]
  const lettre = majuscule ? premier.toLocaleUpperCase('fr') : premier.toLocaleLowerCase('fr')
  return `${lettre}${reste.join('')}`
}

/** Un sigle (« ORL ») garde ses majuscules ; un mot ordinaire passe en minuscule initiale. */
function estSigle(mot: string): boolean {
  const lettres = [...mot].filter((c) => c.toLocaleLowerCase('fr') !== c.toLocaleUpperCase('fr'))
  return lettres.length >= MIN_LETTRES_SIGLE && mot === mot.toLocaleUpperCase('fr')
}

function metierEnMinuscule(metier: string): string {
  const premierMot = metier.split(PREMIER_MOT)[0] ?? ''
  return estSigle(premierMot) ? metier : premiereLettre(metier, false)
}

const SUITE_ACCROCHE = 'à votre écoute pour vous accompagner pas à pas.'

/** Première accroche : avec la ville si elle tient dans la limite, sinon sans (métier + ville de 80 caractères). */
function premiereAccroche(metier: string, ville: string): string {
  const debut = premiereLettre(metier, true)
  const complete = `${debut} à ${ville}, ${SUITE_ACCROCHE}`
  return complete.length <= ACCROCHE_MAX ? complete : `${debut}, ${SUITE_ACCROCHE}`
}

export function repliOnboarding(entree: EntreeOnboarding): PropositionRepli {
  const { metier, ville, pays } = entree
  const presentation = [
    `Je suis ${metierEnMinuscule(metier)} à ${ville} (${pays}). J’accueille chaque personne avec attention et je prends le temps de comprendre votre situation avant de vous proposer la suite.`,
    'Sur cette vitrine, vous trouverez mes services. Vous pouvez me contacter ou réserver un rendez-vous en quelques instants : je vous réponds dès que possible.',
  ].join('\n\n')
  return {
    accroches: [
      premiereAccroche(metier, ville),
      `Un accompagnement attentif et clair, pensé pour vous, à ${ville}.`,
      'Prenez rendez-vous simplement et avancez avec un professionnel à votre écoute.',
    ],
    presentation,
    services: [
      {
        titre: 'Premier rendez-vous',
        description: 'Un premier échange pour faire le point sur votre situation et définir ensemble la suite.',
        type: 'rdv',
        dureeMin: 60,
        nbSeances: null,
      },
      {
        titre: 'Rendez-vous de suivi',
        description: 'Un rendez-vous pour faire le point sur votre avancée et ajuster ce qui doit l’être.',
        type: 'rdv',
        dureeMin: 45,
        nbSeances: null,
      },
      {
        titre: 'Prestation sur mesure',
        description: 'Une prestation adaptée à votre demande. Décrivez votre besoin, je vous réponds avec une proposition.',
        type: 'devis',
        dureeMin: null,
        nbSeances: null,
      },
    ],
  }
}

/** Amélioration indisponible : le texte est rendu tel quel, signalé comme non modifié. */
export function repliAmelioration(input: Pick<EntreeAmelioration, 'champ' | 'texte' | 'objectif'>): AmeliorationDTO {
  return { champ: input.champ, avant: input.texte, apres: input.texte, modifie: false }
}
