<script setup lang="ts">
definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Votre vitrine — Brandself' })

const {
  vitrine, resume, enChargement, enErreur, absente, refresh, publicationEnCours, changerPublication,
} = useStudioVitrine()
const { etat: etatAgenda } = useStudioAgendaApercu()
const { nonLus: messagesNonLus } = useStudioMessages()
const { affichee } = useAdressePublique(() => vitrine.value?.username)

const {
  etape, definition: definitionEtape, enChargement: etapeEnChargement, enErreur: etapeEnErreur,
  ignorerEnCours, erreurIgnorer, annonce: annonceEtape, ignorer: ignorerEtape, refresh: rechargerEtape,
} = useProchaineEtape()

const carteEtape = useTemplateRef<{ focusTitre: () => void }>('carteEtape')
const titreListe = useTemplateRef<HTMLHeadingElement>('titreListe')
const partageOuvert = ref(false)
// Les disponibilités sont ouvertes : le message de partage peut proposer la réservation.
const reservable = computed(() => etatAgenda.value === 'Ouvert')

async function ignorer(): Promise<void> {
  if (!(await ignorerEtape())) return
  await nextTick()
  // Étape suivante : focus sur son titre ; sinon sur le titre « Votre vitrine ».
  if (carteEtape.value) carteEtape.value.focusTitre()
  else titreListe.value?.focus()
}

function actionEtape(): void {
  if (etape.value === 'partager') partageOuvert.value = true
}

// Le panneau a pu enregistrer le partage : la carte « Partagez votre vitrine » doit alors disparaître.
watch(partageOuvert, async (ouvert) => {
  if (ouvert) return
  await rechargerEtape()
  await nextTick()
  if (!carteEtape.value && document.activeElement === document.body) titreListe.value?.focus()
})

const manquants = computed(() => resume.value?.manquantsPourPublier ?? [])

function compteur(nombre: number): string {
  return nombre === 0 ? 'À ajouter' : String(nombre)
}

function pluriel(nombre: number, singulier: string, pluralise: string): string {
  return nombre > 1 ? pluralise : singulier
}

const lignes = computed(() => [
  { label: 'Profil', to: '/studio/profil', valeur: manquants.value.length === 0 ? 'Complet' : 'À compléter', recent: false },
  { label: 'Services', to: '/studio/services', valeur: compteur(resume.value?.compteurs.services ?? 0), recent: false },
  { label: 'Réalisations', to: '/studio/realisations', valeur: compteur(resume.value?.compteurs.realisations ?? 0), recent: false },
  { label: 'Témoignages', to: '/studio/temoignages', valeur: compteur(resume.value?.compteurs.temoignages ?? 0), recent: false },
  { label: 'Agenda', to: '/studio/agenda', valeur: etatAgenda.value, recent: false },
  {
    label: 'Messages',
    to: '/studio/messages',
    valeur: messagesNonLus.value > 0 ? `${messagesNonLus.value} ${pluriel(messagesNonLus.value, 'non lu', 'non lus')}` : 'Tout est lu',
    recent: messagesNonLus.value > 0,
  },
  { label: 'Liens', to: '/studio/liens', valeur: compteur(resume.value?.compteurs.liens ?? 0), recent: false },
])

const statistiques = computed(() => {
  const stats = resume.value?.statistiques7j
  if (!stats) return []
  return [
    { nombre: stats.visites, label: pluriel(stats.visites, 'visite', 'visites') },
    { nombre: stats.clics, label: pluriel(stats.clics, 'clic', 'clics') },
    { nombre: stats.reservations, label: pluriel(stats.reservations, 'réservation', 'réservations') },
  ]
})

// Un seul message de publication à la fois.
const messagePublication = ref('')
const profilIncomplet = ref(false)
const confirmerDepublication = ref(false)

async function publier(): Promise<void> {
  messagePublication.value = ''
  profilIncomplet.value = false
  const resultat = await changerPublication('publier')
  if (!resultat.ok) {
    messagePublication.value = resultat.message
    profilIncomplet.value = resultat.manquants.length > 0
  }
}

async function depublier(): Promise<void> {
  messagePublication.value = ''
  profilIncomplet.value = false
  const resultat = await changerPublication('depublier')
  if (resultat.ok) confirmerDepublication.value = false
  else messagePublication.value = resultat.message
}
</script>

