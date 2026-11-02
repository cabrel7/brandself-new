<script setup lang="ts">
import type { ReservationConfirmationDTO } from '#shared/dto'
import { formatPrix } from '#shared/devises'

const route = useRoute()
const username = String(route.params.username)

if (import.meta.server) {
  useResponseHeader('Cache-Control').value = 'private, no-store'
}

const vitrine = await usePublicVitrine(username)
const confirmationHeaders = import.meta.server ? useRequestHeaders(['cookie']) : undefined

const { data: confirmation, error, status, refresh } = await useAsyncData<ReservationConfirmationDTO>(
  `confirmation-reservation-${username}`,
  () => $fetch<ReservationConfirmationDTO>(
    `/api/public/${encodeURIComponent(username)}/confirmation`,
    import.meta.server
      ? { headers: confirmationHeaders }
      : { credentials: 'include' },
  ),
  { server: true, getCachedData: () => undefined },
)

const erreurApi = computed(() => lireErreurApi(error.value))
const confirmationExpiree = computed(() =>
  erreurApi.value.code === 'CONFIRMATION_EXPIREE' || erreurApi.value.statut === 410,
)
const confirmationInvalide = computed(() =>
  erreurApi.value.code === 'CONFIRMATION_RESERVATION_INVALIDE' || erreurApi.value.statut === 404,
)
const paiement = computed(() => {
  const service = confirmation.value?.service
  if (!service || service.tarif === null) return 'À régler sur place'
  if (service.tarif === 'gratuit') return 'Gratuit'
  if (service.tarif === 'devis') return 'Sur devis'
  if (service.prixMontant === null || service.prixDevise === null) return 'À régler sur place'
  return `${formatPrix(service.prixMontant, service.prixDevise)} · à régler sur place`
})
const lieu = computed(() => confirmation.value?.vitrine.lieu ?? confirmation.value?.vitrine.ville ?? 'Lieu à confirmer')
const lienIcs = computed(() => `/api/public/${encodeURIComponent(username)}/confirmation/agenda.ics`)

async function recharger(): Promise<void> {
  await refresh()
}

useHead({ htmlAttrs: { 'data-palette': () => vitrine.value.palette, lang: 'fr' } })
useSeoMeta({ title: 'Votre demande est envoyée', robots: 'noindex, nofollow' })
</script>

<template>
  <div :data-palette="vitrine.palette" class="flex min-h-dvh flex-col bg-fond text-encre">
    <main class="mx-auto flex w-full max-w-[44rem] flex-1 flex-col px-6 py-12 md:py-20">
      <div v-if="status === 'idle' || status === 'pending'" class="flex flex-col items-center gap-6" aria-live="polite" aria-busy="true">
        <USkeleton class="size-24 rounded-full" />
        <USkeleton class="h-12 w-full max-w-md" />
        <USkeleton class="h-72 w-full rounded-(--rayon-carte)" />
        <span class="sr-only">Chargement de la confirmation</span>
      </div>

      <div v-else-if="confirmationExpiree" class="m-auto flex max-w-lg flex-col items-center gap-5 text-center" role="status">
        <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
          <UIcon name="i-ph-clock-countdown" class="size-10" aria-hidden="true" />
        </span>
        <h1 class="text-(length:--fs-32) leading-tight font-bold md:text-(length:--fs-48)">Cette confirmation a expiré</h1>
        <p class="text-texte-secondaire">Votre demande a bien été transmise, mais ce récapitulatif temporaire n’est plus accessible.</p>
        <UButton :to="`/${vitrine.username}`">Retour à la vitrine</UButton>
      </div>

      <div v-else-if="confirmationInvalide" class="m-auto flex max-w-lg flex-col items-center gap-5 text-center" role="status">
        <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
          <UIcon name="i-ph-calendar-x" class="size-10" aria-hidden="true" />
        </span>
        <h1 class="text-(length:--fs-32) leading-tight font-bold md:text-(length:--fs-48)">Confirmation introuvable</h1>
        <p class="text-texte-secondaire">Ce récapitulatif n’est plus accessible. Revenez à la vitrine pour consulter les créneaux disponibles.</p>
        <UButton :to="`/${vitrine.username}`">Retour à la vitrine</UButton>
      </div>

      <div v-else-if="status === 'error' || !confirmation" class="m-auto flex max-w-lg flex-col items-center gap-5 text-center" role="alert">
        <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
          <UIcon name="i-ph-warning-circle" class="size-10" aria-hidden="true" />
        </span>
        <h1 class="text-(length:--fs-32) leading-tight font-bold md:text-(length:--fs-48)">Le récapitulatif ne peut pas être chargé</h1>
        <p class="text-texte-secondaire">Réessayez dans un instant. Aucune information personnelle n’est affichée sur cette page.</p>
        <UButton variant="outline" icon="i-ph-arrow-counter-clockwise" @click="recharger">Réessayer</UButton>
      </div>

      <div v-else class="flex flex-col gap-8">
        <div class="flex flex-col items-center gap-5 text-center">
          <span class="flex size-24 items-center justify-center rounded-full bg-accent-doux text-accent">
            <UIcon name="i-ph-check" class="size-12" aria-hidden="true" />
          </span>
          <h1 class="max-w-xl text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">Votre demande est envoyée</h1>
          <p class="max-w-xl text-(length:--fs-20) text-texte-secondaire">
            {{ vitrine.nomAffiche }} vous confirmera ce rendez-vous par email. Votre demande a bien été transmise.
          </p>
        </div>

        <ReservationRecap
          :titre="confirmation.service.titre"
          :debut="confirmation.reservation.debut"
          :duree-min="confirmation.service.dureeMin"
          :paiement="paiement"
          :professionnel="confirmation.vitrine.professionnel"
          :lieu="lieu"
          :fuseau="vitrine.fuseau"
        />

        <UButton :to="lienIcs" external download="reservation-brandself.ics" variant="outline" icon="i-ph-calendar-plus" block>
          Ajouter à mon agenda
        </UButton>
        <UButton :to="`/${vitrine.username}`" variant="link" block>Retour à la vitrine</UButton>
      </div>
    </main>

    <p class="px-6 py-8 text-center text-(length:--fs-14) text-texte-secondaire">Créé avec Brandself</p>
  </div>
</template>
