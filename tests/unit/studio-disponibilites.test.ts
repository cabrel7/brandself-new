import { describe, expect, it } from 'vitest'
import {
  appliquerPlagesAuxJours,
  dateDuJourDansFuseau,
  decrirePlages,
  erreursIndisponibiliteDepuisApi,
  formaterDateLocale,
  formaterHeure,
  fusionnerIndisponibilites,
  jourModifie,
  joursPlageSaisie,
  libelleAvertissementReservations,
  libelleNombreJours,
  libelleResultatIndisponibilites,
  messagePlageMax,
  messageResultatIndisponibilites,
  nombreJoursPlage,
  nomLigneJour,
  plagesRestantesPourJour,
  remplacerPlagesDuJour,
  resumeJour,
  semaineType,
  separerIndisponibilites,
  validerDateIndisponibilite,
  validerPlageIndisponibilite,
  validerPlagesJour,
  type PlageAgendaEdition,
  type PlageSaisie,
} from '../../app/composables/useStudioDisponibilites'
import { DISPONIBILITES_MAX, INDISPONIBILITE_PLAGE_MAX_JOURS } from '../../shared/agenda'
import type { IndisponibiliteCreateDTO } from '../../shared/dto/agenda'

function plage(cle: string, jourSemaine: number, debut: string, fin: string, id: string | null = cle): PlageAgendaEdition {
  return { cle, id, jourSemaine, debut, fin }
}

function generateur(): () => string {
  let n = 0
  return () => `copie-${++n}`
}

describe('appliquerPlagesAuxJours', () => {
  const lundi = [plage('l1', 1, '08:00', '12:00'), plage('l2', 1, '14:00', '17:00')]

  it('reproduit les plages du jour source sur plusieurs jours cibles, y compris fermés', () => {
    const resultat = appliquerPlagesAuxJours(lundi, 1, [2, 4, 6], generateur())
    for (const jour of [2, 4, 6]) {
      const duJour = resultat.filter((p) => p.jourSemaine === jour)
      expect(duJour.map(({ debut, fin }) => [debut, fin])).toEqual([['08:00', '12:00'], ['14:00', '17:00']])
      expect(duJour.every((p) => p.id === null)).toBe(true)
    }
    expect(resultat.filter((p) => p.jourSemaine === 1)).toEqual(lundi)
  })

  it('remplace les plages existantes des jours cibles', () => {
    const existantes = [...lundi, plage('m1', 2, '10:00', '11:00'), plage('v1', 5, '09:00', '10:00')]
    const resultat = appliquerPlagesAuxJours(existantes, 1, [2], generateur())
    expect(resultat.find((p) => p.cle === 'm1')).toBeUndefined()
    expect(resultat.find((p) => p.cle === 'v1')).toBeDefined()
    expect(resultat.filter((p) => p.jourSemaine === 2)).toHaveLength(2)
  })

  it('ne touche pas les jours non ciblés (week-end compris)', () => {
    const autres = [plage('m1', 2, '10:00', '11:00'), plage('s1', 6, '09:00', '12:00'), plage('d1', 7, '10:00', '11:00')]
    const resultat = appliquerPlagesAuxJours([...lundi, ...autres], 1, [3], generateur())
    for (const jour of [2, 6, 7]) {
      expect(resultat.filter((p) => p.jourSemaine === jour)).toEqual(autres.filter((p) => p.jourSemaine === jour))
    }
  })

  it('ferme les jours cibles quand le jour source n’a aucune plage', () => {
    const existantes = [plage('m1', 2, '10:00', '11:00'), plage('s1', 6, '09:00', '12:00')]
    const resultat = appliquerPlagesAuxJours(existantes, 1, [2], generateur())
    expect(resultat).toEqual([plage('s1', 6, '09:00', '12:00')])
    expect(appliquerPlagesAuxJours([], 1, [2, 3], generateur())).toEqual([])
  })

  it('ignore le jour source, les doublons et les numéros inconnus dans les cibles', () => {
    const resultat = appliquerPlagesAuxJours(lundi, 1, [1, 2, 2, 0, 9], generateur())
    expect(resultat.filter((p) => p.jourSemaine === 1)).toEqual(lundi)
    expect(resultat.filter((p) => p.jourSemaine === 2)).toHaveLength(2)
    expect(resultat).toHaveLength(4)
  })

  it('produit des plages indépendantes (aucune référence partagée) et ne mute pas l’entrée', () => {
    const entree = structuredClone(lundi)
    const resultat = appliquerPlagesAuxJours(entree, 1, [2, 3], generateur())
    const copie = resultat.find((p) => p.jourSemaine === 2)
    expect(copie).toBeDefined()
    if (copie) copie.debut = '06:00'
    expect(resultat.filter((p) => p.jourSemaine === 3)[0]?.debut).toBe('08:00')
    expect(entree).toEqual(lundi)
    for (const p of resultat) expect(entree).not.toContain(p)
  })

  it('attribue des clés uniques', () => {
    const resultat = appliquerPlagesAuxJours(lundi, 1, [2, 3, 4, 5], generateur())
    expect(new Set(resultat.map((p) => p.cle)).size).toBe(resultat.length)
  })
})

