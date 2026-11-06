<script setup lang="ts">
import { toMajorUnits } from '#shared/devises'
import type { ServiceLien } from '~/composables/usePublicService'
import { SERVICE_ACTIONS, SERVICE_TYPE_PASTILLES } from '#shared/services'

const route = useRoute()
const username = String(route.params.username)
const slug = String(route.params.slug)
const { public: { siteUrl = '' } } = useRuntimeConfig()

const [vitrine, reponse] = await Promise.all([usePublicVitrine(username), usePublicService(username, slug)])

const service = computed(() => reponse.value.service)
const lieu = computed(() => `${vitrine.value.ville}, ${vitrine.value.paysLibelle}`)
const whatsapp = computed(() =>
  lienWhatsapp(vitrine.value.contact.whatsapp, `Bonjour, j'ai une question sur « ${service.value.titre} ».`),
)
const parcoursReservation = computed(() =>
  service.value.reservable && (service.value.type === 'rdv' || service.value.type === 'accompagnement'),
)
const parcoursDemande = computed(() =>
  service.value.reservable && (service.value.type === 'atelier' || service.value.type === 'devis'),
)

function actionPourService(forme: 'court' | 'long'): ServiceLien {
  if (parcoursReservation.value) {
    return { libelle: SERVICE_ACTIONS[service.value.type][forme], to: '#prochains-creneaux', externe: false }
  }
  if (parcoursDemande.value) {
    return { libelle: SERVICE_ACTIONS[service.value.type][forme], to: '#demande', externe: false }
  }
  return actionDetail(service.value, vitrine.value.username, whatsapp.value, forme)
}

const actionLongue = computed(() => actionPourService('long'))
const actionCourte = computed(() => actionPourService('court'))

const {
  reponse: agendaReponse,
  statut: agendaStatut,
  erreur: agendaErreur,
  rafraichir: rafraichirAgenda,
} = await usePublicAgenda({
  username,
  fuseau: vitrine.value.fuseau,
  serviceSlug: parcoursReservation.value ? service.value.slug : null,
  cle: `service-${slug}`,
})
const agendaEnErreur = computed(() => Boolean(agendaErreur.value))

useSeoVitrine({
  vitrine: {
    username: vitrine.value.username,
    nomAffiche: vitrine.value.nomAffiche,
    metier: vitrine.value.metier,
    ville: vitrine.value.ville,
    pays: vitrine.value.pays,
    paysLibelle: vitrine.value.paysLibelle,
    titre: vitrine.value.titre,
    seoTitre: vitrine.value.seo.titre,
    seoDescription: vitrine.value.seo.description,
    accroche: vitrine.value.accroche,
    bio: vitrine.value.bio,
    photo: vitrine.value.photo,
    liens: [],
  },
  page: 'service',
  titre: service.value.seo.titre,
  description: service.value.seo.description,
  image: null,
  siteUrl,
  schema: {
    '@type': 'Service',
    name: service.value.titre,
    description: service.value.seo.description,
    serviceType: service.value.type,
    provider: { '@id': `${siteUrl}/${vitrine.value.username}#personne` },
    areaServed: [{ '@type': 'City', name: vitrine.value.ville ?? '' }],
    ...(service.value.tarif === 'payant' && service.value.prixMontant !== null && service.value.prixDevise !== null
      ? {
          offers: {
            '@type': 'Offer',
            price: Number(toMajorUnits(service.value.prixMontant, service.value.prixDevise)),
            priceCurrency: service.value.prixDevise,
          },
        }
      : {}),
  },
  fil: [
    { name: 'Accueil', item: `/${vitrine.value.username}` },
    { name: 'Services', item: `/${vitrine.value.username}/services` },
    { name: service.value.titre, item: `${siteUrl}/${vitrine.value.username}/services/${slug}` },
  ],
})
</script>

<template>
  <VitrineCadre :vitrine="vitrine" barre-basse>
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-6 py-4 lg:px-6 lg:py-8">
      <NuxtLink
        :to="`/${vitrine.username}/services`"
        class="inline-flex min-h-(--cible-tactile) items-center gap-2 self-start px-6 text-texte-secondaire hover:text-accent lg:px-0"
      >
        <UIcon name="i-ph-arrow-left" class="size-4" aria-hidden="true" />
        Tous les services
      </NuxtLink>

      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-12">
        <article class="flex flex-col gap-6">
          <ServiceVisuel :image="service.image" :titre="service.titre" hauteur="detail" />

          <div class="flex flex-col gap-4 px-6 lg:px-0">
            <p class="self-start rounded-full bg-accent-doux px-3 py-1 text-(length:--fs-14) font-medium text-accent-texte">
              {{ SERVICE_TYPE_PASTILLES[service.type] }}
            </p>
            <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
              {{ service.titre }}
            </h1>

            <ul class="flex flex-col gap-2 lg:hidden">
              <li v-if="resumeDuree(service, 'long')" class="flex items-center gap-3">
                <UIcon name="i-ph-clock" class="size-5 shrink-0 text-accent" aria-hidden="true" />
                {{ resumeDuree(service, 'long') }}
              </li>
              <li class="flex items-center gap-3">
                <UIcon name="i-ph-wallet" class="size-5 shrink-0 text-accent" aria-hidden="true" />
                {{ prixEtReglement(service) }}
              </li>
              <li class="flex items-center gap-3">
                <UIcon name="i-ph-map-pin" class="size-5 shrink-0 text-accent" aria-hidden="true" />
                {{ lieu }}
              </li>
            </ul>

            <p v-if="service.description" class="max-w-prose text-(length:--fs-16) whitespace-pre-line text-texte-secondaire">
              {{ service.description }}
            </p>
          </div>

          <div class="flex flex-col gap-8 px-6 lg:px-0">
            <ServiceInclus :type="service.type" :inclus="service.inclus" />

            <div
              v-if="texteReglement(service)"
              class="flex items-start gap-3 rounded-(--rayon-carte) bg-accent-doux p-6 lg:hidden"
            >
              <UIcon name="i-ph-wallet" class="mt-1 size-5 shrink-0 text-accent" aria-hidden="true" />
              <p class="text-(length:--fs-14) whitespace-pre-line text-encre">
                {{ texteReglement(service) }}
              </p>
            </div>

            <AgendaCreneauxProchains
              v-if="parcoursReservation"
              :username="vitrine.username"
              :service-slug="service.slug"
              :fuseau="vitrine.fuseau"
              :reponse="agendaReponse"
              :statut="agendaStatut"
              :erreur="agendaEnErreur"
              @reessayer="rafraichirAgenda"
            />

            <ReservationDemandeForm
              v-if="parcoursDemande"
              :username="vitrine.username"
              :service-slug="service.slug"
              :service-titre="service.titre"
              :service-type="service.type"
              :professionnel="vitrine.nomAffiche"
            />

            <ServiceAutres :autres="reponse.autres" :total="reponse.total" :username="vitrine.username" />
          </div>
        </article>

        <div class="hidden lg:block">
          <ServiceTarifCarte :service="service" :action="actionLongue" :lieu="lieu" :whatsapp="whatsapp" />
        </div>
      </div>
    </div>

    <ServiceBarreAction :service="service" :action="actionCourte" />
  </VitrineCadre>
</template>
