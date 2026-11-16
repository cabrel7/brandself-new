import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ADMIN_ACTIONS } from '../../../shared/admin'
import { CONTRAT_A2 } from '../../support/admin-contrat'
import { ecartsSourceRoute } from './support/contrat'

// A2 : structure SOURCE des routes et des lectures publiques (test d'énumération, spec §8 « Confidentialité »).
//  1. chaque route A2 : garde d'abord, enveloppe d'erreur, aucune base ; réauthentification là où D-A2-07 l'exige
//     (et nulle part ailleurs) ; clé d'idempotence là où D-A2-06 l'exige (et nulle part ailleurs) ;
//  2. aucune lecture ou écriture visiteur ne recopie `publiee_le IS NOT NULL` hors de server/services/visibilite.ts ;
//  3. chaque surface de la spec §4 s'appuie sur le prédicat unique ou lit la suspension (MCP).
// La mécanique du contrôle est elle-même éprouvée sur des fixtures : un contrôle qui ne sait pas échouer ne prouve rien.

const RACINE = path.resolve(import.meta.dirname, '../../..')
const lire = (relatif: string): string => readFileSync(path.join(RACINE, relatif), 'utf-8')

function fichiersTs(dossier: string): string[] {
  const resultat: string[] = []
  for (const nom of readdirSync(path.join(RACINE, dossier))) {
    const relatif = `${dossier}/${nom}`
    if (statSync(path.join(RACINE, relatif)).isDirectory()) resultat.push(...fichiersTs(relatif))
    else if (nom.endsWith('.ts')) resultat.push(relatif)
  }
  return resultat.sort()
}

