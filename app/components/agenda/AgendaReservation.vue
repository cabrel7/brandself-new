<script setup lang="ts">
import type { CreneauDTO, ServicePublicCarteDTO } from '#shared/dto'
import { formatDureeCourte, formatDureeLongue, libellePrix } from '#shared/services'
import type { AgendaPublicStatut, ReponseMoisAgenda } from '~/composables/usePublicAgenda'
import {
  ajouterJoursAgenda,
  dateLocaleAgenda,
  formaterHeureAgenda,
  libelleMoisAgenda,
} from '~/composables/usePublicAgenda'

const props = defineProps<{
  username: string
  fuseau: string
  services: ServicePublicCarteDTO[]
  serviceSlug: string | null
  mois: string
  creneauxParJour: Map<string, CreneauDTO[]>
  peutReculer: boolean
  peutAvancer: boolean
  reponse: ReponseMoisAgenda | null
  statut: AgendaPublicStatut
  erreur: boolean
}>()

const emit = defineEmits<{
  changementService: [slug: string]
  changerMois: [direction: -1 | 1]
  reessayer: []
}>()

const LOCALE_FR = 'fr-FR'
const JOURS_SEMAINE_CALENDRIER = ['L', 'M', 'M', 'J', 'V', 'S', 'D'] as const

const serviceActif = computed({
  get: () => props.serviceSlug ?? '',
  set: (value: string) => emit('changementService', value),
})
const optionsServices = computed(() => props.services.map(service => ({
  label: service.dureeMin === null ? service.titre : `${service.titre} · ${formatDureeCourte(service.dureeMin)}`,
  value: service.slug,
})))

const fuseauEffectif = computed(() => props.reponse?.fuseau ?? props.fuseau)
const serviceCourant = computed(() => props.services.find(service => service.slug === props.serviceSlug) ?? null)
const paiement = computed(() => {
  const service = serviceCourant.value
  if (!service) return ''
  const prix = libellePrix(service)
  return service.tarif === 'payant' ? `${prix} · à régler sur place` : prix
})

const aujourdhui = dateLocaleAgenda(new Date(), fuseauEffectif.value)

const dateSelectionnee = ref('')
const creneauSelectionne = ref<string | null>(null)

const joursDuMois = computed(() => {
  const [annee = 0, moisNumero = 1] = props.mois.split('-').map(Number)
  const nombreJours = new Date(Date.UTC(annee, moisNumero, 0)).getUTCDate()
  return Array.from({ length: nombreJours }, (_, index) => {
    const date = ajouterJoursAgenda(`${props.mois}-01`, index)
    return {
      date,
      numero: String(index + 1),
      libelle: dateAccessible(date),
      disponible: props.creneauxParJour.has(date),
      passe: date < aujourdhui,
    }
  })
})

// Cellules vides devant le 1er pour aligner la grille sur L M M J V S D.
const cellulesVides = computed(() => {
  const [annee = 0, moisNumero = 1] = props.mois.split('-').map(Number)
  const jourSemaine = new Date(Date.UTC(annee, moisNumero - 1, 1)).getUTCDay() || 7
  return jourSemaine - 1
})

