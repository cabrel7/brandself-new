<script setup lang="ts">
const {
  periodeTexte, periodes, phrasePlanPayant, donnees, jours, chargement, erreur, vide, charger,
} = useStatistiques()

const ouvert = ref(false)

function basculer(): void {
  ouvert.value = !ouvert.value
  if (ouvert.value) void charger()
}

const totauxVues = computed(() => {
  const totaux = donnees.value?.totaux
  if (!totaux) return []
  return [
    { nombre: totaux.visites, label: accorder(totaux.visites, 'visite', 'visites') },
    { nombre: totaux.visiteursUniques, label: accorder(totaux.visiteursUniques, 'visiteur unique', 'visiteurs uniques') },
    { nombre: totaux.clics, label: accorder(totaux.clics, 'clic sur les liens', 'clics sur les liens') },
    { nombre: totaux.reservations, label: accorder(totaux.reservations, 'réservation', 'réservations') },
  ]
})
</script>

<template>
  <BsCard>
    <UButton
      label="Voir le détail"
      block
      size="lg"
      color="neutral"
      variant="outline"
      trailing-icon="i-ph-caret-down"
      :ui="{ trailingIcon: ouvert ? 'transition-transform rotate-180' : 'transition-transform' }"
      :loading="chargement"
      :aria-expanded="ouvert"
      aria-controls="detail-statistiques"
      @click="basculer"
    />

    <div v-if="ouvert" id="detail-statistiques" class="flex flex-col gap-4 border-t border-bordure pt-4">
      <TarifsSelecteur v-model="periodeTexte" :items="periodes" legende="Période des statistiques" />
      <p v-if="phrasePlanPayant" class="message-info">
        Les périodes de 30 et 90 jours sont incluses avec le plan payant.
      </p>

      <div v-if="chargement" role="status" aria-label="Chargement de vos statistiques" class="flex flex-col gap-3">
        <USkeleton class="h-20 w-full" aria-hidden="true" />
        <USkeleton class="h-48 w-full" aria-hidden="true" />
      </div>

      <div v-else-if="erreur" role="status" class="flex flex-col items-start gap-2">
        <p class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ erreur }}</span>
        </p>
        <UButton label="Réessayer" variant="outline" color="neutral" size="lg" @click="() => charger()" />
      </div>

      <p v-else-if="vide" role="status" class="m-0 text-base text-texte-secondaire">
        Aucune visite pour cette période.
      </p>

      <template v-else-if="donnees">
        <dl class="m-0 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div v-for="totaux in totauxVues" :key="totaux.label" class="flex flex-col-reverse">
            <dt class="text-base text-texte-secondaire">
              {{ totaux.label }}
            </dt>
            <dd class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-semibold text-encre">
              {{ totaux.nombre }}
            </dd>
          </div>
        </dl>

        <div class="flex flex-col gap-2">
          <h2 class="m-0 text-(length:--fs-14) font-bold text-encre">Par jour</h2>
          <ul class="m-0 list-none border-t border-bordure p-0">
            <li
              v-for="jour in jours"
              :key="jour.jour"
              class="flex min-h-11 items-center justify-between gap-3 border-b border-bordure py-2"
            >
              <span class="text-encre">{{ jour.libelle }}</span>
              <span class="flex shrink-0 items-baseline gap-3">
                <span class="font-semibold text-encre">
                  {{ jour.visites }} {{ accorder(jour.visites, 'visite', 'visites') }}
                </span>
                <span class="text-(length:--fs-14) text-texte-secondaire">
                  {{ jour.visiteursUniques }} {{ accorder(jour.visiteursUniques, 'visiteur unique', 'visiteurs uniques') }}
                </span>
              </span>
            </li>
          </ul>
        </div>

        <div v-if="donnees.pages && donnees.pages.length > 0" class="flex flex-col gap-2">
          <h2 class="m-0 text-(length:--fs-14) font-bold text-encre">Pages les plus vues</h2>
          <ul class="m-0 list-none border-t border-bordure p-0">
            <li
              v-for="page in donnees.pages"
              :key="`${page.type}-${page.identifiant}`"
              class="flex min-h-11 items-center justify-between gap-3 border-b border-bordure py-2"
            >
              <span class="min-w-0 truncate text-encre">{{ page.libelle }}</span>
              <span class="shrink-0 text-texte-secondaire">
                {{ page.visites }} {{ accorder(page.visites, 'visite', 'visites') }}
              </span>
            </li>
          </ul>
        </div>

        <div v-if="donnees.sources && donnees.sources.length > 0" class="flex flex-col gap-2">
          <h2 class="m-0 text-(length:--fs-14) font-bold text-encre">Sources</h2>
          <ul class="m-0 list-none border-t border-bordure p-0">
            <li
              v-for="source in donnees.sources"
              :key="source.source"
              class="flex min-h-11 items-center justify-between gap-3 border-b border-bordure py-2"
            >
              <span class="min-w-0 truncate text-encre">{{ source.libelle }}</span>
              <span class="shrink-0 text-texte-secondaire">
                {{ source.visites }} {{ accorder(source.visites, 'visite', 'visites') }}
              </span>
            </li>
          </ul>
        </div>
      </template>
    </div>
  </BsCard>
</template>
