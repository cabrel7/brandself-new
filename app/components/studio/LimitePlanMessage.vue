<script setup lang="ts">
import { LIMITE_ACTION, LIMITE_MARQUEUR_DATE, LIMITE_MESSAGES, interpolerLimite } from '#shared/plans'
import type { RessourceQuota } from '#shared/plans'

const props = defineProps<{
  ressource: RessourceQuota
  /** Limite du plan ; `null` si le serveur ne l'a pas précisée (message de repli). */
  limite: number | null
  /** « 1 décembre 2026 » : fin du quota mensuel, pour les réservations. */
  date?: string
  /** Réponse à une action qui vient d'échouer : annoncée tout de suite. */
  alerte?: boolean
}>()

const MESSAGE_DE_REPLI = 'Vous avez atteint la limite du plan gratuit.'

const message = computed(() => LIMITE_MESSAGES[props.ressource])
const texte = computed(() => {
  const modele = message.value.texte
  if (props.limite === null || (modele.includes(LIMITE_MARQUEUR_DATE) && !props.date)) return MESSAGE_DE_REPLI
  return interpolerLimite(modele, { limite: props.limite, date: props.date })
})
</script>

<template>
  <div
    :role="alerte ? 'alert' : 'status'"
    class="flex flex-col items-start gap-3 rounded-(--rayon) border border-bordure bg-accent-doux p-4"
  >
    <p class="m-0 flex items-start gap-2 text-base font-semibold text-encre">
      <UIcon name="i-ph-info" class="mt-0.5 size-5 shrink-0 text-accent-texte" aria-hidden="true" />
      <span>{{ message.titre }}</span>
    </p>
    <p class="m-0 text-base text-encre">
      {{ texte }}
    </p>
    <UButton :label="LIMITE_ACTION.libelle" :to="LIMITE_ACTION.chemin" size="lg" class="min-h-(--cible-tactile)" />
  </div>
</template>
