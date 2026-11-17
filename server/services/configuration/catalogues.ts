// A5 (D-A5-10 à D-A5-13) : catalogues pays, devises et noms d'adresse bloqués. Les pays et les devises ne se créent
// PAS depuis l'interface (migration seulement) ; seuls les noms bloqués s'ajoutent. Chaque écriture : une transaction,
// idempotence (en-tête), réauthentification, motif, journal dans la même transaction (CA13).
import { asc, count, eq, sql } from 'drizzle-orm'
import { ADMIN_ACTIONS, ADMIN_CIBLES } from '../../../shared/admin'
import type { AdminCatalogue } from '../../../shared/admin'
import { devises, pays, usernamesBloques, vitrines } from '../../../shared/db/schema'
import { listerFuseaux } from '../../../shared/fuseau'
import { ABONNEMENT_FUSEAU_REPLI } from '../../../shared/plans'
import { paysDuNumero, smsFournisseurConfigure } from '../../../shared/pays-numero'
import { isReserved } from '../../../shared/reserved'
import type { CreerNomBloque, ModifierDevise, ModifierPays } from '../../../shared/schemas/admin-catalogues'
import { ConflictError, UnprocessableError, ValidationError } from '../../exceptions/http'
import { db } from '../../utils/db'
import { enregistrer } from '../admin/audit'
import type { TransactionAdmin } from '../admin/audit'
import { empreinteValeurs, entreeIntrouvable, horlogeDe, rejouer } from './ecriture'
import type { AuteurEcritureReauth } from './ecriture'

export interface PaysLu {
  code: string
  libelle: string
  indicatif: string
  actif: boolean
  deviseDefaut: string
  fuseaux: string[]
  canalSms: boolean
  canalWhatsapp: boolean
  canalEmail: boolean
  modifieLe: Date
}

export interface PaysVue extends PaysLu {
  smsEffectif: boolean
  whatsappEffectif: boolean
  utilise: boolean
}

export interface DeviseVue {
  code: string
  actif: boolean
  payable: boolean
  modifieLe: Date
}

export interface NomBloqueVue {
  valeur: string
  motif: string
  creePar: string
  creeLe: Date
}

export interface PageCatalogue<T> {
  elements: T[]
  total: number
  page: number
  limite: number
}

export type CanalConnexion = 'sms' | 'whatsapp'

// ---------------------------------------------------------------------------------------------
// Canaux effectifs : drapeau du pays ET fournisseur configuré (D-A5-13)
// ---------------------------------------------------------------------------------------------

/** WhatsApp n'a aucun fournisseur (`SenderOtpWhatsapp`) : le drapeau est inopérant. */
export function whatsappFournisseurConfigure(): boolean {
  return false
}

// ---------------------------------------------------------------------------------------------
// Cache des pays (5 s, comme les autres lectures de configuration)
// ---------------------------------------------------------------------------------------------

const PAYS_CACHE_MS = 5_000
let paysEnCache: { lus: PaysLu[], chargeLe: number } | null = null

/** Vide le cache des pays (après une écriture validée). */
export function viderCachePays(): void {
  paysEnCache = null
}

async function chargerPays(lecteur: Pick<typeof db, 'select'>): Promise<PaysLu[]> {
  return lecteur.select().from(pays).orderBy(asc(pays.libelle), asc(pays.code))
}

/** Pays du catalogue, en cache 5 s ; `sansCache` relit la base. Un échec de lecture sert le cache périmé (jamais d'erreur). */
export async function lirePays(options: { sansCache?: boolean } = {}): Promise<PaysLu[]> {
  const maintenant = Date.now()
  if (options.sansCache !== true && paysEnCache !== null && maintenant - paysEnCache.chargeLe < PAYS_CACHE_MS) return paysEnCache.lus
  try {
    const lus = await chargerPays(db)
    paysEnCache = { lus, chargeLe: maintenant }
    return lus
  } catch {
    console.error({ configuration: 'lecture_pays_impossible' })
    return paysEnCache?.lus ?? []
  }
}

/** Pays actif de ce code, sinon `null`. */
export async function paysActif(code: string): Promise<PaysLu | null> {
  const trouve = (await lirePays()).find((candidat) => candidat.code === code.toUpperCase())
  return trouve !== undefined && trouve.actif ? trouve : null
}