<template>
  <div>
    <div v-if="enChargement" class="flex flex-col gap-6" aria-busy="true" aria-label="Chargement de votre vitrine">
      <USkeleton class="h-16 w-full" />
      <USkeleton class="h-28 w-full" />
      <USkeleton class="h-48 w-full" />
      <USkeleton class="h-64 w-full" />
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons votre vitrine"
      description="Quelques informations suffisent pour mettre votre vitrine en ligne."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || !vitrine || !resume"
      icon="i-ph-warning-circle"
      title="Votre vitrine ne s’affiche pas"
      description="Nous n’avons pas pu la charger. Vos informations sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="flex flex-col gap-8">
      <header class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div class="min-w-0">
          <h1 class="m-0 text-(length:--fs-24) leading-tight font-semibold text-encre md:text-(length:--fs-32)">
            Bonjour {{ vitrine.prenom }}
          </h1>
          <p class="m-0 break-all text-base text-texte-secondaire">
            {{ affichee }}
          </p>
        </div>
        <UBadge color="neutral" variant="outline" size="lg">
          <span
            class="size-2 rounded-full"
            :class="vitrine.publiee ? 'bg-accent' : 'bg-texte-secondaire'"
            aria-hidden="true"
          />
          {{ vitrine.publiee ? 'Publiée' : 'Brouillon' }}
        </UBadge>
      </header>

      <section aria-label="Statistiques des 7 derniers jours">
        <BsCard>
          <dl class="m-0 grid grid-cols-3 gap-4">
            <div v-for="stat in statistiques" :key="stat.label" class="flex flex-col-reverse">
              <dt class="text-base text-texte-secondaire">
                {{ stat.label }}
              </dt>
              <dd class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-semibold text-encre">
                {{ stat.nombre }}
              </dd>
            </div>
          </dl>
          <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
            7 derniers jours
          </p>
        </BsCard>
      </section>

      <p class="sr-only" role="status">
        {{ annonceEtape }}
      </p>

      <!-- Un seul message à l'écran : la carte s'efface quand une erreur de publication est affichée. -->
      <template v-if="!messagePublication">
        <USkeleton v-if="etapeEnChargement" class="h-48 w-full" aria-hidden="true" />
        <div v-else-if="etapeEnErreur" class="flex flex-col items-start gap-2">
          <p role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ MESSAGE_ETAPE_CHARGEMENT }}</span>
          </p>
          <UButton
            label="Réessayer"
            variant="outline"
            color="neutral"
            size="lg"
            class="min-h-(--cible-tactile)"
            @click="() => rechargerEtape()"
          />
        </div>
        <StudioProchaineEtape
          v-else-if="definitionEtape"
          ref="carteEtape"
          :etape="definitionEtape"
          ignorable
          :ignorer-en-cours="ignorerEnCours"
          :erreur="erreurIgnorer"
          @action="actionEtape"
          @ignorer="ignorer"
        />
      </template>

      <StudioPartageVitrine v-model:open="partageOuvert" :reservable="reservable" />

      <section aria-labelledby="titre-liste">
        <h2
          id="titre-liste"
          ref="titreListe"
          tabindex="-1"
          class="m-0 mb-2 text-(length:--fs-20) font-bold text-encre outline-none"
        >
          Votre vitrine
        </h2>
        <ul class="m-0 list-none p-0">
          <li v-for="ligne in lignes" :key="ligne.to" class="border-b border-bordure">
            <NuxtLink
              :to="ligne.to"
              class="flex min-h-14 items-center justify-between gap-3 px-1 text-base text-encre no-underline transition-colors hover:bg-surface"
            >
              <span>{{ ligne.label }}</span>
              <span class="flex items-center gap-2 text-texte-secondaire">
                <span v-if="ligne.recent" class="size-2 rounded-full bg-accent" aria-hidden="true" />
                <span v-if="ligne.valeur">{{ ligne.valeur }}</span>
                <UIcon name="i-ph-caret-right" class="size-5" aria-hidden="true" />
              </span>
            </NuxtLink>
          </li>
        </ul>
      </section>

      <section aria-labelledby="titre-publication" class="flex flex-col gap-3">
        <h2 id="titre-publication" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Publication
        </h2>

        <p v-if="messagePublication" role="alert" class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ messagePublication }}</span>
        </p>
        <UButton
          v-if="messagePublication && profilIncomplet"
          label="Compléter mon profil"
          to="/studio/profil"
          size="lg"
          variant="link"
          class="self-start"
        />

        <template v-if="vitrine.publiee">
          <p class="m-0 text-base text-texte-secondaire">
            Votre vitrine est en ligne et visible de tous.
          </p>
          <p v-if="confirmerDepublication" class="m-0 text-base text-encre">
            Elle ne sera plus visible tant que vous ne l’aurez pas publiée de nouveau.
          </p>
          <div v-if="confirmerDepublication" class="flex flex-col gap-2 sm:flex-row">
            <UButton label="Dépublier ma vitrine" color="error" :loading="publicationEnCours" @click="depublier" />
            <UButton label="Annuler" variant="outline" color="neutral" :disabled="publicationEnCours" @click="confirmerDepublication = false" />
          </div>
          <div v-else class="flex flex-col gap-2 sm:flex-row">
            <UButton label="Voir ma vitrine" :to="`/${vitrine.username}`" target="_blank" variant="outline" />
            <UButton label="Partager ma vitrine" icon="i-ph-share-network" variant="outline" aria-haspopup="dialog" @click="partageOuvert = true" />
            <UButton label="Dépublier" variant="ghost" color="neutral" @click="confirmerDepublication = true" />
          </div>
        </template>

        <template v-else>
          <p v-if="manquants.length > 0" class="m-0 text-base text-texte-secondaire">
            Pour publier, complétez votre profil : {{ libelleChampsManquants(manquants) }}.
          </p>
          <p v-else class="m-0 text-base text-texte-secondaire">
            Votre vitrine n’est visible que par vous. Publiez-la quand vous êtes prêt.
          </p>
          <div class="flex flex-col gap-2 sm:flex-row">
            <UButton
              v-if="manquants.length > 0"
              label="Compléter mon profil"
              to="/studio/profil"
              variant="outline"
            />
            <UButton
              v-else
              label="Publier ma vitrine"
              :loading="publicationEnCours"
              @click="publier"
            />
          </div>
        </template>
      </section>
    </div>
  </div>
</template>
