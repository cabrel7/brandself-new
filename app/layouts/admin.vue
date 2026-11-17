<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { ADMIN_NAV, ADMIN_PREFIXE_PAGES } from '#shared/admin'
import type { ElementNavAdmin } from '#shared/admin'

const LIBELLE_BANDEAU = 'Administration'
// A3 : « Paiements » n'est pas encore dans `ADMIN_NAV` (shared/, test de contrat figé) ; elle suit « Abonnements ».
const ENTREE_PAIEMENTS: ElementNavAdmin = { id: 'paiements', libelle: 'Paiements', to: '/admin/paiements', icone: 'i-ph-receipt' }
const navigation: readonly ElementNavAdmin[] = ADMIN_NAV.flatMap((entree) =>
  entree.id === 'abonnements' ? [entree, ENTREE_PAIEMENTS] : [entree],
)

const route = useRoute()
const { session, deconnexionEnCours, deconnecter } = useAdminSession()
const barreLateraleReduite = ref(false)

useSeoMeta({ robots: 'noindex, nofollow' })

// « Vue d'ensemble » (/admin) ne reste pas active sur les autres pages : seule l'égalité compte pour elle.
function estActive(to: string): boolean {
  return to === ADMIN_PREFIXE_PAGES ? route.path === to : route.path === to || route.path.startsWith(`${to}/`)
}

const entrees = computed<NavigationMenuItem[]>(() =>
  navigation.map((entree) => ({
    label: entree.libelle,
    icon: entree.icone,
    to: entree.to,
    active: estActive(entree.to),
  })),
)

const titrePage = computed(() => navigation.find((entree) => estActive(entree.to))?.libelle ?? LIBELLE_BANDEAU)
</script>

<template>
  <div class="flex h-dvh flex-col bg-fond">
    <!-- Bandeau permanent : aucune fermeture possible (la prop `close` est absente par défaut, posée à false par prudence). -->
    <UBanner
      :title="LIBELLE_BANDEAU"
      icon="i-ph-shield-check"
      :close="false"
      :ui="{
        root: 'bg-(color:--admin-bandeau)',
        title: 'text-(color:--sur-admin-bandeau)',
        icon: 'text-(color:--sur-admin-bandeau)',
      }"
    />

    <!-- Le groupe est fixé plein écran par défaut : il reste ici dans le flux, sous le bandeau. -->
    <UDashboardGroup class="relative inset-auto min-h-0 flex-1">
      <UDashboardSidebar
        v-model:collapsed="barreLateraleReduite"
        resizable
        collapsible
        :min-size="14"
        :default-size="18"
        :max-size="24"
        :collapsed-size="5"
        :ui="{ root: 'min-h-0 bg-fond' }"
      >
        <template #header>
          <UDashboardSidebarCollapse class="min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center max-lg:hidden" />
        </template>

        <template #default="{ collapsed }">
          <UNavigationMenu
            :items="entrees"
            orientation="vertical"
            :collapsed="collapsed"
            :tooltip="collapsed"
            aria-label="Navigation de l’administration"
            :ui="{ link: 'min-h-(--cible-tactile) items-center text-base' }"
          />
        </template>
      </UDashboardSidebar>

      <UDashboardPanel class="min-h-0">
        <template #header>
          <UDashboardNavbar
            :title="titrePage"
            :toggle="{ class: 'min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center' }"
            :ui="{ left: 'min-w-0 flex-1', title: 'truncate', right: 'shrink-0' }">
            <template #right>
              <AdminRechercheGlobale />
              <UUser
                v-if="session"
                :name="session.nom"
                size="sm"
                class="hidden max-w-64 min-w-0 sm:flex"
                :title="session.nom"
                :ui="{ wrapper: 'min-w-0', name: 'truncate' }"
              />
              <UButton
                color="neutral"
                variant="outline"
                size="lg"
                icon="i-ph-sign-out"
                aria-label="Déconnexion"
                class="min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center"
                :loading="deconnexionEnCours"
                @click="deconnecter"
              >
                <span class="hidden sm:inline">Déconnexion</span>
              </UButton>
            </template>
          </UDashboardNavbar>
        </template>

        <template #body>
          <main class="min-w-0">
            <slot />
          </main>
        </template>
      </UDashboardPanel>
    </UDashboardGroup>
  </div>
</template>
