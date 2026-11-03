<script setup lang="ts">
const QR_TAILLE = 192

const props = defineProps<{
  /** La vitrine propose la réservation d'un rendez-vous (adapte le message prêt). */
  reservable?: boolean
}>()

const ouvert = defineModel<boolean>('open', { default: false })

const {
  url, message, pret, lienWhatsapp, lienLinkedin, annonce,
  partagerWhatsapp, partagerLinkedin, copierMessage, telechargerQrcode, reinitialiserAnnonce,
} = usePartageVitrine({ reservable: () => props.reservable ?? false })

const qrConteneur = useTemplateRef<HTMLElement>('qrConteneur')

watch(ouvert, (valeur) => {
  if (!valeur) reinitialiserAnnonce()
})
</script>

<template>
  <UModal
    v-model:open="ouvert"
    title="Partager votre vitrine"
    description="Un message prêt à envoyer, et un QR code à afficher ou à imprimer."
  >
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="m-0 rounded-(--rayon-interne) border border-bordure bg-surface p-4 text-base text-encre">
          {{ message }}
        </p>

        <div class="flex flex-col gap-3">
          <UButton
            label="Envoyer sur WhatsApp"
            icon="i-ph-whatsapp-logo"
            size="lg"
            block
            class="min-h-(--cible-tactile)"
            :to="lienWhatsapp"
            :disabled="!pret"
            target="_blank"
            rel="noopener"
            @click="partagerWhatsapp"
          />
          <UButton
            label="Partager sur LinkedIn"
            icon="i-ph-linkedin-logo"
            variant="outline"
            size="lg"
            block
            class="min-h-(--cible-tactile)"
            :to="lienLinkedin"
            :disabled="!pret"
            target="_blank"
            rel="noopener"
            @click="partagerLinkedin"
          />
          <UButton
            label="Copier le message"
            icon="i-ph-copy"
            variant="outline"
            color="neutral"
            size="lg"
            block
            class="min-h-(--cible-tactile)"
            :disabled="!pret"
            @click="copierMessage"
          />
        </div>

        <div ref="qrConteneur" class="flex flex-col items-center gap-3 border-t border-bordure pt-4">
          <Qrcode
            v-if="ouvert && pret"
            :value="url"
            :width="QR_TAILLE"
            :height="QR_TAILLE"
            aria-label="QR code de votre vitrine"
          />
          <UButton
            label="Télécharger le QR code"
            icon="i-ph-download-simple"
            variant="outline"
            color="neutral"
            size="lg"
            block
            class="min-h-(--cible-tactile)"
            :disabled="!pret"
            @click="telechargerQrcode(qrConteneur)"
          />
        </div>

        <p role="status" class="m-0 min-h-6 text-(length:--fs-14) font-medium text-encre">
          {{ annonce }}
        </p>
      </div>
    </template>
  </UModal>
</template>
