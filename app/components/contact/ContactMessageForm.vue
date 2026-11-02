<script setup lang="ts">
import type { SujetMessage } from '#shared/message'
import { SUJETS_MESSAGE, SUJET_LIBELLES } from '#shared/message'
import { usePublicMessage } from '~/composables/usePublicMessage'

const props = defineProps<{
  username: string
  professionnel: string
}>()

const honeypotId = `${useId()}-site-web`
const { form, erreurs, erreurGenerale, envoyee, envoi, limites, viderErreur, soumettre } = usePublicMessage({
  username: props.username,
})

const optionsSujet = SUJETS_MESSAGE.map(sujet => ({
  label: SUJET_LIBELLES[sujet],
  value: sujet,
}))
const sujetActif = computed<SujetMessage>({
  get: () => form.sujet,
  set: (valeur: SujetMessage) => {
    form.sujet = valeur
    viderErreur('sujet')
  },
})

const regionStatut = useTemplateRef<HTMLElement>('regionStatut')

watch(envoyee, async (valeur) => {
  if (!valeur) return
  await nextTick()
  regionStatut.value?.focus()
  regionStatut.value?.scrollIntoView({ block: 'center' })
})
</script>

<template>
  <section aria-labelledby="message-titre" class="rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8">
    <div ref="regionStatut" role="status" aria-live="polite" tabindex="-1" class="outline-none">
      <p v-if="envoyee" class="m-0 mb-6 flex flex-col items-start gap-3">
        <span class="flex size-12 items-center justify-center rounded-full bg-accent-doux text-accent-texte">
          <UIcon name="i-ph-check" class="size-6" aria-hidden="true" />
        </span>
        <span class="text-base font-semibold text-encre">
          Votre message est envoyé. {{ professionnel }} vous répond dès que possible.
        </span>
      </p>
    </div>

    <form class="flex flex-col gap-5" novalidate :aria-busy="envoi" @submit.prevent="soumettre">
      <h2 id="message-titre" class="m-0 text-(length:--fs-24) leading-tight font-bold">
        Écrivez-moi
      </h2>

      <UFormField label="Nom complet" name="nom" required :error="erreurs.nom">
        <UInput
          v-model="form.nom"
          required
          autocomplete="name"
          :maxlength="limites.nom"
          :readonly="envoi"
          placeholder="Marie Ndzi"
          @update:model-value="viderErreur('nom')"
        />
      </UFormField>

      <UFormField label="Email" name="email" required :error="erreurs.email">
        <UInput
          v-model="form.email"
          required
          type="email"
          inputmode="email"
          autocomplete="email"
          :maxlength="limites.email"
          :readonly="envoi"
          placeholder="adresse@exemple.com"
          @update:model-value="viderErreur('email')"
        />
      </UFormField>

      <UFormField label="Téléphone (facultatif)" name="telephone" :error="erreurs.telephone">
        <UInput
          v-model="form.telephone"
          type="tel"
          inputmode="tel"
          autocomplete="tel"
          :maxlength="limites.telephone"
          :readonly="envoi"
          placeholder="+237 6 99 00 00 01"
          @update:model-value="viderErreur('telephone')"
        />
      </UFormField>

      <UFormField label="Sujet" name="sujet" :error="erreurs.sujet">
        <USelect
          v-model="sujetActif"
          :items="optionsSujet"
          :disabled="envoi"
          class="w-full"
        />
      </UFormField>

      <UFormField label="Message" name="message" required :error="erreurs.message" help="Quelques lignes suffisent.">
        <UTextarea
          v-model="form.message"
          required
          :rows="5"
          :maxlength="limites.message"
          :readonly="envoi"
          class="w-full"
          @update:model-value="viderErreur('message')"
        />
      </UFormField>

      <div class="sr-only" inert>
        <label :for="honeypotId">Site web</label>
        <input :id="honeypotId" v-model="form.siteWeb" name="siteWeb" type="text" autocomplete="off" tabindex="-1">
      </div>

      <p v-if="erreurGenerale" class="message-erreur" role="alert">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurGenerale }}</span>
      </p>

      <UButton type="submit" label="Envoyer mon message" :loading="envoi" block size="lg" class="min-h-(--cible-tactile)" />

      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
        En envoyant, vous acceptez que vos informations soient transmises à {{ professionnel }} pour répondre à votre message.
      </p>
    </form>
  </section>
</template>
