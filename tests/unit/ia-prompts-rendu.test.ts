import { describe, expect, it } from 'vitest'

// S8 §4.4 / CA27 : le gabarit est rendu en UNE passe, sur la liste blanche des variables déclarées.
// Une donnée saisie par l'utilisateur ne doit jamais être réinterprétée comme gabarit ni comme motif
// de remplacement. (L'échappement des chevrons et la forme du message sont éprouvés en intégration,
// à travers la requête réellement reçue par le fournisseur.)

const prompts = () => import('../../server/services/ia/prompts')

const GABARIT = 'Voici les réponses du professionnel.\n<donnees>\n{{donnees}}\n</donnees>'

describe('renderGabarit', () => {
  it('should substitute the donnees variable', async () => {
    const { renderGabarit } = await prompts()

    expect(renderGabarit('Avant {{donnees}} après', { donnees: '{"ville":"Douala"}' })).toBe('Avant {"ville":"Douala"} après')
  })

  it('should substitute every occurrence of the variable', async () => {
    const { renderGabarit } = await prompts()

    expect(renderGabarit('{{donnees}} et {{donnees}}', { donnees: 'X' })).toBe('X et X')
  })

  it('should render the real template shape with one data block', async () => {
    const { renderGabarit } = await prompts()

    const rendu = renderGabarit(GABARIT, { donnees: '{"metier":"Avocat"}' })

    expect(rendu).toBe('Voici les réponses du professionnel.\n<donnees>\n{"metier":"Avocat"}\n</donnees>')
  })

  it('should not re-interpret a placeholder found inside the data (single pass)', async () => {
    const { renderGabarit } = await prompts()
    const donnees = '{"ville":"Douala {{donnees}} {{donnees}}"}'

    const rendu = renderGabarit(GABARIT, { donnees })

    expect(rendu).toBe(`Voici les réponses du professionnel.\n<donnees>\n${donnees}\n</donnees>`)
    expect(rendu.match(/\{\{donnees\}\}/g)).toHaveLength(2)
  })

  it.each([
    ['dollar-ampersand', 'Coach $& pro'],
    ['dollar-digit', 'Coach $1 pro'],
    ['dollar-dollar', 'Coach $$ pro'],
    ['dollar-backtick', 'Coach $` pro'],
    ['dollar-quote', "Coach $' pro"],
    ['named group', 'Coach $<nom> pro'],
  ])('should insert the data literally, never as a replacement pattern (%s)', async (_nom, donnees) => {
    const { renderGabarit } = await prompts()

    expect(renderGabarit('A {{donnees}} B', { donnees })).toBe(`A ${donnees} B`)
  })

  it('should leave the text without placeholder unchanged', async () => {
    const { renderGabarit } = await prompts()

    expect(renderGabarit('Aucune variable ici.', { donnees: 'X' })).toBe('Aucune variable ici.')
  })

  it('should be a pure function: same input, same output', async () => {
    const { renderGabarit } = await prompts()

    expect(renderGabarit(GABARIT, { donnees: 'X' })).toBe(renderGabarit(GABARIT, { donnees: 'X' }))
  })

  it('should keep a very large data string intact', async () => {
    const { renderGabarit } = await prompts()
    const enorme = 'é'.repeat(100_000)

    expect(renderGabarit('{{donnees}}', { donnees: enorme })).toBe(enorme)
  })

  it('should never read a variable that is not whitelisted from the environment', async () => {
    const { renderGabarit } = await prompts()
    process.env.SECRET_DE_TEST_S8 = 'valeur-secrete'

    try {
      const rendu = renderGabarit('{{donnees}} {{SECRET_DE_TEST_S8}} {{__proto__}} {{constructor}}', { donnees: 'X' })

      expect(rendu).not.toContain('valeur-secrete')
      expect(rendu).not.toContain('[object')
      expect(rendu).not.toContain('function')
    } finally {
      delete process.env.SECRET_DE_TEST_S8
    }
  })
})
