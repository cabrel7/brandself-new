import { describe, expect, it } from 'vitest'
import { computeNextStep } from '../../server/services/vitrines-regles'
import type { NextStepInput } from '../../server/services/vitrines-regles'
import { prochaineEtape, PROCHAINES_ETAPES as ETAPES_APP } from '../../app/utils/prochaine-etape'
import { PROCHAINES_ETAPES } from '../../shared/prochaine-etape'
import { NEXT_STEPS } from '../../shared/vitrine'
import type { NextStep } from '../../shared/vitrine'

// S9 §1 #93, §3.3, §3.4 / CA50 à CA53, CA55 : la prochaine étape gagne `partager` (vitrine publiée et jamais
// partagée) et des étapes ignorées pour toujours, sautées même si elles restent à faire.

const TOUT_FAIT: NextStepInput = {
  hasPhoto: true,
  servicesActifs: 2,
  disponibilites: 3,
  realisationsActives: 1,
  publiee: true,
  partagee: true,
  ignorees: [],
}

const VIDE: NextStepInput = {
  hasPhoto: false,
  servicesActifs: 0,
  disponibilites: 0,
  realisationsActives: 0,
  publiee: true,
  partagee: false,
  ignorees: [],
}

describe('computeNextStep avec partager (#93)', () => {
  it('should propose partager once the four steps are done, the vitrine is published and was never shared (CA52)', () => {
    expect(computeNextStep({ ...TOUT_FAIT, partagee: false })).toBe('partager')
  })

  it('should propose nothing when the vitrine is published and already shared', () => {
    expect(computeNextStep(TOUT_FAIT)).toBeNull()
  })

  it('should never propose partager for an unpublished vitrine (CA52)', () => {
    expect(computeNextStep({ ...TOUT_FAIT, publiee: false, partagee: false })).toBeNull()
  })

  it('should keep the order photo, service, disponibilites, realisation, partager', () => {
    const parcours = [
      computeNextStep(VIDE),
      computeNextStep({ ...VIDE, hasPhoto: true }),
      computeNextStep({ ...VIDE, hasPhoto: true, servicesActifs: 1 }),
      computeNextStep({ ...VIDE, hasPhoto: true, servicesActifs: 1, disponibilites: 1 }),
      computeNextStep({ ...VIDE, hasPhoto: true, servicesActifs: 1, disponibilites: 1, realisationsActives: 1 }),
      computeNextStep({ ...VIDE, hasPhoto: true, servicesActifs: 1, disponibilites: 1, realisationsActives: 1, partagee: true }),
    ]

    expect(parcours).toEqual(['photo', 'service', 'disponibilites', 'realisation', 'partager', null])
  })

  it('should ask for the missing photo before partager even when the vitrine is published', () => {
    expect(computeNextStep({ ...TOUT_FAIT, hasPhoto: false, partagee: false })).toBe('photo')
  })
})