/** Fuseau de repli d'une vitrine dont le fuseau n'est pas lisible : premier fuseau de son pays, sinon `ABONNEMENT_FUSEAU_REPLI`. */
export async function lirePaysFuseauRepli(code: string | null | undefined): Promise<string> {
  if (!code) return ABONNEMENT_FUSEAU_REPLI
  const trouve = (await lirePays()).find((candidat) => candidat.code === code.toUpperCase())
  return trouve?.fuseaux[0] ?? ABONNEMENT_FUSEAU_REPLI
}

function canalEffectif(pays: PaysLu, canal: CanalConnexion): boolean {
  return canal === 'sms'
    ? pays.canalSms && smsFournisseurConfigure()
    : pays.canalWhatsapp && whatsappFournisseurConfigure()
}

/**
 * Le canal est-il disponible pour ce numéro ? Le plus RESTRICTIF s'applique quand l'indicatif est partagé (`+1`). Un
 * numéro d'un pays absent du catalogue n'est pas bloqué (aucune décision d'administration ne le vise).
 */
export async function canalCodePourIndicatif(numero: string, canal: CanalConnexion): Promise<boolean> {
  const concernes = paysDuNumero(numero, await lirePays())
  return concernes.every((p) => canalEffectif(p, canal))
}

/** Refuse (422 `CANAL_INDISPONIBLE`) avant toute mise en file. Appelé par l'envoi de code par SMS. */
export async function exigerCanalDisponible(numero: string, canal: CanalConnexion): Promise<void> {
  if (!(await canalCodePourIndicatif(numero, canal))) throw new UnprocessableError('CANAL_INDISPONIBLE')
}

// ---------------------------------------------------------------------------------------------
// Noms d'adresse (R11, CA16)
// ---------------------------------------------------------------------------------------------

/** Refuse (422 `NOM_BLOQUE`) un nom réservé par le code OU bloqué en base. Les vitrines existantes ne sont jamais modifiées. */
export async function verifierNomUtilisateur(valeur: string, lecteur: Pick<typeof db, 'select'> = db): Promise<void> {
  const nom = valeur.trim().toLowerCase()
  if (isReserved(nom)) throw new UnprocessableError('NOM_BLOQUE')
  const [bloque] = await lecteur.select({ valeur: usernamesBloques.valeur }).from(usernamesBloques).where(eq(usernamesBloques.valeur, nom)).limit(1)
  if (bloque !== undefined) throw new UnprocessableError('NOM_BLOQUE')
}

// ---------------------------------------------------------------------------------------------
// Lecture
// ---------------------------------------------------------------------------------------------

function versPaysVue(ligne: PaysLu, utilise: boolean): PaysVue {
  return { ...ligne, smsEffectif: canalEffectif(ligne, 'sms'), whatsappEffectif: canalEffectif(ligne, 'whatsapp'), utilise }
}

async function paysUtilises(lecteur: Pick<typeof db, 'selectDistinct'>): Promise<Set<string>> {
  const lignes = await lecteur.selectDistinct({ pays: vitrines.pays }).from(vitrines)
  return new Set(lignes.flatMap((ligne) => (ligne.pays === null ? [] : [ligne.pays.toUpperCase()])))
}

async function devisesPayables(): Promise<Set<string>> {
  // Import tardif : l'offre dépend de la configuration lue ci-dessus (évite un cycle de modules).
  const { construireOffre } = await import('../paiements/offre')
  return new Set(construireOffre(null).devises.map((offre) => offre.devise))
}

export type ContenuCatalogue = PageCatalogue<PaysVue> | PageCatalogue<DeviseVue> | PageCatalogue<NomBloqueVue>

export async function listerPays(page: number, limite: number): Promise<PageCatalogue<PaysVue>> {
  const [lignes, [total], utilises] = await Promise.all([
    db.select().from(pays).orderBy(asc(pays.libelle), asc(pays.code)).limit(limite).offset((page - 1) * limite),
    db.select({ total: count() }).from(pays),
    paysUtilises(db),
  ])
  return { elements: lignes.map((ligne) => versPaysVue(ligne, utilises.has(ligne.code))), total: total?.total ?? 0, page, limite }
}

