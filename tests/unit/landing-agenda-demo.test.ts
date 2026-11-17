// Page d'accueil : tests unitaires de l'agenda de démonstration (`useAgendaDemo`).
// Le composable dépend des auto-imports Nuxt (useState, onMounted, computed, ref) : ils sont remplacés ici par
// des doublures minimales basées sur `vue` (aucun serveur Nuxt). L'instant est fixé par `vi.setSystemTime`.
import { computed, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SERVICES_DEMO } from '../../app/data/landing'
import { estCreneauPris, FUSEAU_AGENDA_DEMO, useAgendaDemo } from '../../app/composables/useAgendaDemo'

// `~` n'est pas un alias du projet Vitest : on lui substitue le vrai module de données (même contenu, pas de copie).
vi.mock('~/data/landing', async () => await import('../../app/data/landing'))

const NBSP = ' '
const TZ_INITIAL = process.env.TZ

let rappelsMontage: Array<() => void> = []
let etats: Map<string, Ref<unknown>>

function installerGlobaux(): void {
  rappelsMontage = []
  etats = new Map()
  vi.stubGlobal('ref', ref)
  vi.stubGlobal('computed', computed)
  vi.stubGlobal('onMounted', (rappel: () => void) => {
    rappelsMontage.push(rappel)
  })
  // useState : une valeur par clé, initialisée une seule fois (comme Nuxt).
  vi.stubGlobal('useState', <T>(cle: string, init: () => T): Ref<T> => {
    if (!etats.has(cle)) etats.set(cle, ref(init()))
    return etats.get(cle) as Ref<T>
  })
}

function monter(): void {
  for (const rappel of rappelsMontage) rappel()
}

/** Crée l'agenda à un instant donné (heure de Douala = UTC + 1). */
function agendaA(instantIso: string) {
  vi.setSystemTime(new Date(instantIso))
  return useAgendaDemo()
}

beforeEach(() => {
  vi.useFakeTimers()
  installerGlobaux()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  if (TZ_INITIAL === undefined) delete process.env.TZ
  else process.env.TZ = TZ_INITIAL
})

describe('estCreneauPris', () => {
  it('should be deterministic when called repeatedly with the same indexes', () => {
    for (let j = 0; j < 10; j++) {
      for (let c = 0; c < 6; c++) {
        expect(estCreneauPris(j, c)).toBe(estCreneauPris(j, c))
      }
    }
  })

  it.each([
    [0, 3, true],
    [0, 1, false],
    [1, 1, true],
    [2, 4, true],
    [3, 2, true],
    [4, 0, true],
    [4, 5, true],
    [4, 1, false],
  ])('should return the expected value for day %i slot %i', (jour, creneau, attendu) => {
    expect(estCreneauPris(jour, creneau)).toBe(attendu)
  })

  it('should always leave at least one free slot among the 6 when any day index is used', () => {
    for (let jour = 0; jour < 200; jour++) {
      const libres = Array.from({ length: 6 }, (_, c) => estCreneauPris(jour, c)).filter(pris => !pris)
      expect(libres.length).toBeGreaterThan(0)
    }
  })
})

