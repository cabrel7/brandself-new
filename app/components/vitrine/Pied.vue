<script setup lang="ts">
import type { ContenusPublicsDTO, VitrinePubliqueDTO } from '#shared/dto'
import { realisationsHref } from '#shared/realisations'

const props = defineProps<{
  vitrine: VitrinePubliqueDTO
  /** Mêmes contenus que la barre de navigation (déjà chargés par Cadre, aucun nouvel appel). */
  contenus: ContenusPublicsDTO
  /** Pages Agenda et Contact : une simple ligne, sans répéter les coordonnées. */
  compact?: boolean
}>()

// Année figée côté serveur puis reprise telle quelle à l'hydratation : pas d'écart de rendu.
const annee = useState('pied-annee', () => new Date().getFullYear())

// Mêmes liens, mêmes conditions que la barre de navigation (Nav.vue).
const liens = computed(() => {
  const items: { libelle: string, to: string }[] = []
  if (props.contenus.services > 0) items.push({ libelle: 'Services', to: `/${props.vitrine.username}/services` })
  if (props.contenus.realisations > 0) items.push({ libelle: 'Réalisations', to: realisationsHref(props.vitrine.username) })
  if (props.contenus.agenda) items.push({ libelle: 'Agenda', to: `/${props.vitrine.username}/agenda` })
  items.push({ libelle: 'Contact', to: `/${props.vitrine.username}/contact` })
  return items
})

const lieu = computed(() => [props.vitrine.ville, props.vitrine.paysLibelle].filter(Boolean).join(', '))
const whatsappHref = computed(() => {
  const chiffres = props.vitrine.contact.whatsapp?.replace(/\D/g, '')
  return chiffres ? `https://wa.me/${chiffres}` : null
})
const lienClasse = 'inline-flex min-h-(--cible-tactile) items-center text-texte-secondaire underline-offset-4 transition-colors hover:text-accent-texte hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent'
</script>

<template>
  <footer id="contact" class="scroll-mt-24 border-t border-bordure">
    <div
      v-if="compact"
      class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-6 py-4 text-(length:--fs-14) text-texte-secondaire"
    >
      <p class="m-0">{{ vitrine.nomAffiche }} · {{ vitrine.ville }}</p>
      <VitrineBadge v-if="vitrine.badgeBrandself" />
    </div>
    <div v-else class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 pt-8 md:gap-10 md:pt-12">
      <div class="grid gap-8 md:grid-cols-3 md:gap-12">
        <div class="flex flex-col gap-1">
          <p class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold text-encre">{{ vitrine.nomAffiche }}</p>
          <p v-if="vitrine.metier" class="m-0 text-texte-secondaire">{{ vitrine.metier }}</p>
          <p v-if="lieu" class="m-0 text-texte-secondaire">{{ lieu }}</p>
        </div>

        <nav aria-labelledby="pied-navigation" class="flex flex-col">
          <p id="pied-navigation" class="m-0 font-(family-name:--font-titre) text-(length:--fs-16) font-bold">Navigation</p>
          <NuxtLink v-for="lien in liens" :key="lien.to" :to="lien.to" :class="lienClasse">
            {{ lien.libelle }}
          </NuxtLink>
        </nav>

        <div class="flex flex-col">
          <p class="m-0 font-(family-name:--font-titre) text-(length:--fs-16) font-bold">Contact</p>
          <NuxtLink
            :to="`/${vitrine.username}/contact`"
            class="inline-flex min-h-(--cible-tactile) items-center font-semibold text-accent-texte underline-offset-4 hover:underline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Me contacter
          </NuxtLink>
          <a v-if="vitrine.contact.email" :href="`mailto:${vitrine.contact.email}`" :class="lienClasse">
            {{ vitrine.contact.email }}
          </a>
          <a v-if="vitrine.contact.telephone" :href="`tel:${vitrine.contact.telephone}`" :class="lienClasse">
            {{ vitrine.contact.telephone }}
          </a>
          <a
            v-if="whatsappHref"
            :href="whatsappHref"
            target="_blank"
            rel="noopener"
            :class="lienClasse"
          >
            WhatsApp<span class="sr-only"> (nouvel onglet)</span>
          </a>
        </div>
      </div>

      <div class="flex flex-col gap-1 border-t border-bordure py-2 text-(length:--fs-14) text-texte-secondaire sm:flex-row sm:items-center sm:justify-between">
        <p class="m-0">© {{ annee }} {{ vitrine.nomAffiche }}</p>
        <VitrineBadge v-if="vitrine.badgeBrandself" />
      </div>
    </div>
  </footer>
</template>