describe('computeNextStep avec étapes ignorées (CA51)', () => {
  it.each<[NextStep, NextStep | null]>([
    ['photo', 'service'],
    ['service', 'photo'],
  ])('should skip %s and answer %s when photo and service are both missing', (ignoree, attendu) => {
    expect(computeNextStep({ ...VIDE, ignorees: [ignoree] })).toBe(attendu)
  })

  it('should jump to the next step when the current one is ignored, even if it is still to do (disponibilites -> realisation)', () => {
    const etat: NextStepInput = { ...TOUT_FAIT, disponibilites: 0, realisationsActives: 0, partagee: false }

    expect(computeNextStep(etat)).toBe('disponibilites')
    expect(computeNextStep({ ...etat, ignorees: ['disponibilites'] })).toBe('realisation')
  })

  it('should skip several ignored steps in a row', () => {
    expect(computeNextStep({ ...VIDE, ignorees: ['photo', 'service', 'disponibilites'] })).toBe('realisation')
    expect(computeNextStep({ ...VIDE, ignorees: ['photo', 'service', 'disponibilites', 'realisation'] })).toBe('partager')
  })

  it('should answer null once every step is ignored, although all remain to do', () => {
    expect(computeNextStep({ ...VIDE, ignorees: [...NEXT_STEPS] })).toBeNull()
  })

  it('should answer null when the only remaining step (partager) is ignored', () => {
    expect(computeNextStep({ ...TOUT_FAIT, partagee: false, ignorees: ['partager'] })).toBeNull()
  })

  it('should ignore an ignored step that is already done (no effect, no surprise)', () => {
    expect(computeNextStep({ ...TOUT_FAIT, partagee: false, ignorees: ['photo', 'service'] })).toBe('partager')
  })

  it('should stay stable when the same step is listed twice', () => {
    expect(computeNextStep({ ...VIDE, ignorees: ['photo', 'photo'] })).toBe('service')
  })

  it('should not mutate the list of ignored steps it receives', () => {
    const ignorees: NextStep[] = ['photo']
    const copie = [...ignorees]

    computeNextStep({ ...VIDE, ignorees })

    expect(ignorees).toEqual(copie)
  })

  it('should return the first step in NEXT_STEPS order that is both to do and not ignored, for every combination (exhaustive)', () => {
    const booleens = [true, false]
    for (const hasPhoto of booleens) {
      for (const service of [0, 1]) {
        for (const dispo of [0, 4]) {
          for (const realisation of [0, 2]) {
            for (const publiee of booleens) {
              for (const partagee of booleens) {
                for (let masque = 0; masque < 2 ** NEXT_STEPS.length; masque += 1) {
                  const ignorees = NEXT_STEPS.filter((_, index) => (masque >> index) & 1)
                  const aFaire: Record<NextStep, boolean> = {
                    photo: !hasPhoto,
                    service: service === 0,
                    disponibilites: dispo === 0,
                    realisation: realisation === 0,
                    partager: publiee && !partagee,
                  }
                  const attendu = NEXT_STEPS.find((etape) => aFaire[etape] && !ignorees.includes(etape)) ?? null

                  const obtenu = computeNextStep({
                    hasPhoto,
                    servicesActifs: service,
                    disponibilites: dispo,
                    realisationsActives: realisation,
                    publiee,
                    partagee,
                    ignorees,
                  })

                  expect(obtenu, JSON.stringify({ hasPhoto, service, dispo, realisation, publiee, partagee, ignorees })).toBe(attendu)
                }
              }
            }
          }
        }
      }
    }
  })
})

describe('PROCHAINES_ETAPES (shared/prochaine-etape.ts)', () => {
  it('should define every step of NEXT_STEPS and nothing else', () => {
    expect(Object.keys(PROCHAINES_ETAPES).sort()).toEqual([...NEXT_STEPS].sort())
  })

  it('should give partager the exact texts of the spec and no page (the action opens a panel)', () => {
    expect(PROCHAINES_ETAPES.partager).toEqual({
      titre: 'Partagez votre vitrine',
      texte: 'Un message à vos contacts suffit souvent pour recevoir vos premières visites.',
      chemin: null,
      action: 'Partager',
    })
  })

  it.each(NEXT_STEPS.filter((etape) => etape !== 'partager'))('should give %s a studio page', (etape) => {
    expect(PROCHAINES_ETAPES[etape].chemin).toMatch(/^\/studio\//)
  })

  it('should keep the S8 texts and pages of the four historical steps (the resume e-mail quotes them)', () => {
    expect(PROCHAINES_ETAPES.realisation).toMatchObject({
      titre: 'Présentez une réalisation',
      chemin: '/studio/realisations/nouveau',
    })
    expect(PROCHAINES_ETAPES.photo.chemin).toBe('/studio/profil')
    expect(PROCHAINES_ETAPES.service.chemin).toBe('/studio/services/nouveau')
    expect(PROCHAINES_ETAPES.disponibilites.chemin).toBe('/studio/agenda/disponibilites')
  })

  it.each(NEXT_STEPS)('should write %s without forbidden user vocabulary (espace, bloc, module, widget, section)', (etape) => {
    const { titre, texte, action } = PROCHAINES_ETAPES[etape]

    expect(`${titre} ${texte} ${action}`).not.toMatch(/\b(espace|bloc|module|widget|section)s?\b/i)
    expect(titre.length).toBeGreaterThan(0)
    expect(texte.length).toBeGreaterThan(0)
    expect(action.length).toBeGreaterThan(0)
  })
})

describe('app/utils/prochaine-etape.ts (réexport pour les composants existants)', () => {
  it.each(NEXT_STEPS)('should expose %s with `to` taken from `chemin`', (etape) => {
    const source = PROCHAINES_ETAPES[etape]

    expect(ETAPES_APP[etape].titre).toBe(source.titre)
    expect(ETAPES_APP[etape].action).toBe(source.action)
    expect(ETAPES_APP[etape].to).toBe(source.chemin ?? undefined)
  })

  it('should answer null for no step and the definition for a step', () => {
    expect(prochaineEtape(null)).toBeNull()
    expect(prochaineEtape('partager')?.titre).toBe('Partagez votre vitrine')
    expect(prochaineEtape('photo')?.to).toBe('/studio/profil')
  })
})