describe('useAgendaDemo : jours', () => {
  it('should use the Africa/Douala time zone constant', () => {
    expect(FUSEAU_AGENDA_DEMO).toBe('Africa/Douala')
  })

  it('should return the 5 next days without Sunday when today is a Tuesday', () => {
    // mardi 17 novembre 2026, 11 h à Douala
    const { jours } = agendaA('2026-11-17T10:00:00Z')

    expect(jours.value.map(j => j.long)).toEqual([
      'Mercredi 18 novembre',
      'Jeudi 19 novembre',
      'Vendredi 20 novembre',
      'Samedi 21 novembre',
      'Lundi 23 novembre',
    ])
    expect(jours.value.map(j => j.index)).toEqual([0, 1, 2, 3, 4])
    expect(jours.value.map(j => j.numero)).toEqual([18, 19, 20, 21, 23])
  })

  it('should give a short weekday without trailing dot and a long weekday in lowercase', () => {
    const { jours } = agendaA('2026-11-17T10:00:00Z')

    expect(jours.value[0]?.court).toBe('mer')
    expect(jours.value[0]?.semaine).toBe('mercredi')
    expect(jours.value.every(j => !j.court.includes('.'))).toBe(true)
  })

  it('should represent each day by noon UTC of its calendar date', () => {
    const { jours } = agendaA('2026-11-17T10:00:00Z')

    expect(jours.value[0]?.instant).toBe(Date.UTC(2026, 10, 18, 12))
    expect(jours.value[4]?.instant).toBe(Date.UTC(2026, 10, 23, 12))
  })

  it('should skip the Sunday when today is a Saturday', () => {
    const { jours } = agendaA('2026-11-21T10:00:00Z')

    expect(jours.value.map(j => j.semaine)).toEqual(['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi'])
    expect(jours.value[0]?.numero).toBe(23)
  })

  it('should start on Monday when today is a Sunday', () => {
    const { jours } = agendaA('2026-11-22T10:00:00Z')

    expect(jours.value[0]?.long).toBe('Lundi 23 novembre')
    expect(jours.value).toHaveLength(5)
  })

  it('should never contain a Sunday whatever the starting day', () => {
    for (let jourDuMois = 1; jourDuMois <= 28; jourDuMois++) {
      etats.clear()
      const { jours } = agendaA(`2026-11-${String(jourDuMois).padStart(2, '0')}T10:00:00Z`)
      expect(jours.value).toHaveLength(5)
      expect(jours.value.some(j => new Date(j.instant).getUTCDay() === 0)).toBe(false)
    }
  })

  it('should cross the month boundary when the 5 days span two months', () => {
    // jeudi 26 novembre 2026
    const { jours } = agendaA('2026-11-26T10:00:00Z')

    expect(jours.value.map(j => j.numero)).toEqual([27, 28, 30, 1, 2])
    expect(jours.value[3]?.long).toBe('Mardi 1 décembre')
  })

  it('should cross the year boundary', () => {
    // mardi 29 décembre 2026
    const { jours, libelleMois } = agendaA('2026-12-29T10:00:00Z')

    expect(jours.value.map(j => j.numero)).toEqual([30, 31, 1, 2, 4])
    expect(libelleMois.value).toBe('Décembre 2026 – janvier 2027')
  })

  it('should handle 29 February on a leap year', () => {
    // vendredi 27 février 2032 : 28 (sam), 29 (dim, ignoré), 1er mars (lun)...
    const { jours } = agendaA('2032-02-27T10:00:00Z')

    expect(jours.value.map(j => j.numero)).toEqual([28, 1, 2, 3, 4])
  })
})

describe('useAgendaDemo : fuseau Africa/Douala (jamais celui de la machine)', () => {
  it('should use the Douala calendar day when it is already the next day there', () => {
    // 23 h 30 UTC le 17 = 0 h 30 le 18 à Douala : le premier jour proposé est le jeudi 19.
    const { jours } = agendaA('2026-11-17T23:30:00Z')

    expect(jours.value[0]?.long).toBe('Jeudi 19 novembre')
  })

  it('should still use the same calendar day one minute before midnight in Douala', () => {
    // 22 h 59 UTC le 17 = 23 h 59 le 17 à Douala : le premier jour proposé est le mercredi 18.
    const { jours } = agendaA('2026-11-17T22:59:00Z')

    expect(jours.value[0]?.long).toBe('Mercredi 18 novembre')
  })

  it('should really change the machine time zone in this test process (guard against a vacuous TZ test)', () => {
    process.env.TZ = 'Pacific/Auckland'
    const auckland = new Date('2026-11-17T23:30:00Z').getDate()
    process.env.TZ = 'UTC'
    const utc = new Date('2026-11-17T23:30:00Z').getDate()

    expect(auckland).toBe(18)
    expect(utc).toBe(17)
  })

  it.each(['UTC', 'America/Los_Angeles', 'Pacific/Auckland', 'Asia/Tokyo', 'Africa/Douala'])(
    'should give identical days and labels when the machine time zone is %s',
    (tz) => {
      const reference = agendaA('2026-11-17T23:30:00Z')
      const attendu = JSON.stringify({ jours: reference.jours.value, mois: reference.libelleMois.value })
      etats.clear()

      process.env.TZ = tz
      const { jours, libelleMois } = agendaA('2026-11-17T23:30:00Z')

      expect(JSON.stringify({ jours: jours.value, mois: libelleMois.value })).toBe(attendu)
      expect(jours.value[0]?.long).toBe('Jeudi 19 novembre')
    },
  )
})

