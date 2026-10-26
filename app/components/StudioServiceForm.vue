<script setup lang="ts">
import type { Devise } from '#shared/compte'
import type { ServiceStudioDTO, ServicesCompteursDTO } from '#shared/dto'
import {
  INCLUS_LIGNE_MAX,
  INCLUS_MAX,
  PAIEMENT_INSTRUCTIONS_MAX,
  SEANCES_MAX,
  SEANCES_MIN,
  SERVICE_DESCRIPTION_MAX,
  SERVICE_TITRE_MAX,
} from '#shared/services'

const props = defineProps<{
  /** `null` : création. */
  service: ServiceStudioDTO | null
  compteurs: ServicesCompteursDTO
  deviseParDefaut: Devise
}>()

const SWITCH_UI = { root: 'w-full flex-row-reverse items-center justify-between gap-4', wrapper: 'ms-0' }
const RADIO_UI = { legend: 'mb-2 text-base font-semibold text-encre', item: 'flex-1' }
// Segment actif plein (accent + texte blanc) : l'option choisie se lit d'un coup d'oeil.
const TARIF_UI = {
  ...RADIO_UI,
  item: 'flex-1 has-data-[state=checked]:border-accent has-data-[state=checked]:bg-accent has-data-[state=checked]:**:text-sur-accent',
}

const {
  form, image, erreurs, erreurGenerale, enregistrement, aDesModifications, viderErreur,
  accompagnement, dureeRequise, tarifVerrouille, payant, libellePrix, prixDecimal,
  itemsTarifs, itemsPaiement, vedetteBloquee, aideVedette,
  choisirImage, retirerImage, enregistrer,
  suppressionOuverte, suppressionEnCours, erreurSuppression, supprimer,
} = useServiceForm({
  service: props.service,
  compteurs: props.compteurs,
  deviseParDefaut: props.deviseParDefaut,
})

const aidePrix = computed(() =>
  prixDecimal.value ? 'Exemple : 12,50 (deux décimales au plus).' : 'Montant entier, sans décimale. Exemple : 15 000.',
)
</script>

