<script setup lang="ts">
// L'agenda s'hydrate avant d'entrer à l'écran : un appui rapide après le défilement n'est pas perdu.
const MARGE_HYDRATATION = '400px'

const route = useRoute()
const username = String(route.params.username)

// Lancés ensemble : les trois lectures partent avant le premier await.
const [vitrine, { reponse: services }, { reponse: realisations }, { reponse: temoignages }] = await Promise.all([
  usePublicVitrine(username),
  usePublicServices(username),
  usePublicRealisations(username),
  usePublicTemoignages(username),
])
const contenus = usePublicContenus(username)

useSeoVitrine({
  vitrine: vitrine.value,
  page: 'accueil',
  servicesVisibles: services.value?.services ?? [],
})

const total = computed(() => services.value?.total ?? 0)
const aLaUne = computed(() => services.value?.aLaUne ?? [])
const realisationsTotal = computed(() => realisations.value?.total ?? 0)
// L'accueil ne met en avant qu'une réalisation (la première à la une).
const realisationALaUne = computed(() => realisations.value?.aLaUne[0] ?? null)
const temoignagesTotal = computed(() => temoignages.value?.total ?? 0)

const servicesReservables = computed(() => (services.value?.services ?? []).filter(service =>
  service.reservable
  && service.dureeMin !== null
  && (service.type === 'rdv' || service.type === 'accompagnement'),
))
const {
  serviceSlug: agendaServiceSlug,
  dateDebut: agendaDateDebut,
  dateFin: agendaDateFin,
  reponse: agendaReponse,
  prochainCreneau,
  statut: agendaStatut,
  erreur: agendaErreur,
  choisirService,
  rafraichir: rafraichirAgenda,
} = await usePublicAgenda({
  username,
  fuseau: vitrine.value.fuseau,
  serviceSlug: servicesReservables.value[0]?.slug ?? null,
  cle: 'accueil',
})
const agendaEnErreur = computed(() => Boolean(agendaErreur.value))
</script>

<template>
  <VitrineCadre :vitrine="vitrine">
    <VitrineHero :vitrine="vitrine" :prochain-creneau="prochainCreneau" />
    <VitrineAPropos v-if="vitrine.bio" :bio="vitrine.bio" />
    <VitrineServicesALaUne v-if="total > 0 && aLaUne.length > 0" :username="vitrine.username" :services="aLaUne" :total="total" />
    <div v-if="contenus.agenda" class="mx-auto w-full max-w-6xl px-6 pb-12 md:pb-16">
      <LazyAgendaPublic
        :hydrate-on-visible="{ rootMargin: MARGE_HYDRATATION }"
        :username="vitrine.username"
        :fuseau="vitrine.fuseau"
        :services="servicesReservables"
        :service-slug="agendaServiceSlug"
        :reponse="agendaReponse"
        :statut="agendaStatut"
        :erreur="agendaEnErreur"
        :date-debut="agendaDateDebut"
        :date-fin="agendaDateFin"
        @changement-service="choisirService"
        @reessayer="rafraichirAgenda"
      />
    </div>
    <LazyVitrineALaUne
      v-if="realisationsTotal > 0 && realisationALaUne"
      hydrate-on-visible
      :username="vitrine.username"
      :realisation="realisationALaUne"
      :realisations-total="realisationsTotal"
    />
    <!-- Hydratation normale : le bouton « Lire d'autres avis » doit répondre dès le premier clic (hydrate-on-idle laissait une fenêtre où il était perdu). -->
    <VitrineTemoignageALaUne v-if="temoignagesTotal > 0" :username="vitrine.username" />
  </VitrineCadre>
</template>
