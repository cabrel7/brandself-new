<script setup lang="ts">
interface ActionLienBio {
  cle: string
  /** Texte visible sous l’icône. */
  libelle: string
  /** Nom accessible quand il est plus explicite que le texte visible (il le contient toujours). */
  nomAccessible?: string
  href: string
  icone: string
  externe: boolean
}

const props = defineProps<{ actions: ActionLienBio[] }>()

// Classes écrites en entier : Tailwind ne génère pas de classe construite dynamiquement.
const COLONNES: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }

// Un lien qui s'ouvre dans un nouvel onglet l'annonce aux lecteurs d'écran ; le nom visible reste contenu dans le nom accessible.
function nomAccessible(action: ActionLienBio): string {
  const nom = action.nomAccessible ?? action.libelle
  return action.externe ? `${nom} (nouvel onglet)` : nom
}

const colonnes = computed(() => COLONNES[props.actions.length] ?? COLONNES[4])
</script>

<template>
  <nav v-if="actions.length > 0" aria-label="Actions rapides">
    <ul class="m-0 grid list-none overflow-hidden rounded-(--rayon-carte) border border-bordure bg-surface p-0" :class="colonnes">
      <li v-for="action in actions" :key="action.cle" class="border-l border-bordure first:border-l-0">
        <NuxtLink
          :to="action.href"
          :target="action.externe ? '_blank' : undefined"
          :rel="action.externe ? 'noopener nofollow' : undefined"
          :aria-label="nomAccessible(action)"
          class="flex items-center justify-center gap-1 px-2 py-3 text-(length:--fs-14) font-medium text-encre no-underline transition-colors hover:bg-accent-doux focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-accent"
          :class="actions.length === 1 ? 'min-h-(--cible-tactile) flex-row gap-3' : 'min-h-20 flex-col'"
        >
          <UIcon :name="action.icone" class="size-6 text-accent-texte" aria-hidden="true" />
          <span class="text-center break-words">{{ action.libelle }}</span>
        </NuxtLink>
      </li>
    </ul>
  </nav>
</template>