describe('remplacerPlagesDuJour', () => {
  const base = [plage('l1', 1, '08:00', '12:00', 'id-l1'), plage('m1', 2, '10:00', '11:00')]

  it('remplace les plages du jour, garde clé et id des plages connues, crée les nouvelles sans id', () => {
    const saisies: PlageSaisie[] = [
      { cle: 'l1', debut: '09:00', fin: '12:00' },
      { cle: 'saisie-1', debut: '14:00', fin: '16:00' },
    ]
    const resultat = remplacerPlagesDuJour(base, 1, saisies, generateur())
    expect(resultat.filter((p) => p.jourSemaine === 1)).toEqual([
      plage('l1', 1, '09:00', '12:00', 'id-l1'),
      plage('copie-1', 1, '14:00', '16:00', null),
    ])
    expect(resultat.find((p) => p.cle === 'm1')).toEqual(base[1])
  })

  it('ferme le jour sans saisie et ne mute pas l’entrée', () => {
    const entree = structuredClone(base)
    expect(remplacerPlagesDuJour(entree, 1, [], generateur()).filter((p) => p.jourSemaine === 1)).toEqual([])
    expect(entree).toEqual(base)
  })
})

describe('semaineType', () => {
  it('ouvre lundi à vendredi de 09:00 à 17:00 et laisse le week-end fermé', () => {
    const resultat = semaineType(generateur())
    expect(resultat.map((p) => p.jourSemaine)).toEqual([1, 2, 3, 4, 5])
    expect(resultat.every((p) => p.debut === '09:00' && p.fin === '17:00' && p.id === null)).toBe(true)
    expect(new Set(resultat.map((p) => p.cle)).size).toBe(5)
  })
})

describe('resumeJour', () => {
  it('résume une plage', () => {
    expect(resumeJour([{ debut: '09:00', fin: '12:00' }])).toBe('9h–12h')
  })

  it('résume deux plages dans l’ordre chronologique', () => {
    expect(resumeJour([{ debut: '14:00', fin: '17:00' }, { debut: '09:00', fin: '12:00' }])).toBe('9h–12h · 14h–17h')
  })

  it('indique « Fermé » sans plage', () => {
    expect(resumeJour([])).toBe('Fermé')
  })

  it('garde les minutes non nulles (9h30) et ne supprime pas le zéro des minutes', () => {
    expect(resumeJour([{ debut: '09:30', fin: '12:05' }])).toBe('9h30–12h05')
    expect(formaterHeure('00:00')).toBe('0h')
    expect(formaterHeure('')).toBe('')
  })
})

describe('validerPlagesJour', () => {
  it('accepte un jour sans plage et des plages contiguës', () => {
    expect(validerPlagesJour([])).toEqual({})
    expect(validerPlagesJour([
      { cle: 'a', debut: '09:00', fin: '12:00' },
      { cle: 'b', debut: '12:00', fin: '14:00' },
    ])).toEqual({})
  })

  it('signale une fin avant le début, une heure illisible et un chevauchement', () => {
    const erreurs = validerPlagesJour([
      { cle: 'a', debut: '10:00', fin: '08:00' },
      { cle: 'b', debut: '', fin: '12:00' },
    ])
    expect(erreurs.a?.fin).toBe('La fin doit être après le début, le même jour.')
    expect(erreurs.b?.debut).toBe('Indiquez une heure de début valide.')

    const chevauchement = validerPlagesJour([
      { cle: 'c', debut: '09:00', fin: '11:00' },
      { cle: 'd', debut: '10:30', fin: '12:00' },
    ])
    expect(chevauchement.d?.debut).toBe('Cette plage chevauche la précédente.')
    expect(chevauchement.c).toBeUndefined()
  })
})

