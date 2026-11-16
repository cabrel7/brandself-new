<script setup lang="ts">
// États d'une donnée serveur affichée en liste : chargement (squelette après 200 ms), erreur avec « Réessayer »,
// vide (message distinct de l'erreur), puis le contenu.
withDefaults(
  defineProps<{
    chargement: boolean
    erreur: boolean
    vide: boolean
    titreVide: string
    descriptionVide?: string
    messageErreur: string
    icone?: string
  }>(),
  { descriptionVide: undefined, icone: 'i-ph-magnifying-glass' },
)
defineEmits<{ reessayer: [] }>()

const { ready: squeletteVisible } = useTimeout(200, { controls: true })
</script>

<template>
  <div v-if="chargement" class="flex flex-col gap-3" aria-busy="true">
    <p class="sr-only" role="status">
      Chargement en cours
    </p>
    <template v-if="squeletteVisible">
      <USkeleton v-for="n in 5" :key="n" class="h-16 w-full" />
    </template>
  </div>

  <div v-else-if="erreur" class="flex flex-col items-start gap-4">
    <UAlert
      role="alert"
      color="error"
      variant="soft"
      icon="i-ph-warning-circle"
      :description="messageErreur"
      class="w-full"
    />
    <UButton
      color="neutral"
      variant="outline"
      size="lg"
      icon="i-ph-arrow-counter-clockwise"
      class="min-h-(--cible-tactile)"
      @click="$emit('reessayer')"
    >
      Réessayer
    </UButton>
  </div>

  <UEmpty v-else-if="vide" :icon="icone" :title="titreVide" :description="descriptionVide">
    <template #actions>
      <slot name="vide-actions" />
    </template>
  </UEmpty>

  <slot v-else />
</template>