export async function listerDevises(page: number, limite: number): Promise<PageCatalogue<DeviseVue>> {
  const [lignes, [total], payables] = await Promise.all([
    db.select().from(devises).orderBy(asc(devises.code)).limit(limite).offset((page - 1) * limite),
    db.select({ total: count() }).from(devises),
    devisesPayables(),
  ])
  return {
    elements: lignes.map((ligne) => ({ code: ligne.code, actif: ligne.actif, payable: ligne.actif && payables.has(ligne.code), modifieLe: ligne.modifieLe })),
    total: total?.total ?? 0,
    page,
    limite,
  }
}

export async function listerNomsBloques(page: number, limite: number): Promise<PageCatalogue<NomBloqueVue>> {
  const [lignes, [total]] = await Promise.all([
    db.select().from(usernamesBloques).orderBy(asc(usernamesBloques.valeur)).limit(limite).offset((page - 1) * limite),
    db.select({ total: count() }).from(usernamesBloques),
  ])
  return { elements: lignes, total: total?.total ?? 0, page, limite }
}

export async function listerCatalogue(nom: AdminCatalogue, page: number, limite: number): Promise<ContenuCatalogue> {
  if (nom === 'pays') return listerPays(page, limite)
  if (nom === 'devises') return listerDevises(page, limite)
  return listerNomsBloques(page, limite)
}

export async function lireEntree(nom: AdminCatalogue, id: string): Promise<PaysVue | DeviseVue | NomBloqueVue> {
  if (nom === 'pays') {
    const [ligne] = await db.select().from(pays).where(eq(pays.code, id.toUpperCase())).limit(1)
    if (!ligne) throw entreeIntrouvable()
    return versPaysVue(ligne, (await paysUtilises(db)).has(ligne.code))
  }
  if (nom === 'devises') {
    const [ligne] = await db.select().from(devises).where(eq(devises.code, id.toUpperCase())).limit(1)
    if (!ligne) throw entreeIntrouvable()
    return { code: ligne.code, actif: ligne.actif, payable: ligne.actif && (await devisesPayables()).has(ligne.code), modifieLe: ligne.modifieLe }
  }
  const [ligne] = await db.select().from(usernamesBloques).where(eq(usernamesBloques.valeur, id)).limit(1)
  if (!ligne) throw entreeIntrouvable()
  return ligne
}

// ---------------------------------------------------------------------------------------------
// Écritures
// ---------------------------------------------------------------------------------------------

export interface ResultatCatalogue<T> {
  entree: T
  rejoue: boolean
}

const cibleCatalogue = (nom: AdminCatalogue, id: string): string => `${nom}:${id}`

function etatPays(ligne: PaysLu): Record<string, string | number | boolean> {
  return {
    actif: ligne.actif,
    canal_sms: ligne.canalSms,
    canal_whatsapp: ligne.canalWhatsapp,
    canal_email: ligne.canalEmail,
    devise_defaut: ligne.deviseDefaut,
    indicatif: ligne.indicatif,
    nb_fuseaux: ligne.fuseaux.length,
  }
}

/** Contrôle D-A5-12 : seuls les fuseaux AJOUTÉS doivent être connus du moteur (un fuseau déjà enregistré reste valide). */
function exigerFuseauxConnus(nouveaux: readonly string[], anciens: readonly string[]): void {
  const connus = new Set([...listerFuseaux(), 'UTC'])
  const inconnus = nouveaux.filter((fuseau) => !anciens.includes(fuseau) && !connus.has(fuseau))
  if (inconnus.length > 0) throw new UnprocessableError('FUSEAU_INCONNU', { champs: { fuseaux: inconnus } })
}

