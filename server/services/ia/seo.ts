import { randomUUID } from 'node:crypto'
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { generationsIa, vitrines } from '../../../shared/db/schema'
import {
  IA_GLOBAL_LIMIT,
  IA_LIMITE_CLE_GLOBALE,
  SEO_IA_LIMITE_CLE_PREFIXE,
  SEO_IA_VITRINE_LIMIT,
} from '../../../shared/limites'
import { schemaSeoIa } from '../../../shared/schemas/ia'
import type { SeoIa } from '../../../shared/schemas/ia'
import { ServiceUnavailableError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { hitLimit, releaseLimit } from '../limiteur'
import { executeGeneration } from './generations'
import { detecterInjection, empreinte, entreeSeo } from './nettoyage'
import type { EntreeSeo } from './entrees'
import { getActivePrompt } from './prompts'
import { seoIaFraiche, signatureEntreesSeo } from './seo-regles'
import type { ExecutionDeps } from './types'

// Décision #24 : régénération du SEO d'une vitrine existante, en tâche de fond (file `ia-fond`, job différé).
// Le job ne porte qu'un identifiant de vitrine. Journal : identifiant et motif, JAMAIS une entrée ni un texte généré.
// Hors quota de l'utilisateur : ni `assertQuota`, ni le compteur `ia:{userId}`. Seuls comptent le compteur par
// vitrine (`seo-ia:{vitrineId}`, 5 par 24 h) et le plafond global de coût.

export type MotifSeo =
  | 'ecrit'
  | 'reutilise'
  | 'vitrine_absente'
  | 'non_publiee'
  | 'saisies_completes'
  | 'deja_frais'
  | 'sans_fournisseur'
  | 'injection'
  | 'limite_vitrine'
  | 'plafond_global'
  | 'limiteur_indisponible'
  | 'sans_proposition'
  | 'obsolete'

export interface ResultatSeo {
  /** Vrai si la proposition a été écrite dans la vitrine (générée ou réutilisée). */
  ecrit: boolean
  motif: MotifSeo
}

const TYPE_SEO = 'seo_vitrine'
const PROMPT_ABSENT = 'sans_prompt'
const STATUT_TERMINEE = 'terminee'

function termine(vitrineId: string, ecrit: boolean, motif: MotifSeo): ResultatSeo {
  console.info({ ia: 'seo', vitrine: vitrineId, ecrit, motif })
  return { ecrit, motif }
}

function estRenseigne(texte: string | null): boolean {
  return texte !== null && texte.trim() !== ''
}

/** Dédoublonnage : une génération terminée pour les mêmes entrées (et le même prompt) est réutilisée, sans appel. */
async function chercherDejaGeneree(userId: string, empreinteEntree: string): Promise<SeoIa | null> {
  const [ligne] = await db
    .select({ sortie: generationsIa.sortie })
    .from(generationsIa)
    .where(
      and(
        eq(generationsIa.userId, userId),
        eq(generationsIa.type, TYPE_SEO),
        eq(generationsIa.entreeEmpreinte, empreinteEntree),
        eq(generationsIa.statut, STATUT_TERMINEE),
        isNotNull(generationsIa.sortie),
      ),
    )
    .orderBy(desc(generationsIa.createdAt))
    .limit(1)
  const seo = schemaSeoIa.safeParse(ligne?.sortie)
  return seo.success ? seo.data : null
}

type Reservation = { ok: true } | { ok: false, motif: 'limite_vitrine' | 'plafond_global' | 'limiteur_indisponible' }

/**
 * Compteur de la vitrine PUIS plafond global (jamais le compteur de l'utilisateur). Redis indisponible = pas d'appel
 * payant (on ne peut pas compter). Un refus rend le compteur de la vitrine : une demande refusée ne coûte rien.
 */
async function reserverLimites(vitrineId: string): Promise<Reservation> {
  const cleVitrine = `${SEO_IA_LIMITE_CLE_PREFIXE}${vitrineId}`
  try {
    const parVitrine = await hitLimit(cleVitrine, SEO_IA_VITRINE_LIMIT.limit, SEO_IA_VITRINE_LIMIT.windowS, { failClosed: true })
    if (!parVitrine.allowed) {
      await releaseLimit(cleVitrine)
      return { ok: false, motif: 'limite_vitrine' }
    }
    const global = await hitLimit(IA_LIMITE_CLE_GLOBALE, IA_GLOBAL_LIMIT.limit, IA_GLOBAL_LIMIT.windowS, { failClosed: true })
    if (!global.allowed) {
      await releaseLimit(cleVitrine)
      return { ok: false, motif: 'plafond_global' }
    }
    return { ok: true }
  } catch (erreur) {
    if (erreur instanceof ServiceUnavailableError) return { ok: false, motif: 'limiteur_indisponible' }
    throw erreur
  }
}

async function insererGeneration(
  userId: string,
  entree: EntreeSeo,
  empreinteEntree: string,
  promptId: string | null,
  now: Date,
  injection: boolean,
): Promise<string> {
  const id = randomUUID()
  const base = { id, userId, type: TYPE_SEO, promptId, entreeEmpreinte: empreinteEntree, injectionSuspectee: injection, entree, createdAt: now }
  await db
    .insert(generationsIa)
    .values(injection ? { ...base, statut: 'repli', motifRepli: 'injection', termineeLe: now } : { ...base, statut: 'en_attente' })
  return id
}

async function lireSortie(generationId: string): Promise<SeoIa | null> {
  const [ligne] = await db.select({ sortie: generationsIa.sortie }).from(generationsIa).where(eq(generationsIa.id, generationId)).limit(1)
  const seo = schemaSeoIa.safeParse(ligne?.sortie)
  return seo.success ? seo.data : null
}

/**
 * Écrit la proposition SEULEMENT si les entrées de la vitrine n'ont pas bougé depuis la lecture (une édition
 * concurrente invalide ce résultat). Ne touche pas `updated_at` : ce n'est pas une modification de l'utilisateur
 * (`modifieLe` pilote `lastmod` et les caches). Renvoie vrai si une ligne a été écrite.
 */
async function ecrireSeo(
  vitrine: typeof vitrines.$inferSelect,
  seo: SeoIa,
  now: Date,
): Promise<boolean> {
  const ecrites = await db
    .update(vitrines)
    .set({
      seoIaTitre: seo.titre,
      seoIaDescription: seo.description,
      seoIaSignature: signatureEntreesSeo(vitrine),
      seoIaGenereLe: now,
    })
    .where(
      and(
        eq(vitrines.id, vitrine.id),
        sql`${vitrines.metier} IS NOT DISTINCT FROM ${vitrine.metier}`,
        sql`${vitrines.ville} IS NOT DISTINCT FROM ${vitrine.ville}`,
        sql`${vitrines.pays} IS NOT DISTINCT FROM ${vitrine.pays}`,
        sql`${vitrines.accroche} IS NOT DISTINCT FROM ${vitrine.accroche}`,
      ),
    )
    .returning({ id: vitrines.id })
  return ecrites.length > 0
}

/**
 * Régénère le SEO d'une vitrine. Ne lève pas pour une absence, un refus de limite, une panne ou une sortie
 * rejetée du fournisseur (rien n'est écrit, la vitrine garde son gabarit) ; une erreur d'infrastructure
 * (base de données) remonte, le job échoue.
 *  1. vitrine absente, non publiée, ou les deux textes Google saisis : fin (rien à écrire) ;
 *  2. proposition déjà fraîche : fin, aucun appel ;
 *  3. injection suspectée dans les entrées : génération en repli `injection`, aucun appel ;
 *  4. génération terminée identique (mêmes entrées, même prompt) : réutilisée, aucun appel ;
 *  5. limiteurs (vitrine puis plafond global) : refus = fin, aucun appel ;
 *  6. génération `seo_vitrine` créée puis exécutée dans ce même job (retries et validation de `executeGeneration`) ;
 *  7. écriture conditionnelle aux entrées lues en 1.
 */
export async function regenererSeoVitrine(vitrineId: string, deps: ExecutionDeps): Promise<ResultatSeo> {
  const [vitrine] = await db.select().from(vitrines).where(eq(vitrines.id, vitrineId)).limit(1)
  if (!vitrine) return termine(vitrineId, false, 'vitrine_absente')
  if (vitrine.publieeLe === null) return termine(vitrineId, false, 'non_publiee')
  if (estRenseigne(vitrine.seoTitre) && estRenseigne(vitrine.seoDescription)) return termine(vitrineId, false, 'saisies_completes')
  if (seoIaFraiche(vitrine) !== null) return termine(vitrineId, false, 'deja_frais')

  const entree = entreeSeo(vitrine)
  const prompt = await getActivePrompt(TYPE_SEO)
  const empreinteEntree = empreinte(entree, prompt?.id ?? PROMPT_ABSENT)
  const maintenant = new Date(deps.now())

  const injection = [entree.metier, entree.ville, entree.accroche ?? '', `${entree.metier} ${entree.ville}`].some(detecterInjection)
  if (injection) {
    await insererGeneration(vitrine.userId, entree, empreinteEntree, prompt?.id ?? null, maintenant, true)
    return termine(vitrineId, false, 'injection')
  }

  const reutilisee = await chercherDejaGeneree(vitrine.userId, empreinteEntree)
  if (reutilisee) {
    const ecrit = await ecrireSeo(vitrine, reutilisee, maintenant)
    return termine(vitrineId, ecrit, ecrit ? 'reutilise' : 'obsolete')
  }

  // Sans fournisseur (IA_FOURNISSEUR=aucun) : rien à payer ni à compter, inutile de laisser une génération en repli.
  if (deps.provider === null) return termine(vitrineId, false, 'sans_fournisseur')

  const reservation = await reserverLimites(vitrineId)
  if (!reservation.ok) return termine(vitrineId, false, reservation.motif)

  const generationId = await insererGeneration(vitrine.userId, entree, empreinteEntree, prompt?.id ?? null, maintenant, false)
  const statut = await executeGeneration(generationId, deps)
  if (statut !== STATUT_TERMINEE) return termine(vitrineId, false, 'sans_proposition')
  const seo = await lireSortie(generationId)
  if (seo === null) return termine(vitrineId, false, 'sans_proposition')
  const ecrit = await ecrireSeo(vitrine, seo, new Date(deps.now()))
  return termine(vitrineId, ecrit, ecrit ? 'ecrit' : 'obsolete')
}
