<script setup lang="ts">
const props = defineProps<{
  actif: string
}>()

const { actif } = props

const entrees = [
  { to: '/studio', label: 'Vitrine', icon: 'home' },
  { to: '/studio/services', label: 'Services', icon: 'briefcase' },
  { to: '/studio/realisations', label: 'Réalisations', icon: 'image' },
  { to: '/studio/liens', label: 'Liens', icon: 'link' },
  { to: '/studio/agenda', label: 'Agenda', icon: 'calendar' },
]
</script>

<template>
  <nav class="bottom-nav">
    <NuxtLink
      v-for="entree in entrees"
      :key="entree.to"
      :to="entree.to"
      :class="[
        'bottom-nav__entree',
        { 'bottom-nav__entree--actif': actif === entree.to.split('/').pop() || actif === entree.to }
      ]"
      aria-label="entree.label"
    >
      <PhosphorIcon :icon="entree.icon" weight="fill" size="1.5rem" />
      <span class="bottom-nav__label">{{ entree.label }}</span>
    </NuxtLink>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: flex;
  justify-content: space-around;
  align-items: center;
  height: 4rem;
  padding: 0 1rem;
  background-color: var(--surface);
  border-top: 1px solid var(--bordure);
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
}
.bottom-nav__entree {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.7rem;
  color: var(--texte-secondaire);
  text-decoration: none;
  font-weight: 500;
  transition: color 0.2s;
}
.bottom-nav__entree:hover {
  color: var(--accent);
}
.bottom-nav__entree--actif {
  color: var(--accent);
}
.bottom-nav__label {
  line-height: 1;
}
</style>
