---
managed-by: claude-system-v5
name: vue3
description: Utiliser quand tu implémentes des composants Vue 3, composables, stores Pinia, pages Nuxt/Vue Router — logique ET implémentation du design (transitions, suspense, accessibilité).
---

# Vue 3 + TypeScript + Pinia

> **Design** : les règles universelles (hiérarchie, états, WCAG, anti-patterns IA) sont dans
> `~/.claude/skills/ui-ux/SKILL.md` — lis-le d'abord. Ci-dessous, leur IMPLÉMENTATION en Vue.

## Composition API
- `<script setup lang="ts">` obligatoire · `defineProps<{}>()` en generics (pas runtime)
- Jamais d'Options API dans le nouveau code

## Réactivité
- `ref()` primitives, `reactive()` objets · `computed()` pour tout state dérivé
- `watch(..., { immediate: true })` si besoin de la valeur au montage · cleanup dans `onUnmounted`

## Composables & Pinia
- 1 composable/responsabilité, retourne des refs · `use[Nom]` camelCase
- 1 store/domaine · actions async try/catch · pas de mutation hors actions · `storeToRefs()` pour destructurer

## Templates
- Pas de logique complexe (→ computed) · `v-for` avec `:key` stable (jamais l'index)
- `v-if` et `v-for` jamais sur le même élément (→ `<template>`)

## DESIGN EN VUE (implémentation des règles ui-ux)
### États obligatoires (loading / error / empty)
```vue
<script setup lang="ts">
const { data, status, error, refresh } = await useAsyncData('users', () => $api.users.list())
</script>
<template>
  <SkeletonList v-if="status === 'pending'" />
  <ErrorState v-else-if="error" :message="error.message" @retry="refresh" />
  <EmptyState v-else-if="!data?.length" cta="Ajouter" @action="..." />
  <ul v-else> <li v-for="u in data" :key="u.id">{{ u.name }}</li> </ul>
</template>
```
### Transitions (respectent prefers-reduced-motion)
```vue
<Transition name="fade"><Panel v-if="open" /></Transition>
<style>
.fade-enter-active,.fade-leave-active{transition:opacity .2s ease}
.fade-enter-from,.fade-leave-to{opacity:0}
@media (prefers-reduced-motion: reduce){.fade-enter-active,.fade-leave-active{transition:none}}
</style>
```
Pour des listes : `<TransitionGroup>`. Anime opacity/transform, jamais height/top.

### Modal accessible (Teleport + focus trap + Esc)
- `<Teleport to="body">`, `role="dialog"` `aria-modal="true"`, focus piégé dans la modal,
  fermeture sur `Esc` et clic overlay, restaure le focus au déclencheur à la fermeture.

### Tokens & classes conditionnelles
- Couleurs/espacement via variables CSS / classes Tailwind du thème — jamais de hex en dur.
- Classes conditionnelles lisibles (`:class="{ 'is-active': active }"`), pas de ternaires imbriqués.

### Accessibilité
- `<button>` pour une action, `<a>` pour naviguer (jamais un `div` cliquable).
- Labels réels liés aux champs · `:aria-invalid` + message sous le champ en erreur · focus visible.

## Anti-patterns interdits
Options API · mutation directe du store · logique dans le template · `v-for` sans/`:key`=index ·
`any` · couleurs en dur · div cliquable · + anti-patterns UI de ui-ux §7

## Pattern store Pinia
```ts
export const useUserStore = defineStore('user', () => {
  const user = ref<User | null>(null); const isLoading = ref(false)
  async function fetchUser(id: string) {
    isLoading.value = true
    try { user.value = await api.users.get(id) }
    catch (e) { console.error('fetchUser', e); throw e }
    finally { isLoading.value = false }
  }
  return { user: readonly(user), isLoading: readonly(isLoading), fetchUser }
})
```
