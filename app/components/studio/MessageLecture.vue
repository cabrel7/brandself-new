<script setup lang="ts">
import type { SujetMessage } from '#shared/message'
import { SUJET_LIBELLES } from '#shared/message'
import type { MessageStudioVue, VoisinsMessage } from '~/composables/useStudioMessages'

/**
 * Lecture d'un message : partagée par la feuille (mobile, tablette) et le volet (PC).
 * Présentationnel : navigation et marquage « lu » viennent du composable.
 */
const props = defineProps<{
  message: MessageStudioVue
  voisins: VoisinsMessage
  /** Alerte de marquage « lu » : affichée ici, la page étant derrière la feuille. */
  erreur: string | null
  /** Volet PC : affiche le nom, la date et le sujet (la feuille les porte dans son en-tête). */
  avecEntete?: boolean
}>()

defineEmits<{ precedent: [], suivant: [] }>()

const sujet = computed(() => (Object.hasOwn(SUJET_LIBELLES, props.message.sujet)
  ? SUJET_LIBELLES[props.message.sujet as SujetMessage]
  : props.message.sujet))

// L'email du visiteur est encodé : un « ? » ou un « & » valide dans une adresse ne doit pas
// ajouter de paramètres (cc, bcc, body) au lien mailto.
const lienMail = computed(() => `mailto:${encodeURIComponent(props.message.email)}`)
const lienTel = computed(() => (props.message.telephone ? `tel:${props.message.telephone}` : null))

const annoncePosition = computed(() => `${props.voisins.position} sur ${props.voisins.total}`)
</script>

<template>
  <div class="flex flex-col gap-5">
    <header v-if="avecEntete" class="flex flex-col gap-1">
      <h2 class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre">
        {{ message.nom }}
      </h2>
      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
        {{ message.dateComplete }}
      </p>
      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
        Sujet : <span class="font-semibold text-encre">{{ sujet }}</span>
      </p>
    </header>
    <p v-else class="m-0 text-(length:--fs-14) text-texte-secondaire">
      Sujet : <span class="font-semibold text-encre">{{ sujet }}</span>
    </p>

    <UAlert
      v-if="erreur"
      role="alert"
      aria-live="assertive"
      color="error"
      variant="soft"
      icon="i-ph-warning-circle"
      :description="erreur"
    />

    <div class="flex flex-col gap-3 sm:flex-row">
      <UButton
        :to="lienMail"
        icon="i-ph-envelope-simple"
        size="xl"
        class="min-h-(--cible-tactile) justify-center"
        :aria-label="`Répondre par e-mail à ${message.nom} (${message.email})`"
      >
        Répondre par e-mail
      </UButton>
      <UButton
        v-if="lienTel"
        :to="lienTel"
        icon="i-ph-phone"
        size="xl"
        color="neutral"
        variant="outline"
        class="min-h-(--cible-tactile) justify-center"
        :aria-label="`Appeler ${message.nom} (${message.telephone})`"
      >
        Appeler
      </UButton>
    </div>

    <div
      role="region"
      tabindex="0"
      aria-label="Texte du message"
      class="max-h-[45dvh] overflow-y-auto rounded-(--rayon-interne) border border-bordure bg-surface p-4"
    >
      <p class="m-0 text-base break-words whitespace-pre-line text-encre">{{ message.message }}</p>
    </div>

    <nav aria-label="Autres messages" class="flex items-center justify-between gap-3">
      <UButton
        icon="i-ph-caret-left"
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-(--cible-tactile)"
        :disabled="voisins.precedent === null"
        @click="$emit('precedent')"
      >
        Précédent
      </UButton>
      <p class="m-0 text-(length:--fs-14) text-texte-secondaire" aria-live="polite">
        {{ annoncePosition }}
      </p>
      <UButton
        trailing-icon="i-ph-caret-right"
        color="neutral"
        variant="outline"
        size="lg"
        class="min-h-(--cible-tactile)"
        :disabled="voisins.suivant === null"
        @click="$emit('suivant')"
      >
        Suivant
      </UButton>
    </nav>
  </div>
</template>
