import type { VitrineStudioDTO, StudioResumeDTO } from '#shared/dto'
import { DEFAULT_PALETTE, type Palette } from '#shared/palettes'
import type { NextStep, Titre } from '#shared/vitrine'

/** Valeur du sélecteur pour « pas de titre » (le serveur attend `null`). */
export const TITRE_AUCUN = 'aucun'

export const HOTE_VITRINES = 'brandself.io'

type ChampOnboarding = 'titre' | 'prenom' | 'nom' | 'metier' | 'username'

interface ReponseVitrine {
  vitrine: VitrineStudioDTO
  resume: StudioResumeDTO
}

interface EnLigne {
  username: string
  prochaineEtape: NextStep | null
}

const HTTP_BAD_REQUEST = 400
const HTTP_CONFLICT = 409

const ERREUR_GENERALE = "Nous n'avons pas pu créer votre vitrine. Vos informations sont gardées, réessayez dans un instant."
const ERREUR_PRIS = 'Cette adresse est déjà prise. Essayez-en une autre.'

interface ErreurApi {
  statusCode: number | undefined
  code: string | undefined
  champs: Partial<Record<string, string[]>>
}

function lireErreur(err: unknown): ErreurApi {
  const vide: ErreurApi = { statusCode: undefined, code: undefined, champs: {} }
  if (typeof err !== 'object' || err === null) return vide
  const statusCode = 'statusCode' in err && typeof err.statusCode === 'number' ? err.statusCode : undefined
  const corps = 'data' in err && typeof err.data === 'object' && err.data !== null ? err.data : null
  const detail = corps && 'data' in corps && typeof corps.data === 'object' && corps.data !== null ? corps.data : null
  const code = detail && 'code' in detail && typeof detail.code === 'string' ? detail.code : undefined
  const champs: ErreurApi['champs'] = {}
  if (detail && 'champs' in detail && typeof detail.champs === 'object' && detail.champs !== null) {
    for (const [champ, messages] of Object.entries(detail.champs)) {
      if (Array.isArray(messages)) champs[champ] = messages.filter((m): m is string => typeof m === 'string')
    }
  }
  return { statusCode, code, champs }
}

/** Création de la vitrine à l'onboarding : état du formulaire, erreurs par champ, enchaînement. */
export function useOnboardingVitrine() {
  const titre = ref<string>(TITRE_AUCUN)
  const prenom = ref('')
  const nom = ref('')
  const metier = ref('')
  const username = ref('')
  const palette = ref<Palette>(DEFAULT_PALETTE)

  const chargement = ref(false)
  const erreurs = ref<Partial<Record<ChampOnboarding, string>>>({})
  const erreurGenerale = ref('')
  const enLigne = ref<EnLigne | null>(null)

  async function soumettre(): Promise<void> {
    erreurs.value = {}
    erreurGenerale.value = ''
    chargement.value = true
    try {
      const { vitrine, resume } = await $fetch<ReponseVitrine>('/api/studio/vitrine', {
        method: 'POST',
        body: {
          titre: titre.value === TITRE_AUCUN ? null : (titre.value as Titre),
          prenom: prenom.value,
          nom: nom.value,
          metier: metier.value,
          username: username.value.trim().toLowerCase(),
        },
      })
      await appliquerSuite(vitrine, resume)
    } catch (err: unknown) {
      const { statusCode, code, champs } = lireErreur(err)
      if (code === 'VITRINE_EXISTE') {
        await navigateTo('/studio')
      } else if (statusCode === HTTP_CONFLICT) {
        erreurs.value = { username: ERREUR_PRIS }
      } else if (statusCode === HTTP_BAD_REQUEST && Object.keys(champs).length > 0) {
        erreurs.value = {
          titre: champs.titre?.[0],
          prenom: champs.prenom?.[0],
          nom: champs.nom?.[0],
          metier: champs.metier?.[0],
          username: champs.username?.[0],
        }
      } else {
        erreurGenerale.value = ERREUR_GENERALE
      }
    } finally {
      chargement.value = false
    }
  }

  /** La vitrine existe : choix de palette, puis publication si elle est complète, sinon studio. */
  async function appliquerSuite(vitrine: VitrineStudioDTO, resume: StudioResumeDTO): Promise<void> {
    if (palette.value !== DEFAULT_PALETTE) {
      try {
        await $fetch('/api/studio/vitrine', { method: 'PUT', body: { palette: palette.value } })
      } catch {
        // Non bloquant : la vitrine est créée, la palette se change depuis le studio.
      }
    }
    if (vitrine.ville && vitrine.pays) {
      try {
        await $fetch('/api/studio/vitrine/publier', { method: 'POST' })
        enLigne.value = { username: vitrine.username, prochaineEtape: resume.prochaineEtape }
        return
      } catch {
        // Publication refusée : le studio guidera vers ce qui manque.
      }
    }
    await navigateTo('/studio')
  }

  return { titre, prenom, nom, metier, username, palette, chargement, erreurs, erreurGenerale, enLigne, soumettre }
}
