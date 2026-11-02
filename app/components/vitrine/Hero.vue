<script setup lang="ts">
import type { VitrinePubliqueDTO } from '#shared/dto'
import type { ProchainCreneauPublic } from '~/composables/usePublicAgenda'
import { ajouterJoursAgenda, dateLocaleAgenda, formaterHeureAgenda } from '~/composables/usePublicAgenda'

const props = defineProps<{ vitrine: VitrinePubliqueDTO, prochainCreneau?: ProchainCreneauPublic | null }>()

const surtitre = computed(() => `${props.vitrine.metier} · ${props.vitrine.ville}`)

const lienWhatsapp = computed(() => {
  const chiffres = props.vitrine.contact.whatsapp?.replace(/\D/g, '')
  return chiffres ? `https://wa.me/${chiffres}` : null
})

const lienReservation = computed(() => props.prochainCreneau
  ? {
      path: `/${props.vitrine.username}/reserver`,
      query: { service: props.prochainCreneau.serviceSlug, debut: props.prochainCreneau.debut },
    }
  : '#contact')
const disponibleCetteSemaine = computed(() => {
  if (!props.prochainCreneau) return false
  const aujourdHui = dateLocaleAgenda(new Date(), props.prochainCreneau.fuseau)
  const dateCreneau = dateLocaleAgenda(props.prochainCreneau.debut, props.prochainCreneau.fuseau)
  return dateCreneau >= aujourdHui && dateCreneau <= ajouterJoursAgenda(aujourdHui, 6)
})
const libelleProchainCreneau = computed(() => {
  if (!props.prochainCreneau) return ''
  const jour = new Intl.DateTimeFormat('fr-FR', {
    timeZone: props.prochainCreneau.fuseau,
    weekday: 'long',
  }).format(new Date(props.prochainCreneau.debut))
  const jourCapitalise = jour.charAt(0).toLocaleUpperCase('fr-FR') + jour.slice(1)
  return `${jourCapitalise}, ${formaterHeureAgenda(props.prochainCreneau.debut, props.prochainCreneau.fuseau)}`
})
</script>

<template>
  <section class="mx-auto grid w-full max-w-6xl items-center gap-8 pb-12 md:grid-cols-2 md:gap-12 md:px-6 md:py-16">
    <div class="relative md:order-2">
      <VitrinePhoto
        :photo="vitrine.photo"
        :prenom="vitrine.prenom"
        :nom="vitrine.nom"
        :nom-affiche="vitrine.nomAffiche"
      />
      <NuxtLink
        v-if="prochainCreneau"
        :to="lienReservation"
        class="absolute right-6 bottom-4 flex min-h-(--cible-tactile) max-w-48 flex-col rounded-(--rayon) border border-bordure bg-fond p-4 shadow-sm transition-transform hover:-translate-y-0.5 md:right-auto md:bottom-8 md:-left-8"
      >
        <span class="text-(length:--fs-12) font-semibold tracking-wider text-texte-secondaire uppercase">Prochain créneau</span>
        <strong class="font-(family-name:--font-titre) text-(length:--fs-20)">{{ libelleProchainCreneau }}</strong>
        <span class="mt-1 inline-flex items-center gap-1 text-(length:--fs-14) font-semibold text-accent-texte">
          Réserver <UIcon name="i-ph-caret-right" class="size-4" aria-hidden="true" />
        </span>
      </NuxtLink>
    </div>
    <div class="flex flex-col gap-4 px-6 md:order-1 md:px-0">
      <p
        v-if="disponibleCetteSemaine"
        class="inline-flex min-h-(--cible-tactile) items-center gap-2 self-start rounded-full border border-bordure bg-fond px-4 text-(length:--fs-14) font-medium"
      >
        <span class="size-2 rounded-full bg-accent" aria-hidden="true" />
        Disponible cette semaine
      </p>
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">{{ surtitre }}</p>
      <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
        {{ vitrine.accroche ?? vitrine.nomAffiche }}
      </h1>
      <p v-if="vitrine.bio" class="max-w-prose text-(length:--fs-16) whitespace-pre-line text-texte-secondaire">
        {{ vitrine.bio }}
      </p>
      <div class="mt-2 flex flex-col gap-3 sm:flex-row">
        <UButton :to="lienReservation" block class="sm:w-auto">
          {{ prochainCreneau ? 'Prendre rendez-vous' : 'Me contacter' }}
        </UButton>
        <UButton
          v-if="lienWhatsapp"
          :to="lienWhatsapp"
          target="_blank"
          rel="noopener"
          variant="outline"
          block
          class="sm:w-auto"
          icon="i-ph-whatsapp-logo"
        >
          Écrire sur WhatsApp
        </UButton>
      </div>
    </div>
  </section>
</template>
