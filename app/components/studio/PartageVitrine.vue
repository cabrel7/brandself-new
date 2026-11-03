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

const ECHECS = [ANNONCE_COPIE_IMPOSSIBLE, ANNONCE_QR_IMPOSSIBLE]
const iconeAnnonce = computed(() => (ECHECS.includes(annonce.value) ? 'i-ph-warning-circle' : 'i-ph-check-circle'))

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
            variant="link"
            color="neutral"
            size="lg"
            block
            class="min-h-(--cible-tactile)"
            :disabled="!pret"
            @click="copierMessage"
          />
          <p role="status" class="m-0 flex min-h-6 items-center gap-2 text-(length:--fs-14) font-medium text-encre">
            <UIcon v-if="annonce" :name="iconeAnnonce" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ annonce }}</span>
          </p>
        </div>

        <div ref="qrConteneur" class="flex flex-col items-center gap-3 border-t border-bordure pt-4">
          <Qrcode
            v-if="ouvert && pret"
            role="img"
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
      </div>
    </template>
  </UModal>
</template>
