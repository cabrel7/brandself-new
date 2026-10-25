interface UtilisateurAuth {
  id: string
  email?: string | null
  phoneNumber?: string | null
  nom?: string
  locale?: string
  devise?: string
  fuseau?: string
}

export default defineEventHandler(async (event) => {
  const { user: brut } = await requireUserSession(event)
  const user = brut as unknown as UtilisateurAuth
  return {
    id: user.id,
    email: user.email ?? null,
    telephone: user.phoneNumber ?? null,
    nom: user.nom ?? '',
    locale: user.locale ?? 'fr',
    devise: user.devise ?? 'XAF',
    fuseau: user.fuseau ?? 'Africa/Douala',
    aUneVitrine: false,
  }
})
