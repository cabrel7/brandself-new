<script setup lang="ts">
import { z } from 'zod'
import type { CreneauDTO, ServicePublicReponse } from '#shared/dto'
import { libellePrix, SERVICE_SLUG_REGEX } from '#shared/services'

const route = useRoute()
const username = String(route.params.username)
const pageConfirmation = route.path.endsWith('/reserver/confirmation')
const vitrine = await usePublicVitrine(username)

const CHAMPS_QUERY_AUTORISES = new Set(['service', 'debut'])
const serviceQuery = typeof route.query.service === 'string' ? route.query.service : null
const debutQuery = typeof route.query.debut === 'string' ? route.query.debut : null
const querySansChampInattendu = Object.keys(route.query).every(cle => CHAMPS_QUERY_AUTORISES.has(cle))
const debutValide = debutQuery === null ? null : z.iso.datetime({ offset: true }).safeParse(debutQuery)
const parametresValides = !pageConfirmation
  && querySansChampInattendu
  && serviceQuery !== null
  && SERVICE_SLUG_REGEX.test(serviceQuery)
  && debutValide?.success === true
const debutNormalise = parametresValides && debutQuery ? new Date(debutQuery).toISOString() : null

// S7-bis : sans paramètres valides, la page agenda remplace l'ancien formulaire.
// 308 : préservation de la méthode, exécuté côté serveur pendant le SSR.
// Un service renseigné (lien « Réserver » d'une page service) est transmis à l'agenda.
if (!pageConfirmation && !parametresValides) {
  const cibleService = serviceQuery && SERVICE_SLUG_REGEX.test(serviceQuery) ? `?service=${serviceQuery}` : ''
  await navigateTo(`/${vitrine.value.username}/agenda${cibleService}`, { redirectCode: 308 })
}

let reponseService: Ref<ServicePublicReponse> | null = null
if (parametresValides && serviceQuery) reponseService = await usePublicService(username, serviceQuery)
const service = computed(() => reponseService?.value.service ?? null)
const parcoursReservation = computed(() => service.value !== null
  && service.value.reservable
  && (service.value.type === 'rdv' || service.value.type === 'accompagnement'))

const {
  reponse: agendaReponse,
  statut: agendaStatut,
  erreur: agendaErreur,
  rafraichir: rafraichirAgenda,
} = await usePublicAgenda({
  username,
  fuseau: vitrine.value.fuseau,
  serviceSlug: parametresValides && serviceQuery && parcoursReservation.value ? serviceQuery : null,
  cle: `reservation-${serviceQuery ?? 'sans-service'}`,
})

interface ContexteReservation {
  creneau: CreneauDTO
  serviceId: string
  fuseau: string
}

function trouverContexteReservation(): ContexteReservation | null {
  if (!parcoursReservation.value || !debutNormalise || !agendaReponse.value) return null
  const creneau = agendaReponse.value.creneaux.find(item => item.debut === debutNormalise)
  if (!creneau) return null
  return { creneau, serviceId: agendaReponse.value.service.id, fuseau: agendaReponse.value.fuseau }
}

// Ce contexte non-PII reste figé pendant le rafraîchissement d'un 409 : le formulaire reste monté.
const contexteReservation = shallowRef<ContexteReservation | null>(trouverContexteReservation())
watch(agendaReponse, () => {
  if (contexteReservation.value === null) contexteReservation.value = trouverContexteReservation()
})
const agendaEnErreur = computed(() => Boolean(agendaErreur.value))
const paiement = computed(() => {
  if (!service.value) return ''
  const prix = libellePrix(service.value)
  return service.value.tarif === 'payant' ? `${prix} · à régler sur place` : prix
})
const lieu = computed(() => `${vitrine.value.ville}, ${vitrine.value.paysLibelle}`)

useHead({ htmlAttrs: { 'data-palette': () => vitrine.value.palette, lang: 'fr' } })
useSeoMeta({
  title: () => `Réserver avec ${vitrine.value.nomAffiche}`,
  robots: 'noindex, nofollow',
})
</script>

