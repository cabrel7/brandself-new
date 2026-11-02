<script setup lang="ts">
import { SERVICE_SLUG_REGEX } from '#shared/services'

const route = useRoute()
const username = String(route.params.username)
const vitrine = await usePublicVitrine(username)
const { reponse: servicesReponse } = await usePublicServices(username)

const servicesReservables = computed(() => (servicesReponse.value?.services ?? []).filter(service =>
  service.reservable
  && service.dureeMin !== null
  && (service.type === 'rdv' || service.type === 'accompagnement')))

// Préselection depuis ?service= (liens « Choisir un autre créneau ») si le slug est réservable.
const serviceQuery = typeof route.query.service === 'string' && SERVICE_SLUG_REGEX.test(route.query.service)
  ? route.query.service
  : null
const serviceInitial = servicesReservables.value.some(service => service.slug === serviceQuery)
  ? serviceQuery
  : servicesReservables.value[0]?.slug ?? null

const {
  serviceSlug,
  mois,
  creneauxParJour,
  peutReculer,
  peutAvancer,
  reponse: agendaReponse,
  statut: agendaStatut,
  erreur: agendaErreur,
  choisirService,
  changerMois,
  rafraichir: rafraichirAgenda,
} = await usePublicAgenda({
  username,
  fuseau: vitrine.value.fuseau,
  serviceSlug: serviceInitial,
  cle: 'page',
  mode: 'page',
})

useSeoMeta({
  title: () => `Agenda — ${vitrine.value.nomAffiche}`,
  robots: 'noindex, nofollow',
})
</script>

<template>
  <VitrineCadre :vitrine="vitrine" pied-compact>
    <div class="mx-auto w-full max-w-6xl px-6 py-8 md:py-12 xl:py-16">
      <nav class="mb-4 hidden text-(length:--fs-14) text-texte-secondaire xl:block" aria-label="Fil d’Ariane">
        <NuxtLink :to="`/${vitrine.username}`" class="hover:text-accent-texte">Accueil</NuxtLink>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">Agenda</span>
      </nav>

      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">Agenda</h1>
        <p class="m-0 mt-3 max-w-xl text-base text-texte-secondaire">
          Choisissez un service, puis un jour et une heure disponibles.
        </p>
      </header>

      <div
        v-if="servicesReservables.length === 0"
        class="mt-10 max-w-xl rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8"
        role="status"
      >
        <UIcon name="i-ph-calendar-x" class="size-8 text-accent" aria-hidden="true" />
        <h2 class="mt-4 text-(length:--fs-24) font-bold">Aucune réservation en ligne pour le moment</h2>
        <p class="mt-2 text-texte-secondaire">
          {{ vitrine.nomAffiche }} n’ouvre pas de créneaux actuellement. Écrivez-le depuis la page Contact pour convenir d’un rendez-vous.
        </p>
        <UButton :to="`/${vitrine.username}/contact`" class="mt-5" variant="outline">
          Aller à la page Contact
        </UButton>
      </div>

      <AgendaReservation
        v-else
        class="mt-10"
        :username="vitrine.username"
        :fuseau="vitrine.fuseau"
        :services="servicesReservables"
        :service-slug="serviceSlug"
        :mois="mois"
        :creneaux-par-jour="creneauxParJour"
        :peut-reculer="peutReculer"
        :peut-avancer="peutAvancer"
        :reponse="agendaReponse"
        :statut="agendaStatut"
        :erreur="Boolean(agendaErreur)"
        @changement-service="choisirService"
        @changer-mois="changerMois"
        @reessayer="rafraichirAgenda"
      />
    </div>
  </VitrineCadre>
</template>
