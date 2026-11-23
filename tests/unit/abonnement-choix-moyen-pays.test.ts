// Choix du moyen de paiement par pays (P1b : MTN MoMo existe au Cameroun ET au Congo, Airtel Money au Congo ET au Gabon).
//
// `ChoixMoyen.vue` ne peut pas être monté ici (pas de plugin Vue ni de @vue/test-utils dans le projet Vitest) : la logique
// de regroupement vit dans des fonctions pures de `usePaiementAbonnement.ts` (testées en comportement), et le contrat du
// composant (sélecteur seulement si plusieurs pays, changement de pays = premier opérateur + `choisir`) est vérifié par
// lecture de source, comme les autres composants du projet.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { MoyenPaiementDTO } from '../../shared/dto'
import { indicatifChange, moyensDuPays, paysDesMoyens } from '../../app/composables/usePaiementAbonnement'

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const lire = (fichier: string): string => readFileSync(path.join(RACINE, fichier), 'utf8')

function moyen(id: string, libelle: string, pays: string, paysLibelle: string, indicatif: string): MoyenPaiementDTO {
  return { id, libelle, methode: 'mobile_money', devise: 'XAF', pays, paysLibelle, indicatif, exemple: '600000000' } as MoyenPaiementDTO
}

const MTN_CMR = moyen('mercypay:MTN_CMR', 'MTN MoMo', 'CMR', 'Cameroun', '237')
const ORANGE_CMR = moyen('mercypay:ORANGE_CMR', 'Orange Money', 'CMR', 'Cameroun', '237')
const MTN_COG = moyen('mercypay:MTN_COG', 'MTN MoMo', 'COG', 'Congo', '242')
const AIRTEL_COG = moyen('mercypay:AIRTEL_COG', 'Airtel Money', 'COG', 'Congo', '242')
const AIRTEL_GAB = moyen('mercypay:AIRTEL_GAB', 'Airtel Money', 'GAB', 'Gabon', '241')
const CATALOGUE = [MTN_CMR, ORANGE_CMR, MTN_COG, AIRTEL_COG, AIRTEL_GAB]

describe('paysDesMoyens', () => {
  it('liste les pays sans doublon, dans l’ordre du catalogue (Cameroun d’abord)', () => {
    expect(paysDesMoyens(CATALOGUE)).toEqual([
      { code: 'CMR', libelle: 'Cameroun' },
      { code: 'COG', libelle: 'Congo' },
      { code: 'GAB', libelle: 'Gabon' },
    ])
  })

  it('un seul pays : un seul élément (aucun sélecteur à afficher)', () => {
    expect(paysDesMoyens([MTN_CMR, ORANGE_CMR])).toHaveLength(1)
  })

  it('aucun moyen : aucun pays', () => {
    expect(paysDesMoyens([])).toEqual([])
  })
})

describe('moyensDuPays', () => {
  it('ne garde que les opérateurs du pays, dans l’ordre (le premier est sélectionné au changement)', () => {
    expect(moyensDuPays(CATALOGUE, 'COG').map((m) => m.id)).toEqual([MTN_COG.id, AIRTEL_COG.id])
    expect(moyensDuPays(CATALOGUE, 'GAB').map((m) => m.id)).toEqual([AIRTEL_GAB.id])
  })

  it('distingue deux moyens de même libellé par leur identifiant (MTN MoMo CMR / COG)', () => {
    expect(moyensDuPays(CATALOGUE, 'CMR')[0]?.id).not.toBe(moyensDuPays(CATALOGUE, 'COG')[0]?.id)
  })

  it('pays inconnu : liste vide', () => {
    expect(moyensDuPays(CATALOGUE, 'XXX')).toEqual([])
  })
})

describe('indicatifChange', () => {
  it('vide seulement si les deux indicatifs sont non vides et différents', () => {
    expect(indicatifChange('237', '242')).toBe(true)
    expect(indicatifChange('237', '237')).toBe(false)
    expect(indicatifChange(undefined, '237')).toBe(false)
    expect(indicatifChange('237', undefined)).toBe(false)
    expect(indicatifChange('', '242')).toBe(false)
  })

  it('le composable vide le numéro et l’erreur du numéro sur ce changement', () => {
    const source = lire('app/composables/usePaiementAbonnement.ts')
    expect(source).toMatch(/watch\(\(\) => moyenChoisi\.value\?\.indicatif[\s\S]*?indicatifChange\(ancien, nouveau\)[\s\S]*?telephone\.value = ''[\s\S]*?viderErreur\('telephone'\)/)
  })
})

describe('ChoixMoyen.vue (contrat par lecture de source)', () => {
  const source = lire('app/components/studio/abonnement/ChoixMoyen.vue')

  it('le sélecteur de pays n’existe que si plusieurs pays, avec un vrai libellé « Pays »', () => {
    expect(source).toMatch(/<UFormField v-if="plusieursPays" label="Pays"/)
    expect(source).toMatch(/const plusieursPays = computed\(\(\) => listePays\.value\.length > 1\)/)
  })

  it('les opérateurs sont filtrés sur le pays choisi seulement quand il y a plusieurs pays', () => {
    expect(source).toMatch(/plusieursPays\.value \? moyensDuPays\(props\.moyens, paysChoisi\.value\) : props\.moyens/)
  })

  it('changer de pays sélectionne le premier opérateur et notifie le parent comme `choisir`', () => {
    const corps = source.match(/function changerPays[\s\S]*?\n}\n/)?.[0] ?? ''
    expect(corps).toContain('moyensDuPays(props.moyens, code)[0]')
    expect(corps).toContain('moyen.value = premier.id')
    expect(corps).toContain("emit('choisir')")
  })

  it('aucun moyen : phrase claire, sans légende orpheline ; le sélecteur n’est pas en size lg', () => {
    expect(source).toMatch(/v-if="moyens\.length === 0"[\s\S]*?Aucun moyen de paiement n’est proposé pour cette devise\./)
    expect(source).not.toMatch(/<USelect[^>]*size=/)
  })

  it('un seul moyen : texte « Paiement par … » inchangé, sans sélecteur', () => {
    expect(source).toMatch(/<p v-else-if="moyens\.length === 1"[\s\S]*Paiement par/)
  })

  it('aucune couleur en dur ni mot interdit', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(source).not.toMatch(/\b(espace|bloc|module|widget|section)\b/i)
  })
})

describe('FormulairePaiement.vue : indicatif et exemple suivent le moyen choisi', () => {
  it('dérivés de `moyenChoisi` (donc du moyen, pas du pays par défaut)', () => {
    const source = lire('app/components/studio/abonnement/FormulairePaiement.vue')
    expect(source).toContain(':placeholder="moyenChoisi?.exemple"')
    expect(source).toContain('+{{ moyenChoisi.indicatif }}')
  })
})
