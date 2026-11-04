<script setup lang="ts">
import type { CreneauDTO, CreneauxPublicsReponse, ServicePublicCarteDTO } from '#shared/dto'
import { formatDureeCourte } from '#shared/services'
import type { AgendaPublicStatut } from '~/composables/usePublicAgenda'
import {
  ajouterJoursAgenda,
  dateLocaleAgenda,
  debutSemaineAgenda,
  formaterHeureAgenda,
} from '~/composables/usePublicAgenda'

const props = defineProps<{
  username: string
  fuseau: string
  services: ServicePublicCarteDTO[]
  serviceSlug: string | null
  reponse: CreneauxPublicsReponse | null
  statut: AgendaPublicStatut
  erreur: boolean
  dateDebut: string
  dateFin: string
}>()

const emit = defineEmits<{
  changementService: [slug: string]
  reessayer: []
}>()

const LOCALE_FR = 'fr-FR'
const JOURS_PAR_SEMAINE = 7

const serviceActif = computed({
  get: () => props.serviceSlug ?? '',
  set: (value: string) => emit('changementService', value),
})
const optionsServices = computed(() => props.services.map(service => ({
  label: service.dureeMin === null ? service.titre : `${service.titre} · ${formatDureeCourte(service.dureeMin)}`,
  value: service.slug,
})))
const fuseauEffectif = computed(() => props.reponse?.fuseau ?? props.fuseau)
const creneauxParDate = computed(() => {
  const groupes = new Map<string, CreneauDTO[]>()
  for (const creneau of props.reponse?.creneaux ?? []) {
    const date = dateLocaleAgenda(creneau.debut, fuseauEffectif.value)
    groupes.set(date, [...(groupes.get(date) ?? []), creneau])
  }
  return groupes
})

const dateSelectionnee = ref(props.dateDebut)
const debutSemaine = ref(debutSemaineAgenda(props.dateDebut))
const creneauSelectionne = ref<string | null>(null)

watch(() => props.reponse, (reponse) => {
  const premier = reponse?.creneaux[0]
  if (!premier) {
    dateSelectionnee.value = props.dateDebut
    debutSemaine.value = debutSemaineAgenda(props.dateDebut)
    creneauSelectionne.value = null
    return
  }
  const date = dateLocaleAgenda(premier.debut, reponse.fuseau)
  dateSelectionnee.value = date
  debutSemaine.value = debutSemaineAgenda(date)
  creneauSelectionne.value = premier.debut
}, { immediate: true })

