<script setup lang="ts">
const props = defineProps<{
  actif: string
}>()

const { actif } = props

const entrees = [
  { to: '/studio', label: 'Vitrine', icon: '🏠' },
  { to: '/studio/services', label: 'Services', icon: '💼' },
  { to: '/studio/realisations', label: 'Réalisations', icon: '📸' },
  { to: '/studio/liens', label: 'Liens', icon: '🔗' },
  { to: '/studio/agenda', label: 'Agenda', icon: '📅' },
]
</script>

<template>
  <nav class="top-nav">
    <div class="top-nav__gauche">
      <NuxtLink to="/studio" class="logo">Brandself</NuxtLink>
    </div>
    <div class="top-nav__droite">
      <NuxtLink
        v-for="entree in entrees"
        :key="entree.to"
        :to="entree.to"
        :class="[
          'top-nav__entree',
          { 'top-nav__entree--actif': actif === entree.to.split('/').pop() || actif === entree.to }
        ]"
        aria-label="entree.label"
      >
        {{ entree.label }}
      </NuxtLink>
      <button class="top-nav__avatar">👤</button>
    </div>
  </nav>
</template>

<style scoped>
.top-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 4rem;
  padding: 0 1.5rem;
  background-color: var(--surface);
  border-bottom: 1px solid var(--bordure);
  position: sticky;
  top: 0;
  z-index: 10;
}
.top-nav__gauche {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.logo {
  font-family: var(--font-titre);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--encre);
  text-decoration: none;
}
.top-nav__droite {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}
.top-nav__entree {
  font-size: 0.95rem;
  color: var(--texte-secondaire);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}
.top-nav__entree:hover {
  color: var(--accent);
}
.top-nav__entree--actif {
  color: var(--accent);
}
.top-nav__avatar {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 50%;
  border: 1px solid var(--bordure);
  background-color: var(--surface);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.25rem;
  cursor: pointer;
}
</style>
