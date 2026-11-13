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
  phrase: string
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
      phrase: `${contexte.professionnel} a confirmé ce rendez-vous : un email de confirmation vous a été envoyé.`,
      picto: 'i-ph-check',
      ics: true,
      action: null,
    },
    annulee: {
      titre: 'Ce rendez-vous a été annulé',
      phrase: 'Cette réservation n’est plus valable. Vous pouvez choisir un nouveau créneau.',
      picto: 'i-ph-x',
      ics: false,
      action: { libelle: 'Reprendre rendez-vous', to: agenda },
    },
    refusee: {
      titre: 'Cette demande n’a pas été acceptée',
      phrase: `${contexte.professionnel} ne peut pas vous recevoir sur ce créneau. Vous pouvez en choisir un autre.`,
      picto: 'i-ph-x',
      ics: false,
      action: { libelle: 'Choisir un autre créneau', to: agenda },
    },
    terminee: {
      titre: 'Ce rendez-vous est passé',
      phrase: 'Cette réservation est terminée.',
      picto: 'i-ph-clock',
      ics: false,
      action: null,
    },
  } satisfies Record<ReservationStatut, Omit<ContenuConfirmation, 'titrePage'>>

  const contenu = contenus[statut]
  return { ...contenu, titrePage: contenu.titre }
}
