<template>
  <header class="border-b border-bordure">
    <div class="mx-auto flex min-h-20 w-full max-w-6xl items-center justify-between gap-4 px-6">
      <NuxtLink
        to="/"
        class="font-(family-name:--font-titre) text-(length:--fs-24) font-bold text-encre no-underline"
      >
        Brandself
      </NuxtLink>
      <nav aria-label="Accès au compte" class="flex items-center gap-3">
        <UButton label="Se connecter" to="/connexion" variant="outline" size="lg" class="hidden sm:inline-flex" />
        <UButton label="Commencer" to="/connexion" size="lg" />
      </nav>
    </div>
  </header>
</template>
