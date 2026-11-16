// A5 : contrats Zod STRICTS des catalogues (pays, devises, noms d'adresse bloqués) et de la lecture publique des
// référentiels (docs/specs/A5-catalogues-versions.md §5, D-A5-10 à D-A5-15). Les réponses sont construites champ par
// champ puis validées par ces schémas. Les pays et les devises ne se CRÉENT pas depuis l'interface (migration
// seulement) ; seuls les noms bloqués s'ajoutent et se retirent. Clé d'idempotence : en-tête `Idempotency-Key` (D-A5-16).
import { z } from 'zod'
import {
  ADMIN_CATALOGUES,
  ADMIN_CIBLE_ID_MAX,
  ADMIN_LISTE_LIMITE_MAX,
  ADMIN_MOTIF_MIN,
  CATALOGUE_MOTIF_MAX,
  NOM_BLOQUE_FORMAT,
  PAYS_CODE_FORMAT,
  PAYS_FUSEAUX_MAX,
  PAYS_INDICATIF_FORMAT,
  PAYS_LIBELLE_MAX,
  PAYS_LIBELLE_MIN,
} from '../admin'
import { DEVISES } from '../compte'
import { isValidTimeZone } from '../fuseau'
import { schemaMotifAdmin } from './admin'
import { schemaIdAdmin, schemaPaginationAdmin } from './admin-a2'

const schemaInstant = z.iso.datetime()
const schemaCompteur = z.number().int().nonnegative()
const schemaIdCourt = z.string().min(1).max(ADMIN_CIBLE_ID_MAX)
const schemaDevise = z.enum(DEVISES)

/** Forme d'un identifiant IANA (`Africa/Douala`, `America/Argentina/Buenos_Aires`, `Etc/GMT+5`). */
export const FUSEAU_FORMAT = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9][A-Za-z0-9_+-]*){0,2}$/
const FUSEAU_LONGUEUR_MAX = 64

/**
 * Fuseau : forme ET existence pour le moteur (`isValidTimeZone`). L'appartenance à `listerFuseaux()` n'est contrôlée
 * que par le service, au CHANGEMENT de valeur (D-A5-12, un fuseau déjà enregistré reste valide) : `FUSEAU_INCONNU`.
 */
export const schemaFuseau = z
  .string()
  .min(3)
  .max(FUSEAU_LONGUEUR_MAX)
  .regex(FUSEAU_FORMAT)
  .refine(isValidTimeZone, { message: 'Fuseau horaire inconnu.' })

const schemaFuseaux = z
  .array(schemaFuseau)
  .min(1)
  .max(PAYS_FUSEAUX_MAX)
  .refine((fuseaux) => new Set(fuseaux).size === fuseaux.length, { message: 'Un fuseau ne peut figurer qu’une fois.' })

/** Motif d'un nom bloqué : stocké dans `usernames_bloques.motif` (5 à 200 caractères), plus court que le motif du journal. */
export const schemaMotifCatalogue = z.string().trim().min(ADMIN_MOTIF_MIN).max(CATALOGUE_MOTIF_MAX)

// --- Entrées ---

/** `[nom]` de `/api/admin/catalogues/[nom]`. */
export const schemaCatalogueNomParam = z.strictObject({ nom: z.enum(ADMIN_CATALOGUES) })
export type CatalogueNomParam = z.infer<typeof schemaCatalogueNomParam>

/** `[nom]` et `[id]` de `/api/admin/catalogues/[nom]/[id]` (`id` = code du pays, code de la devise ou valeur du nom). */
export const schemaCatalogueEntreeParam = z.strictObject({ nom: z.enum(ADMIN_CATALOGUES), id: schemaIdAdmin })
export type CatalogueEntreeParam = z.infer<typeof schemaCatalogueEntreeParam>

/** `GET /api/admin/catalogues/[nom]` : pagination par `page`/`limite`. */
export const schemaListeCatalogueQuery = schemaPaginationAdmin
export type ListeCatalogueQuery = z.infer<typeof schemaListeCatalogueQuery>

const champsPays = {
  libelle: z.string().trim().min(PAYS_LIBELLE_MIN).max(PAYS_LIBELLE_MAX),
  indicatif: z.string().regex(PAYS_INDICATIF_FORMAT),
  actif: z.boolean(),
  deviseDefaut: schemaDevise,
  fuseaux: schemaFuseaux,
  canalSms: z.boolean(),
  canalWhatsapp: z.boolean(),
  canalEmail: z.boolean(),
}

/** `PATCH …/pays/[code]` : au moins un champ, motif obligatoire. Aucune création ni suppression d'un pays utilisé. */
export const schemaModifierPays = z
  .strictObject({ ...champsPays, motif: schemaMotifAdmin })
  .partial({ libelle: true, indicatif: true, actif: true, deviseDefaut: true, fuseaux: true, canalSms: true, canalWhatsapp: true, canalEmail: true })
  .refine((corps) => Object.keys(corps).some((cle) => cle !== 'motif'), { message: 'Aucune modification à enregistrer.' })
export type ModifierPays = z.infer<typeof schemaModifierPays>

/** `PATCH …/devises/[code]` : seul le drapeau `actif` change (D-A5-10, D-A5-11). */
export const schemaModifierDevise = z.strictObject({ actif: z.boolean(), motif: schemaMotifAdmin })
export type ModifierDevise = z.infer<typeof schemaModifierDevise>

