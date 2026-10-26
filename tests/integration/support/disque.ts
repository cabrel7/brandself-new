import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export function mediasDir(): string {
  const dossier = process.env.MEDIAS_DIR
  if (!dossier) {
    throw new Error('MEDIAS_DIR doit être défini pour les tests d’intégration.')
  }
  return dossier
}

/** Tous les fichiers (chemins absolus) sous un dossier, quelle que soit l'organisation interne du stockage. */
export async function fichiersSous(dossier: string): Promise<string[]> {
  let entrees
  try {
    entrees = await readdir(dossier, { withFileTypes: true })
  } catch {
    return []
  }
  const resultats: string[] = []
  for (const entree of entrees) {
    const complet = path.join(dossier, entree.name)
    if (entree.isDirectory()) {
      resultats.push(...(await fichiersSous(complet)))
    } else {
      resultats.push(complet)
    }
  }
  return resultats.sort()
}

/** Fichiers du stockage dont le chemin relatif mentionne l'identifiant (les 3 variantes d'un média). */
export async function fichiersDuMedia(mediaId: string): Promise<string[]> {
  const base = mediasDir()
  const tous = await fichiersSous(base)
  return tous.filter((fichier) => path.relative(base, fichier).includes(mediaId))
}

export async function fichiersDeLUtilisateur(userId: string): Promise<string[]> {
  const base = mediasDir()
  const tous = await fichiersSous(base)
  return tous.filter((fichier) => path.relative(base, fichier).split(path.sep)[0] === userId)
}

export async function lireOctets(fichier: string): Promise<Buffer> {
  return readFile(fichier)
}