export async function modifierPays(
  auteur: AuteurEcritureReauth,
  code: string,
  corps: ModifierPays,
): Promise<ResultatCatalogue<PaysVue>> {
  const codePays = code.toUpperCase()
  const { motif, ...champs } = corps
  const parametres = { empreinte: empreinteValeurs(champs) }
  const rejoue = await db.transaction(async (tx) => {
    const dejaFait = await rejouer(tx, auteur, {
      action: ADMIN_ACTIONS.catalogueModifier,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue('pays', codePays),
      motif,
      parametres,
    })
    if (dejaFait !== null) return true
    const [avant] = await tx.select().from(pays).where(eq(pays.code, codePays)).for('update').limit(1)
    if (!avant) throw entreeIntrouvable()
    await auteur.reauth(tx)
    if (champs.fuseaux !== undefined) exigerFuseauxConnus(champs.fuseaux, avant.fuseaux)
    const [devise] = champs.deviseDefaut === undefined
      ? [{ code: avant.deviseDefaut }]
      : await tx.select({ code: devises.code }).from(devises).where(eq(devises.code, champs.deviseDefaut)).limit(1)
    if (!devise) throw new ValidationError({ deviseDefaut: ['Devise inconnue.'] })
    const [apres] = await tx
      .update(pays)
      .set({ ...champs, modifieLe: horlogeDe(auteur) })
      .where(eq(pays.code, codePays))
      .returning()
    if (!apres) throw entreeIntrouvable()
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action: ADMIN_ACTIONS.catalogueModifier,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue('pays', codePays),
      avant: etatPays(avant),
      apres: { ...etatPays(apres), ...parametres },
      motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return false
  })
  viderCachePays()
  return { entree: (await lireEntree('pays', codePays)) as PaysVue, rejoue }
}

export async function modifierDevise(
  auteur: AuteurEcritureReauth,
  code: string,
  corps: ModifierDevise,
): Promise<ResultatCatalogue<DeviseVue>> {
  const codeDevise = code.toUpperCase()
  const parametres = { empreinte: empreinteValeurs({ actif: corps.actif }) }
  const rejoue = await db.transaction(async (tx) => {
    const dejaFait = await rejouer(tx, auteur, {
      action: ADMIN_ACTIONS.catalogueModifier,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue('devises', codeDevise),
      motif: corps.motif,
      parametres,
    })
    if (dejaFait !== null) return true
    const [avant] = await tx.select().from(devises).where(eq(devises.code, codeDevise)).for('update').limit(1)
    if (!avant) throw entreeIntrouvable()
    await auteur.reauth(tx)
    await tx.update(devises).set({ actif: corps.actif, modifieLe: horlogeDe(auteur) }).where(eq(devises.code, codeDevise))
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action: ADMIN_ACTIONS.catalogueModifier,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue('devises', codeDevise),
      avant: { actif: avant.actif },
      apres: { actif: corps.actif, ...parametres },
      motif: corps.motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return false
  })
  return { entree: (await lireEntree('devises', codeDevise)) as DeviseVue, rejoue }
}

export async function modifierEntree(
  auteur: AuteurEcritureReauth,
  nom: AdminCatalogue,
  id: string,
  corps: ModifierPays | ModifierDevise,
): Promise<ResultatCatalogue<PaysVue | DeviseVue>> {
  if (nom === 'pays') return modifierPays(auteur, id, corps as ModifierPays)
  if (nom === 'devises') return modifierDevise(auteur, id, corps as ModifierDevise)
  throw new UnprocessableError('VALIDATION', { champs: { nom: ['Cette liste ne se modifie pas : retirez l’entrée.'] } })
}

/** Ajoute un nom bloqué. Un nom déjà réservé ou déjà bloqué : 409 `ETAT_DEJA_APPLIQUE`. */
export async function creerNomBloque(
  auteur: AuteurEcritureReauth,
  corps: CreerNomBloque,
): Promise<ResultatCatalogue<NomBloqueVue>> {
  const parametres = { empreinte: empreinteValeurs({ valeur: corps.valeur }) }
  const rejoue = await db.transaction(async (tx) => {
    const dejaFait = await rejouer(tx, auteur, {
      action: ADMIN_ACTIONS.catalogueCreer,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue('noms-bloques', corps.valeur),
      motif: corps.motif,
      parametres,
    })
    if (dejaFait !== null) return true
    await auteur.reauth(tx)
    if (isReserved(corps.valeur)) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    const [cree] = await tx
      .insert(usernamesBloques)
      .values({ valeur: corps.valeur, motif: corps.motif, creePar: auteur.adminId })
      .onConflictDoNothing()
      .returning({ valeur: usernamesBloques.valeur })
    if (!cree) throw new ConflictError('ETAT_DEJA_APPLIQUE')
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action: ADMIN_ACTIONS.catalogueCreer,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue('noms-bloques', corps.valeur),
      apres: { bloque: true, ...parametres },
      motif: corps.motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return false
  })
  return { entree: (await lireEntree('noms-bloques', corps.valeur)) as NomBloqueVue, rejoue }
}

