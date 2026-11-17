<script setup lang="ts">
import { PROMPT_GABARIT_LONGUEUR_MAX, PROMPT_MAX_TOKENS_MAX, PROMPT_MAX_TOKENS_MIN, PROMPT_SYSTEME_LONGUEUR_MAX, PROMPT_TEMPERATURE_MAX, PROMPT_TEMPERATURE_MIN, IA_ESSAI_PROMPT_LIMIT } from '#shared/ia'
import type { EssaiPromptDto } from '#shared/schemas/admin-versions'
import { LIBELLES_ERREUR_ESSAI, valeursPromptDepuis, variablesDuGabarit } from '~/utils/admin-versions'
import type { FormPrompt } from '~/utils/admin-versions'

// Édition d'un prompt : systeme, gabarit et réglages (avec leurs bornes). Le format de sortie et les variables sont en
// lecture seule : le code les impose, le serveur recalcule les variables depuis le gabarit et refuse toute variable
// inconnue. L'essai à blanc envoie le contenu du prompt, jamais une donnée d'utilisateur (entrées synthétiques fixées
// côté serveur) et ne conserve rien. Une version enregistrée n'est jamais modifiée : on en crée une nouvelle.
const props = defineProps<{
  cle: string
  /** Format de sortie imposé par le code (version de départ), en lecture seule. */
  schemaSortie: string
  erreurs: Record<string, string>
  desactive: boolean
}>()
const form = defineModel<FormPrompt>('form', { required: true })

const { essaiPrompt } = useAdminVersionsEcritures()
const essaiEnCours = ref(false)
const essaiErreur = ref('')
// shallowRef : la sortie d'essai est un JSON récursif (z.json()) ; `ref` en déroulerait le type à l'infini (TS2589).
const essai = shallowRef<EssaiPromptDto | null>(null)

const variables = computed(() => variablesDuGabarit(form.value.gabarit))
const sortieTexte = computed(() => (essai.value?.sortie == null ? '' : JSON.stringify(essai.value.sortie, null, 2)))
const essaisRestants = computed(() => essai.value?.essaisRestants ?? null)
const messageEchecEssai = computed(() => (essai.value?.erreurCode ? (LIBELLES_ERREUR_ESSAI[essai.value.erreurCode] ?? 'L’essai n’a pas abouti.') : ''))
const essaiPossible = computed(() => !essaiEnCours.value && !props.desactive && Object.keys(props.erreurs).length === 0 && essaisRestants.value !== 0)

async function lancerEssai(): Promise<void> {
  if (!essaiPossible.value) return
  essaiEnCours.value = true
  essaiErreur.value = ''
  const resultat = await essaiPrompt(props.cle, valeursPromptDepuis(form.value))
  essaiEnCours.value = false
  if (!resultat.ok) {
    essaiErreur.value = resultat.message
    return
  }
  essai.value = resultat.donnees
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <UFormField label="Consigne générale" name="systeme" required :error="erreurs.systeme" :help="`Au plus ${PROMPT_SYSTEME_LONGUEUR_MAX} caractères.`">
      <UTextarea v-model="form.systeme" :rows="6" :maxlength="PROMPT_SYSTEME_LONGUEUR_MAX" autoresize class="w-full" :disabled="desactive" />
    </UFormField>

    <UFormField label="Gabarit" name="gabarit" required :error="erreurs.gabarit" :help="`Au plus ${PROMPT_GABARIT_LONGUEUR_MAX} caractères. Les variables s’écrivent {{nom}}.`">
      <UTextarea v-model="form.gabarit" :rows="8" :maxlength="PROMPT_GABARIT_LONGUEUR_MAX" autoresize class="w-full" :disabled="desactive" />
    </UFormField>

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <UFormField label="Température" name="temperature" required :error="erreurs.temperature" :help="`De ${PROMPT_TEMPERATURE_MIN} à ${PROMPT_TEMPERATURE_MAX}.`">
        <UInputNumber v-model="form.temperature" :min="PROMPT_TEMPERATURE_MIN" :max="PROMPT_TEMPERATURE_MAX" :step="0.1" size="lg" class="w-full" :disabled="desactive" />
      </UFormField>
      <UFormField label="Longueur maximale" name="maxTokens" required :error="erreurs.maxTokens" :help="`De ${PROMPT_MAX_TOKENS_MIN} à ${PROMPT_MAX_TOKENS_MAX}.`">
        <UInputNumber v-model="form.maxTokens" :min="PROMPT_MAX_TOKENS_MIN" :max="PROMPT_MAX_TOKENS_MAX" :step="100" size="lg" class="w-full" :disabled="desactive" />
      </UFormField>
    </div>

    <dl class="m-0 flex flex-col gap-2">
      <div class="flex flex-col gap-0.5">
        <dt class="text-(length:--fs-14) text-texte-secondaire">Variables du gabarit (calculées par le serveur)</dt>
        <dd class="m-0 text-encre">{{ variables.length > 0 ? variables.join(', ') : 'Aucune' }}</dd>
      </div>
      <div class="flex flex-col gap-0.5">
        <dt class="text-(length:--fs-14) text-texte-secondaire">Format de sortie (imposé par le code)</dt>
        <dd class="m-0 text-encre">{{ schemaSortie }}</dd>
      </div>
    </dl>

    <section aria-labelledby="titre-essai" class="flex flex-col gap-3 border-t border-bordure pt-5" :aria-busy="essaiEnCours">
      <h3 id="titre-essai" class="m-0 font-(family-name:--font-titre) text-(length:--fs-20) font-bold">Essai à blanc</h3>
      <p class="m-0 text-base text-texte-secondaire">
        Le prompt est essayé sur des exemples fictifs, sans donnée d’utilisateur. Rien n’est enregistré.
        {{ essaisRestants === null ? `${IA_ESSAI_PROMPT_LIMIT.limit} essais par heure.` : `Essais restants cette heure : ${essaisRestants}.` }}
      </p>
      <UButton
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-ph-flask"
        class="min-h-(--cible-tactile) self-start"
        :loading="essaiEnCours"
        :disabled="!essaiPossible"
        @click="lancerEssai"
      >
        Lancer un essai
      </UButton>

      <UAlert v-if="essaiErreur" role="alert" color="error" variant="soft" icon="i-ph-warning-circle" :description="essaiErreur" />
      <div v-else-if="essai" class="flex flex-col gap-2" role="status">
        <p class="m-0 font-medium text-encre">
          {{ essai.valide ? 'La réponse respecte le format attendu.' : (messageEchecEssai || 'La réponse ne respecte pas le format attendu.') }}
          <span v-if="essai.dureeMs !== null" class="font-normal text-texte-secondaire"> · {{ essai.dureeMs }} ms</span>
        </p>
        <pre v-if="sortieTexte" class="m-0 max-h-80 overflow-auto rounded-md border border-bordure p-3 text-(length:--fs-14) whitespace-pre-wrap text-encre">{{ sortieTexte }}</pre>
      </div>
    </section>
  </div>
</template>