function dateCivile(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`)
}

function libelleJour(date: string): string {
  return new Intl.DateTimeFormat(LOCALE_FR, { weekday: 'narrow', timeZone: 'UTC' })
    .format(dateCivile(date))
    .toLocaleUpperCase(LOCALE_FR)
}

function numeroJour(date: string): string {
  return new Intl.DateTimeFormat(LOCALE_FR, { day: 'numeric', timeZone: 'UTC' }).format(dateCivile(date))
}

function dateAccessible(date: string): string {
  return new Intl.DateTimeFormat(LOCALE_FR, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(dateCivile(date))
}

const jours = computed(() => Array.from({ length: JOURS_PAR_SEMAINE }, (_, index) => {
  const date = ajouterJoursAgenda(debutSemaine.value, index)
  return {
    date,
    lettre: libelleJour(date),
    numero: numeroJour(date),
    libelle: dateAccessible(date),
    disponible: creneauxParDate.value.has(date),
    passe: date < props.dateDebut,
  }
}))

const titreMois = computed(() => {
  const texte = new Intl.DateTimeFormat(LOCALE_FR, { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(dateCivile(dateSelectionnee.value))
  return texte.charAt(0).toLocaleUpperCase(LOCALE_FR) + texte.slice(1)
})
const creneauxDuJour = computed(() => creneauxParDate.value.get(dateSelectionnee.value) ?? [])
const dateSelectionneeLisible = computed(() => dateAccessible(dateSelectionnee.value))
const villeFuseau = computed(() => {
  const segments = fuseauEffectif.value.split('/')
  return (segments[segments.length - 1] ?? fuseauEffectif.value).replaceAll('_', ' ')
})
const resumeCreneaux = computed(() => {
  const nombre = creneauxDuJour.value.length
  return `${nombre} créneau${nombre > 1 ? 'x' : ''} disponible${nombre > 1 ? 's' : ''} · heure de ${villeFuseau.value}`
})
const peutReculer = computed(() => ajouterJoursAgenda(debutSemaine.value, -1) >= props.dateDebut)
const peutAvancer = computed(() => ajouterJoursAgenda(debutSemaine.value, JOURS_PAR_SEMAINE) <= props.dateFin)

function selectionnerJour(date: string): void {
  dateSelectionnee.value = date
  creneauSelectionne.value = creneauxParDate.value.get(date)?.[0]?.debut ?? null
}

function changerSemaine(direction: -1 | 1): void {
  const nouveauDebut = ajouterJoursAgenda(debutSemaine.value, direction * JOURS_PAR_SEMAINE)
  debutSemaine.value = nouveauDebut
  const premierJourDisponible = Array.from({ length: JOURS_PAR_SEMAINE }, (_, index) =>
    ajouterJoursAgenda(nouveauDebut, index),
  ).find(date => creneauxParDate.value.has(date))
  selectionnerJour(premierJourDisponible ?? nouveauDebut)
}

const lienConfirmation = computed(() => {
  if (!creneauSelectionne.value || !props.reponse) return undefined
  return {
    path: `/${props.username}/reserver`,
    query: { service: props.reponse.service.slug, debut: creneauSelectionne.value },
  }
})
const libelleConfirmation = computed(() => {
  if (!creneauSelectionne.value) return 'Choisissez une heure'
  const jour = new Intl.DateTimeFormat(LOCALE_FR, {
    timeZone: fuseauEffectif.value,
    weekday: 'long',
    day: 'numeric',
  }).format(new Date(creneauSelectionne.value))
  return `Confirmer ${jour} à ${formaterHeureAgenda(creneauSelectionne.value, fuseauEffectif.value)}`
})
</script>

<template>
  <section id="agenda" class="scroll-mt-24 rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8" aria-labelledby="agenda-titre">
    <div class="flex flex-col gap-2">
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">Agenda</p>
      <h2 id="agenda-titre" class="text-(length:--fs-32) leading-tight font-bold">Réservez votre rendez-vous</h2>
      <p class="text-texte-secondaire">Choisissez un service, un jour, puis une heure.</p>
    </div>

    <USelect
      v-model="serviceActif"
      :items="optionsServices"
      aria-label="Service à réserver"
      class="mt-6"
    />

    <div v-if="statut === 'pending'" class="mt-6 grid gap-6 xl:grid-cols-2" aria-live="polite" aria-busy="true">
      <div class="flex flex-col gap-4">
        <USkeleton class="h-8 w-40" />
        <div class="grid grid-cols-7 gap-2">
          <USkeleton v-for="jour in JOURS_PAR_SEMAINE" :key="jour" class="h-16 rounded-(--rayon-interne)" />
        </div>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:border-l xl:border-bordure xl:pl-8">
        <USkeleton v-for="heure in 4" :key="heure" class="h-(--cible-tactile) rounded-(--rayon-interne)" />
      </div>
      <span class="sr-only">Chargement des créneaux</span>
    </div>

    <div v-else-if="statut === 'error' || erreur" class="mt-6 flex flex-col items-start gap-3" role="alert">
      <p class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>Les créneaux ne sont pas disponibles pour le moment.</span>
      </p>
      <UButton variant="outline" icon="i-ph-arrow-counter-clockwise" @click="emit('reessayer')">
        Réessayer
      </UButton>
    </div>

    <AgendaSuspendue v-else-if="reponse?.suspendues" :username="username" />

    <div v-else-if="!reponse?.creneaux.length" class="mt-6 flex items-start gap-3 text-texte-secondaire" role="status">
      <UIcon name="i-ph-calendar-x" class="mt-0.5 size-5 shrink-0 text-accent" aria-hidden="true" />
      <p>Aucun créneau n’est disponible pour ce service actuellement.</p>
    </div>

    <div v-else class="mt-6 grid gap-6 xl:grid-cols-2 xl:gap-8">
      <div class="flex flex-col gap-4">
        <div class="flex items-center justify-between gap-4">
          <h3 class="text-(length:--fs-20) font-bold">{{ titreMois }}</h3>
          <div class="flex gap-2">
            <UButton
              type="button"
              icon="i-ph-caret-left"
              variant="outline"
              color="neutral"
              square
              size="lg"
              aria-label="Semaine précédente"
              :disabled="!peutReculer"
              @click="changerSemaine(-1)"
            />
            <UButton
              type="button"
              icon="i-ph-caret-right"
              variant="outline"
              color="neutral"
              square
              size="lg"
              aria-label="Semaine suivante"
              :disabled="!peutAvancer"
              @click="changerSemaine(1)"
            />
          </div>
        </div>

        <div class="grid grid-cols-7 gap-1 sm:gap-2" role="group" aria-label="Jours de la semaine">
          <button
            v-for="jour in jours"
            :key="jour.date"
            type="button"
            class="relative flex min-h-16 min-w-0 flex-col items-center justify-center rounded-(--rayon-interne) border text-(length:--fs-14) transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :class="dateSelectionnee === jour.date
              ? 'border-accent bg-accent font-semibold text-sur-accent'
              : 'border-bordure bg-champ text-encre hover:border-accent'"
            :disabled="jour.passe"
            :aria-pressed="dateSelectionnee === jour.date"
            :aria-label="jour.libelle"
            @click="selectionnerJour(jour.date)"
          >
            <span class="text-(length:--fs-12)">{{ jour.lettre }}</span>
            <span>{{ jour.numero }}</span>
            <span
              v-if="jour.disponible"
              class="absolute bottom-1.5 size-1.5 rounded-full"
              :class="dateSelectionnee === jour.date ? 'bg-sur-accent' : 'bg-accent'"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <div class="flex flex-col gap-4 xl:border-l xl:border-bordure xl:pl-8">
        <div>
          <h3 class="text-(length:--fs-20) font-bold">
            {{ dateSelectionneeLisible }}
          </h3>
          <p class="text-(length:--fs-14) text-texte-secondaire">{{ resumeCreneaux }}</p>
        </div>

        <div v-if="creneauxDuJour.length" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <button
            v-for="creneau in creneauxDuJour"
            :key="creneau.debut"
            type="button"
            class="min-h-(--cible-tactile) rounded-(--rayon-interne) border px-3 py-2 font-semibold transition-colors"
            :class="creneauSelectionne === creneau.debut
              ? 'border-accent bg-accent text-sur-accent'
              : 'border-bordure bg-champ text-encre hover:border-accent'"
            :aria-pressed="creneauSelectionne === creneau.debut"
            @click="creneauSelectionne = creneau.debut"
          >
            {{ formaterHeureAgenda(creneau.debut, fuseauEffectif) }}
          </button>
        </div>
        <p v-else class="text-texte-secondaire">Aucun créneau ce jour. Choisissez un jour marqué d’un point.</p>

        <UButton v-if="lienConfirmation" :to="lienConfirmation" block class="mt-auto">
          {{ libelleConfirmation }}
        </UButton>
        <p class="text-(length:--fs-14) text-texte-secondaire">Votre demande sera confirmée par le professionnel.</p>
      </div>
    </div>
  </section>
</template>
