<script setup lang="ts">
import { ADMIN_MOTIF_MAX } from '#shared/admin'
import { MESSAGE_MOTIF, motifValide } from '~/utils/admin-paiements'

// Formulaire à motif obligatoire (le motif est journalisé côté serveur). Monté à la demande : son état repart de zéro.
const props = defineProps<{
  libelleAction: string
  enCours: boolean
  erreur: string
}>()
const emit = defineEmits<{ confirmer: [motif: string], annuler: [] }>()

const motif = ref('')
const tente = ref(false)

const erreurMotif = computed(() => (tente.value && !motifValide(motif.value) ? MESSAGE_MOTIF : ''))

function soumettre(): void {
  tente.value = true
  if (props.enCours || !motifValide(motif.value)) return
  emit('confirmer', motif.value)
}
</script>

<template>
  <form class="flex flex-col gap-4" novalidate @submit.prevent="soumettre">
    <UFormField label="Motif" name="motif" :error="erreurMotif" required>
      <UTextarea v-model="motif" :rows="3" :maxlength="ADMIN_MOTIF_MAX" :disabled="enCours" autofocus class="w-full" />
    </UFormField>
    <UAlert v-if="erreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="erreur" />
    <div class="flex flex-wrap justify-end gap-3">
      <UButton color="neutral" variant="outline" size="lg" class="min-h-(--cible-tactile)" :disabled="enCours" @click="emit('annuler')">
        Annuler
      </UButton>
      <UButton type="submit" size="lg" class="min-h-(--cible-tactile)" :loading="enCours">
        {{ libelleAction }}
      </UButton>
    </div>
  </form>
</template>
