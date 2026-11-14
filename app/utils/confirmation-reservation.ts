import type { ReservationStatut } from '#shared/agenda'

// Page de confirmation d'une réservation : un état par statut, décrit une seule fois (pur, testable).

export interface ContexteConfirmation {
  professionnel: string
  username: string
}

export interface ContenuConfirmation {
  titre: string
  /** Titre de l'onglet (identique au titre visible). */
  titrePage: string
  /** Phrase d'accompagnement ; absente quand le titre suffit. */
  phrase: string | null
  picto: string
  /** Propose « Ajouter à mon agenda » (fichier ICS). */
  ics: boolean
  /** Lien principal de reprise, quand le visiteur peut agir. */
  action: { libelle: string, to: string } | null
}

export function contenuConfirmation(statut: ReservationStatut, contexte: ContexteConfirmation): ContenuConfirmation {
  const agenda = `/${contexte.username}/agenda`
  const contenus = {
    en_attente: {
      titre: 'Votre demande est envoyée',
      phrase: `${contexte.professionnel} vous confirmera ce rendez-vous par email.`,
      picto: 'i-ph-check',
      ics: true,
      action: null,
    },
    confirmee: {
      titre: 'Votre rendez-vous est confirmé',
      phrase: `${contexte.professionnel} a confirmé ce rendez-vous. Un email vous a été envoyé.`,
      picto: 'i-ph-check',
      ics: true,
      action: null,
    },
    annulee: {
      titre: 'Ce rendez-vous a été annulé',
      phrase: 'Cette réservation n’est plus valable.',
      picto: 'i-ph-x',
      ics: false,
      action: { libelle: 'Reprendre rendez-vous', to: agenda },
    },
    refusee: {
      titre: 'Cette demande n’a pas été acceptée',
      phrase: `${contexte.professionnel} ne peut pas vous recevoir sur ce créneau.`,
      picto: 'i-ph-x',
      ics: false,
      action: { libelle: 'Choisir un autre créneau', to: agenda },
    },
    terminee: {
      titre: 'Ce rendez-vous est passé',
      phrase: null,
      picto: 'i-ph-clock',
      ics: false,
      action: null,
    },
  } satisfies Record<ReservationStatut, Omit<ContenuConfirmation, 'titrePage'>>

  const contenu = contenus[statut]
  return { ...contenu, titrePage: contenu.titre }
}
