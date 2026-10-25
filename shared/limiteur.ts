export const LIMITE_OTP_IP = 10
export const LIMITE_OTP_IDENTIFIANT = 1
export const FENETRE_OTP_SECONDES = 60

export type VerdictLimiteOtp =
  | { autorise: true }
  | { autorise: false; message: string }

export function verdictLimiteOtp(compteurIp: number, compteurIdentifiant: number): VerdictLimiteOtp {
  if (compteurIdentifiant > LIMITE_OTP_IDENTIFIANT) {
    return {
      autorise: false,
      message: `Un code vient d'être envoyé. Le renvoi est possible dans ${FENETRE_OTP_SECONDES} secondes.`,
    }
  }
  if (compteurIp > LIMITE_OTP_IP) {
    return {
      autorise: false,
      message: 'Trop de tentatives. Patientez une minute avant de recommencer.',
    }
  }
  return { autorise: true }
}
