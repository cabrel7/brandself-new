<script setup lang="ts">
import type { ContenusPublicsDTO } from '#shared/dto'
import { realisationsHref } from '#shared/realisations'

const props = defineProps<{ nomAffiche: string, username: string, contenus: ContenusPublicsDTO }>()

const route = useRoute()
const menuOuvert = ref(false)
// Le volet (Dialog + Slideover) n'est monté, donc téléchargé, qu'à la première intention d'ouvrir le menu.
const menuDemande = ref(false)
const boutonMenu = useTemplateRef<HTMLButtonElement>('boutonMenu')
// Survol, focus ou appui précèdent le clic : le volet est prêt quand le clic arrive.
function preparerMenu() { menuDemande.value = true }
function ouvrirMenu() {
  menuDemande.value = true
  menuOuvert.value = true
}
// Sans déclencheur Reka, le focus revient explicitement au bouton à la fermeture.
watch(menuOuvert, async (ouvert) => {
  if (ouvert) return
  await nextTick()
  boutonMenu.value?.focus()
})
// Le menu se ferme aussi quand la navigation vient d'ailleurs (retour du navigateur).
watch(() => route.fullPath, () => { menuOuvert.value = false })

const servicesHref = computed(() => `/${props.username}/services`)
const realisationsHrefComputed = computed(() => realisationsHref(props.username))
// S7-bis : « Réserver » mène à la page Agenda, seul endroit où choisir un créneau.
const reserverHref = computed(() => `/${props.username}/agenda`)
const reserverActif = computed(() => route.path === reserverHref.value)

const liens = computed(() => {
  const items: { libelle: string, to: string }[] = []
  if (props.contenus.services > 0) items.push({ libelle: 'Services', to: servicesHref.value })
  if (props.contenus.realisations > 0) items.push({ libelle: 'Réalisations', to: realisationsHrefComputed.value })
  if (props.contenus.agenda) items.push({ libelle: 'Agenda', to: `/${props.username}/agenda` })
  items.push({ libelle: 'Contact', to: `/${props.username}/contact` })
  return items.map(item => ({
    ...item,
    actif: route.path === item.to || route.path.startsWith(`${item.to}/`),
  }))
})
</script>

<template>
  <header class="border-b border-bordure bg-fond sticky top-0 z-10">
    <div class="mx-auto flex min-h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
      <NuxtLink
        :to="`/${username}`"
        class="inline-flex min-h-(--cible-tactile) min-w-0 items-center font-(family-name:--font-titre) text-(length:--fs-16) font-bold md:text-(length:--fs-20)"
      >
        <span class="line-clamp-2 md:truncate">{{ nomAffiche }}</span>
      </NuxtLink>
      <div class="flex shrink-0 items-center gap-2">
        <nav aria-label="Navigation principale" class="flex shrink-0 items-center gap-6">
          <NuxtLink
            v-for="lien in liens"
            :key="lien.to"
            :to="lien.to"
            :aria-current="lien.actif ? 'page' : undefined"
            class="hidden min-h-(--cible-tactile) items-center text-(length:--fs-14) font-medium transition-colors hover:text-accent-texte md:inline-flex"
            :class="lien.actif ? 'text-encre font-semibold underline underline-offset-8 decoration-accent' : 'text-texte-secondaire'"
          >
            {{ lien.libelle }}
          </NuxtLink>
          <NuxtLink
            v-if="contenus.agenda"
            :to="reserverHref"
            :aria-current="reserverActif ? 'page' : undefined"
            class="inline-flex min-h-(--cible-tactile) items-center rounded-(--rayon) bg-accent px-4 py-2 text-(length:--fs-14) font-medium text-sur-accent no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Réserver
          </NuxtLink>
        </nav>

        <!-- Sous 768 px : les liens passent dans un menu qui descend du haut. Les liens restent dans la navigation principale rendue au serveur. -->
        <button
          ref="boutonMenu"
          type="button"
          aria-haspopup="dialog"
          :aria-expanded="menuOuvert"
          class="inline-flex size-(--cible-tactile) items-center justify-center rounded-(--rayon) text-encre transition-colors hover:bg-surface hover:text-accent-texte focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent md:hidden"
          @pointerenter="preparerMenu"
          @pointerdown="preparerMenu"
          @focus="preparerMenu"
          @click="ouvrirMenu"
        >
          <UIcon name="i-ph-list" class="size-6" aria-hidden="true" />
          <span class="sr-only">Menu</span>
        </button>

        <LazyUSlideover
          v-if="menuDemande"
          v-model:open="menuOuvert"
          side="top"
          description="Pages de la vitrine"
          :ui="{ content: 'bg-fond text-encre', wrapper: 'min-w-0 flex-1', title: 'line-clamp-2 font-(family-name:--font-titre) text-(length:--fs-20) font-bold text-encre', description: 'sr-only', close: 'shrink-0' }"
        >
          <template #title>
            {{ nomAffiche }}<span class="sr-only">, menu</span>
          </template>

          <template #body>
            <nav aria-label="Menu de la vitrine" class="flex flex-col gap-1">
              <NuxtLink
                v-for="lien in liens"
                :key="lien.to"
                :to="lien.to"
                :aria-current="lien.actif ? 'page' : undefined"
                class="flex min-h-(--cible-tactile) items-center rounded-(--rayon) border-l-4 px-3 text-(length:--fs-16) transition-colors hover:bg-surface hover:text-accent-texte focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
                :class="lien.actif ? 'border-accent font-bold text-encre' : 'border-transparent font-medium text-texte-secondaire'"
                @click="menuOuvert = false"
              >
                {{ lien.libelle }}
              </NuxtLink>
              <NuxtLink
                v-if="contenus.agenda"
                :to="reserverHref"
                :aria-current="reserverActif ? 'page' : undefined"
                class="mt-3 inline-flex min-h-(--cible-tactile) items-center justify-center rounded-(--rayon) bg-accent px-4 py-2 text-(length:--fs-16) font-medium text-sur-accent no-underline transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_88%,var(--encre))] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
                @click="menuOuvert = false"
              >
                Réserver
              </NuxtLink>
            </nav>
          </template>
        </LazyUSlideover>
      </div>
    </div>
  </header>
</template>
