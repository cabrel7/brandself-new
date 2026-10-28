<script setup lang="ts">
import type { TemoignagePublicCarteDTO } from '#shared/dto'

const props = defineProps<{ username: string }>()

const { reponse } = await usePublicTemoignages(props.username)
const temoignages = computed<TemoignagePublicCarteDTO[]>(() => reponse.value?.temoignages ?? [])
const ouvert = ref(false)

const aLaUne = computed(() => temoignages.value[0] ?? null)
const autres = computed(() => temoignages.value.slice(1))
</script>

<template>
  <section v-if="aLaUne" class="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-12" aria-label="Témoignages à la une">
    <div class="flex flex-col gap-2">
      <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">Témoignages</p>
      <h2 id="temoignage-a-la-une" class="font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-bold">À la une</h2>
    </div>

    <article class="flex flex-col gap-4 md:flex-row md:gap-8">
      <div class="prose flex-1">
        <blockquote class="citation m-0 font-(family-name:--font-titre) text-(length:--fs-28) leading-snug font-bold text-encre italic">
          « {{ aLaUne.texte }} »
        </blockquote>
        <p class="auteur m-0 font-(family-name:--font-titre) text-(length:--fs-18) font-bold text-encre">
          {{ aLaUne.auteur }}
        </p>
        <p v-if="aLaUne.fonction" class="fonction m-0 text-(length:--fs-14) text-texte-secondaire">
          {{ aLaUne.fonction }}
        </p>
      </div>
    </article>

    <button v-if="autres.length > 0" class="voir-plus min-h-(--cible-tactile) items-center gap-1 self-start font-semibold text-accent-texte hover:underline" @click="ouvert = !ouvert">
      Lire d'autres avis ({{ autres.length }})
      <UIcon :name="ouvert ? 'i-ph-caret-down' : 'i-ph-caret-right'" class="size-4" aria-hidden="true" />
    </button>

    <div v-if="ouvert && autres.length > 0" class="mt-6 grid gap-4">
      <div v-for="t in autres" :key="t.slug" class="p-4 surface rounded-(--rayon-carte) border border-bordure">
        <p class="texte m-0 text-(length:--fs-15) text-encre leading-relaxed italic">
          « {{ t.texte }} »
        </p>
        <p class="auteur mt-2 m-0 font-(family-name:--font-titre) text-(length:--fs-16) font-bold text-encre">
          {{ t.auteur }}
        </p>
        <p v-if="t.fonction" class="fonction m-0 text-(length:--fs-14) text-texte-secondaire">{{ t.fonction }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.citation {
  quotes: '«' '»' '«' '»';
}
</style>
