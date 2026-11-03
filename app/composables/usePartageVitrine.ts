import type { PartageDTO } from '#shared/dto'
import { buildShareMessage, linkedinShareUrl, whatsappShareUrl } from '#shared/partage'

export const ANNONCE_MESSAGE_COPIE = 'Message copié.'
export const ANNONCE_LINKEDIN_COPIE = 'Message copié : collez-le dans votre publication.'
export const ANNONCE_COPIE_IMPOSSIBLE = 'Copie impossible. Sélectionnez le message ci-dessus pour le copier.'
export const ANNONCE_QR_TELECHARGE = 'QR code téléchargé.'
export const ANNONCE_QR_IMPOSSIBLE = 'Téléchargement impossible. Réessayez dans un instant.'

interface UsePartageVitrineOptions {
  /** La vitrine propose la réservation d'un rendez-vous (message adapté). Faux par défaut. */
  reservable?: MaybeRefOrGetter<boolean>
}

/**
 * Message de partage prêt, liens WhatsApp et LinkedIn, copie et QR code de la vitrine.
 * Le premier geste enregistre le partage (`POST /api/studio/vitrine/partage`, idempotent) sans jamais bloquer ni alerter.
 */
export function usePartageVitrine(options: UsePartageVitrineOptions = {}) {
  const { vitrine } = useStudioVitrine()

  const adresse = computed(() => (vitrine.value ? `${HOTE_VITRINES}/${vitrine.value.username}` : ''))
  const url = computed(() => (adresse.value ? `https://${adresse.value}` : ''))

  const message = computed(() => {
    if (!vitrine.value) return ''
    return buildShareMessage({
      prenom: vitrine.value.prenom,
      metier: vitrine.value.metier,
      url: url.value,
      reservable: toValue(options.reservable) ?? false,
    })
  })
  const pret = computed(() => message.value !== '')

  const lienWhatsapp = computed(() => (pret.value ? whatsappShareUrl(message.value) : undefined))
  const lienLinkedin = computed(() => (pret.value ? linkedinShareUrl(url.value) : undefined))

  const annonce = ref('')
  async function annoncer(texte: string): Promise<void> {
    // Vider puis réécrire : un même texte est annoncé de nouveau.
    annonce.value = ''
    await nextTick()
    annonce.value = texte
  }

  let partageEnregistre = false
  /** Un échec est sans conséquence pour la personne : elle a bien partagé, seule la prochaine étape en dépend. */
  async function enregistrerPartage(): Promise<void> {
    if (partageEnregistre) return
    partageEnregistre = true
    try {
      await $fetch<PartageDTO>('/api/studio/vitrine/partage', { method: 'POST' })
    } catch {
      partageEnregistre = false
    }
  }

  async function copierTexte(texte: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(texte)
      return true
    } catch {
      return false
    }
  }

  /** Clic sur le lien WhatsApp (la navigation est assurée par le lien lui-même). */
  async function partagerWhatsapp(): Promise<void> {
    await enregistrerPartage()
  }

  /** LinkedIn n'accepte que l'URL : le message est copié avant l'ouverture, et annoncé. */
  async function partagerLinkedin(): Promise<void> {
    const copie = await copierTexte(message.value)
    await annoncer(copie ? ANNONCE_LINKEDIN_COPIE : ANNONCE_COPIE_IMPOSSIBLE)
    await enregistrerPartage()
  }

  async function copierMessage(): Promise<void> {
    const copie = await copierTexte(message.value)
    await annoncer(copie ? ANNONCE_MESSAGE_COPIE : ANNONCE_COPIE_IMPOSSIBLE)
    if (copie) await enregistrerPartage()
  }

  /** Télécharge le QR code (SVG) affiché dans `conteneur`. */
  async function telechargerQrcode(conteneur: HTMLElement | null): Promise<void> {
    let objectUrl: string | null = null
    let ancre: HTMLAnchorElement | null = null
    try {
      const svg = conteneur?.querySelector<SVGSVGElement>('svg')
      if (!svg || !vitrine.value) throw new Error('QR code indisponible')
      const fichier = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml;charset=utf-8' })
      objectUrl = URL.createObjectURL(fichier)
      ancre = document.createElement('a')
      ancre.href = objectUrl
      ancre.download = `qr-code-brandself-${vitrine.value.username}.svg`
      document.body.appendChild(ancre)
      ancre.click()
      await annoncer(ANNONCE_QR_TELECHARGE)
      await enregistrerPartage()
    } catch {
      await annoncer(ANNONCE_QR_IMPOSSIBLE)
    } finally {
      ancre?.remove()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }

  function reinitialiserAnnonce(): void {
    annonce.value = ''
  }

  return {
    adresse, url, message, pret, lienWhatsapp, lienLinkedin, annonce,
    partagerWhatsapp, partagerLinkedin, copierMessage, telechargerQrcode, reinitialiserAnnonce,
  }
}
