<template>
  <!-- Même badge et même lien que partout (`VitrineBadge`), dans le bandeau arrondi de la maquette. -->
  <div class="flex items-center justify-center min-h-16 gap-3 rounded-full bg-accent-doux px-5 py-2">
    <UIcon name="i-ph-shield-check" class="size-7 shrink-0 text-accent-texte" aria-hidden="true" />
    <span class="h-8 w-px bg-accent" aria-hidden="true" />
    <VitrineBadge />
  </div>
</template>
