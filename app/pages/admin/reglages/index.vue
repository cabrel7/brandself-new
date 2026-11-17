<script setup lang="ts">
import { REGLAGE_CATEGORIE_LIBELLES } from '#shared/reglages'
import type { ReglageCategorie } from '#shared/reglages'
import { optionsCategoriesReglage } from '~/utils/admin-reglages'
import { UI_CHAMP_TACTILE } from '~/utils/admin-ui'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Réglages · Administration' })

const {
  categorie, elements, visibles, enChargement, erreurLecture, messageErreur, refresh, changerCategorie,
  dialogue, resume, dialogueOuvert, enCours, erreurEcriture, demander, confirmer,
} = useAdminReglages()

const options = optionsCategoriesReglage()
const categorieModele = computed<ReglageCategorie>({
  get: () => categorie.value,
  set: (valeur) => void changerCategorie(valeur),
})
</script>

<template>
  <div class="flex flex-col gap-6">
    <UFormField label="Catégorie" name="categorie" class="max-w-md">
      <USelect v-model="categorieModele" :items="options" :ui="UI_CHAMP_TACTILE" class="w-full" />
    </UFormField>

    <AdminRechercheEtats
      :chargement="enChargement"
      :erreur="!!erreurLecture"
      :vide="!enChargement && !erreurLecture && visibles.length === 0"
      :message-erreur="messageErreur"
      icone="i-ph-sliders"
      titre-vide="Aucun réglage dans cette catégorie."
      @reessayer="() => refresh()"
    >
      <section :aria-label="REGLAGE_CATEGORIE_LIBELLES[categorie]">
        <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
          <li v-for="reglage in visibles" :key="reglage.cle">
            <AdminReglageLigne
              :reglage="reglage"
              :tous="elements"
              :occupe="enCours"
              @enregistrer="(valeur) => demander(reglage, valeur)"
              @retablir="demander(reglage, null)"
            />
          </li>
        </ul>
      </section>
    </AdminRechercheEtats>

    <AdminSupervisionConfirmation
      v-if="dialogue"
      v-model:open="dialogueOuvert"
      :titre="dialogue.titre"
      :description="dialogue.description"
      :libelle-action="dialogue.libelleAction"
      :reauth="dialogue.reauth"
      :action="dialogue.action"
      :cible-type="dialogue.cibleType"
      :cible-id="dialogue.cibleId"
      :destructive="dialogue.destructive"
      :en-cours="enCours"
      :erreur="erreurEcriture"
      @confirmer="confirmer"
    >
      <dl v-if="resume" class="m-0 flex flex-col gap-2 rounded-(--rayon-interne) bg-surface p-4">
        <div class="flex flex-col">
          <dt class="text-(length:--fs-14) text-texte-secondaire">Réglage</dt>
          <dd class="m-0 font-medium text-encre">{{ resume.libelle }}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-(length:--fs-14) text-texte-secondaire">Valeur actuelle</dt>
          <dd class="m-0 break-words text-encre">{{ resume.actuelle }}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-(length:--fs-14) text-texte-secondaire">Nouvelle valeur</dt>
          <dd class="m-0 break-words font-medium text-encre">{{ resume.nouvelle }}</dd>
        </div>
      </dl>
    </AdminSupervisionConfirmation>
  </div>
</template>
