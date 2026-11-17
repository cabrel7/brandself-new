<script setup lang="ts">
import type { PlateformeCle } from '#shared/plateformes'

const props = defineProps<{
  href: string
  libelle: string
  /** Plateforme reconnue : pastille à sa couleur de marque. `null` : pastille neutre. */
  plateforme: PlateformeCle | null
  /** Icône de la pastille neutre (lien sans plateforme reconnue). */
  iconeNeutre?: string
}>()

const emit = defineEmits<{ clic: [] }>()

interface StylePastille {
  icone: string
  classe: string
}

// Classes écrites en entier : Tailwind ne génère pas de classe construite dynamiquement.
const PASTILLES: Record<PlateformeCle, StylePastille> = {
  whatsapp: { icone: 'i-ph-whatsapp-logo', classe: 'bg-(--marque-whatsapp) text-(--sur-marque)' },
  linkedin: { icone: 'i-ph-linkedin-logo', classe: 'bg-(--marque-linkedin) text-(--sur-marque)' },
  instagram: { icone: 'i-ph-instagram-logo', classe: 'bg-(--marque-instagram) text-(--sur-marque)' },
  facebook: { icone: 'i-ph-facebook-logo', classe: 'bg-(--marque-facebook) text-(--sur-marque)' },
  youtube: { icone: 'i-ph-youtube-logo', classe: 'bg-(--marque-youtube) text-(--sur-marque)' },
  tiktok: { icone: 'i-ph-tiktok-logo', classe: 'bg-(--marque-tiktok) text-(--sur-marque)' },
  x: { icone: 'i-ph-x-logo', classe: 'bg-(--marque-x) text-(--sur-marque)' },
  telegram: { icone: 'i-ph-telegram-logo', classe: 'bg-(--marque-telegram) text-(--sur-marque)' },
  email: { icone: 'i-ph-envelope-simple', classe: 'bg-accent text-sur-accent' },
  telephone: { icone: 'i-ph-phone', classe: 'bg-accent text-sur-accent' },
}

const PASTILLE_NEUTRE = 'bg-accent-doux text-encre'
const ICONE_NEUTRE_DEFAUT = 'i-ph-globe'

const pastille = computed<StylePastille>(() =>
  props.plateforme
    ? PASTILLES[props.plateforme]
    : { icone: props.iconeNeutre ?? ICONE_NEUTRE_DEFAUT, classe: PASTILLE_NEUTRE },
)

const interne = computed(() => props.href.startsWith('/'))
</script>

<template>
  <NuxtLink
    :to="href"
    :target="interne ? undefined : '_blank'"
    :rel="interne ? undefined : 'noopener nofollow'"
    class="flex min-h-14 w-full items-center gap-3 rounded-(--rayon) border border-bordure bg-surface py-2 pr-4 pl-2 text-base font-semibold text-encre no-underline transition-colors hover:bg-accent-doux focus-visible:outline-3 focus-visible:outline-accent"
    @click="emit('clic')"
    @auxclick="emit('clic')"
  >
    <span
      class="flex size-10 shrink-0 items-center justify-center rounded-(--rayon-interne)"
      :class="pastille.classe"
      aria-hidden="true"
    >
      <UIcon :name="pastille.icone" class="size-5" />
    </span>
    <span class="min-w-0 flex-1 truncate wrap-break-word">{{ libelle }}</span>
    <UIcon name="i-ph-caret-right" class="size-5 shrink-0 text-texte-secondaire" aria-hidden="true" />
  </NuxtLink>
</template>
