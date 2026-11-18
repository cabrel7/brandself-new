<script setup lang="ts">
import type { PlateformeCle } from '#shared/plateformes'

interface LienReseau {
  slug: string
  libelle: string
  url: string
  plateforme: PlateformeCle
}

interface LienListe {
  /** Absent pour le lien natif « Mes services » : aucun clic compté. */
  slug: string | null
  libelle: string
  url: string
  /** Icône Phosphor ; à défaut, l'icône neutre (page interne ou lien externe). */
  icone: string | null
}

defineProps<{
  /** Liens dont la plateforme est reconnue : icônes rondes sous « Suivez-moi ». */
  reseaux: LienReseau[]
  /** « Mes services » en premier, puis les autres liens du studio (CV, site, page interne) : jamais masqués. */
  autres: LienListe[]
}>()

const emit = defineEmits<{ clic: [slug: string] }>()

// Mêmes icônes que `LienPlateforme.vue` (pastilles de la liste) ; une couleur unique, celle de la palette.
const ICONES: Record<PlateformeCle, string> = {
  whatsapp: 'i-ph-whatsapp-logo',
  linkedin: 'i-ph-linkedin-logo',
  instagram: 'i-ph-instagram-logo',
  facebook: 'i-ph-facebook-logo',
  youtube: 'i-ph-youtube-logo',
  tiktok: 'i-ph-tiktok-logo',
  x: 'i-ph-x-logo',
  telegram: 'i-ph-telegram-logo',
  email: 'i-ph-envelope-simple',
  telephone: 'i-ph-phone',
}

const URL_WEB = /^https?:/i
const ICONE_PAGE_INTERNE = 'i-ph-storefront'

function estWeb(url: string): boolean {
  return URL_WEB.test(url)
}

function iconeDuLien(lien: LienListe): string | undefined {
  return lien.icone ?? (lien.url.startsWith('/') ? ICONE_PAGE_INTERNE : undefined)
}

function compter(slug: string | null): void {
  if (slug) emit('clic', slug)
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <nav v-if="autres.length > 0" aria-label="Mes liens">
      <ul class="m-0 flex list-none flex-col gap-3 p-0">
        <li v-for="lien in autres" :key="lien.slug ?? lien.url">
          <VitrineLienPlateforme
            :href="lien.url"
            :libelle="lien.libelle"
            :plateforme="null"
            :icone-neutre="iconeDuLien(lien)"
            @clic="compter(lien.slug)"
          />
        </li>
      </ul>
    </nav>

    <section v-if="reseaux.length > 0" aria-labelledby="lien-bio-reseaux" class="flex flex-col gap-4">
      <h2 id="lien-bio-reseaux" class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold text-encre">
        Suivez-moi
      </h2>

      <ul class="m-0 flex list-none flex-wrap gap-3 p-0">
        <li v-for="lien in reseaux" :key="lien.slug">
          <NuxtLink
            :to="lien.url"
            :target="estWeb(lien.url) ? '_blank' : undefined"
            :rel="estWeb(lien.url) ? 'noopener nofollow' : undefined"
            :aria-label="estWeb(lien.url) ? `${lien.libelle} (nouvel onglet)` : lien.libelle"
            class="flex size-14 items-center justify-center rounded-full border border-bordure bg-accent-doux text-accent-texte transition-colors hover:bg-surface focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
            @click="emit('clic', lien.slug)"
            @auxclick="emit('clic', lien.slug)"
          >
            <UIcon :name="ICONES[lien.plateforme]" class="size-7" aria-hidden="true" />
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
