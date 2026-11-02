<script setup lang="ts">
import type {
  ActionActiviteAgenda,
  ActionActiviteEnCours,
  ActiviteAgendaVue,
  ConfirmationActiviteAgenda,
  OngletAgenda,
} from '~/composables/useStudioAgenda'

const props = defineProps<{
  activites: ActiviteAgendaVue[]
  onglet: OngletAgenda
  compteurs: { aVenir: number, demandes: number, passees: number }
  actionEnCours: ActionActiviteEnCours | null
  confirmation: ConfirmationActiviteAgenda | null
}>()

const emit = defineEmits<{
  changerOnglet: [onglet: OngletAgenda]
  demanderAction: [cle: string, action: ActionActiviteAgenda]
  annulerConfirmation: []
  confirmerAction: []
}>()

const racine = useTemplateRef<HTMLElement>('racine')

const ONGLETS: readonly OngletAgenda[] = ['a_venir', 'demandes', 'passees']
const LIBELLES_ONGLETS: Record<OngletAgenda, string> = {
  a_venir: 'À venir',
  demandes: 'Demandes',
  passees: 'Passées',
}

watch(() => props.confirmation?.cle, async (cle) => {
  if (!cle) return
  await nextTick()
  racine.value?.querySelector<HTMLElement>('[data-confirmer-activite]')?.focus()
})

async function surToucheOnglet(event: KeyboardEvent): Promise<void> {
  const index = ONGLETS.indexOf(props.onglet)
  let cible: OngletAgenda | null = null
  if (event.key === 'ArrowRight') cible = ONGLETS[(index + 1) % ONGLETS.length] ?? null
  if (event.key === 'ArrowLeft') cible = ONGLETS[(index - 1 + ONGLETS.length) % ONGLETS.length] ?? null
  if (event.key === 'Home') cible = ONGLETS[0] ?? null
  if (event.key === 'End') cible = ONGLETS[ONGLETS.length - 1] ?? null
  if (!cible || cible === props.onglet) return
  event.preventDefault()
  emit('changerOnglet', cible)
  await nextTick()
  racine.value?.querySelector<HTMLElement>(`[data-onglet="${cible}"]`)?.focus()
}

const onglets = computed(() => ONGLETS.map((valeur) => ({
  valeur,
  libelle: LIBELLES_ONGLETS[valeur],
  // Pas de compteur dans l'onglet (il figure déjà dans le sous-titre) : un point signale les demandes à traiter.
  pastille: valeur === 'demandes' && props.compteurs.demandes > 0,
})))

const ICONES_VIDE: Record<OngletAgenda, string> = {
  a_venir: 'i-ph-calendar-blank',
  demandes: 'i-ph-chat-circle-text',
  passees: 'i-ph-clock-counter-clockwise',
}
const TITRES_VIDE: Record<OngletAgenda, string> = {
  a_venir: 'Aucun rendez-vous à venir',
  demandes: 'Aucune demande',
  passees: 'Rien de passé — tout est traité',
}
const DESCRIPTIONS_VIDE: Record<OngletAgenda, string> = {
  a_venir: 'Les nouvelles réservations apparaîtront ici.',
  demandes: 'Les demandes d’inscription ou de devis arriveront ici.',
  passees: 'Les rendez-vous terminés, annulés ou refusés apparaîtront ici.',
}

interface GroupeActivites {
  jourGroupe: string
  activites: ActiviteAgendaVue[]
}

// À venir et demandes : groupées par jour. Passées : une seule liste sous « Passées ».
const groupes = computed<GroupeActivites[]>(() => {
  if (props.onglet === 'passees') return [{ jourGroupe: 'Passées', activites: props.activites }]
  const groupes_: GroupeActivites[] = []
  for (const activite of props.activites) {
    const derniere = groupes_[groupes_.length - 1]
    if (derniere && derniere.jourGroupe === activite.jourGroupe) derniere.activites.push(activite)
    else groupes_.push({ jourGroupe: activite.jourGroupe, activites: [activite] })
  }
  return groupes_
})
</script>