describe('routes A2 : réauthentification et idempotence (D-A2-06, D-A2-07)', () => {
  const REAUTH: Record<string, string> = {
    'utilisateurs/[id]/suspendre.post.ts': ADMIN_ACTIONS.utilisateurSuspendre,
    'utilisateurs/[id]/changer-plan.post.ts': ADMIN_ACTIONS.utilisateurChangerPlan,
    'utilisateurs/[id]/supprimer.post.ts': ADMIN_ACTIONS.utilisateurSupprimer,
    'vitrines/[id]/depublier.post.ts': ADMIN_ACTIONS.vitrineDepublier,
  }
  const CLE_IDEMPOTENCE = ['utilisateurs/[id]/offrir-jours.post.ts', 'utilisateurs/[id]/changer-plan.post.ts']
  const ecritures = Object.keys(CONTRAT_A2).filter((f) => f.endsWith('.post.ts'))

  it.each(ecritures)('should wire the reauthentication of %s exactly as D-A2-07 says', (fichier) => {
    const source = lire(`server/api/admin/${fichier}`)
    const exige = fichier in REAUTH

    if (exige) {
      expect(source, 'doit demander la réauthentification').toMatch(/reauthPour\(|exigerReauth\(/)
      expect(source, 'doit la lier à la bonne action du journal').toContain(Object.keys(ADMIN_ACTIONS).find((c) => ADMIN_ACTIONS[c as keyof typeof ADMIN_ACTIONS] === REAUTH[fichier])!)
    } else {
      expect(source, 'ne doit pas demander de réauthentification').not.toMatch(/reauthPour\(|exigerReauth\(|ADMIN_REAUTH_ENTETE/)
    }
  })

  it.each(ecritures)('should read the Idempotency-Key in %s only where D-A2-06 says', (fichier) => {
    const source = lire(`server/api/admin/${fichier}`)

    if (CLE_IDEMPOTENCE.includes(fichier)) expect(source).toMatch(/lireCleIdempotence\(|ADMIN_IDEMPOTENCE_ENTETE|idempotency-key/i)
    else expect(source).not.toMatch(/lireCleIdempotence\(|ADMIN_IDEMPOTENCE_ENTETE|idempotency-key/i)
  })

  it.each(Object.keys(CONTRAT_A2))('should keep %s thin: guard first, error envelope, no database, no process.env', (fichier) => {
    expect(ecartsSourceRoute(fichier, lire(`server/api/admin/${fichier}`))).toEqual([])
  })

  it('should keep the reauthentication binding out of the request body (the target comes from the URL)', () => {
    for (const fichier of Object.keys(REAUTH)) {
      const source = lire(`server/api/admin/${fichier}`)
      expect(source, fichier).toMatch(/lireIdParam\(|getRouterParam/)
      expect(source, fichier).not.toMatch(/corps\.(id|cibleId|utilisateurId|vitrineId)|body\.(id|cibleId)/)
    }
  })
})

/** Prédicats SQL de publication recopiés à la main (`isNotNull(vitrines.publieeLe)`, `publiee_le IS NOT NULL`). */
export const PREDICAT_RECOPIE = /isNotNull\(\s*(?:\w+\.)?publieeLe\s*\)|publiee_le\s+IS\s+NOT\s+NULL|publieeLe\s*\}?\s*IS\s+NOT\s+NULL/i

describe('prédicat unique de visibilité (D-A2-03)', () => {
  it('should flag a hand-copied publication predicate, in every spelling used in the code base', () => {
    for (const recopie of [
      '.where(isNotNull(vitrines.publieeLe))',
      '.where(and(eq(vitrines.username, u), isNotNull(vitrines.publieeLe)))',
      'sql`${vitrines.publieeLe} IS NOT NULL`',
      'sql`v.publiee_le IS NOT NULL`',
      'WHERE publiee_le   is not null',
    ]) expect(recopie).toMatch(PREDICAT_RECOPIE)
  })

  it('should NOT flag the legitimate readings (JS comparison on an owner\'s own row, the predicate helper)', () => {
    for (const legitime of ['publiee: vitrine.publieeLe !== null', 'sqlVitrinePublique()', 'COALESCE(publiee_le, now())', 'publieeLe: sql`now()`']) {
      expect(legitime).not.toMatch(PREDICAT_RECOPIE)
    }
  })

  it('should find NO hand-copied publication predicate in the visitor-facing code of server/ (outside visibilite.ts and the administration services)', () => {
    const fautifs = [...fichiersTs('server/services'), ...fichiersTs('server/mcp'), ...fichiersTs('server/api'), ...fichiersTs('server/jobs')]
      .filter((f) => f !== 'server/services/visibilite.ts')
      // Les services d'ADMINISTRATION lisent l'état brut (publiée, bloquée, suspendu) pour l'AFFICHER à l'administrateur :
      // ce ne sont pas des surfaces visiteur.
      .filter((f) => !f.startsWith('server/services/admin/'))
      .filter((f) => PREDICAT_RECOPIE.test(lire(f)))

    expect(fautifs).toEqual([])
  })

  it('should keep the public routes free of any publication reading (they delegate to services)', () => {
    for (const fichier of fichiersTs('server/api/public')) expect(lire(fichier), fichier).not.toMatch(/publieeLe|publiee_le|blocageAdmin|\.banned/)
  })

  it.each([
    ['server/services/vitrines.ts', /sqlVitrinePublique|requireVitrinePublique/],
    ['server/services/creneaux.ts', /sqlVitrinePublique|requireVitrinePublique/],
    ['server/services/messages.ts', /sqlVitrinePublique|requireVitrinePublique/],
    ['server/services/statistiques.ts', /sqlVitrinePublique|requireVitrinePublique/],
    ['server/services/medias.ts', /sqlVitrinePublique|requireVitrinePublique/],
    ['server/services/seo-sitemap.ts', /sqlVitrinePublique|requireVitrinePublique/],
    ['server/services/ia/seo.ts', /estVitrinePublique|sqlVitrinePublique|requireVitrinePublique/],
    ['server/mcp/auth.ts', /\.banned|suspendu/],
  ])('should make %s depend on the single predicate (or read the suspension for the MCP)', (fichier, attendu) => {
    expect(lire(fichier)).toMatch(attendu)
  })

  it('should expose the SQL predicate and the 404 guard from one module', () => {
    const source = lire('server/services/visibilite.ts')

    expect(source).toMatch(/export function sqlVitrinePublique/)
    expect(source).toMatch(/export async function requireVitrinePublique/)
    expect(source).toMatch(/VITRINE_INTROUVABLE/)
  })
})