<template>
  <form class="flex flex-col gap-6" novalidate @submit.prevent="enregistrer">
    <UFormField name="imageMediaId">
      <template #label>
        Photo <StudioMentionFacultative feminin />
      </template>
      <StudioServicePhoto
        :photo="image"
        :erreur-externe="erreurs.imageMediaId"
        @televersee="choisirImage"
        @retiree="retirerImage"
      />
    </UFormField>

    <UFormField label="Titre" name="titre" required :error="erreurs.titre">
      <UInput v-model="form.titre" :maxlength="SERVICE_TITRE_MAX" @update:model-value="viderErreur('titre')" />
    </UFormField>

    <UFormField label="Description" name="description" :error="erreurs.description">
      <UTextarea
        v-model="form.description"
        :rows="4"
        :maxlength="SERVICE_DESCRIPTION_MAX"
        class="w-full"
        @update:model-value="viderErreur('description')"
      />
      <p class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
        {{ form.description.length }} sur {{ SERVICE_DESCRIPTION_MAX }} caractères
      </p>
    </UFormField>

    <UFormField
      label="Type de service"
      name="type"
      :error="erreurs.type"
      help="Le type adapte le bouton et le parcours de réservation du visiteur."
    >
      <USelect v-model="form.type" :items="ITEMS_TYPES" @update:model-value="viderErreur('type')" />
    </UFormField>

    <section
      v-if="accompagnement"
      aria-labelledby="titre-accompagnement"
      class="flex flex-col gap-4 rounded-(--rayon) bg-surface p-4"
    >
      <h2 id="titre-accompagnement" class="m-0 text-(length:--fs-14) font-semibold tracking-wider text-accent-texte uppercase">
        Accompagnement
      </h2>
      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Séances" name="nbSeances" required :error="erreurs.nbSeances">
          <UInput
            v-model="form.nbSeances"
            inputmode="numeric"
            :placeholder="`${SEANCES_MIN} à ${SEANCES_MAX}`"
            @update:model-value="viderErreur('nbSeances')"
          />
        </UFormField>
        <UFormField label="Durée (min)" name="dureeMin" required :error="erreurs.dureeMin">
          <UInput v-model="form.dureeMin" inputmode="numeric" @update:model-value="viderErreur('dureeMin')" />
        </UFormField>
      </div>
      <UFormField label="Rythme" name="rythme" :error="erreurs.rythme">
        <USelect v-model="form.rythme" :items="ITEMS_RYTHMES" @update:model-value="viderErreur('rythme')" />
      </UFormField>
    </section>

    <UFormField v-else name="dureeMin" :required="dureeRequise" :error="erreurs.dureeMin">
      <template #label>
        Durée (min) <StudioMentionFacultative v-if="!dureeRequise" feminin />
      </template>
      <UInput v-model="form.dureeMin" inputmode="numeric" @update:model-value="viderErreur('dureeMin')" />
    </UFormField>

    <div class="flex flex-col gap-2">
      <URadioGroup
        v-model="form.tarif"
        legend="Tarif"
        :items="itemsTarifs"
        variant="table"
        indicator="hidden"
        orientation="horizontal"
        size="lg"
        :ui="TARIF_UI"
        @update:model-value="viderErreur('tarif')"
      />
      <p v-if="tarifVerrouille" class="m-0 text-(length:--fs-14) text-texte-secondaire">
        Une prestation sur devis n’a pas de tarif fixe : le prix sera défini avec chaque client.
      </p>
      <p v-if="erreurs.tarif" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurs.tarif }}</span>
      </p>
    </div>

    <template v-if="payant">
      <div class="grid grid-cols-[minmax(0,1fr)_8rem] gap-4">
        <UFormField :label="libellePrix" name="prix" required :error="erreurs.prix" :help="aidePrix">
          <UInput
            v-model="form.prix"
            :inputmode="prixDecimal ? 'decimal' : 'numeric'"
            @update:model-value="viderErreur('prix')"
          >
            <template #trailing>
              <span class="text-base font-semibold text-texte-secondaire" aria-hidden="true">{{ form.devise }}</span>
            </template>
          </UInput>
        </UFormField>
        <UFormField label="Devise" name="devise" :error="erreurs.devise">
          <USelect v-model="form.devise" :items="ITEMS_DEVISES_SERVICE" @update:model-value="viderErreur('devise')" />
        </UFormField>
      </div>

      <div class="flex flex-col gap-2">
        <URadioGroup
          v-model="form.paiementMode"
          legend="Comment le client règle-t-il ?"
          :items="itemsPaiement"
          variant="card"
          size="lg"
          :ui="{ ...RADIO_UI, item: 'w-full' }"
          @update:model-value="viderErreur('paiementMode')"
        />
        <p v-if="erreurs.paiementMode" role="alert" class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ erreurs.paiementMode }}</span>
        </p>
      </div>

      <UFormField name="paiementInstructions" :error="erreurs.paiementInstructions">
        <template #label>
          Instructions de règlement <StudioMentionFacultative />
        </template>
        <UTextarea
          v-model="form.paiementInstructions"
          :rows="3"
          :maxlength="PAIEMENT_INSTRUCTIONS_MAX"
          placeholder="Mobile Money au +237…, ou en espèces au cabinet."
          class="w-full"
          @update:model-value="viderErreur('paiementInstructions')"
        />
      </UFormField>
    </template>

    <UFormField
      name="inclus"
      :error="erreurs.inclus"
      :help="`Une ligne par élément, ${INCLUS_MAX} au maximum (${INCLUS_LIGNE_MAX} caractères par ligne). Pour un accompagnement, une ligne par étape du programme.`"
    >
      <template #label>
        Ce que comprend le service <StudioMentionFacultative />
      </template>
      <UTextarea v-model="form.inclus" :rows="5" class="w-full" @update:model-value="viderErreur('inclus')" />
    </UFormField>

    <div class="flex flex-col border-y border-bordure">
      <div class="border-b border-bordure py-4">
        <USwitch
          v-model="form.actif"
          label="Visible sur la vitrine"
          description="Désactivez pour masquer ce service sans le supprimer."
          :ui="SWITCH_UI"
        />
      </div>
      <div class="border-b border-bordure py-4">
        <USwitch
          v-model="form.reservable"
          label="Réservable en ligne"
          description="Le visiteur peut réserver ou faire sa demande depuis la vitrine."
          :ui="SWITCH_UI"
        />
      </div>
      <div class="py-4">
        <USwitch
          v-model="form.enVedette"
          label="En vedette sur l’accueil"
          :description="aideVedette"
          :disabled="vedetteBloquee"
          :ui="SWITCH_UI"
          @update:model-value="viderErreur('enVedette')"
        />
        <p v-if="erreurs.enVedette" role="alert" class="message-erreur mt-2">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ erreurs.enVedette }}</span>
        </p>
      </div>
    </div>

    <div class="flex flex-col gap-3">
      <p v-if="erreurGenerale" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurGenerale }}</span>
      </p>
      <UButton
        type="submit"
        label="Enregistrer"
        :loading="enregistrement"
        :disabled="!aDesModifications"
        block
      />
      <UButton
        v-if="service"
        type="button"
        label="Supprimer ce service"
        variant="link"
        color="neutral"
        size="lg"
        block
        @click="suppressionOuverte = true"
      />
    </div>

    <UModal
      v-if="service"
      v-model:open="suppressionOuverte"
      :title="`Supprimer « ${service.titre} » ?`"
      description="Il disparaîtra de votre vitrine. Cette action est définitive."
      :dismissible="!suppressionEnCours"
    >
      <template #footer="{ close }">
        <div class="flex w-full flex-col gap-3">
          <p v-if="erreurSuppression" role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ erreurSuppression }}</span>
          </p>
          <div class="flex flex-col gap-2 sm:flex-row-reverse">
            <UButton label="Supprimer" color="error" :loading="suppressionEnCours" @click="supprimer" />
            <UButton label="Annuler" variant="outline" color="neutral" :disabled="suppressionEnCours" @click="close" />
          </div>
        </div>
      </template>
    </UModal>
  </form>
</template>
