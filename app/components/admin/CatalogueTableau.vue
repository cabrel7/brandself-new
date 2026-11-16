<script setup lang="ts">
import type { ListeCatalogueDto, DeviseDto, NomBloqueDto, PaysDto } from '#shared/schemas/admin-catalogues'
import { resumeCanaux } from '~/utils/admin-catalogues'
import { formaterDate } from '~/utils/admin-paiements'

// Liste d'un catalogue, en lignes empilées (lisible à 390 px) : le contenu dépend de `liste.nom`. Chaque ligne a un
// seul bouton, de 44 px de haut, qui ouvre le panneau de modification. Aucune écriture ici.
defineProps<{ liste: ListeCatalogueDto }>()
const emit = defineEmits<{
  modifierPays: [pays: PaysDto]
  modifierDevise: [devise: DeviseDto]
  retirerNom: [nom: NomBloqueDto]
}>()
</script>

<template>
  <ul class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
    <template v-if="liste.nom === 'pays'">
      <li v-for="pays in liste.elements" :key="pays.code" class="flex flex-col gap-3 px-1 py-4 md:flex-row md:items-center md:gap-6">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="font-semibold text-encre">{{ pays.libelle }}</span>
          <span class="text-(length:--fs-14) text-texte-secondaire">
            {{ pays.code }} · +{{ pays.indicatif }} · {{ pays.deviseDefaut }} · {{ pays.fuseaux.join(', ') }}
          </span>
          <span class="text-(length:--fs-14) text-texte-secondaire">Connexion : {{ resumeCanaux(pays) }}</span>
        </div>
        <div class="flex items-center justify-between gap-4 md:justify-end">
          <UBadge :color="pays.actif ? 'primary' : 'neutral'" variant="subtle" size="lg">
            {{ pays.actif ? 'Actif' : 'Inactif' }}
          </UBadge>
          <UBadge v-if="pays.utilise" color="neutral" variant="outline" size="lg">Utilisé</UBadge>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-ph-pencil-simple"
          class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
          :aria-label="`Modifier ${pays.libelle}`"
          @click="emit('modifierPays', pays)"
        >
          Modifier
        </UButton>
      </li>
    </template>

    <template v-else-if="liste.nom === 'devises'">
      <li v-for="devise in liste.elements" :key="devise.code" class="flex flex-col gap-3 px-1 py-4 md:flex-row md:items-center md:gap-6">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="font-semibold text-encre">{{ devise.code }}</span>
          <span class="text-(length:--fs-14) text-texte-secondaire">
            {{ devise.payable ? 'Payable aujourd’hui par Mobile Money' : 'Non payable aujourd’hui' }}
          </span>
        </div>
        <div class="flex items-center justify-between gap-4 md:justify-end">
          <UBadge :color="devise.actif ? 'primary' : 'neutral'" variant="subtle" size="lg">
            {{ devise.actif ? 'Active' : 'Inactive' }}
          </UBadge>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-ph-pencil-simple"
          class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
          :aria-label="`Modifier la devise ${devise.code}`"
          @click="emit('modifierDevise', devise)"
        >
          Modifier
        </UButton>
      </li>
    </template>

    <template v-else>
      <li v-for="nom in liste.elements" :key="nom.valeur" class="flex flex-col gap-3 px-1 py-4 md:flex-row md:items-center md:gap-6">
        <div class="flex min-w-0 flex-1 flex-col gap-0.5">
          <span class="truncate font-semibold text-encre" :title="nom.valeur">{{ nom.valeur }}</span>
          <span class="text-(length:--fs-14) text-texte-secondaire">{{ nom.motif }}</span>
          <span class="text-(length:--fs-14) text-texte-secondaire">Bloqué le {{ formaterDate(nom.creeLe) }}</span>
        </div>
        <UButton
          color="neutral"
          variant="outline"
          size="lg"
          icon="i-ph-lock-key-open"
          class="min-h-(--cible-tactile) justify-center max-md:w-full md:shrink-0"
          :aria-label="`Débloquer ${nom.valeur}`"
          @click="emit('retirerNom', nom)"
        >
          Débloquer
        </UButton>
      </li>
    </template>
  </ul>
</template>
