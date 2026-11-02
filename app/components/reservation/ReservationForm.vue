<script setup lang="ts">
import { CONTACT_EMAIL_MAX, CONTACT_NOM_MAX, MOTIF_MAX } from '#shared/agenda'

const props = defineProps<{
  username: string
  serviceId: string
  debut: string
  professionnel: string
}>()

const emit = defineEmits<{
  creneauPris: []
  creneauExpire: []
}>()

const TELEPHONE_MAX = 24
const reservation = useReservation({ username: props.username, serviceId: props.serviceId, debut: props.debut })
const { form, erreurs, erreurGenerale, etat, envoi, viderErreur } = reservation

async function envoyer(): Promise<void> {
  const resultat = await reservation.soumettre()
  if (resultat === 'envoyee') {
    await navigateTo(`/${props.username}/reserver/confirmation`, { external: true })
  }
  else if (resultat === 'prise') {
    emit('creneauPris')
  }
  else if (resultat === 'expiree') {
    emit('creneauExpire')
  }
}
</script>

<template>
  <form class="flex flex-col gap-8" novalidate @submit.prevent="envoyer">
    <section class="flex flex-col gap-5" aria-labelledby="informations-titre">
      <h2 id="informations-titre" class="text-(length:--fs-24) font-bold md:text-(length:--fs-32)">Vos informations</h2>

      <div class="grid gap-5 md:grid-cols-2">
        <UFormField class="order-1" label="Nom complet" name="nom" required :error="erreurs.nom">
          <UInput
            v-model="form.nom"
            required
            autocomplete="name"
            :maxlength="CONTACT_NOM_MAX"
            :disabled="envoi"
            placeholder="Marie Ndzi"
            @update:model-value="viderErreur('nom')"
          />
        </UFormField>

        <UFormField class="order-3 md:order-2" label="Téléphone ou WhatsApp" name="telephone" required :error="erreurs.telephone">
          <UInput
            v-model="form.telephone"
            required
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            :maxlength="TELEPHONE_MAX"
            :disabled="envoi"
            placeholder="+237 6 99 00 00 01"
            @update:model-value="viderErreur('telephone')"
          />
        </UFormField>

        <UFormField
          class="order-2 md:order-3 md:col-span-2"
          label="Email"
          name="email"
          required
          :error="erreurs.email"
          help="Votre confirmation sera envoyée ici."
        >
          <UInput
            v-model="form.email"
            required
            type="email"
            inputmode="email"
            autocomplete="email"
            :maxlength="CONTACT_EMAIL_MAX"
            :disabled="envoi"
            placeholder="adresse@exemple.com"
            @update:model-value="viderErreur('email')"
          />
        </UFormField>
      </div>

      <UFormField name="motif" :error="erreurs.motif" help="Quelques mots pour préparer votre venue.">
        <template #label>Motif de la consultation <span class="font-normal text-texte-secondaire">(facultatif)</span></template>
        <UTextarea
          v-model="form.motif"
          :rows="5"
          :maxlength="MOTIF_MAX"
          :disabled="envoi"
          class="w-full"
          @update:model-value="viderErreur('motif')"
        />
      </UFormField>

      <div class="sr-only" aria-hidden="true">
        <label for="reservation-site-web">Site web</label>
        <input
          id="reservation-site-web"
          v-model="form.siteWeb"
          name="siteWeb"
          type="text"
          autocomplete="off"
          tabindex="-1"
        >
      </div>
    </section>

    <section class="flex flex-col gap-4" aria-labelledby="reglement-titre">
      <h2 id="reglement-titre" class="text-(length:--fs-24) font-bold md:text-(length:--fs-32)">Comment souhaitez-vous régler ?</h2>
      <div class="flex items-start gap-4 rounded-(--rayon) border border-bordure bg-accent-doux p-5">
        <UIcon name="i-ph-wallet" class="mt-0.5 size-6 shrink-0 text-accent" aria-hidden="true" />
        <div>
          <h3 class="font-(family-name:--font-texte) text-(length:--fs-20) font-semibold">Payer sur place</h3>
          <p class="text-texte-secondaire">Vous réglerez directement auprès de {{ professionnel }} lors du rendez-vous.</p>
        </div>
      </div>
    </section>

    <div class="flex flex-col gap-4">
      <p v-if="erreurGenerale" class="message-erreur" role="alert" aria-live="assertive">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurGenerale }}</span>
      </p>
      <UButton
        type="submit"
        label="Envoyer ma demande"
        :loading="envoi"
        :disabled="etat === 'prise' || etat === 'expiree'"
        block
      />
      <UButton
        v-if="etat === 'prise' || etat === 'expiree'"
        :to="`/${username}#agenda`"
        label="Choisir un autre créneau"
        variant="outline"
        block
      />
      <p class="text-(length:--fs-14) text-texte-secondaire">
        En envoyant, vous acceptez que vos informations soient transmises à {{ professionnel }} pour ce rendez-vous.
      </p>
    </div>
  </form>
</template>
