export const LOCALES = ['fr'] as const
export type Locale = (typeof LOCALES)[number]

export const DEVISES = ['XAF', 'EUR', 'USD'] as const
export type Devise = (typeof DEVISES)[number]

export const ACCOUNT_DELETION_PHRASE = 'SUPPRIMER'
export const FRESH_SESSION_MAX_AGE_S = 86_400
export const TEMP_EMAIL_DOMAIN = 'telephone.brandself.local'
