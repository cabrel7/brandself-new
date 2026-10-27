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
  form, image, galerie, erreurs, erreurGenerale, enregistrement, introuvable, aDesModifications, viderErreur,
  vedetteBloquee, aideVedette, choisirImage, majGalerie, enregistrer,
  suppressionOuverte, suppressionEnCours, erreurSuppression, supprimer,
} = useRealisationForm({
  realisation: props.realisation,
  compteurs: props.compteurs,
})
</script>

<template>
  <UEmpty
    v-if="introuvable"
    icon="i-ph-squares-four"
    title="Cette réalisation n’existe plus"
    description="Elle a peut-être été supprimée depuis un autre appareil."
    :actions="[{ label: 'Retour aux réalisations', to: '/studio/realisations', size: 'xl' }]"
  />

  <form v-else class="flex flex-col gap-6" novalidate @submit.prevent="enregistrer">
    <UFormField label="Image principale" name="imageMediaId" required>
      <StudioRealisationImage
        :image="image"
        :erreur-externe="erreurs.imageMediaId"
        @televersee="choisirImage"
      />
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
        Racontez le contexte, votre rôle et le résultat.
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
          placeholder="Ville, établissement ou client"
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
          description="Désactivez pour masquer cette réalisation sans la supprimer."
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
