import { describe, expect, it } from 'vitest'
import {
  DELAI_REPORT_JOURS,
  ETAT_INITIAL,
  avecAffichage,
  avecPlusTard,
  avecRefus,
  avecVisite,
  cheminAutorise,
  cheminPwa,
  libelleAppareilInstallation,
  lireEtat,
  peutAfficher,
  typeAppareil,
} from '../../app/utils/pwa-install'
import type { ContexteAffichage, EtatInstallation } from '../../app/utils/pwa-install'

const MAINTENANT = 1_800_000_000_000
const JOUR = 24 * 60 * 60 * 1000

const contexte = (surcharge: Partial<ContexteAffichage> = {}): ContexteAffichage => ({
  chemin: '/studio/services',
  maintenant: MAINTENANT,
  dejaInstalle: false,
  installable: true,
  saisieEnCours: false,
  messageOuvert: false,
  dejaProposeSession: false,
  ...surcharge,
})

const etat = (surcharge: Partial<EtatInstallation> = {}): EtatInstallation => ({ ...ETAT_INITIAL, visites: 2, ...surcharge })

describe('fenêtre d’installation : quand l’afficher', () => {
  it('1re visite : rien', () => {
    expect(peutAfficher(avecVisite(ETAT_INITIAL), contexte())).toBe(false)
  })

  it('2e visite : affichage', () => {
    expect(peutAfficher(avecVisite(avecVisite(ETAT_INITIAL)), contexte())).toBe(true)
  })

  it('mêmes limites sur iOS : 1re visite = rien, même installable par instructions manuelles', () => {
    expect(peutAfficher(avecVisite(ETAT_INITIAL), contexte({ installable: true }))).toBe(false)
  })

  it('Échap / voile / croix = « Plus tard » : report de 30 jours, pas un refus', () => {
    const apres = avecPlusTard(etat(), MAINTENANT)
    expect(apres.reportJusqua).toBe(MAINTENANT + DELAI_REPORT_JOURS * JOUR)
    expect(apres.refus).toBe(0)
    expect(peutAfficher(apres, contexte({ maintenant: MAINTENANT + 29 * JOUR }))).toBe(false)
    expect(peutAfficher(apres, contexte({ maintenant: MAINTENANT + 31 * JOUR }))).toBe(true)
  })

  it('deux refus : plus jamais, même après 30 jours', () => {
    const unRefus = avecRefus(etat(), MAINTENANT)
    expect(unRefus.refus).toBe(1)
    expect(peutAfficher(unRefus, contexte({ maintenant: MAINTENANT + 31 * JOUR }))).toBe(true)
    const deuxRefus = avecRefus(unRefus, MAINTENANT + 31 * JOUR)
    expect(peutAfficher(deuxRefus, contexte({ maintenant: MAINTENANT + 400 * JOUR }))).toBe(false)
  })

  it('dernierAffichage posé à l’affichage : pas de retour avant 30 jours, même sans clic', () => {
    const affiche = avecAffichage(etat(), MAINTENANT)
    expect(affiche.dernierAffichage).toBe(MAINTENANT)
    expect(peutAfficher(affiche, contexte({ maintenant: MAINTENANT + 10 * JOUR }))).toBe(false)
    expect(peutAfficher(affiche, contexte({ maintenant: MAINTENANT + 30 * JOUR }))).toBe(true)
  })

  it.each(['/connexion', '/connexion/code', '/studio/assistants/autorisation'])('route %s : rien', (chemin) => {
    expect(peutAfficher(etat(), contexte({ chemin }))).toBe(false)
  })

  it('cheminPwa : accueil, tarifs, studio et page d’arrivée /studio (visite comptée, service worker) ; jamais une vitrine, l’administration ni /connexion', () => {
    for (const chemin of ['/', '/tarifs', '/studio', '/studio/profil']) expect(cheminPwa(chemin), chemin).toBe(true)
    for (const chemin of ['/dr-cabrel', '/dr-cabrel/services', '/connexion', '/connexion/code', '/admin', '/onboarding']) expect(cheminPwa(chemin), chemin).toBe(false)
    // L'invite elle-même n'est pas proposée sur /studio seul (cheminAutorise inchangé).
    expect(cheminAutorise('/studio')).toBe(false)
  })

  it('pages publiques d’une vitrine : rien ; accueil, tarifs et studio : autorisés', () => {
    expect(cheminAutorise('/dr-cabrel')).toBe(false)
    expect(cheminAutorise('/')).toBe(true)
    expect(cheminAutorise('/tarifs')).toBe(true)
    expect(cheminAutorise('/studio/profil')).toBe(true)
    expect(cheminAutorise('/studio/assistants')).toBe(true)
  })

  it('pendant une saisie : rien', () => {
    expect(peutAfficher(etat(), contexte({ saisieEnCours: true }))).toBe(false)
  })

  it('si un autre message ou une modale est ouvert : rien', () => {
    expect(peutAfficher(etat(), contexte({ messageOuvert: true }))).toBe(false)
  })

  it('déjà installée, non installable ou déjà proposée dans la session : rien', () => {
    expect(peutAfficher(etat(), contexte({ dejaInstalle: true }))).toBe(false)
    expect(peutAfficher(etat(), contexte({ installable: false }))).toBe(false)
    expect(peutAfficher(etat(), contexte({ dejaProposeSession: true }))).toBe(false)
  })
})

describe('fenêtre d’installation : stockage', () => {
  it('valeur absente, corrompue ou d’un ancien format : état initial sans lever', () => {
    expect(lireEtat(null)).toEqual(ETAT_INITIAL)
    expect(lireEtat('{pas du json')).toEqual(ETAT_INITIAL)
    expect(lireEtat('42')).toEqual(ETAT_INITIAL)
    expect(lireEtat(JSON.stringify({ refusals: 2, lastPrompt: 5 }))).toEqual(ETAT_INITIAL)
  })

  it('relit ce qui a été écrit, et rejette les types invalides', () => {
    const ecrit = avecRefus(avecAffichage(avecVisite(ETAT_INITIAL), 10), 20)
    expect(lireEtat(JSON.stringify(ecrit))).toEqual(ecrit)
    expect(lireEtat(JSON.stringify({ visites: 'x', refus: -3, reportJusqua: 'a', dernierAffichage: null }))).toEqual(ETAT_INITIAL)
  })
})

describe('fenêtre d’installation : appareil et texte', () => {
  it('détecte l’appareil sans tenir compte de la casse', () => {
    expect(typeAppareil('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari')).toBe('mobile')
    expect(typeAppareil('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537')).toBe('mobile')
    expect(typeAppareil('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari')).toBe('tablette')
    expect(typeAppareil('Mozilla/5.0 (Linux; Android 14; SM-X900) Chrome/120 Safari/537')).toBe('tablette')
    expect(typeAppareil('Mozilla/5.0 (X11; Linux x86_64) Chrome/120 Safari/537')).toBe('ordinateur')
    expect(typeAppareil('')).toBe('inconnu')
  })

  it('texte adapté à l’appareil', () => {
    expect(libelleAppareilInstallation('mobile')).toBe('sur votre téléphone')
    expect(libelleAppareilInstallation('ordinateur')).toBe('sur cet ordinateur')
    expect(libelleAppareilInstallation('tablette')).toBe('sur votre tablette')
  })
})
