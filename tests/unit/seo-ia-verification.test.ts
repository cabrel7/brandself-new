import { describe, expect, it } from 'vitest'
import {
  ENTREE_SEO,
  SEO_VALIDE,
  descriptionDeLongueur,
  titreDeLongueur,
} from './support/seo-ia'

// Décision #24, groupe C : la sortie SEO du fournisseur n'est jamais crue sur parole. Fonctions pures
// (aucune base, aucun réseau) de server/services/ia/verification.ts.
const verification = () => import('../../server/services/ia/verification')

const valider = async (donnees: unknown, entree: object = ENTREE_SEO) => {
  const { validerSeo } = await verification()
  return validerSeo(donnees, entree)
}

/** Sous 20 caractères on ne peut pas ajouter de remplissage : la ville y reste, le reste est minimal. */
const TITRES_COURTS: Record<number, string> = { 9: 'ab Douala', 10: 'ORL Douala' }

const avecDescription = (description: string) => ({ ...SEO_VALIDE, description })
const avecTitre = (titre: string) => ({ ...SEO_VALIDE, titre })

describe('validerSeo : sortie conforme', () => {
  it('should accept a proposal in the bounds, citing the ville in the titre AND the description', async () => {
    const resultat = await valider(SEO_VALIDE)

    expect(resultat).toEqual({ ok: true, valeur: SEO_VALIDE })
  })

  it('should return the validated value untouched (no extra key, no rewriting)', async () => {
    const resultat = await valider(SEO_VALIDE)

    expect(resultat.ok && Object.keys(resultat.valeur).sort()).toEqual(['description', 'titre'])
  })

  it('should let « Premier rendez-vous » and « soins dentaires » through (no false positive)', async () => {
    const entree = { metier: 'Dentiste', ville: 'Douala', pays: 'CM', accroche: null }
    const donnees = {
      titre: 'Soins dentaires à Douala',
      description: 'Premier rendez-vous à Douala pour faire le point sur vos soins dentaires, avec écoute et des explications claires.',
    }

    expect(await valider(donnees, entree)).toEqual({ ok: true, valeur: donnees })
  })
})

