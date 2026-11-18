<script setup lang="ts">
import type { LiensPublicsReponse } from '#shared/dto'
import { plateformeDuLien } from '#shared/plateformes'
import type { PlateformeCle } from '#shared/plateformes'

const route = useRoute()
const username = String(route.params.username)

const vitrine = await usePublicVitrine(username)
const contenus = usePublicContenus(username)

// Les lectures partent ensemble ; rien n’est demandé pour une liste ou un agenda absents.
const [{ data: reponseLiens, error: erreurLiens }, services] = await Promise.all([
  useAsyncData(
    `liens-publics-${username}`,
    () => $fetch<LiensPublicsReponse>(`/api/public/${encodeURIComponent(username)}/liens`),
  ),
  contenus.value.services > 0 ? usePublicServices(username) : Promise.resolve(null),
])

if (erreurLiens.value) throw erreurPagePublique(erreurLiens.value)

const liens = computed(() => reponseLiens.value?.liens ?? [])

const totalServices = computed(() => services?.reponse.value?.total ?? 0)
const servicesReservables = computed(() => (services?.reponse.value?.services ?? []).filter(service =>
  service.reservable
  && service.dureeMin !== null
  && (service.type === 'rdv' || service.type === 'accompagnement'),
))

// Un seul appel (créneaux du premier service réservable), et seulement si la vitrine a un agenda.
const agenda = await usePublicAgenda({
  username,
  fuseau: vitrine.value.fuseau,
  serviceSlug: contenus.value.agenda ? (servicesReservables.value[0]?.slug ?? null) : null,
  cle: 'lien-bio',
})
const prochainCreneau = agenda.prochainCreneau
const creneauTo = computed(() => prochainCreneau.value
  ? { path: `/${username}/agenda`, query: { service: prochainCreneau.value.serviceSlug } }
  : `/${username}/agenda`,
)

const ICONE_SERVICES = 'i-ph-briefcase'
const urlServices = computed(() => `/${username}/services`)
const urlReserver = computed(() => `/${username}/agenda`)
// Anciens liens du studio créés avant S7-bis : ils remplacent aussi le bouton natif.
const urlReserverHerite = computed(() => `/${username}/reserver`)
const urlVitrine = computed(() => `/${username}`)

const urlWhatsapp = computed(() => {
  const numero = vitrine.value.contact?.whatsapp ?? vitrine.value.contact?.telephone
  return numero ? `https://wa.me/${numero.replace(/\D/g, '')}` : null
})

const urlTelephone = computed(() => {
  const numero = vitrine.value.contact?.telephone
  return numero ? `tel:${numero.replace(/[^\d+]/g, '')}` : null
})