describe('plagesRestantesPourJour', () => {
  it('compte la limite de la semaine hors jour édité', () => {
    const jours = [{ numero: 1, plages: [1, 2] }, { numero: 2, plages: [1, 2, 3] }]
    expect(plagesRestantesPourJour(jours, 1)).toBe(DISPONIBILITES_MAX - 3)
    expect(plagesRestantesPourJour([{ numero: 2, plages: new Array(DISPONIBILITES_MAX + 5).fill(0) }], 1)).toBe(0)
  })
})

describe('decrirePlages et nomLigneJour', () => {
  it('décrit une, deux et trois plages dans l’ordre chronologique', () => {
    expect(decrirePlages([{ debut: '09:00', fin: '12:00' }])).toBe('de 9h à 12h')
    expect(decrirePlages([{ debut: '14:00', fin: '17:00' }, { debut: '09:00', fin: '12:00' }]))
      .toBe('de 9h à 12h et de 14h à 17h')
    expect(decrirePlages([
      { debut: '14:00', fin: '17:00' },
      { debut: '08:00', fin: '10:00' },
      { debut: '11:00', fin: '12:30' },
    ])).toBe('de 8h à 10h, de 11h à 12h30 et de 14h à 17h')
    expect(decrirePlages([])).toBe('')
  })

  it('compose le nom accessible de la ligne, jour fermé compris', () => {
    expect(nomLigneJour('Lundi', [{ debut: '09:00', fin: '12:00' }, { debut: '14:00', fin: '17:00' }]))
      .toBe('Lundi : de 9h à 12h et de 14h à 17h. Modifier')
    expect(nomLigneJour('Dimanche', [])).toBe('Dimanche : fermé. Modifier')
  })
})

describe('jourModifie', () => {
  const origine = [{ debut: '09:00', fin: '12:00' }, { debut: '14:00', fin: '17:00' }]

  it('est faux quand la copie est identique, clés techniques ignorées', () => {
    expect(jourModifie(origine, origine.map((p) => ({ ...p })))).toBe(false)
    expect(jourModifie([], [])).toBe(false)
  })

  it('est vrai quand une heure, le nombre de plages ou la fermeture change', () => {
    expect(jourModifie(origine, [{ debut: '09:00', fin: '12:30' }, origine[1] ?? { debut: '', fin: '' }])).toBe(true)
    expect(jourModifie(origine, origine.slice(0, 1))).toBe(true)
    expect(jourModifie(origine, [])).toBe(true)
    expect(jourModifie([], [{ debut: '09:00', fin: '17:00' }])).toBe(true)
  })

  it('est vrai dès qu’un jour cible est choisi, même sans changement d’heure', () => {
    expect(jourModifie(origine, origine, [3])).toBe(true)
  })
})

describe('formaterDateLocale', () => {
  it('écrit le jour en français, sans année pour l’année courante', () => {
    expect(formaterDateLocale('2026-12-15', 2026)).toBe('mardi 15 décembre')
  })

  it('ajoute l’année quand elle diffère ou n’est pas précisée', () => {
    expect(formaterDateLocale('2027-01-04', 2026)).toBe('lundi 4 janvier 2027')
    expect(formaterDateLocale('2026-12-15')).toBe('mardi 15 décembre 2026')
  })

  it('rend une valeur illisible telle quelle', () => {
    expect(formaterDateLocale('abc')).toBe('abc')
  })
})

describe('dateDuJourDansFuseau', () => {
  const instant = new Date('2026-12-14T23:30:00Z')

  it('suit le fuseau de la vitrine autour de minuit', () => {
    expect(dateDuJourDansFuseau(instant, 'Africa/Douala')).toBe('2026-12-15')
    expect(dateDuJourDansFuseau(instant, 'America/New_York')).toBe('2026-12-14')
  })

  it('se replie sur Africa/Douala si le fuseau est inconnu', () => {
    expect(dateDuJourDansFuseau(instant, 'Pas/UnFuseau')).toBe('2026-12-15')
  })
})

describe('separerIndisponibilites', () => {
  const items = [
    { id: 'c', date: '2026-12-20' },
    { id: 'a', date: '2026-11-01' },
    { id: 'b', date: '2026-12-15' },
    { id: 'd', date: '2026-10-01' },
  ]

  it('classe à venir (aujourd’hui compris) du plus proche au plus lointain', () => {
    expect(separerIndisponibilites(items, '2026-12-15').aVenir.map((i) => i.id)).toEqual(['b', 'c'])
  })

  it('classe les passées de la plus récente à la plus ancienne', () => {
    expect(separerIndisponibilites(items, '2026-12-15').passees.map((i) => i.id)).toEqual(['a', 'd'])
  })

  it('gère une liste vide et ne mute pas l’entrée', () => {
    expect(separerIndisponibilites([], '2026-12-15')).toEqual({ aVenir: [], passees: [] })
    const copie = structuredClone(items)
    separerIndisponibilites(items, '2026-12-15')
    expect(items).toEqual(copie)
  })
})

