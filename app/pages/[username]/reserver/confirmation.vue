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

const contenu = computed(() => confirmation.value
  ? contenuConfirmation(confirmation.value.reservation.statut, { professionnel: vitrine.value.nomAffiche, username: vitrine.value.username })
  : null)

const titrePage = computed(() => {
  if (status.value === 'idle' || status.value === 'pending') return 'Chargement de votre demande'
  if (confirmationExpiree.value) return 'Cette confirmation a expiré'
  if (confirmationInvalide.value) return 'Confirmation introuvable'
  if (status.value === 'error' || !confirmation.value) return 'Récapitulatif indisponible'
  return contenu.value?.titrePage ?? 'Votre demande'
})

// Le titre reçoit le focus une seule fois, sauf si le visiteur a déjà interagi avec la page.
const titre = useTemplateRef<HTMLElement>('titre')
let focusPose = false
async function focaliserTitre(): Promise<void> {
  if (focusPose) return
  await nextTick()
  if (!titre.value) return
  focusPose = true
  const actif = document.activeElement
  if (actif && actif !== document.body) return
  titre.value.focus({ preventScroll: true })
}
onMounted(() => {
  if (status.value !== 'idle' && status.value !== 'pending') void focaliserTitre()
})
watch(status, (valeur) => {
  if (valeur !== 'idle' && valeur !== 'pending') void focaliserTitre()
})

useHead({ htmlAttrs: { 'data-palette': () => vitrine.value.palette, lang: 'fr' } })
useSeoMeta({ title: titrePage, robots: 'noindex, nofollow' })
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
        <h1 ref="titre" tabindex="-1" class="text-(length:--fs-32) leading-tight font-bold outline-none">Cette confirmation a expiré</h1>
        <p class="text-texte-secondaire">Votre demande a bien été transmise, mais ce récapitulatif temporaire n’est plus accessible.</p>
        <UButton :to="`/${vitrine.username}`">Retour à la vitrine</UButton>
      </div>

      <div v-else-if="confirmationInvalide" class="m-auto flex max-w-lg flex-col items-center gap-5 text-center" role="status">
        <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
          <UIcon name="i-ph-calendar-x" class="size-10" aria-hidden="true" />
        </span>
        <h1 ref="titre" tabindex="-1" class="text-(length:--fs-32) leading-tight font-bold outline-none">Confirmation introuvable</h1>
        <p class="text-texte-secondaire">Ce récapitulatif n’est plus accessible. Revenez à la vitrine pour consulter les créneaux disponibles.</p>
        <UButton :to="`/${vitrine.username}`">Retour à la vitrine</UButton>
      </div>

      <div v-else-if="status === 'error' || !confirmation" class="m-auto flex max-w-lg flex-col items-center gap-5 text-center" role="alert">
        <span class="flex size-20 items-center justify-center rounded-full bg-accent-doux text-accent">
          <UIcon name="i-ph-warning-circle" class="size-10" aria-hidden="true" />
        </span>
        <h1 ref="titre" tabindex="-1" class="text-(length:--fs-32) leading-tight font-bold outline-none">Le récapitulatif ne peut pas être chargé</h1>
        <p class="text-texte-secondaire">Réessayez dans un instant. Aucune information personnelle n’est affichée sur cette page.</p>
        <UButton variant="outline" icon="i-ph-arrow-counter-clockwise" @click="recharger">Réessayer</UButton>
      </div>

      <div v-else-if="contenu" class="flex flex-col gap-8">
        <div class="flex flex-col items-center gap-4 text-center md:items-start md:text-left">
          <span class="flex size-16 items-center justify-center rounded-full bg-accent-doux text-accent">
            <UIcon :name="contenu.picto" class="size-8" aria-hidden="true" />
          </span>
          <h1 ref="titre" tabindex="-1" class="max-w-xl text-(length:--fs-32) leading-tight font-bold outline-none">{{ contenu.titre }}</h1>
          <p class="m-0 max-w-xl text-texte-secondaire">{{ contenu.phrase }}</p>
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

        <UButton v-if="contenu.ics" :to="lienIcs" external download="reservation-jesuis.pro.ics" icon="i-ph-calendar-plus" block>
          Ajouter à mon agenda
        </UButton>
        <UButton v-else-if="contenu.action" :to="contenu.action.to" block>{{ contenu.action.libelle }}</UButton>
        <NuxtLink
          :to="`/${vitrine.username}`"
          class="inline-flex min-h-(--cible-tactile) items-center justify-center text-accent-texte underline underline-offset-4 hover:no-underline"
        >
          Retour à la vitrine
        </NuxtLink>
      </div>
    </main>

    <footer v-if="vitrine.badgeBrandself" class="flex justify-center px-6 py-6">
      <VitrineBadge />
    </footer>
  </div>
</template>