function dateCivile(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`)
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

function selectionnerJour(date: string): void {
  dateSelectionnee.value = date
  // L'heure n'est jamais présélectionnée : le CTA reste désactivé
  // tant que le visiteur n'a pas choisi un créneau (spec S7-bis §7.1).
  creneauSelectionne.value = null
}

// Le jour proposé par défaut est le premier jour du mois ayant un créneau.
watch(() => props.creneauxParJour, (groupes) => {
  const premierJourDisponible = joursDuMois.value.find(jour => groupes.has(jour.date))?.date
    ?? (props.mois === aujourdhui.slice(0, 7) ? aujourdhui : `${props.mois}-01`)
  if (premierJourDisponible !== dateSelectionnee.value || !groupes.has(dateSelectionnee.value)) {
    selectionnerJour(premierJourDisponible)
  }
}, { immediate: true })

const titreMois = computed(() => libelleMoisAgenda(props.mois))
const creneauxDuJour = computed(() => props.creneauxParJour.get(dateSelectionnee.value) ?? [])
const dateSelectionneeLisible = computed(() => dateAccessible(dateSelectionnee.value))
const villeFuseau = computed(() => {
  const segments = fuseauEffectif.value.split('/')
  return (segments[segments.length - 1] ?? fuseauEffectif.value).replaceAll('_', ' ')
})
const resumeCreneaux = computed(() => {
  const nombre = creneauxDuJour.value.length
  return `${nombre} créneau${nombre > 1 ? 'x' : ''} disponible${nombre > 1 ? 's' : ''} · Heure de ${villeFuseau.value}`
})

function jourLongMinuscule(dateCivileChaine: string): string {
  // La date est civile (YYYY-MM-DD) : le jour de la semaine se calcule en UTC
  // pour rester indépendant du fuseau (cf. dateAccessible).
  return new Intl.DateTimeFormat(LOCALE_FR, { weekday: 'long', timeZone: 'UTC' })
    .format(dateCivile(dateCivileChaine))
}

const libelleConfirmation = computed(() => {
  if (!dateSelectionnee.value) return 'Continuer'
  const jour = `Continuer avec ${jourLongMinuscule(dateSelectionnee.value)}`
  return creneauSelectionne.value
    ? `${jour} à ${formaterHeureAgenda(creneauSelectionne.value, fuseauEffectif.value)}`
    : jour
})
const lienConfirmation = computed(() => {
  if (!creneauSelectionne.value || !props.reponse) return undefined
  return {
    path: `/${props.username}/reserver`,
    query: { service: props.reponse.service.slug, debut: creneauSelectionne.value },
  }
})

function allerConfirmation(): void {
  if (lienConfirmation.value) navigateTo(lienConfirmation.value)
}

const dureeMinutes = computed(() => props.reponse?.service.dureeMin ?? null)
</script>

<template>
  <div class="grid items-start gap-6 xl:grid-cols-2 xl:gap-8">
    <div class="min-w-0 rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8" aria-labelledby="agenda-calendrier-titre">
      <h2 id="agenda-calendrier-titre" class="sr-only">Calendrier des créneaux</h2>

      <USelect
        v-model="serviceActif"
        :items="optionsServices"
        aria-label="Service à réserver"
        class="w-full"
      />

      <div v-if="statut === 'pending' && !reponse" class="mt-6 flex flex-col gap-4" aria-live="polite" aria-busy="true">
        <div class="flex items-center justify-between gap-4">
          <USkeleton class="h-8 w-40" />
          <USkeleton class="h-(--cible-tactile) w-24" />
        </div>
        <div class="grid grid-cols-7 gap-1 sm:gap-2">
          <USkeleton v-for="cellule in 35" :key="cellule" class="h-16 rounded-(--rayon-interne)" />
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

      <template v-else>
        <div class="mt-6 flex items-center justify-between gap-4">
          <h3 class="m-0 text-(length:--fs-24) font-bold">{{ titreMois }}</h3>
          <div class="flex gap-2">
            <UButton
              type="button"
              icon="i-ph-caret-left"
              variant="outline"
              color="neutral"
              square
              size="lg"
              aria-label="Mois précédent"
              :disabled="!peutReculer"
              @click="emit('changerMois', -1)"
            />
            <UButton
              type="button"
              icon="i-ph-caret-right"
              variant="outline"
              color="neutral"
              square
              size="lg"
              aria-label="Mois suivant"
              :disabled="!peutAvancer"
              @click="emit('changerMois', 1)"
            />
          </div>
        </div>

        <div class="mt-4 grid grid-cols-7 gap-1 text-center text-(length:--fs-14) font-semibold text-texte-secondaire sm:gap-2" aria-hidden="true">
          <span v-for="(lettre, index) in JOURS_SEMAINE_CALENDRIER" :key="index">{{ lettre }}</span>
        </div>

        <div class="mt-2 grid grid-cols-7 gap-1 sm:gap-2" role="group" aria-label="Jours du mois">
          <span v-for="cellule in cellulesVides" :key="`vide-${cellule}`" aria-hidden="true" />
          <button
            v-for="jour in joursDuMois"
            :key="jour.date"
            type="button"
            class="relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-(--rayon-interne) border py-1 text-(length:--fs-14) transition-colors disabled:cursor-not-allowed disabled:opacity-50"
            :class="dateSelectionnee === jour.date
              ? 'border-accent bg-accent font-semibold text-sur-accent'
              : jour.disponible
                ? 'border-bordure bg-champ text-accent-texte hover:border-accent'
                : 'border-bordure bg-champ text-encre hover:border-accent'"
            :disabled="jour.passe"
            :aria-pressed="dateSelectionnee === jour.date"
            :aria-label="`${jour.libelle}${jour.disponible ? ', créneaux disponibles' : ''}`"
            @click="selectionnerJour(jour.date)"
          >
            <span>{{ jour.numero }}</span>
            <span
              v-if="jour.disponible"
              class="absolute bottom-1 size-1.5 rounded-full"
              :class="dateSelectionnee === jour.date ? 'bg-sur-accent' : 'bg-accent'"
              aria-hidden="true"
            />
          </button>
        </div>

        <p v-if="creneauxParJour.size > 0" class="mt-4 flex items-center gap-2 text-(length:--fs-14) text-texte-secondaire">
          <span class="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
          Jours avec des créneaux disponibles
        </p>

        <div
          v-if="statut === 'success' && reponse !== null && creneauxParJour.size === 0"
          class="mt-6 flex flex-col items-start gap-3 text-texte-secondaire"
          role="status"
        >
          <p class="m-0">
            Aucun créneau en {{ titreMois.toLowerCase() }} — revenez plus tard ou regardez le mois suivant.
          </p>
          <UButton
            variant="outline"
            icon="i-ph-caret-right"
            :disabled="!peutAvancer"
            @click="emit('changerMois', 1)"
          >
            Mois suivant
          </UButton>
        </div>
      </template>
    </div>

    <div class="min-w-0 rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8" aria-labelledby="agenda-jour-titre">
      <div>
        <h2 id="agenda-jour-titre" class="m-0 text-(length:--fs-24) leading-tight font-bold md:text-(length:--fs-32)">
          {{ dateSelectionneeLisible }}
        </h2>
        <p class="m-0 mt-1 text-(length:--fs-14) text-texte-secondaire" aria-live="polite">{{ resumeCreneaux }}</p>
      </div>

      <div v-if="creneauxDuJour.length > 0" class="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
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
      <p v-else class="mt-5 text-texte-secondaire" role="status">
        Aucun créneau ce jour. Choisissez un jour marqué d’un point.
      </p>

      <ul class="m-0 mt-6 flex list-none flex-col gap-3 border-t border-bordure p-0 pt-5 text-base">
        <li v-if="dureeMinutes !== null" class="flex items-center gap-3">
          <UIcon name="i-ph-clock" class="size-5 shrink-0 text-accent" aria-hidden="true" />
          <span>{{ formatDureeLongue(dureeMinutes) }}</span>
        </li>
        <li v-if="paiement" class="flex items-center gap-3">
          <UIcon name="i-ph-credit-card" class="size-5 shrink-0 text-accent" aria-hidden="true" />
          <span>{{ paiement }}</span>
        </li>
      </ul>

      <UButton
        type="button"
        block
        size="lg"
        class="mt-6 min-h-(--cible-tactile)"
        :disabled="!creneauSelectionne"
        @click="allerConfirmation"
      >
        {{ libelleConfirmation }}
      </UButton>
      <p class="mt-3 text-(length:--fs-14) text-texte-secondaire">
        Vous confirmez vos informations à l’étape suivante.
      </p>
    </div>
  </div>
</template>
