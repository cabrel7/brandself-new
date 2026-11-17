<script setup lang="ts">
import type { LiensPublicsReponse } from '#shared/dto'
import { plateformeDuLien } from '#shared/plateformes'

const route = useRoute()
const username = String(route.params.username)

const vitrine = await usePublicVitrine(username)
const contenus = usePublicContenus(username)

const { data: reponseLiens, error: erreurLiens } = await useAsyncData(
  `liens-publics-${username}`,
  () => $fetch<LiensPublicsReponse>(`/api/public/${encodeURIComponent(username)}/liens`),
)

if (erreurLiens.value) throw erreurPagePublique(erreurLiens.value)

const liens = computed(() => reponseLiens.value?.liens ?? [])
const servicesDisponibles = computed(() => (contenus.value?.services ?? 0) > 0)

const urlServices = computed(() => `/${username}/services`)
const urlReserver = computed(() => `/${username}/agenda`)
// Anciens liens du studio créés avant S7-bis : ils remplacent aussi le bouton natif.
const urlReserverHerite = computed(() => `/${username}/reserver`)

const urlWhatsapp = computed(() => {
  const numero = vitrine.value.contact?.whatsapp ?? vitrine.value.contact?.telephone
  return numero ? `https://wa.me/${numero.replace(/\D/g, '')}` : null
})

/**
 * Un lien du studio pointant vers la même destination qu’un bouton natif le remplace :
 * l’utilisateur a choisi son libellé et son emplacement, la page publique reflète alors
 * exactement l’ordre du studio sans doublon.
 */
function remplaceBoutonNatif(destination: string | null): boolean {
  if (!destination) return false
  return liens.value.some((lien) => lien.url === destination)
}

const reserverPersonnalise = computed(() =>
  remplaceBoutonNatif(urlReserver.value) || remplaceBoutonNatif(urlReserverHerite.value),
)
const servicesPersonnalise = computed(() => remplaceBoutonNatif(urlServices.value))
const whatsappPersonnalise = computed(() => remplaceBoutonNatif(urlWhatsapp.value))

const sousTitre = computed(() =>
  [vitrine.value.metier, vitrine.value.ville].filter(Boolean).join(' · '),
)

const initiales = computed(() =>
  (vitrine.value.prenom.charAt(0) + vitrine.value.nom.charAt(0)).toUpperCase(),
)

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

function estLienInterne(url: string): boolean {
  return url.startsWith('/')
}

function estLienReservation(url: string): boolean {
  return url === urlReserver.value || url === urlReserverHerite.value
}

useSeoVitrine({ vitrine: vitrine.value, page: 'lien-bio', liens: liens.value })
</script>

<template>
  <VitrineCadre :vitrine="vitrine" sans-nav pied-minimal>
    <div class="mx-auto flex w-full max-w-md flex-col items-center px-6 pt-10 pb-4">
      <div class="flex h-(--photo-arche-hauteur) w-(--photo-arche-largeur) shrink-0 items-center justify-center overflow-hidden rounded-t-full rounded-b-3xl bg-accent-doux shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--encre)_35%,transparent)] ring-1 ring-bordure">
        <img
          v-if="vitrine.photo"
          :src="vitrine.photo.url"
          :srcset="vitrine.photo.srcset"
          sizes="144px"
          :width="vitrine.photo.largeur"
          :height="vitrine.photo.hauteur"
          :alt="`Portrait de ${vitrine.nomAffiche}`"
          fetchpriority="high"
          class="size-full object-cover object-top"
        >
        <span v-else class="font-(family-name:--font-titre) text-(length:--fs-48) leading-none font-medium text-accent">
          {{ initiales }}
        </span>
      </div>

      <h1 class="m-0 mt-4 font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold text-encre text-center">
        {{ vitrine.nomAffiche }}
      </h1>
      <p v-if="sousTitre" class="m-0 mt-2 text-center text-(length:--fs-16) text-texte-secondaire">
        {{ sousTitre }}
      </p>

      <div class="mt-8 flex w-full flex-col gap-4">
        <UButton
          v-if="!reserverPersonnalise"
          :to="urlReserver"
          block
          size="lg"
          class="justify-between px-5"
        >
          <span>Prendre rendez-vous</span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0" aria-hidden="true" />
        </UButton>

        <VitrineLienPlateforme
          v-if="servicesDisponibles && !servicesPersonnalise"
          :href="urlServices"
          libelle="Mes services"
          :plateforme="null"
          icone-neutre="i-ph-list-bullets"
        />

        <VitrineLienPlateforme
          v-if="urlWhatsapp && !whatsappPersonnalise"
          :href="urlWhatsapp"
          libelle="Écrire sur WhatsApp"
          plateforme="whatsapp"
        />

        <template v-for="lien in liens" :key="lien.slug">
          <a
            v-if="estLienReservation(lien.url)"
            :href="lien.url"
            class="inline-flex min-h-14 w-full items-center justify-between gap-2 rounded-(--rayon) bg-accent px-5 py-2 text-base font-semibold text-sur-accent no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))] focus-visible:outline-3 focus-visible:outline-accent"
            @click="compterClic(lien.slug)"
            @auxclick="compterClic(lien.slug)"
          >
            <span class="min-w-0 truncate wrap-break-word">{{ lien.libelle }}</span>
            <UIcon name="i-ph-caret-right" class="size-5 shrink-0" aria-hidden="true" />
          </a>
          <VitrineLienPlateforme
            v-else
            :href="lien.url"
            :libelle="lien.libelle"
            :plateforme="plateformeDuLien(lien)"
            :icone-neutre="estLienInterne(lien.url) ? 'i-ph-storefront' : undefined"
            @clic="compterClic(lien.slug)"
          />
        </template>
      </div>
    </div>
  </VitrineCadre>
</template>
