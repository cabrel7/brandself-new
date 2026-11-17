<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { MARQUE } from '#shared/brand'

// Le logo est l'unique contenu du lien : le lien porte un nom accessible explicite.
const LIBELLE_LIEN_ACCUEIL = `${MARQUE.nom}, accueil du studio`

const { entrees, estActive, estEcranEnfant } = useStudioNav()
const { nombre, affichage, libelleAccessible } = useStudioAgendaATraiter()

const items = computed<NavigationMenuItem[]>(() =>
  entrees.map((entree) => ({
    label: entree.label,
    to: entree.to,
    active: estActive(entree.to),
    slot: entree.to === CHEMIN_AGENDA ? 'agenda' : undefined,
  })),
)
</script>

<template>
  <header
    class="sticky top-0 z-10 border-b border-bordure bg-fond"
    :class="{ 'max-md:hidden': estEcranEnfant }"
  >
    <div class="studio-conteneur flex h-14 items-center justify-between md:hidden">
      <NuxtLink
        to="/studio"
        :aria-label="LIBELLE_LIEN_ACCUEIL"
        class="inline-flex min-h-(--cible-tactile) items-center"
      >
        <BsLogo variante="wordmark" class="h-8" />
      </NuxtLink>
      <StudioMenuCompte />
    </div>

    <div class="studio-conteneur hidden h-16 items-center justify-between gap-6 md:flex">
      <NuxtLink
        to="/studio"
        :aria-label="LIBELLE_LIEN_ACCUEIL"
        class="inline-flex min-h-(--cible-tactile) items-center"
      >
        <BsLogo variante="horizontal" class="h-10" />
      </NuxtLink>
      <UNavigationMenu
        :items="items"
        orientation="horizontal"
        aria-label="Navigation du studio"
        :ui="{ link: 'min-h-(--cible-tactile) items-center text-base' }"
      >
        <template #agenda-trailing>
          <template v-if="nombre > 0">
            <span
              class="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-(length:--fs-12) leading-5 font-semibold text-sur-accent"
              aria-hidden="true"
            >{{ affichage }}</span>
            <span class="sr-only">, {{ libelleAccessible }}</span>
          </template>
        </template>
      </UNavigationMenu>
      <StudioMenuCompte />
    </div>
  </header>
</template>
