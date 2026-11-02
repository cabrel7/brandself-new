<script setup lang="ts">
import type { LiensPublicsReponse } from '#shared/dto'

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

function estLienInterne(url: string): boolean {
  return url.startsWith('/')
}

function estLienReservation(url: string): boolean {
  return url === urlReserver.value || url === urlReserverHerite.value
}
</script>

<template>
  <VitrineCadre :vitrine="vitrine" sans-nav pied-minimal>
    <div class="mx-auto flex w-full max-w-md flex-col items-center px-6 pt-10 pb-4">
      <div class="flex h-34 w-28 shrink-0 items-center justify-center overflow-hidden rounded-t-full rounded-b-2xl bg-accent-doux">
        <img
          v-if="vitrine.photo"
          :src="vitrine.photo.url"
          :srcset="vitrine.photo.srcset"
          :width="vitrine.photo.largeur"
          :height="vitrine.photo.hauteur"
          :alt="`Portrait de ${vitrine.nomAffiche}`"
          class="size-full object-cover object-center"
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

        <UButton
          v-if="servicesDisponibles && !servicesPersonnalise"
          :to="urlServices"
          variant="ghost"
          color="neutral"
          block
          size="lg"
          class="justify-between border border-bordure bg-surface px-5 font-semibold text-encre hover:bg-accent-doux"
        >
          <span>Mes services</span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0" aria-hidden="true" />
        </UButton>

        <UButton
          v-if="urlWhatsapp && !whatsappPersonnalise"
          :href="urlWhatsapp"
          variant="ghost"
          color="neutral"
          block
          size="lg"
          class="justify-between border border-bordure bg-surface px-5 font-semibold text-encre hover:bg-accent-doux"
          target="_blank"
          rel="noopener nofollow"
        >
          <span>Écrire sur WhatsApp</span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0" aria-hidden="true" />
        </UButton>

        <a
          v-for="lien in liens"
          :key="lien.slug"
          :href="lien.url"
          :ping="endpointClic(lien.slug)"
          class="inline-flex min-h-(--cible-tactile) w-full items-center justify-between gap-2 rounded-(--rayon) px-5 py-2 text-base font-semibold no-underline transition-colors focus-visible:outline-3 focus-visible:outline-accent"
          :class="estLienReservation(lien.url)
            ? 'bg-accent text-sur-accent hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))]'
            : 'border border-bordure bg-surface text-encre hover:bg-accent-doux'"
          :target="estLienInterne(lien.url) ? undefined : '_blank'"
          :rel="estLienInterne(lien.url) ? undefined : 'noopener nofollow'"
        >
          <span class="min-w-0 truncate wrap-break-word">{{ lien.libelle }}</span>
          <UIcon name="i-ph-caret-right" class="size-5 shrink-0" aria-hidden="true" />
        </a>
      </div>
    </div>
  </VitrineCadre>
</template>