async function supprimerPays(tx: TransactionAdmin, code: string): Promise<Record<string, string | number | boolean>> {
  const [ligne] = await tx.select().from(pays).where(eq(pays.code, code)).for('update').limit(1)
  if (!ligne) throw entreeIntrouvable()
  // Refusé dès qu'une vitrine le référence (pas de clé étrangère : le contrôle vit ici, sous le verrou de la ligne).
  const [utilisee] = await tx.select({ n: sql<number>`1` }).from(vitrines).where(sql`upper(${vitrines.pays}) = ${code}`).limit(1)
  if (utilisee !== undefined) throw new ConflictError('CATALOGUE_ENTREE_UTILISEE')
  await tx.delete(pays).where(eq(pays.code, code))
  return etatPays(ligne)
}

/** Retire une entrée : pays non utilisé ou nom bloqué. Une devise ne se retire jamais (elle se désactive). */
export async function supprimerEntree(
  auteur: AuteurEcritureReauth,
  nom: AdminCatalogue,
  id: string,
  motif: string,
): Promise<{ rejoue: boolean }> {
  if (nom === 'devises') throw new ConflictError('CATALOGUE_ENTREE_UTILISEE')
  const identifiant = nom === 'pays' ? id.toUpperCase() : id
  const rejoue = await db.transaction(async (tx) => {
    const dejaFait = await rejouer(tx, auteur, {
      action: ADMIN_ACTIONS.catalogueSupprimer,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue(nom, identifiant),
      motif,
      parametres: {},
    })
    if (dejaFait !== null) return true
    await auteur.reauth(tx)
    let avant: Record<string, string | number | boolean>
    if (nom === 'pays') {
      avant = await supprimerPays(tx, identifiant)
    } else {
      const [supprime] = await tx.delete(usernamesBloques).where(eq(usernamesBloques.valeur, identifiant)).returning({ valeur: usernamesBloques.valeur })
      if (!supprime) throw entreeIntrouvable()
      avant = { bloque: true }
    }
    await enregistrer(tx, {
      adminId: auteur.adminId,
      action: ADMIN_ACTIONS.catalogueSupprimer,
      cibleType: ADMIN_CIBLES.catalogue,
      cibleId: cibleCatalogue(nom, identifiant),
      avant,
      apres: { supprime: true },
      motif,
      ip: auteur.ip,
      cleIdempotence: auteur.cleIdempotence,
    })
    return false
  })
  viderCachePays()
  return { rejoue }
}

// ---------------------------------------------------------------------------------------------
// Lecture publique (D-A5-15)
// ---------------------------------------------------------------------------------------------

export interface ReferentielsLus {
  pays: { code: string, libelle: string, indicatif: string, deviseDefaut: string, fuseaux: string[], canaux: { sms: boolean, whatsapp: boolean, email: boolean } }[]
  devises: string[]
}

/** Pays actifs (canaux EFFECTIFS) et devises actives. Aucune donnée d'administration. */
export async function lireReferentiels(): Promise<ReferentielsLus> {
  const [lus, lignesDevises] = await Promise.all([
    lirePays(),
    db.select({ code: devises.code }).from(devises).where(eq(devises.actif, true)).orderBy(asc(devises.code)),
  ])
  return {
    pays: lus
      .filter((p) => p.actif)
      .map((p) => ({
        code: p.code,
        libelle: p.libelle,
        indicatif: p.indicatif,
        deviseDefaut: p.deviseDefaut,
        fuseaux: p.fuseaux,
        canaux: { sms: canalEffectif(p, 'sms'), whatsapp: canalEffectif(p, 'whatsapp'), email: p.canalEmail },
      })),
    devises: lignesDevises.map((ligne) => ligne.code),
  }
}
