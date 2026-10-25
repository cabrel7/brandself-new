import { emailOTPClient, phoneNumberClient } from 'better-auth/client/plugins'
import { defineClientAuth } from '@nuxtjs/better-auth/config'

export default defineClientAuth({
  plugins: [emailOTPClient(), phoneNumberClient()],
})
