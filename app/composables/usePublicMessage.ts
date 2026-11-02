import type { MessageCreatedDTO } from '#shared/dto'
import type { MessageCreateInput, SujetMessage } from '#shared/message'
import { MESSAGE_EMAIL_MAX, MESSAGE_MAX, MESSAGE_NOM_MAX, MESSAGE_TELEPHONE_MAX, SUJETS_MESSAGE } from '#shared/message'
import { schemaMessageCreate } from '#shared/schemas/message'

type ChampMessage = 'nom' | 'email' | 'telephone' | 'sujet' | 'message'
type ErreursMessage = Partial<Record<ChampMessage, string>>

const CHAMPS_MESSAGE: readonly ChampMessage[] = ['nom', 'email', 'telephone', 'sujet', 'message']
const MESSAGE_GENERIQUE = 'Nous n’avons pas pu envoyer votre message. Vos informations sont gardées, réessayez dans un instant.'
const MESSAGE_TROP_DE_REQUETES = 'Trop de messages ont été envoyés.'

function messageTropDeRequetes(retryAfterS: number | null): string {
  if (retryAfterS === null || retryAfterS < 120) {
    return `${MESSAGE_TROP_DE_REQUETES} Réessayez dans quelques instants.`
  }
  const minutes = Math.ceil(retryAfterS / 60)
  if (minutes < 60) {
    return `${MESSAGE_TROP_DE_REQUETES} Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`
  }
  const heures = Math.ceil(minutes / 60)
  return `${MESSAGE_TROP_DE_REQUETES} Réessayez dans environ ${heures} heure${heures > 1 ? 's' : ''}.`
}

function normaliserTelephone(value: string): string {
  return value.trim().replace(/[\s().-]/g, '')
}

function estChampMessage(value: string): value is ChampMessage {
  return CHAMPS_MESSAGE.some(champ => champ === value)
}

/**
 * Formulaire « Écrivez-moi » de la page Contact (S7-bis) : aucune donnée
 * personnelle n'est mise en cache globalement, la réponse ne sert qu'au succès.
 */
const SUJET_PAR_DEFAUT: SujetMessage = SUJETS_MESSAGE[0]

export function usePublicMessage(options: { username: string }) {
  const form = reactive({
    nom: '',
    email: '',
    telephone: '',
    sujet: SUJET_PAR_DEFAUT,
    message: '',
    siteWeb: '',
  })
  const erreurs = ref<ErreursMessage>({})
  const erreurGenerale = ref('')
  const envoyee = ref(false)
  const envoi = ref(false)

  // Le message de succès reste affiché tant que le visiteur ne saisit rien de nouveau.
  watch(form, () => {
    if (envoyee.value) envoyee.value = false
  })

  function viderErreur(champ: ChampMessage): void {
    if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
  }

  function construireCorps(): Record<string, unknown> {
    const telephone = normaliserTelephone(form.telephone)
    return {
      nom: form.nom.trim(),
      email: form.email.trim(),
      ...(telephone === '' ? {} : { telephone }),
      sujet: form.sujet,
      message: form.message.trim(),
      siteWeb: form.siteWeb,
    }
  }

  function valider(): MessageCreateInput | null {
    const resultat = schemaMessageCreate.safeParse(construireCorps())
    if (resultat.success) return resultat.data

    const erreursChamps: ErreursMessage = {}
    for (const issue of resultat.error.issues) {
      const champ = String(issue.path[0] ?? '')
      if (estChampMessage(champ) && !erreursChamps[champ]) erreursChamps[champ] = issue.message
    }
    erreurs.value = erreursChamps
    if (Object.keys(erreursChamps).length === 0) erreurGenerale.value = 'Vérifiez les informations saisies.'
    return null
  }

  function rangerErreur(error: unknown): void {
    const api = lireErreurApi(error)
    if (api.code === 'VALIDATION') {
      const erreursChamps: ErreursMessage = {}
      for (const [champ, messages] of Object.entries(api.champs)) {
        if (estChampMessage(champ) && messages?.[0]) erreursChamps[champ] = messages[0]
      }
      erreurs.value = erreursChamps
      erreurGenerale.value = Object.keys(erreursChamps).length === 0 ? 'Vérifiez les informations saisies.' : ''
      return
    }
    if (api.code === 'TROP_DE_REQUETES') {
      erreurGenerale.value = messageTropDeRequetes(api.retryAfter)
      return
    }
    if (api.code === 'LIMITEUR_INDISPONIBLE') {
      erreurGenerale.value = 'Le formulaire est momentanément indisponible. Réessayez dans quelques instants.'
      return
    }
    erreurGenerale.value = MESSAGE_GENERIQUE
  }

  async function soumettre(): Promise<void> {
    if (envoi.value) return
    erreurs.value = {}
    erreurGenerale.value = ''
    const corps = valider()
    if (!corps) return

    envoi.value = true
    try {
      await $fetch<MessageCreatedDTO>(
        `/api/public/${encodeURIComponent(options.username)}/messages`,
        { method: 'POST', body: corps },
      )
      form.nom = ''
      form.email = ''
      form.telephone = ''
      form.sujet = SUJET_PAR_DEFAUT
      form.message = ''
      form.siteWeb = ''
      envoyee.value = true
    }
    catch (error) {
      rangerErreur(error)
    }
    finally {
      envoi.value = false
    }
  }

  return {
    form,
    erreurs,
    erreurGenerale,
    envoyee: readonly(envoyee),
    envoi,
    limites: {
      nom: MESSAGE_NOM_MAX,
      email: MESSAGE_EMAIL_MAX,
      telephone: MESSAGE_TELEPHONE_MAX,
      message: MESSAGE_MAX,
    },
    viderErreur,
    soumettre,
  }
}