describe('nombre de jours d’une plage', () => {
  it('compte les bornes incluses (un seul jour = 1, cinq jours de suite = 5)', () => {
    expect(nombreJoursPlage('2026-12-10', '2026-12-10')).toBe(1)
    expect(nombreJoursPlage('2026-12-10', '2026-12-14')).toBe(5)
    expect(joursPlageSaisie('2026-12-10', '2026-12-14')).toBe(5)
  })

  it('est nul tant qu’une date est illisible ou que la fin précède le début', () => {
    expect(joursPlageSaisie('', '2026-12-14')).toBeNull()
    expect(joursPlageSaisie('2026-12-10', '')).toBeNull()
    expect(joursPlageSaisie('2026-12-14', '2026-12-10')).toBeNull()
  })

  it('met le libellé au singulier ou au pluriel', () => {
    expect(libelleNombreJours(1)).toBe('1 jour')
    expect(libelleNombreJours(5)).toBe('5 jours')
  })
})

describe('validerPlageIndisponibilite', () => {
  const aujourdhui = '2026-12-10'

  it('accepte une plage à venir, d’un jour ou à la limite', () => {
    expect(validerPlageIndisponibilite('2026-12-10', '2026-12-10', aujourdhui)).toEqual({})
    expect(validerPlageIndisponibilite('2026-12-11', '2027-02-08', aujourdhui)).toEqual({})
  })

  it('refuse une plage d’un jour de plus que la limite, avec la limite dans le message', () => {
    expect(INDISPONIBILITE_PLAGE_MAX_JOURS).toBe(60)
    expect(validerPlageIndisponibilite('2026-12-11', '2027-02-09', aujourdhui).fin)
      .toBe(`Au maximum ${INDISPONIBILITE_PLAGE_MAX_JOURS} jours à la fois.`)
    expect(messagePlageMax(7)).toBe('Au maximum 7 jours à la fois.')
  })

  it('refuse un début passé, une date illisible et une fin avant le début', () => {
    expect(validerPlageIndisponibilite('2026-12-09', '2026-12-12', aujourdhui).debut).toBe('Choisissez une date à venir.')
    expect(validerPlageIndisponibilite('', '', aujourdhui)).toEqual({
      debut: 'Choisissez une date valide.',
      fin: 'Choisissez une date valide.',
    })
    expect(validerPlageIndisponibilite('2026-12-15', '2026-12-12', aujourdhui).fin)
      .toBe('La date de fin doit être le même jour que le début, ou après.')
  })
})

describe('validerDateIndisponibilite', () => {
  it('refuse une date illisible, passée ou déjà fermée ; accepte aujourd’hui', () => {
    expect(validerDateIndisponibilite('', '2026-12-10', [])).toBe('Choisissez une date valide.')
    expect(validerDateIndisponibilite('2026-12-09', '2026-12-10', [])).toBe('Choisissez une date à venir.')
    expect(validerDateIndisponibilite('2026-12-12', '2026-12-10', ['2026-12-12'])).toBe('Cette date est déjà indisponible.')
    expect(validerDateIndisponibilite('2026-12-10', '2026-12-10', [])).toBeUndefined()
  })
})

describe('libelleResultatIndisponibilites', () => {
  const ligne = (date: string) => ({ id: date, date, raison: null })
  const plageReponse = (creees: number, ignorees: number, reservationsConcernees = 0): IndisponibiliteCreateDTO => ({
    items: Array.from({ length: creees }, (_, i) => ligne(`2027-01-${String(i + 1).padStart(2, '0')}`)),
    creees,
    ignorees,
    reservationsConcernees,
  })

  it('confirme une date unique', () => {
    expect(libelleResultatIndisponibilites({ item: ligne('2027-01-05'), reservationsConcernees: 0 }))
      .toBe('Indisponibilité ajoutée.')
  })

  it('compte les jours fermés d’une plage de 5 jours, au singulier comme au pluriel', () => {
    expect(libelleResultatIndisponibilites(plageReponse(5, 0))).toBe('5 jours fermés.')
    expect(libelleResultatIndisponibilites(plageReponse(1, 0))).toBe('1 jour fermé.')
  })

  it('signale les dates déjà fermées', () => {
    expect(libelleResultatIndisponibilites(plageReponse(3, 2))).toBe('3 jours fermés (2 déjà fermés).')
    expect(libelleResultatIndisponibilites(plageReponse(1, 1))).toBe('1 jour fermé (1 déjà fermé).')
  })

  it('reste neutre quand toute la plage était déjà fermée', () => {
    expect(libelleResultatIndisponibilites(plageReponse(0, 5))).toBe('Ces dates étaient déjà fermées.')
    expect(messageResultatIndisponibilites(plageReponse(0, 5))).toEqual({ type: 'info', texte: 'Ces dates étaient déjà fermées.' })
  })
})

