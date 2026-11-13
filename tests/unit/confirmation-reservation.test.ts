import { describe, expect, it } from 'vitest'
import { RESERVATION_STATUTS } from '../../shared/agenda'
import { contenuConfirmation } from '../../app/utils/confirmation-reservation'

const CONTEXTE = { professionnel: 'Dr Cabrel Nguesso', username: 'dr-cabrel' }

describe('contenuConfirmation : un état par statut de réservation', () => {
  it('couvre chaque statut avec un titre, une phrase et un picto', () => {
    for (const statut of RESERVATION_STATUTS) {
      const contenu = contenuConfirmation(statut, CONTEXTE)
      expect(contenu.titre, statut).not.toBe('')
      expect(contenu.phrase, statut).not.toBe('')
      expect(contenu.picto, statut).toMatch(/^i-ph-/)
      expect(contenu.titrePage, statut).not.toBe('')
    }
  })

  it('en_attente : demande envoyée, ICS proposé', () => {
    const contenu = contenuConfirmation('en_attente', CONTEXTE)
    expect(contenu.titre).toBe('Votre demande est envoyée')
    expect(contenu.phrase).toBe('Dr Cabrel Nguesso vous confirmera ce rendez-vous par email.')
    expect(contenu.ics).toBe(true)
    expect(contenu.action).toBeNull()
  })

  it('confirmee : rendez-vous confirmé, ICS proposé', () => {
    const contenu = contenuConfirmation('confirmee', CONTEXTE)
    expect(contenu.titre).toBe('Votre rendez-vous est confirmé')
    expect(contenu.phrase).toContain('Dr Cabrel Nguesso')
    expect(contenu.phrase).toContain('email')
    expect(contenu.ics).toBe(true)
    expect(contenu.action).toBeNull()
  })

  it('annulee : pas d’ICS, reprise de rendez-vous vers l’agenda', () => {
    const contenu = contenuConfirmation('annulee', CONTEXTE)
    expect(contenu.titre).toBe('Ce rendez-vous a été annulé')
    expect(contenu.ics).toBe(false)
    expect(contenu.action).toEqual({ libelle: 'Reprendre rendez-vous', to: '/dr-cabrel/agenda' })
  })

  it('refusee : pas d’ICS, choix d’un autre créneau vers l’agenda', () => {
    const contenu = contenuConfirmation('refusee', CONTEXTE)
    expect(contenu.titre).toBe('Cette demande n’a pas été acceptée')
    expect(contenu.ics).toBe(false)
    expect(contenu.action).toEqual({ libelle: 'Choisir un autre créneau', to: '/dr-cabrel/agenda' })
  })

  it('terminee : pas d’ICS, aucune action de reprise', () => {
    const contenu = contenuConfirmation('terminee', CONTEXTE)
    expect(contenu.titre).toBe('Ce rendez-vous est passé')
    expect(contenu.ics).toBe(false)
    expect(contenu.action).toBeNull()
  })

  it('n’emploie jamais les mots interdits côté visiteur', () => {
    for (const statut of RESERVATION_STATUTS) {
      const { titre, phrase } = contenuConfirmation(statut, CONTEXTE)
      expect(`${titre} ${phrase}`).not.toMatch(/\b(espace|bloc|module|widget|section)\b/i)
    }
  })
})
