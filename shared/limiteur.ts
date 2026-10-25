export const OTP_LIMIT_IP = 10
export const OTP_LIMIT_IDENTIFIER = 1
export const OTP_WINDOW_SECONDS = 60

export type OtpLimitVerdict =
  | { allowed: true }
  | { allowed: false; message: string }

export function checkOtpLimit(ipCount: number, identifierCount: number): OtpLimitVerdict {
  if (identifierCount > OTP_LIMIT_IDENTIFIER) {
    return {
      allowed: false,
      message: `Un code vient d'être envoyé. Le renvoi est possible dans ${OTP_WINDOW_SECONDS} secondes.`,
    }
  }
  if (ipCount > OTP_LIMIT_IP) {
    return {
      allowed: false,
      message: 'Trop de tentatives. Patientez une minute avant de recommencer.',
    }
  }
  return { allowed: true }
}