describe('libelleAvertissementReservations', () => {
  it('est vide sans réservation', () => {
    expect(libelleAvertissementReservations(0)).toBe('')
  })

  it('accorde une réservation au singulier', () => {
    expect(libelleAvertissementReservations(1))
      .toBe('1 réservation existe déjà sur ces dates. Elle n’est pas annulée : traitez-la depuis l’agenda.')
  })

  it('accorde plusieurs réservations au pluriel', () => {
    expect(libelleAvertissementReservations(3))
      .toBe('3 réservations existent déjà sur ces dates. Elles ne sont pas annulées : traitez-les depuis l’agenda.')
  })
})

describe('messageResultatIndisponibilites', () => {
  it('l’avertissement remplace le succès (un seul message), pour une date comme pour une plage', () => {
    const date = messageResultatIndisponibilites({ item: { id: 'a', date: '2027-01-05', raison: null }, reservationsConcernees: 2 })
    expect(date.type).toBe('avertissement')
    expect(date.texte).toBe(libelleAvertissementReservations(2))
    const plage = messageResultatIndisponibilites({ items: [], creees: 3, ignorees: 0, reservationsConcernees: 1 })
    expect(plage).toEqual({ type: 'avertissement', texte: libelleAvertissementReservations(1) })
  })

  it('renvoie un succès sans réservation concernée', () => {
    expect(messageResultatIndisponibilites({ item: { id: 'a', date: '2027-01-05', raison: null }, reservationsConcernees: 0 }))
      .toEqual({ type: 'succes', texte: 'Indisponibilité ajoutée.' })
  })
})

describe('erreursIndisponibiliteDepuisApi', () => {
  it('place la date passée sous « Date » (une date) ou « Du » (plage), avec le message du serveur', () => {
    const api = { code: 'INDISPONIBILITE_DATE_PASSEE' as const, champs: {} }
    expect(erreursIndisponibiliteDepuisApi(api, 'date', null))
      .toEqual({ date: 'Cette date est déjà passée. Choisissez une date à venir.' })
    expect(erreursIndisponibiliteDepuisApi(api, 'plage', 'Message serveur.')).toEqual({ debut: 'Message serveur.' })
  })

  it('place « déjà indisponible » sous « Date »', () => {
    expect(erreursIndisponibiliteDepuisApi({ code: 'INDISPONIBILITE_EXISTANTE', champs: {} }, 'date', null))
      .toEqual({ date: 'Cette date est déjà indisponible.' })
  })

  it('reprend le premier message de chaque champ en erreur de validation', () => {
    expect(erreursIndisponibiliteDepuisApi(
      { code: 'VALIDATION', champs: { fin: ['La plage ne peut pas dépasser 60 jours.', 'autre'], debut: [] } },
      'plage',
      null,
    )).toEqual({ fin: 'La plage ne peut pas dépasser 60 jours.' })
  })

  it('reste vide pour une erreur sans champ (panne réseau, 500)', () => {
    expect(erreursIndisponibiliteDepuisApi({ code: null, champs: {} }, 'date', null)).toEqual({})
  })
})

describe('fusionnerIndisponibilites', () => {
  it('insère les lignes créées triées par date, sans doublon, sans muter l’entrée', () => {
    const existantes = [{ id: 'b', date: '2027-01-10', raison: null }, { id: 'a', date: '2027-01-01', raison: 'x' }]
    const copie = structuredClone(existantes)
    const resultat = fusionnerIndisponibilites(existantes, [
      { id: 'c', date: '2027-01-05', raison: null },
      { id: 'b', date: '2027-01-10', raison: 'maj' },
    ])
    expect(resultat.map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(resultat.find((i) => i.id === 'b')?.raison).toBe('maj')
    expect(existantes).toEqual(copie)
  })
})
