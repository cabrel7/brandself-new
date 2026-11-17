<script setup lang="ts">
import type { CommandPaletteGroup, CommandPaletteItem } from '@nuxt/ui'
import { ADMIN_RECHERCHE_MAX, ADMIN_RECHERCHE_MIN } from '#shared/admin-a2'
import { etiquettesUtilisateur, valeurOuTiret } from '~/utils/admin-a2'

// Recherche globale de la barre du haut : comptes et vitrines, 10 résultats par groupe (le serveur limite).
// Le filtrage est celui du serveur (e-mail, téléphone, adresse, nom) : le filtre local de la palette est coupé.
const ouvert = ref(false)
const route = useRoute()
const { saisie, resultats, enCours, erreur, tropCourte, sansResultat, reinitialiser } = useAdminRecherche()

defineShortcuts({ meta_k: () => { ouvert.value = true } })

// La navigation vers une fiche ferme la fenêtre ; à la fermeture, la recherche repart de zéro.
watch(() => route.fullPath, () => { ouvert.value = false })
watch(ouvert, (estOuvert) => {
  if (!estOuvert) reinitialiser()
})

const groupes = computed<CommandPaletteGroup<CommandPaletteItem>[]>(() => {
  if (!resultats.value) return []
  const comptes: CommandPaletteItem[] = resultats.value.utilisateurs.map((u) => ({
    id: `utilisateur-${u.id}`,
    label: u.nom,
    suffix: `${u.email} · ${etiquettesUtilisateur(u).map((e) => e.libelle).join(', ')}`,
    icon: 'i-ph-user',
    to: `/admin/utilisateurs/${encodeURIComponent(u.id)}`,
  }))
  const vitrines: CommandPaletteItem[] = resultats.value.vitrines.map((v) => ({
    id: `vitrine-${v.id}`,
    label: v.nom,
    suffix: `/${v.username} · ${valeurOuTiret(v.metier)}`,
    icon: 'i-ph-storefront',
    to: `/admin/vitrines/${encodeURIComponent(v.id)}`,
  }))
  return [
    { id: 'utilisateurs', label: 'Utilisateurs', items: comptes, ignoreFilter: true },
    { id: 'vitrines', label: 'Vitrines', items: vitrines, ignoreFilter: true },
  ].filter((groupe) => groupe.items.length > 0)
})
</script>

<template>
  <UModal v-model:open="ouvert" title="Rechercher" description="Trouvez un compte ou une vitrine par e-mail, téléphone, adresse ou nom.">
    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-ph-magnifying-glass"
      aria-label="Rechercher"
      class="min-h-(--cible-tactile) min-w-(--cible-tactile) justify-center"
    >
      <span class="hidden sm:inline">Rechercher</span>
    </UButton>

    <template #body>
      <UCommandPalette
        v-model:search-term="saisie"
        :groups="groupes"
        :loading="enCours"
        placeholder="E-mail, téléphone, adresse ou nom"
        :maxlength="ADMIN_RECHERCHE_MAX"
        class="h-80"
        :ui="{ input: '[&>input]:h-12' }"
      >
        <template #empty>
          <p v-if="erreur" role="alert" class="m-0 px-4 py-6 text-center text-base text-erreur">
            {{ erreur }}
          </p>
          <p v-else-if="tropCourte || saisie.trim() === ''" class="m-0 px-4 py-6 text-center text-base text-texte-secondaire">
            Saisissez au moins {{ ADMIN_RECHERCHE_MIN }} caractères.
          </p>
          <p v-else-if="enCours" role="status" class="m-0 px-4 py-6 text-center text-base text-texte-secondaire">
            Recherche en cours…
          </p>
          <p v-else-if="sansResultat" role="status" class="m-0 px-4 py-6 text-center text-base text-texte-secondaire">
            Aucun résultat.
          </p>
        </template>
      </UCommandPalette>
    </template>
  </UModal>
</template>
