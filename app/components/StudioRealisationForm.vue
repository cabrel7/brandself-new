<script setup lang="ts">
import type { RealisationStudioDTO, RealisationsCompteursDTO } from '#shared/dto'
import {
  REALISATION_DESCRIPTION_MAX,
  REALISATION_LIEN_MAX,
  REALISATION_LIEU_MAX,
  REALISATION_ROLE_MAX,
  REALISATION_TITRE_MAX,
} from '#shared/realisations'

const props = defineProps<{
  /** `null` : création. */
  realisation: RealisationStudioDTO | null
  compteurs: RealisationsCompteursDTO
}>()

const SWITCH_UI = { root: 'w-full flex-row-reverse items-center justify-between gap-4', wrapper: 'ms-0' }

const {
  form, image, galerie, erreurs, erreurGenerale, limiteAtteinte, enregistrement, introuvable, aDesModifications, viderErreur,
  vedetteBloquee, aideVedette, choisirImage, majGalerie, enregistrer,
  suppressionOuverte, suppressionEnCours, erreurSuppression, supprimer,
} = useRealisationForm({
  realisation: props.realisation,
  compteurs: props.compteurs,
})

// Créée via l'assistant MCP : relue dans le studio, activable seulement avec une image principale.
const creeeParAssistant = computed(() => props.realisation?.source === 'assistant')
const actifBloque = computed(() => creeeParAssistant.value && image.value === null)
const aideVisibilite = computed(() => (actifBloque.value ? 'Disponible dès que l’image principale est ajoutée.' : undefined))
</script>

<template>
  <UEmpty
    v-if="introuvable"
    icon="i-ph-squares-four"
    title="Cette réalisation n’existe plus"
    :actions="[{ label: 'Retour aux réalisations', to: '/studio/realisations', size: 'xl' }]"
  />

  <form v-else class="grid gap-6 lg:grid-cols-2 lg:items-start lg:gap-x-10" novalidate @submit.prevent="enregistrer">
    <div class="flex flex-col gap-6">
    <UBadge
      v-if="creeeParAssistant"
      label="Créé par l’assistant"
      variant="soft"
      class="self-start bg-accent-doux text-base font-semibold text-accent-texte"
    />

    <UFormField label="Image principale" name="imageMediaId" required>
      <StudioRealisationImage
        :image="image"
        :erreur-externe="erreurs.imageMediaId"
        @televersee="choisirImage"
      />
      <p v-if="actifBloque" class="mt-3 flex items-start gap-1.5 text-base font-semibold text-erreur">
        <UIcon name="i-ph-warning-circle" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <span>Ajoutez l’image principale pour pouvoir publier cette réalisation.</span>
      </p>
    </UFormField>

    <UFormField name="galerie">
      <template #label>
        Galerie <StudioMentionFacultative feminin />
      </template>
      <StudioRealisationGalerie
        :images="galerie"
        :erreur-externe="erreurs.galerie"
        @update:images="majGalerie"
      />
    </UFormField>
    </div>

    <div class="flex flex-col gap-6">
    <UFormField label="Titre" name="titre" required :error="erreurs.titre">
      <UInput
        v-model="form.titre"
        :maxlength="REALISATION_TITRE_MAX"
        placeholder="Le nom du projet"
        @update:model-value="viderErreur('titre')"
      />
    </UFormField>

    <UFormField label="Description" name="description" :error="erreurs.description">
      <UTextarea
        v-model="form.description"
        :rows="5"
        :maxlength="REALISATION_DESCRIPTION_MAX"
        class="w-full"
        @update:model-value="viderErreur('description')"
      />
      <p class="m-0 mt-2 text-(length:--fs-14) text-texte-secondaire">
        {{ form.description.length }} sur {{ REALISATION_DESCRIPTION_MAX }} caractères.
      </p>
    </UFormField>

    <div class="grid grid-cols-2 items-start gap-4">
      <UFormField label="Année" name="annee" :error="erreurs.annee">
        <UInput v-model="form.annee" inputmode="numeric" @update:model-value="viderErreur('annee')" />
      </UFormField>
      <UFormField label="Lieu ou client" name="lieu" :error="erreurs.lieu">
        <UInput
          v-model="form.lieu"
          :maxlength="REALISATION_LIEU_MAX"
          placeholder="Ville ou client"
          @update:model-value="viderErreur('lieu')"
        />
      </UFormField>
    </div>

    <UFormField label="Votre rôle" name="role" :error="erreurs.role">
      <UInput
        v-model="form.role"
        :maxlength="REALISATION_ROLE_MAX"
        placeholder="Ce que vous y avez fait"
        @update:model-value="viderErreur('role')"
      />
    </UFormField>

    <UFormField label="Lien externe" name="lien" :error="erreurs.lien">
      <UInput
        v-model="form.lien"
        type="url"
        inputmode="url"
        :maxlength="REALISATION_LIEN_MAX"
        placeholder="https://"
        @update:model-value="viderErreur('lien')"
      />
    </UFormField>

    <div class="flex flex-col border-y border-bordure">
      <div class="border-b border-bordure py-4">
        <USwitch
          v-model="form.actif"
          label="Visible sur la vitrine"
          :description="aideVisibilite"
          :disabled="actifBloque"
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
      <StudioLimitePlanMessage
        v-if="limiteAtteinte"
        alerte
        :ressource="limiteAtteinte.ressource"
        :limite="limiteAtteinte.limite"
      />
      <p v-else-if="erreurGenerale" role="alert" class="message-erreur">
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
        v-if="realisation"
        type="button"
        label="Supprimer cette réalisation"
        variant="link"
        color="neutral"
        size="lg"
        block
        @click="suppressionOuverte = true"
      />
    </div>
    </div>

    <UModal
      v-if="realisation"
      v-model:open="suppressionOuverte"
      :title="`Supprimer « ${realisation.titre} » ?`"
      description="Elle disparaîtra de votre vitrine, avec ses images. Cette action est définitive."
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