/** `POST …/noms-bloques` : une valeur en minuscules, un motif. La liste du code (`shared/reserved.ts`) n'est pas modifiable ici. */
export const schemaCreerNomBloque = z.strictObject({
  valeur: z.string().trim().toLowerCase().regex(NOM_BLOQUE_FORMAT),
  motif: schemaMotifCatalogue,
})
export type CreerNomBloque = z.infer<typeof schemaCreerNomBloque>

// `DELETE …/[nom]/[id]` : corps `schemaActionMotif` (A2), `{ motif }`.

// --- Sorties ---

/** Un pays du catalogue. `utilise` : au moins une vitrine le référence (donc « Désactiver », jamais « Supprimer »). */
export const schemaPaysDto = z.strictObject({
  code: z.string().regex(PAYS_CODE_FORMAT),
  libelle: z.string().min(PAYS_LIBELLE_MIN).max(PAYS_LIBELLE_MAX),
  indicatif: z.string().regex(PAYS_INDICATIF_FORMAT),
  actif: z.boolean(),
  deviseDefaut: schemaDevise,
  fuseaux: schemaFuseaux,
  canalSms: z.boolean(),
  canalWhatsapp: z.boolean(),
  /** Informatif : la connexion par e-mail ne connaît pas le pays (D-A5-13). */
  canalEmail: z.boolean(),
  /** Canal EFFECTIF = drapeau ET fournisseur configuré (SMS non branché en production, WhatsApp sans fournisseur). */
  smsEffectif: z.boolean(),
  whatsappEffectif: z.boolean(),
  utilise: z.boolean(),
  modifieLe: schemaInstant,
})
export type PaysDto = z.infer<typeof schemaPaysDto>

/** Une devise. `payable` est CALCULÉ (moyen actif + fournisseur configuré), distinct de `actif` (ce qu'un compte peut choisir, D-A5-11). */
export const schemaDeviseDto = z.strictObject({
  code: schemaDevise,
  actif: z.boolean(),
  payable: z.boolean(),
  modifieLe: schemaInstant,
})
export type DeviseDto = z.infer<typeof schemaDeviseDto>

export const schemaNomBloqueDto = z.strictObject({
  valeur: z.string().regex(NOM_BLOQUE_FORMAT),
  motif: z.string().min(1).max(CATALOGUE_MOTIF_MAX),
  /** Identifiant de l'administrateur auteur. */
  creePar: schemaIdCourt,
  creeLe: schemaInstant,
})
export type NomBloqueDto = z.infer<typeof schemaNomBloqueDto>

function schemaListe<N extends (typeof ADMIN_CATALOGUES)[number], E extends z.ZodType>(nom: N, element: E) {
  return z.strictObject({
    nom: z.literal(nom),
    elements: z.array(element).max(ADMIN_LISTE_LIMITE_MAX),
    total: schemaCompteur,
    page: z.number().int().min(1),
    limite: z.number().int().min(1).max(ADMIN_LISTE_LIMITE_MAX),
  })
}

/** `GET /api/admin/catalogues/[nom]` : le contenu de `elements` dépend de `nom`. */
export const schemaListeCatalogueDto = z.discriminatedUnion('nom', [
  schemaListe('pays', schemaPaysDto),
  schemaListe('devises', schemaDeviseDto),
  schemaListe('noms-bloques', schemaNomBloqueDto),
])
export type ListeCatalogueDto = z.infer<typeof schemaListeCatalogueDto>

/** Réponses des écritures : l'entrée telle qu'enregistrée, et `rejoue` si la réponse est relue du journal (idempotence). */
export const schemaPaysReponse = z.strictObject({ entree: schemaPaysDto, rejoue: z.boolean() })
export const schemaDeviseReponse = z.strictObject({ entree: schemaDeviseDto, rejoue: z.boolean() })
export const schemaNomBloqueReponse = z.strictObject({ entree: schemaNomBloqueDto, rejoue: z.boolean() })
export type PaysReponse = z.infer<typeof schemaPaysReponse>
export type DeviseReponse = z.infer<typeof schemaDeviseReponse>
export type NomBloqueReponse = z.infer<typeof schemaNomBloqueReponse>

/**
 * `GET /api/referentiels` (public, D-A5-15, cache 60 s) : pays actifs avec indicatif, fuseaux et canaux EFFECTIFS,
 * devises actives. Aucune donnée d'administration (ni motif, ni date, ni identifiant d'administrateur).
 */
export const schemaReferentielsDto = z.strictObject({
  pays: z.array(
    z.strictObject({
      code: z.string().regex(PAYS_CODE_FORMAT),
      libelle: z.string().min(PAYS_LIBELLE_MIN).max(PAYS_LIBELLE_MAX),
      indicatif: z.string().regex(PAYS_INDICATIF_FORMAT),
      deviseDefaut: schemaDevise,
      fuseaux: schemaFuseaux,
      canaux: z.strictObject({ sms: z.boolean(), whatsapp: z.boolean(), email: z.boolean() }),
    }),
  ),
  devises: z.array(schemaDevise),
})
export type ReferentielsDto = z.infer<typeof schemaReferentielsDto>