<template>
  <NuxtPage v-if="pageConfirmation" />
  <div v-else :data-palette="vitrine.palette" class="flex min-h-dvh flex-col bg-fond text-encre">
    <header class="border-b border-bordure">
      <div class="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <NuxtLink
          :to="`/${vitrine.username}`"
          class="min-w-0 truncate font-(family-name:--font-titre) text-(length:--fs-20) font-bold md:text-(length:--fs-24)"
        >
          {{ vitrine.nomAffiche }}
        </NuxtLink>
        <NuxtLink
          :to="`/${vitrine.username}`"
          class="inline-flex min-h-(--cible-tactile) shrink-0 items-center gap-2 text-texte-secondaire hover:text-accent-texte"
        >
          <UIcon name="i-ph-arrow-left" class="size-4" aria-hidden="true" />
          <span class="xl:hidden">Retour</span>
          <span class="hidden xl:inline">Retour à la vitrine</span>
        </NuxtLink>
      </div>
    </header>

    <main class="mx-auto w-full max-w-[44rem] flex-1 px-6 py-8 md:py-12 xl:max-w-6xl xl:py-16">
      <nav class="mb-4 hidden text-texte-secondaire xl:block" aria-label="Fil d’Ariane">
        <NuxtLink :to="`/${vitrine.username}`" class="hover:text-accent-texte">Accueil</NuxtLink>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Réserver</span>
      </nav>
      <h1 class="text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">Plus qu’une étape pour réserver</h1>

      <div v-if="!parcoursReservation" class="mt-8 max-w-xl rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8" role="status">
        <UIcon name="i-ph-calendar-dots" class="size-8 text-accent" aria-hidden="true" />
        <h2 class="mt-4 text-(length:--fs-24) font-bold">Choisissez d’abord un créneau</h2>
        <p class="mt-2 text-texte-secondaire">Revenez à l’agenda pour choisir le service, le jour et l’heure qui vous conviennent.</p>
        <UButton :to="`/${vitrine.username}/agenda`" class="mt-5">Voir l’agenda</UButton>
      </div>

      <div v-else-if="agendaStatut === 'pending' && !contexteReservation" class="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_28rem]" aria-live="polite" aria-busy="true">
        <div class="flex flex-col gap-5 xl:col-start-1">
          <USkeleton class="h-8 w-48" />
          <USkeleton class="h-(--hauteur-controle) w-full rounded-(--rayon)" />
          <USkeleton class="h-(--hauteur-controle) w-full rounded-(--rayon)" />
          <USkeleton class="h-32 w-full rounded-(--rayon)" />
        </div>
        <USkeleton class="h-80 rounded-(--rayon-carte) xl:col-start-2 xl:row-start-1" />
        <span class="sr-only">Chargement de votre rendez-vous</span>
      </div>

      <div v-else-if="(agendaStatut === 'error' || agendaEnErreur) && !contexteReservation" class="mt-8 max-w-xl" role="alert">
        <p class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>Nous n’avons pas pu vérifier ce créneau. Réessayez dans un instant.</span>
        </p>
        <UButton class="mt-4" variant="outline" icon="i-ph-arrow-counter-clockwise" @click="rafraichirAgenda">
          Réessayer
        </UButton>
      </div>

      <div v-else-if="!contexteReservation || !service" class="mt-8 max-w-xl rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8" role="status">
        <UIcon name="i-ph-calendar-x" class="size-8 text-accent" aria-hidden="true" />
        <h2 class="mt-4 text-(length:--fs-24) font-bold">Ce créneau n’est plus disponible</h2>
        <p class="mt-2 text-texte-secondaire">Il a expiré ou vient d’être réservé. Consultez les horaires encore libres.</p>
        <UButton :to="`/${vitrine.username}/agenda?service=${serviceQuery}`" class="mt-5">Choisir un autre créneau</UButton>
      </div>

      <div v-else class="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_28rem] xl:gap-12">
        <ReservationRecap
          class="xl:sticky xl:top-8 xl:col-start-2 xl:row-start-1 xl:self-start"
          :titre="service.titre"
          :debut="contexteReservation.creneau.debut"
          :duree-min="service.dureeMin"
          :paiement="paiement"
          :professionnel="vitrine.nomAffiche"
          :lieu="lieu"
          :fuseau="contexteReservation.fuseau"
          :modifier-href="`/${vitrine.username}/agenda?service=${service.slug}`"
        />
        <ReservationForm
          class="xl:col-start-1 xl:row-start-1"
          :username="vitrine.username"
          :service-id="contexteReservation.serviceId"
          :debut="contexteReservation.creneau.debut"
          :professionnel="vitrine.nomAffiche"
          @creneau-pris="rafraichirAgenda"
          @creneau-expire="rafraichirAgenda"
        />
      </div>
    </main>

    <footer class="border-t border-bordure">
      <div class="mx-auto flex w-full max-w-6xl flex-col gap-2 px-6 py-8 text-(length:--fs-14) text-texte-secondaire sm:flex-row sm:items-center sm:justify-between">
        <p>{{ vitrine.nomAffiche }} · {{ vitrine.ville }}</p>
        <p>Créé avec Brandself</p>
      </div>
    </footer>
  </div>
</template>
