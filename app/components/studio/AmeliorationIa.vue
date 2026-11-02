<script setup lang="ts">
const props = defineProps<{
  /** Présentation actuellement saisie dans le formulaire. */
  texte: string
  /** Une erreur d'enregistrement du formulaire est affichée : elle prime sur le message de l'IA. */
  messageMasque?: boolean
}>()

const emit = defineEmits<{ utiliser: [texte: string] }>()

const { enCours, proposition, message, demander, fermer } = useAmeliorationIa()

const assezLong = computed(() => texteSuffisant(props.texte))
const aide = computed(() => (assezLong.value ? AIDE_AMELIORATION : AIDE_AMELIORATION_TROP_COURT))
const messageVisible = computed(() => (props.messageMasque ? null : message.value))

const titre = useTemplateRef<HTMLElement>('titre')
const bouton = useTemplateRef<{ $el: HTMLElement }>('bouton')

// Le panneau apparaît sous le bouton : le focus va sur son titre pour qu'il soit annoncé et atteint au clavier.
watch(proposition, async (courante) => {
  if (!courante) return
  await nextTick()
  titre.value?.focus()
})

// Le panneau disparaît : le focus revient au formulaire (champ présentation via la page, ou bouton « Améliorer »).
function utiliser(apres: string): void {
  emit('utiliser', apres)
  fermer()
}

async function garder(): Promise<void> {
  fermer()
  await nextTick()
  bouton.value?.$el.focus()
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p id="aide-amelioration-ia" class="m-0 text-(length:--fs-14) text-texte-secondaire">
      {{ aide }}
    </p>
    <UButton
      ref="bouton"
      type="button"
      variant="outline"
      size="xl"
      block
      icon="i-ph-sparkle"
      :label="enCours ? 'Rédaction en cours…' : 'Améliorer avec l’IA'"
      :loading="enCours"
      :disabled="!assezLong && !enCours"
      aria-describedby="aide-amelioration-ia"
      @click="demander('bio', texte)"
    />

    <p
      v-if="messageVisible"
      :role="messageVisible.type === 'erreur' ? 'alert' : 'status'"
      :class="messageVisible.type === 'erreur' ? 'message-erreur' : 'message-info'"
    >
      <UIcon
        :name="messageVisible.type === 'erreur' ? 'i-ph-warning-circle' : 'i-ph-info'"
        class="size-5 shrink-0"
        aria-hidden="true"
      />
      <span>{{ messageVisible.texte }}</span>
    </p>

    <section v-if="proposition" aria-labelledby="titre-proposition-ia" class="flex flex-col gap-4 pt-2">
      <h2
        id="titre-proposition-ia"
        ref="titre"
        tabindex="-1"
        class="m-0 text-(length:--fs-20) leading-snug font-bold text-encre outline-none"
      >
        Proposition de l’IA
      </h2>

      <div class="flex min-w-0 flex-col gap-1">
        <h3 class="m-0 text-(length:--fs-14) font-bold text-texte-secondaire">
          Votre texte
        </h3>
        <p class="m-0 text-base break-words whitespace-pre-line text-texte-secondaire">
          {{ proposition.avant }}
        </p>
      </div>
      <div class="flex min-w-0 flex-col gap-1 rounded-(--rayon) bg-accent-doux p-4">
        <h3 class="m-0 text-(length:--fs-14) font-bold text-accent-texte">
          Proposition
        </h3>
        <p class="m-0 text-base break-words whitespace-pre-line text-encre">
          {{ proposition.apres }}
        </p>
      </div>

      <div class="flex flex-col gap-2 sm:flex-row">
        <UButton type="button" label="Utiliser ce texte" size="lg" @click="utiliser(proposition.apres)" />
        <UButton type="button" label="Garder le mien" variant="outline" color="neutral" size="lg" @click="garder" />
      </div>
    </section>
  </div>
</template>