describe('useAgendaDemo : libellé du mois', () => {
  it('should show the month and the year when the 5 days stay in one month', () => {
    const { libelleMois } = agendaA('2026-11-17T10:00:00Z')

    expect(libelleMois.value).toBe('Novembre 2026')
  })

  it('should show two months separated by an en dash when the 5 days overlap two months', () => {
    const { libelleMois } = agendaA('2026-11-26T10:00:00Z')

    expect(libelleMois.value).toBe('Novembre 2026 – décembre 2026')
  })

  it('should capitalize the first month only', () => {
    const { libelleMois } = agendaA('2026-11-26T10:00:00Z')

    expect(libelleMois.value.startsWith('N')).toBe(true)
    expect(libelleMois.value).toContain(' – d')
  })
})

describe('useAgendaDemo : hydratation', () => {
  it('should recompute the days from the current time once mounted', () => {
    const { jours } = agendaA('2026-11-17T10:00:00Z')
    expect(jours.value[0]?.numero).toBe(18)

    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'))
    monter()

    expect(jours.value[0]?.numero).toBe(25)
  })

  it('should keep the server instant until mounted', () => {
    const { jours } = agendaA('2026-11-17T10:00:00Z')

    vi.setSystemTime(new Date('2026-11-24T10:00:00Z'))

    expect(jours.value[0]?.numero).toBe(18)
  })
})

describe('useAgendaDemo : services', () => {
  it('should reuse title and duration of SERVICES_DEMO for each service', () => {
    const { services } = agendaA('2026-11-17T10:00:00Z')

    expect(services).toHaveLength(SERVICES_DEMO.length)
    services.forEach((service, i) => {
      expect(service.index).toBe(i)
      expect(service.titre).toBe(SERVICES_DEMO[i]?.titre)
      expect(service.duree).toBe(SERVICES_DEMO[i]?.duree)
    })
  })

  it('should select the first service by default', () => {
    const { serviceChoisi } = agendaA('2026-11-17T10:00:00Z')

    expect(serviceChoisi.value?.duree).toBe('45 min')
  })

  it('should follow the selected service index', () => {
    const { serviceChoisi, indexService } = agendaA('2026-11-17T10:00:00Z')

    indexService.value = 2

    expect(serviceChoisi.value?.duree).toBe('6 séances')
  })

  it('should fall back to the first service when the index is out of range', () => {
    const { serviceChoisi, indexService } = agendaA('2026-11-17T10:00:00Z')

    indexService.value = 99

    expect(serviceChoisi.value?.titre).toBe(SERVICES_DEMO[0]?.titre)
  })
})