describe('validerSeo : forme et bornes (C)', () => {
  it.each([
    ['null', null],
    ['a string', 'Cardiologue à Douala'],
    ['an array', [SEO_VALIDE]],
    ['an empty object', {}],
    ['a titre only', { titre: SEO_VALIDE.titre }],
    ['a description only', { description: SEO_VALIDE.description }],
    ['non-string fields', { titre: 12, description: 34 }],
  ])('should reject %s with sortie_invalide', async (_nom, donnees) => {
    expect(await valider(donnees)).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it('should reject an unknown extra key (strict output)', async () => {
    expect(await valider({ ...SEO_VALIDE, motsCles: ['cardiologue'] })).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it.each([
    [9, false],
    [10, true],
    [50, true],
    [51, false],
  ])('should judge a titre of %i characters: accepted = %s', async (longueur, accepte) => {
    const titre = TITRES_COURTS[longueur] ?? titreDeLongueur(longueur)
    expect(titre).toHaveLength(longueur)

    const resultat = await valider(avecTitre(titre))

    expect(resultat.ok).toBe(accepte)
    if (!accepte) expect(resultat).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it.each([
    [49, false],
    [50, true],
    [160, true],
    [161, false],
  ])('should judge a description of %i characters: accepted = %s', async (longueur, accepte) => {
    const description = descriptionDeLongueur(longueur)
    expect(description).toHaveLength(longueur)

    const resultat = await valider(avecDescription(description))

    expect(resultat.ok).toBe(accepte)
    if (!accepte) expect(resultat).toEqual({ ok: false, code: 'sortie_invalide' })
  })

  it('should not count surrounding whitespace to reach the minimum (a titre of 10 spaces is empty)', async () => {
    expect((await valider(avecTitre('          '))).ok).toBe(false)
  })
})

describe('validerSeo : la ville doit figurer dans le titre ET la description (C)', () => {
  it('should refuse a titre without the ville', async () => {
    expect((await valider(avecTitre('Cardiologue interventionnel'))).ok).toBe(false)
  })

  it('should refuse a description without the ville', async () => {
    const sansVille = 'Consultations de cardiologie pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.'

    expect((await valider(avecDescription(sansVille))).ok).toBe(false)
  })

  it('should refuse a ville spelled without its accent', async () => {
    const entree = { ...ENTREE_SEO, ville: 'Yaoundé' }
    const donnees = {
      titre: 'Cardiologue à Yaounde',
      description: 'Consultations de cardiologie à Yaounde pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.',
    }

    expect((await valider(donnees, entree)).ok).toBe(false)
  })

  it('should accept an accented ville spelled correctly in both texts', async () => {
    const entree = { ...ENTREE_SEO, ville: 'Yaoundé' }
    const donnees = {
      titre: 'Cardiologue à Yaoundé',
      description: 'Consultations de cardiologie à Yaoundé pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.',
    }

    expect(await valider(donnees, entree)).toEqual({ ok: true, valeur: donnees })
  })
})

describe('contientFormulationInterdite (C)', () => {
  it.each([
    ['meilleur', 'Le meilleur cardiologue de Douala'],
    ['meilleure (feminine)', 'La meilleure clinique de cardiologie'],
    ['meilleurs (plural)', 'Les meilleurs soins du quartier'],
    ['MEILLEUR (capitals)', 'LE MEILLEUR CARDIOLOGUE'],
    ['n°1', 'Cardiologue n°1 à Douala'],
    ['N°1 (capital)', 'Le N°1 de la cardiologie'],
    ['garanti', 'Résultat garanti dès la première consultation'],
    ['garantie (feminine)', 'Satisfaction garantie à chaque visite'],
    ['garantis (plural)', 'Des résultats garantis pour votre cœur'],
    ['100 %', 'Satisfaction à 100 % pour tous nos patients'],
    ['100%', 'Efficace à 100% sur votre santé'],
    ['guérir', 'Une approche pour guérir votre cœur'],
    ['guérison', 'Votre guérison est notre priorité'],
    ['miracle', 'Une méthode miracle pour votre santé'],
    ['sans effets secondaires', 'Un traitement sans effets secondaires'],
    ['exclamation mark', 'Prenez rendez-vous maintenant !'],
    ['exclamation mark mid-sentence', 'Bienvenue! Prenez rendez-vous'],
    ['emoji', 'Cardiologue à Douala 😀'],
    ['emoji (heart)', 'Prenez soin de votre cœur ❤️'],
  ])('should flag %s', async (_nom, texte) => {
    const { contientFormulationInterdite } = await verification()

    expect(contientFormulationInterdite(texte)).toBe(true)
  })

  it.each([
    ['Premier rendez-vous'],
    ['Soins dentaires'],
    ['Soins dentaires à Douala'],
    ['Cardiologue à Douala'],
    ['Consultations de cardiologie à Douala pour vous accompagner avec écoute, clarté et un suivi adapté à votre rythme.'],
    ['Pour améliorer votre quotidien, un suivi régulier est proposé.'],
    ['Une première consultation pour faire le point sur votre situation.'],
    ['Un accompagnement sur mesure, centré sur vos besoins.'],
    ['Cardiologue à Douala : « écoute et clarté »'],
    ['Du lundi au vendredi, sur rendez-vous.'],
    [''],
  ])('should NOT flag the legitimate text « %s »', async (texte) => {
    const { contientFormulationInterdite } = await verification()

    expect(contientFormulationInterdite(texte)).toBe(false)
  })

  it.each([
    ['meilleur', 'Le meilleur cardiologue de Douala'],
    ['guérir', 'Consultations à Douala pour guérir votre cœur avec écoute, clarté et un suivi adapté.'],
    ['miracle', 'Consultations à Douala avec une méthode miracle, écoute, clarté et un suivi adapté.'],
    ['sans effets secondaires', 'Consultations à Douala sans effets secondaires, avec écoute, clarté et un suivi adapté.'],
    ['!', 'Consultations de cardiologie à Douala avec écoute, clarté et un suivi adapté à votre rythme !'],
    ['emoji', 'Consultations de cardiologie à Douala avec écoute, clarté et un suivi adapté 😀 à votre rythme.'],
  ])('should make validerSeo answer formulation_interdite for « %s »', async (_nom, texte) => {
    const dansLeTitre = texte.length <= 50
    const donnees = dansLeTitre ? avecTitre(texte) : avecDescription(texte)

    expect(await valider(donnees)).toEqual({ ok: false, code: 'formulation_interdite' })
  })

  it.each([
    ['100 %', 'Consultations à Douala : 100 % de satisfaction, avec écoute, clarté et un suivi adapté.'],
    ['n°1', 'Cardiologue n°1 à Douala, avec écoute, clarté et un suivi adapté à votre rythme sur place.'],
    ['garanti', 'Consultations à Douala avec résultat garanti, écoute, clarté et un suivi adapté.'],
  ])('should refuse « %s » in a description, whichever rule (numbers or claims) fires first', async (_nom, description) => {
    const resultat = await valider(avecDescription(description))

    expect(resultat.ok).toBe(false)
    if (!resultat.ok) expect(['formulation_interdite', 'faits_inventes']).toContain(resultat.code)
  })
})

describe('validerSeo : faits inventés (C)', () => {
  it.each([
    ['a number of years', 'Cardiologue à Douala avec 15 ans d’expérience au service de votre cœur et de votre santé.'],
    ['a diploma', 'Cardiologue diplômé à Douala, avec écoute, clarté et un suivi adapté à votre rythme de vie.'],
    ['an institution', 'Cardiologue à Douala formé à l’université, avec écoute, clarté et un suivi adapté à vos besoins.'],
    ['an invented proper noun', 'Cardiologue à Douala, ancien de la Clinique Bonanjo, avec écoute, clarté et un suivi adapté.'],
    ['another city', 'Cardiologue à Douala et à Bafoussam, avec écoute, clarté et un suivi adapté à votre rythme.'],
    ['a person name', 'Cardiologue à Douala : le docteur Mballa vous reçoit avec écoute, clarté et un suivi adapté.'],
    ['a price', 'Consultations de cardiologie à Douala avec écoute, clarté et un suivi adapté, à petit prix.'],
  ])('should refuse a description that invents %s', async (_nom, description) => {
    const resultat = await valider(avecDescription(description))

    expect(resultat).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it('should refuse a titre that invents a fact', async () => {
    expect(await valider(avecTitre('Cardiologue à Douala depuis 2010'))).toEqual({ ok: false, code: 'faits_inventes' })
  })

  it('should accept a fact that the professional wrote himself (it is in the sources)', async () => {
    const entree = { ...ENTREE_SEO, accroche: 'Cardiologue diplômé, à votre écoute depuis toujours' }
    const description = 'Cardiologue diplômé à Douala : consultations avec écoute, clarté et un suivi adapté à votre rythme.'

    expect(await valider(avecDescription(description), entree)).toEqual({ ok: true, valeur: avecDescription(description) })
  })

  it('should refuse an invented link or markup', async () => {
    const description = 'Consultations de cardiologie à Douala sur www.cardio-douala.example avec écoute, clarté et un suivi adapté.'

    expect((await valider(avecDescription(description))).ok).toBe(false)
  })
})

describe('accentsManquants (C)', () => {
  it('should flag a text that spells a source word without its accent', async () => {
    const { accentsManquants } = await verification()

    expect(accentsManquants(['Pediatre a Yaounde'], ['Pédiatre', 'Yaoundé'])).toBe(true)
  })

  it('should not flag a text that keeps the accents of the sources', async () => {
    const { accentsManquants } = await verification()

    expect(accentsManquants(['Pédiatre à Yaoundé'], ['Pédiatre', 'Yaoundé'])).toBe(false)
  })

  it.each([
    ['Une ecoute attentive et un suivi regulier pour votre sante a Douala, du lundi au vendredi.'],
    ['Cardiologue a Douala : consultations pour accompagner votre coeur avec ecoute et clarte, selon votre rythme.'],
  ])('should flag a French sentence that lost all its accents (« %s »)', async (texte) => {
    const { accentsManquants } = await verification()

    expect(accentsManquants([texte], ['Cardiologue', 'Douala'])).toBe(true)
  })

  it.each([
    ['Premier rendez-vous'],
    ['Soins dentaires'],
    ['Soins dentaires pour toute la famille avec un suivi simple et clair'],
  ])('should not flag « %s » (no accent is needed: false positives forbidden)', async (texte) => {
    const { accentsManquants } = await verification()

    expect(accentsManquants([texte], ['Dentiste', 'Douala'])).toBe(false)
  })

  it('should answer false for no text at all', async () => {
    const { accentsManquants } = await verification()

    expect(accentsManquants([], [])).toBe(false)
  })

  it('should make validerSeo answer accents_manquants when the texts lost the accents of the ville', async () => {
    const entree = { ...ENTREE_SEO, ville: 'Yaoundé' }
    const donnees = {
      titre: 'Cardiologue a Yaounde',
      description: 'Consultations de cardiologie a Yaounde pour vous accompagner avec ecoute, clarte et un suivi adapte a votre rythme.',
    }

    const resultat = await valider(donnees, entree)

    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.code).toBe('accents_manquants')
  })
})
