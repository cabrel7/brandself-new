<script setup lang="ts">
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

useSeoMeta({
  title: () => vitrine.value.seo.titre,
  description: () => vitrine.value.seo.description,
  ogTitle: () => vitrine.value.seo.titre,
  ogDescription: () => vitrine.value.seo.description,
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
    <VitrineServicesALaUne v-if="total > 0 && aLaUne.length > 0" :username="vitrine.username" :services="aLaUne" :total="total" />
    <div v-if="contenus.agenda" class="mx-auto w-full max-w-6xl px-6 pb-12 md:pb-16">
      <AgendaPublic
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
    <VitrineALaUne
      v-if="realisationsTotal > 0 && realisationALaUne"
      :username="vitrine.username"
      :realisation="realisationALaUne"
      :realisations-total="realisationsTotal"
    />
    <VitrineTemoignageALaUne v-if="temoignagesTotal > 0" :username="vitrine.username" />
  </VitrineCadre>
</template>
