<script setup lang="ts">
import type { JournalEntreeDto } from '#shared/schemas/admin-a4'
import {
  empreinteCourte,
  libelleActionJournal,
  libelleCibleJournal,
  lignesEtatJournal,
} from '~/utils/admin-journal'
import { formaterDateHeureAdmin } from '~/utils/admin-paiements'
import { tronquerIdentifiant } from '~/utils/admin-supervision'

// Une entrée du journal : action, cible et date en tête ; motif, états avant/après et empreinte dans un détail repliable
// (en ligne, jamais une fenêtre : le détail se lit sans quitter la liste).
const props = defineProps<{ entree: JournalEntreeDto }>()

const avant = computed(() => lignesEtatJournal(props.entree.avant))
const apres = computed(() => lignesEtatJournal(props.entree.apres))
const groupes = computed(() => [
  { titre: 'Avant', lignes: avant.value },
  { titre: 'Après', lignes: apres.value },
])
const cible = computed(() => {
  const type = libelleCibleJournal(props.entree.cibleType)
  return props.entree.cibleId === null ? type : `${type} ${tronquerIdentifiant(props.entree.cibleId)}`
})
</script>

<template>
  <details class="group">
    <summary class="flex min-h-(--cible-tactile) cursor-pointer items-start gap-3 px-1 py-3">
      <UIcon name="i-ph-caret-right" class="mt-1 size-5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
      <span class="flex min-w-0 flex-1 flex-col gap-0.5">
        <span class="font-semibold text-encre">{{ libelleActionJournal(entree.action) }}</span>
        <span class="text-(length:--fs-14) text-texte-secondaire">
          {{ cible }} · {{ formaterDateHeureAdmin(entree.creeLe) }} · n° {{ entree.numero }}
        </span>
      </span>
    </summary>

    <div class="flex flex-col gap-4 pb-4 pl-9">
      <dl class="m-0 flex flex-col gap-3">
        <div class="flex flex-col">
          <dt class="text-(length:--fs-14) text-texte-secondaire">Motif</dt>
          <dd class="m-0 break-words text-encre">{{ entree.motif }}</dd>
        </div>
        <div class="flex flex-col">
          <dt class="text-(length:--fs-14) text-texte-secondaire">Administrateur</dt>
          <dd class="m-0 text-encre" :title="entree.adminId">{{ tronquerIdentifiant(entree.adminId) }}</dd>
        </div>
        <div v-if="entree.cibleId" class="flex flex-col">
          <dt class="text-(length:--fs-14) text-texte-secondaire">Identifiant de la cible</dt>
          <dd class="m-0 break-all text-encre">{{ entree.cibleId }}</dd>
        </div>
      </dl>

      <div v-if="avant.length > 0 || apres.length > 0" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div v-for="groupe in groupes" :key="groupe.titre" class="flex flex-col gap-1">
          <h3 class="m-0 text-base font-semibold text-texte-secondaire">
            {{ groupe.titre }}
          </h3>
          <p v-if="groupe.lignes.length === 0" class="m-0 text-base text-texte-secondaire">
            Aucune valeur.
          </p>
          <dl v-else class="m-0 flex flex-col gap-1">
            <div v-for="ligne in groupe.lignes" :key="ligne.cle" class="flex flex-wrap gap-x-2">
              <dt class="text-texte-secondaire">{{ ligne.libelle }} :</dt>
              <dd class="m-0 break-all text-encre">{{ ligne.valeur }}</dd>
            </div>
          </dl>
        </div>
      </div>

      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
        Empreinte : <code :title="entree.empreinte">{{ empreinteCourte(entree.empreinte) }}</code>
      </p>
    </div>
  </details>
</template>