describe('useAgendaDemo : créneaux', () => {
  it('should offer the 6 slots with non-breaking-space labels', () => {
    const { creneaux } = agendaA('2026-11-17T10:00:00Z')

    expect(creneaux.value.map(c => c.libelle)).toEqual([
      `9${NBSP}h`,
      `10${NBSP}h`,
      `11${NBSP}h${NBSP}30`,
      `14${NBSP}h`,
      `15${NBSP}h${NBSP}30`,
      `16${NBSP}h${NBSP}30`,
    ])
  })

  it('should flag taken slots with the deterministic pattern of the selected day', () => {
    const { creneaux, choisirJour } = agendaA('2026-11-17T10:00:00Z')

    expect(creneaux.value.map(c => c.pris)).toEqual([false, false, false, true, false, false])
    choisirJour(1)
    expect(creneaux.value.map(c => c.pris)).toEqual([false, true, false, false, false, false])
  })

  it('should select the second slot of the first day by default', () => {
    const { indexCreneau, creneaux } = agendaA('2026-11-17T10:00:00Z')

    expect(indexCreneau.value).toBe(1)
    expect(creneaux.value[1]?.pris).toBe(false)
  })

  it('should keep the preferred slot when changing day if it is still free', () => {
    const { choisirJour, indexCreneau, indexJour } = agendaA('2026-11-17T10:00:00Z')

    choisirJour(2)

    expect(indexJour.value).toBe(2)
    expect(indexCreneau.value).toBe(1)
  })

  it('should move to the first free slot when changing day lands on a taken slot', () => {
    const { choisirJour, indexCreneau } = agendaA('2026-11-17T10:00:00Z')

    choisirJour(1) // le créneau 1 est pris le jour 1

    expect(indexCreneau.value).toBe(0)
  })

  it('should ignore the choice of a taken slot', () => {
    const { choisirCreneau, indexCreneau } = agendaA('2026-11-17T10:00:00Z')

    choisirCreneau(3) // pris le jour 0

    expect(indexCreneau.value).toBe(1)
  })

  it('should accept the choice of a free slot', () => {
    const { choisirCreneau, indexCreneau } = agendaA('2026-11-17T10:00:00Z')

    choisirCreneau(5)

    expect(indexCreneau.value).toBe(5)
  })

  it('should never leave a taken slot selected whatever the day chosen', () => {
    const { choisirJour, indexCreneau, creneaux, choisirCreneau } = agendaA('2026-11-17T10:00:00Z')

    for (let jour = 0; jour < 5; jour++) {
      for (let creneau = 0; creneau < 6; creneau++) {
        choisirCreneau(creneau)
        choisirJour(jour)
        expect(creneaux.value[indexCreneau.value]?.pris).toBe(false)
      }
    }
  })
})

describe('useAgendaDemo : confirmation', () => {
  it('should build the confirm label from the selected day and slot', () => {
    const { libelleConfirmer } = agendaA('2026-11-17T10:00:00Z')

    expect(libelleConfirmer.value).toBe(`Confirmer mercredi à 10${NBSP}h`)
  })

  it('should update the confirm label when the slot changes', () => {
    const { libelleConfirmer, choisirCreneau } = agendaA('2026-11-17T10:00:00Z')

    choisirCreneau(2)

    expect(libelleConfirmer.value).toBe(`Confirmer mercredi à 11${NBSP}h${NBSP}30`)
  })

  it('should toggle confirmation on confirmer and recommencer without any network call', () => {
    const fetchEspion = vi.fn()
    vi.stubGlobal('fetch', fetchEspion)
    const { confirme, confirmer, recommencer } = agendaA('2026-11-17T10:00:00Z')

    expect(confirme.value).toBe(false)
    confirmer()
    expect(confirme.value).toBe(true)
    recommencer()
    expect(confirme.value).toBe(false)
    expect(fetchEspion).not.toHaveBeenCalled()
  })

  it('should fall back to the first day when the selected day index is out of range', () => {
    const { jourChoisi, indexJour } = agendaA('2026-11-17T10:00:00Z')

    indexJour.value = 42

    expect(jourChoisi.value?.long).toBe('Mercredi 18 novembre')
  })
})