<template>
  <section ref="racine" aria-label="Activité de l’agenda">
    <div
      role="tablist"
      aria-label="Période de l’activité"
      class="grid grid-cols-3 rounded-(--rayon-interne) border border-bordure bg-surface p-1"
    >
      <button
        v-for="item in onglets"
        :id="`onglet-agenda-${item.valeur}`"
        :key="item.valeur"
        type="button"
        role="tab"
        :data-onglet="item.valeur"
        aria-controls="panneau-activite-agenda"
        :aria-selected="onglet === item.valeur"
        :tabindex="onglet === item.valeur ? 0 : -1"
        class="min-h-(--cible-tactile) rounded-(--rayon-interne) px-2 text-(length:--fs-14) font-semibold transition-colors md:text-base"
        :class="onglet === item.valeur ? 'bg-accent text-sur-accent' : 'text-texte-secondaire hover:bg-accent-doux hover:text-encre'"
        @click="emit('changerOnglet', item.valeur)"
        @keydown="surToucheOnglet"
      >
        {{ item.libelle }}
        <template v-if="item.pastille">
          <span
            class="ms-1 inline-block size-2 rounded-full align-middle"
            :class="onglet === item.valeur ? 'bg-sur-accent' : 'bg-accent'"
            aria-hidden="true"
          />
          <span class="sr-only">, demandes à traiter</span>
        </template>
      </button>
    </div>

    <div
      id="panneau-activite-agenda"
      role="tabpanel"
      :aria-labelledby="`onglet-agenda-${onglet}`"
      class="mt-6 flex flex-col gap-6"
    >
      <UEmpty
        v-if="activites.length === 0"
        :icon="ICONES_VIDE[onglet]"
        :title="TITRES_VIDE[onglet]"
        :description="DESCRIPTIONS_VIDE[onglet]"
        class="rounded-(--rayon) border border-bordure bg-surface"
      />

      <template v-else>
        <div v-for="groupe in groupes" :key="groupe.jourGroupe">
          <h3 class="m-0 text-(length:--fs-14) font-semibold tracking-widest text-texte-secondaire uppercase">
            {{ groupe.jourGroupe }}
          </h3>
          <ul class="m-0 mt-2 list-none space-y-4 p-0">
            <li
              v-for="activite in groupe.activites"
              :key="activite.cle"
              class="rounded-(--rayon) border border-bordure bg-surface p-4 md:p-5"
            >
              <article>
                <div class="flex items-start gap-4">
                  <span
                    v-if="activite.tuile.jour"
                    class="flex w-14 shrink-0 flex-col items-center rounded-(--rayon-interne) border border-bordure bg-champ py-2"
                    aria-hidden="true"
                  >
                    <span class="font-(family-name:--font-titre) text-(length:--fs-24) leading-none font-bold text-encre">
                      {{ activite.tuile.jour }}
                    </span>
                    <span class="mt-1 text-(length:--fs-12) font-semibold tracking-wider text-texte-secondaire uppercase">
                      {{ activite.tuile.mois }}
                    </span>
                  </span>
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-start justify-between gap-2">
                      <h4 class="m-0 text-base leading-snug font-bold text-encre">
                        {{ activite.service }}
                      </h4>
                      <UBadge
                        :label="activite.statutLibelle"
                        :color="activite.statutCouleur"
                        variant="soft"
                        :class="activite.statutCouleur === 'primary' ? 'bg-accent-doux text-accent-texte' : undefined"
                      />
                    </div>
                    <p class="m-0 mt-1 text-(length:--fs-14) text-texte-secondaire">
                      <span :class="onglet === 'passees' ? undefined : 'sr-only'">{{ activite.dateLibelle }} · </span>{{ activite.visiteur.nom }}<template v-if="activite.heureLibelle"> · {{ activite.heureLibelle }}</template>
                      <template v-if="activite.reglement"> · {{ activite.reglement }}</template>
                    </p>
                    <p class="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-(length:--fs-14)">
                      <a
                        :href="`mailto:${activite.visiteur.email}`"
                        class="break-all text-texte-secondaire underline-offset-4 hover:underline"
                      >{{ activite.visiteur.email }}</a>
                      <a
                        v-if="activite.visiteur.telephone.trim()"
                        :href="`tel:${activite.visiteur.telephone}`"
                        class="text-texte-secondaire underline-offset-4 hover:underline"
                      >{{ activite.visiteur.telephone }}</a>
                    </p>
                  </div>
                </div>

                <p v-if="activite.detail" class="m-0 mt-3 border-s-2 border-bordure ps-3 text-(length:--fs-14) whitespace-pre-line text-encre">
                  {{ activite.detail }}
                </p>

                <div
                  v-if="confirmation?.cle === activite.cle"
                  role="group"
                  aria-live="polite"
                  :aria-labelledby="`confirmation-activite-${activite.id}`"
                  class="mt-4 border-t border-bordure pt-4"
                >
                  <p :id="`confirmation-activite-${activite.id}`" class="m-0 text-base font-semibold text-encre">
                    {{ confirmation.texte }}
                  </p>
                  <div class="mt-3 flex flex-col gap-2 sm:flex-row">
                    <UButton
                      :label="confirmation.libelleConfirmation"
                      data-confirmer-activite
                      color="error"
                      size="lg"
                      class="min-h-(--cible-tactile) justify-center"
                      :loading="actionEnCours?.cle === activite.cle"
                      @click="emit('confirmerAction')"
                    />
                    <UButton
                      :label="confirmation.libelleRetour"
                      color="neutral"
                      variant="outline"
                      size="lg"
                      class="min-h-(--cible-tactile) justify-center"
                      :disabled="Boolean(actionEnCours)"
                      @click="emit('annulerConfirmation')"
                    />
                  </div>
                </div>

                <div v-else-if="activite.actions.length > 0" class="mt-4 flex flex-wrap gap-2 border-t border-bordure pt-4">
                  <UButton
                    v-for="action in activite.actions"
                    :key="action.action"
                    :label="action.libelle"
                    :color="action.couleur"
                    :variant="action.variante"
                    size="lg"
                    class="min-h-(--cible-tactile) grow justify-center sm:grow-0"
                    :loading="actionEnCours?.cle === activite.cle && actionEnCours.action === action.action"
                    :disabled="Boolean(actionEnCours)"
                    @click="emit('demanderAction', activite.cle, action.action)"
                  />
                </div>
              </article>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </section>
</template>