// Localisation : « ville, pays » seulement si renseignés ; ouvre la carte sur ce lieu.
const libelleLocalisation = computed(() =>
  [vitrine.value.ville, vitrine.value.paysLibelle].map(partie => partie?.trim()).filter(Boolean).join(', '),
)
const urlLocalisation = computed(() => libelleLocalisation.value
  ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(libelleLocalisation.value)}`
  : null,
)

/**
 * Un lien du studio pointant vers la même destination qu’un bouton natif le remplace :
 * l’utilisateur a choisi son libellé et son emplacement, la page publique reflète alors
 * exactement l’ordre du studio sans doublon.
 */
function remplaceBoutonNatif(destination: string | null): boolean {
  if (!destination) return false
  return liens.value.some((lien) => lien.url === destination)
}

const whatsappPersonnalise = computed(() => remplaceBoutonNatif(urlWhatsapp.value))
const telephonePersonnalise = computed(() => remplaceBoutonNatif(urlTelephone.value))
const vitrinePersonnalisee = computed(() => remplaceBoutonNatif(urlVitrine.value))

function estLienReservation(url: string): boolean {
  return url === urlReserver.value || url === urlReserverHerite.value
}

interface BoutonReserver {
  cle: string
  slug: string | null
  libelle: string
  href: string
}

// Plein écran : la page n'utilise pas `VitrineCadre` (portrait pleine largeur, pied propre).
// Grand bouton : le lien du studio (libellé choisi) ou, à défaut, le bouton natif.
const boutonsReserver = computed<BoutonReserver[]>(() => {
  const personnalises = liens.value
    .filter(lien => estLienReservation(lien.url))
    .map(lien => ({ cle: lien.slug, slug: lien.slug, libelle: lien.libelle, href: lien.url }))
  if (personnalises.length > 0) return personnalises
  // Bouton natif seulement s'il y a quelque chose à réserver : on n'affiche pas ce qui n'existe pas.
  if (!contenus.value.agenda || servicesReservables.value.length === 0) return []
  return [{ cle: 'natif', slug: null, libelle: 'Prendre rendez-vous', href: urlReserver.value }]
})

interface ActionRapide {
  cle: string
  libelle: string
  nomAccessible?: string
  href: string
  icone: string
  externe: boolean
}

const actions = computed(() => {
  const liste: ActionRapide[] = []
  if (urlTelephone.value && !telephonePersonnalise.value) {
    liste.push({ cle: 'appeler', libelle: 'Appeler', href: urlTelephone.value, icone: 'i-ph-phone', externe: false })
  }
  if (urlWhatsapp.value && !whatsappPersonnalise.value) {
    liste.push({
      cle: 'whatsapp',
      libelle: 'WhatsApp',
      nomAccessible: 'Écrire sur WhatsApp',
      href: urlWhatsapp.value,
      icone: 'i-ph-whatsapp-logo',
      externe: true,
    })
  }
  if (urlLocalisation.value && libelleLocalisation.value) {
    liste.push({
      cle: 'localisation',
      libelle: libelleLocalisation.value,
      nomAccessible: `Localisation : ${libelleLocalisation.value}`,
      href: urlLocalisation.value,
      icone: 'i-ph-map-pin',
      externe: true,
    })
  }
  if (!vitrinePersonnalisee.value) {
    liste.push({ cle: 'vitrine', libelle: 'Site web', href: urlVitrine.value, icone: 'i-ph-globe', externe: false })
  }
  return liste
})

// Liens du studio hors réservation : icônes rondes pour les plateformes reconnues, liste pour le reste.
const reseaux = computed(() => liens.value.flatMap((lien) => {
  const plateforme: PlateformeCle | null = estLienReservation(lien.url) ? null : plateformeDuLien(lien)
  return plateforme ? [{ slug: lien.slug, libelle: lien.libelle, url: lien.url, plateforme }] : []
}))
// Liste de liens : « Mes services » en premier (le lien du studio vers les services, avec son libellé, sinon le lien natif
// dès qu'il y a au moins un service visible), puis les autres liens du studio dans leur ordre. Aucune carte de service ici :
// le détail des services est dans la vitrine.
const lienServices = computed(() => {
  const personnalise = liens.value.find(lien => lien.url === urlServices.value)
  if (personnalise) return { slug: personnalise.slug, libelle: personnalise.libelle, url: personnalise.url, icone: ICONE_SERVICES }
  if (totalServices.value > 0) return { slug: null, libelle: 'Mes services', url: urlServices.value, icone: ICONE_SERVICES }
  return null
})
const autres = computed(() => {
  const suite = liens.value
    .filter(lien => !estLienReservation(lien.url) && plateformeDuLien(lien) === null && lien.url !== urlServices.value)
    .map(({ slug, libelle, url }) => ({ slug, libelle, url, icone: null }))
  return lienServices.value ? [lienServices.value, ...suite] : suite
})

const siteUrl = (useSiteConfig().url ?? '').replace(/\/+$/, '') || useRequestURL().origin
const urlPage = `${siteUrl}/@${username}`

function endpointClic(slug: string): string {
  return `/api/public/${encodeURIComponent(username)}/liens/${encodeURIComponent(slug)}/clic`
}

/**
 * Clic compté en arrière-plan, sans retarder la navigation. `sendBeacon` plutôt que l’attribut
 * `ping` : Firefox le désactive par défaut et la plupart des bloqueurs de publicités l’interceptent.
 */
function compterClic(slug: string): void {
  if (typeof navigator.sendBeacon === 'function') navigator.sendBeacon(endpointClic(slug))
}

// Le fond (<body>) suit la palette : l’attribut doit être sur <html>, comme dans `VitrineCadre`.
useHead({ htmlAttrs: { 'data-palette': () => vitrine.value.palette, 'lang': 'fr' } })

useSeoVitrine({ vitrine: vitrine.value, page: 'lien-bio', liens: liens.value })
</script>

<template>
  <div :data-palette="vitrine.palette" class="flex min-h-dvh flex-col bg-fond text-encre">
    <!-- Téléphone : une colonne de 448 px. Dès 768 px : deux colonnes (portrait, nom, réservation / créneau, liens, réseaux). -->
    <main class="relative mx-auto w-full max-w-md flex-1 pb-8 md:grid md:max-w-5xl md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] md:content-start md:items-start md:gap-x-12 md:px-8">
      <VitrineLienBioEntete :logo="vitrine.badgeBrandself" :url="urlPage" :titre="vitrine.nomAffiche" />

      <div class="md:sticky md:top-6">
        <VitrineLienBioHero :vitrine="vitrine" />

        <div class="mt-6 flex flex-col gap-4 px-6 md:px-0">
          <NuxtLink
            v-for="bouton in boutonsReserver"
            :key="bouton.cle"
            :to="bouton.href"
            class="flex min-h-16 w-full items-center gap-3 rounded-full bg-accent px-6 py-2 text-(length:--fs-20) leading-tight font-semibold text-sur-accent no-underline transition-[filter] hover:brightness-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
            @click="bouton.slug && compterClic(bouton.slug)"
            @auxclick="bouton.slug && compterClic(bouton.slug)"
          >
            <UIcon name="i-ph-calendar-check" class="size-6 shrink-0" aria-hidden="true" />
            <span class="min-w-0 flex-1 text-balance">{{ bouton.libelle }}</span>
            <UIcon name="i-ph-caret-right" class="size-5 shrink-0" aria-hidden="true" />
          </NuxtLink>
          <VitrineLienBioActions :actions="actions" />
        </div>
      </div>

      <div class="mt-8 flex flex-col gap-8 px-6 md:mt-0 md:px-0">
        <VitrineLienBioCreneau
          v-if="prochainCreneau"
          :creneau="prochainCreneau"
          :service-titre="agenda.reponse.value?.service.titre ?? null"
          :to="creneauTo"
        />

        <VitrineLienBioReseaux v-if="reseaux.length > 0 || autres.length > 0" :reseaux="reseaux" :autres="autres" @clic="compterClic" />
      </div>
    </main>

    <footer v-if="vitrine.badgeBrandself" class="mx-auto w-full max-w-md px-6 pb-6 md:max-w-5xl md:px-8">
      <VitrineLienBioPied />
    </footer>
  </div>
</template>
