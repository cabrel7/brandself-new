<script setup lang="ts">
import { REALISATION_FAITS_LIBELLES } from '#shared/realisations'

const props = defineProps<{ annee: number | null, lieu: string | null, role: string | null }>()

const faits = computed(() => {
  const lignes: { cle: string, libelle: string, valeur: string }[] = []
  if (props.annee !== null) lignes.push({ cle: 'annee', libelle: REALISATION_FAITS_LIBELLES.annee, valeur: String(props.annee) })
  if (props.lieu) lignes.push({ cle: 'lieu', libelle: REALISATION_FAITS_LIBELLES.lieu, valeur: props.lieu })
  if (props.role) lignes.push({ cle: 'role', libelle: REALISATION_FAITS_LIBELLES.role, valeur: props.role })
  return lignes
})
</script>

<template>
  <dl v-if="faits.length > 0" class="flex flex-col border-t border-bordure">
    <div v-for="fait in faits" :key="fait.cle" class="flex items-baseline justify-between gap-6 border-b border-bordure py-3">
      <dt class="text-texte-secondaire">{{ fait.libelle }}</dt>
      <dd class="text-right font-semibold text-encre">{{ fait.valeur }}</dd>
    </div>
  </dl>
</template>
