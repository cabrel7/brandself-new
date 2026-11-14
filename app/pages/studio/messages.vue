<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Messages' })

const {
  messages,
  nonLus,
  idSelectionne,
  voisins,
  ouvrir,
  fermer,
  precedent,
  suivant,
  erreurMarquageLu,
  enChargement,
  enErreur,
  absente,
  rafraichir,
} = useStudioMessages()

// PC (xl, 1280 px) : volet de lecture à côté de la liste ; en dessous : feuille. Page `ssr: false`.
const estPc = useMediaQuery('(min-width: 1280px)')

const liste = useTemplateRef<HTMLElement>('liste')

// Dernier message lu : la feuille garde son contenu pendant l'animation de fermeture,
// et le focus revient sur sa ligne.
const idCourant = ref<string | null>(null)
watch(idSelectionne, (id) => {
  if (id !== null) idCourant.value = id
})
const messageCourant = computed(() => messages.value.find((message) => message.id === idCourant.value) ?? null)

const feuilleOuverte = computed({
  get: () => !estPc.value && idSelectionne.value !== null && messageCourant.value !== null,
  set: (ouverte: boolean) => {
    if (!ouverte) fermer()
  },
})

// Sur PC un message est toujours sélectionné ; en repassant sous 1280 px, aucune feuille ne s'ouvre seule.
watch([estPc, messages], () => {
  if (!estPc.value) {
    if (idSelectionne.value !== null) fermer()
    return
  }
  const present = idSelectionne.value !== null && messages.value.some((message) => message.id === idSelectionne.value)
  if (!present) {
    const id = premierASelectionner(messages.value)
    if (id !== null) ouvrir(id)
  }
}, { immediate: true })

function retournerALaLigne(): void {
  if (idCourant.value === null) return
  liste.value?.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(idCourant.value)}"]`)?.focus()
}

function plurielNonLus(nombre: number): string {
  return nombre > 1 ? 'non lus' : 'non lu'
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <StudioRetour to="/studio" label="Vitrine" />

    <div v-if="enChargement" role="status" aria-label="Chargement de vos messages">
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton class="h-10 w-48" />
        <USkeleton class="h-5 w-24" />
      </div>
      <div class="mt-6 flex flex-col gap-4" aria-hidden="true">
        <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Vos messages ne s’affichent pas"
      description="Nous n’avons pas pu charger vos messages."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: rafraichir }]"
    />

    <template v-else>
      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
          Messages
        </h1>
        <p v-if="messages.length > 0" class="m-0 mt-1 text-base text-texte-secondaire" aria-live="polite">
          {{ nonLus > 0 ? `${nonLus} ${plurielNonLus(nonLus)}` : 'Tout est lu' }}
        </p>
      </header>

      <UEmpty
        v-if="messages.length === 0"
        icon="i-ph-chat-circle-dots"
        title="Aucun message pour l’instant"
        description="Les nouveaux messages apparaîtront ici."
        class="rounded-(--rayon) border border-bordure bg-surface"
      />

      <div v-else class="xl:grid xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)] xl:items-start xl:gap-8">
        <ul ref="liste" class="m-0 list-none border-t border-bordure p-0">
          <li v-for="message in messages" :key="message.id" class="border-b border-bordure">
            <button
              type="button"
              :data-message-id="message.id"
              class="relative flex min-h-14 w-full items-start gap-4 px-2 py-3 text-left transition-colors hover:bg-surface"
              :class="{ 'bg-surface before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-accent': estPc && idSelectionne === message.id }"
              :aria-haspopup="estPc ? undefined : 'dialog'"
              :aria-current="estPc && idSelectionne === message.id ? 'true' : undefined"
              @click="ouvrir(message.id)"
            >
              <span
                class="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-doux font-(family-name:--font-titre) text-(length:--fs-20) font-semibold text-accent-texte"
                aria-hidden="true"
              >
                {{ message.initiale }}
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center justify-between gap-3">
                  <span class="truncate text-encre" :class="message.luLe === null ? 'font-bold' : 'font-medium'">
                    <span v-if="message.luLe === null" class="sr-only">Non lu, </span>{{ message.nom }}
                  </span>
                  <span class="flex shrink-0 items-center gap-2 text-(length:--fs-14) text-texte-secondaire">
                    {{ message.dateRelative }}
                    <span
                      v-if="message.luLe === null"
                      class="size-2 rounded-full bg-accent"
                      aria-hidden="true"
                    />
                  </span>
                </span>
                <span class="mt-1 line-clamp-2 text-base wrap-break-word text-texte-secondaire">{{ message.message }}</span>
              </span>
            </button>
          </li>
        </ul>

        <section
          v-if="estPc"
          aria-label="Lecture du message"
          class="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-(--rayon) border border-bordure bg-surface p-6"
        >
          <StudioMessageLecture
            v-if="messageCourant && idSelectionne !== null"
            :message="messageCourant"
            :voisins="voisins"
            :erreur="erreurMarquageLu?.texte ?? null"
            avec-entete
            @precedent="precedent"
            @suivant="suivant"
          />
        </section>
      </div>

      <StudioFeuilleMessage
        v-if="!estPc && messageCourant"
        v-model:open="feuilleOuverte"
        :message="messageCourant"
        :voisins="voisins"
        :erreur="erreurMarquageLu?.texte ?? null"
        @precedent="precedent"
        @suivant="suivant"
        @fermer="fermer"
        @fermee="retournerALaLigne"
      />
    </template>
  </div>
</template>
