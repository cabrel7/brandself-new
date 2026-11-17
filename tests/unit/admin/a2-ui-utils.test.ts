import { describe, expect, it } from 'vitest'
import { ADMIN_IDEMPOTENCE_ENTETE, ADMIN_PREFIXE_API } from '../../../shared/admin'
import {
  ACTIONS_A2,
  cheminAction,
  corpsAction,
  emailConfirme,
  etiquettesUtilisateur,
  etiquettesVitrine,
  messageDepuisErreurApi,
  saisieActionValide,
  saisieTropCourte,
  termeRecherche,
} from '../../../app/utils/admin-a2'
import { schemaChangerPlan, schemaOffrirJours, schemaSupprimerUtilisateur, schemaActionMotif } from '../../../shared/schemas/admin-a2'

const SAISIE = { motif: 'Demande du professionnel', code: '123456', jours: 30, emailConfirmation: 'a@b.cm' }

describe('A2 UI : recherche', () => {
  it('exige 3 caractères rognés', () => {
    expect(termeRecherche(' ab ')).toBeNull()
    expect(termeRecherche(' abc ')).toBe('abc')
    expect(saisieTropCourte('ab')).toBe(true)
    expect(saisieTropCourte('')).toBe(false)
    expect(saisieTropCourte('abc')).toBe(false)
  })
})

describe('A2 UI : corps des écritures conformes aux schémas stricts du serveur', () => {
  it('motif seul', () => {
    for (const id of ['suspendre', 'reactiver', 'revoquer_sessions', 'retirer_assistants', 'depublier', 'republier', 'retirer_assistant'] as const) {
      expect(schemaActionMotif.safeParse(corpsAction(id, SAISIE)).success).toBe(true)
    }
  })
  it('jours, plan, suppression', () => {
    expect(schemaOffrirJours.safeParse(corpsAction('offrir_jours', SAISIE)).success).toBe(true)
    expect(schemaChangerPlan.safeParse(corpsAction('plan_payant', SAISIE)).success).toBe(true)
    expect(schemaChangerPlan.safeParse(corpsAction('plan_gratuit', SAISIE)).success).toBe(true)
    expect(schemaSupprimerUtilisateur.safeParse(corpsAction('supprimer', SAISIE)).success).toBe(true)
  })
  it('le passage au gratuit n’envoie pas de jours', () => {
    expect(corpsAction('plan_gratuit', SAISIE)).not.toHaveProperty('jours')
  })
})

describe('A2 UI : chemins', () => {
  it('encode la cible et vise les routes de la spec', () => {
    expect(cheminAction('suspendre', 'u/1')).toBe(`${ADMIN_PREFIXE_API}/utilisateurs/u%2F1/suspendre`)
    expect(cheminAction('offrir_jours', 'u1')).toBe(`${ADMIN_PREFIXE_API}/utilisateurs/u1/offrir-jours`)
    expect(cheminAction('plan_gratuit', 'u1')).toBe(`${ADMIN_PREFIXE_API}/utilisateurs/u1/changer-plan`)
    expect(cheminAction('depublier', 'v1')).toBe(`${ADMIN_PREFIXE_API}/vitrines/v1/depublier`)
    expect(cheminAction('retirer_assistant', 'c1')).toBe(`${ADMIN_PREFIXE_API}/assistants/c1/retirer`)
    expect(ADMIN_IDEMPOTENCE_ENTETE).toBe('idempotency-key')
  })
})

describe('A2 UI : validation de la saisie', () => {
  it('réauthentification exigée pour suspendre, dépublier, changer le plan, supprimer (D-A2-07)', () => {
    const avec = Object.values(ACTIONS_A2).filter((d) => d.reauth).map((d) => d.id).sort()
    expect(avec).toEqual(['depublier', 'plan_gratuit', 'plan_payant', 'supprimer', 'suspendre'])
  })
  it('motif trop court ou code absent : refusé', () => {
    expect(saisieActionValide(ACTIONS_A2.reactiver, { ...SAISIE, motif: 'ok' }, '')).toBe(false)
    expect(saisieActionValide(ACTIONS_A2.suspendre, { ...SAISIE, code: '12' }, '')).toBe(false)
    expect(saisieActionValide(ACTIONS_A2.suspendre, SAISIE, '')).toBe(true)
    expect(saisieActionValide(ACTIONS_A2.reactiver, { ...SAISIE, code: '' }, '')).toBe(true)
  })
  it('jours entre 1 et 365', () => {
    expect(saisieActionValide(ACTIONS_A2.offrir_jours, { ...SAISIE, jours: 0 }, '')).toBe(false)
    expect(saisieActionValide(ACTIONS_A2.offrir_jours, { ...SAISIE, jours: 366 }, '')).toBe(false)
    expect(saisieActionValide(ACTIONS_A2.offrir_jours, { ...SAISIE, jours: 365 }, '')).toBe(true)
  })
  it('suppression : e-mail exact, casse ignorée', () => {
    expect(emailConfirme(' A@B.cm ', 'a@b.cm')).toBe(true)
    expect(emailConfirme('', '')).toBe(false)
    expect(saisieActionValide(ACTIONS_A2.supprimer, { ...SAISIE, emailConfirmation: 'x@y.cm' }, 'a@b.cm')).toBe(false)
    expect(saisieActionValide(ACTIONS_A2.supprimer, SAISIE, 'a@b.cm')).toBe(true)
  })
})

describe('A2 UI : étiquettes et erreurs', () => {
  it('un compte suspendu sans vitrine', () => {
    const libelles = etiquettesUtilisateur({ etat: 'grace', suspendu: true, vitrine: null }).map((e) => e.libelle)
    expect(libelles).toEqual(['Suspendu', 'Grâce', 'Sans vitrine'])
  })
  it('une vitrine bloquée n’est jamais « Publiée »', () => {
    expect(etiquettesVitrine({ publiee: true, bloquee: true, proprietaireSuspendu: false }).map((e) => e.libelle)).toEqual(['Bloquée'])
  })
  it('le message d’erreur est celui du serveur', () => {
    expect(messageDepuisErreurApi({ data: { statusCode: 409, message: 'Cette vitrine est bloquée par l’administration.' } })).toBe('Cette vitrine est bloquée par l’administration.')
    expect(messageDepuisErreurApi(new Error('x'))).toContain('Réessayez')
  })
})
