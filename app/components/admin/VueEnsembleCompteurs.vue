<script setup lang="ts">
import { REVENUS_MENTION_INCERTITUDE } from '#shared/admin-paiements'
import type { VueEnsembleEnrichieDto } from '#shared/schemas/admin-paiements'
import { compteursEssais, formaterMontantAdmin, formaterNombre, titreEssais } from '~/utils/admin-paiements'

const props = defineProps<{ vue: VueEnsembleEnrichieDto }>()

const compteurs = computed(() => [
  { id: 'inscrits', libelle: 'Inscrits', valeur: formaterNombre(props.vue.compteurs.inscrits) },
  { id: 'publiees', libelle: 'Vitrines publiées', valeur: formaterNombre(props.vue.compteurs.vitrinesPubliees) },
  { id: 'payants', libelle: 'Abonnés payants', valeur: formaterNombre(props.vue.compteurs.abonnesPayants) },
])

const essais = computed(() => compteursEssais(props.vue.essais))

const reussite = computed(() => {
  const { vitrinesActives, vitrinesPubliees } = props.vue.indicateurReussite
  return vitrinesPubliees === 0
    ? 'Aucune vitrine publiée pour le moment.'
    : `${formaterNombre(vitrinesActives)} sur ${formaterNombre(vitrinesPubliees)} vitrines publiées ont reçu une visite ou une réservation ces 30 derniers jours.`
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <dl class="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
      <div v-for="compteur in compteurs" :key="compteur.id" class="flex flex-col gap-1 border-t border-bordure pt-3">
        <dt class="text-muted">{{ compteur.libelle }}</dt>
        <dd class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold">{{ compteur.valeur }}</dd>
      </div>
    </dl>

    <section aria-labelledby="titre-revenus" class="flex flex-col gap-3">
      <h2 id="titre-revenus" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">
        Encaissé ce mois-ci
      </h2>
      <p v-if="vue.revenus.length === 0" class="text-muted">Aucun paiement encaissé ce mois-ci.</p>
      <ul v-else class="divide-y divide-(--bordure)">
        <li v-for="revenu in vue.revenus" :key="revenu.devise" class="flex flex-wrap items-baseline justify-between gap-x-4 py-3">
          <span class="font-medium">{{ formaterMontantAdmin(revenu.encaisseMoisCourant, revenu.devise) }}</span>
          <span class="text-muted">{{ formaterNombre(revenu.nombre) }} {{ revenu.nombre > 1 ? 'paiements' : 'paiement' }}</span>
        </li>
      </ul>
      <p class="text-muted">{{ REVENUS_MENTION_INCERTITUDE }}</p>
    </section>

    <section aria-labelledby="titre-essais" class="flex flex-col gap-3">
      <h2 id="titre-essais" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">
        {{ titreEssais(vue.essais.jours) }}
      </h2>
      <p v-if="vue.essais.accordes === 0" class="text-muted">Aucun essai accordé sur cette période.</p>
      <dl v-else class="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        <div v-for="compteur in essais" :key="compteur.id" class="flex flex-col gap-1 border-t border-bordure pt-3">
          <dt class="text-muted">{{ compteur.libelle }}</dt>
          <dd class="font-(family-name:--font-titre) text-(length:--fs-24) leading-[1.15] font-bold">{{ compteur.valeur }}</dd>
        </div>
      </dl>
    </section>

    <section aria-labelledby="titre-reussite" class="flex flex-col gap-2">
      <h2 id="titre-reussite" class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">
        Indicateur de réussite
      </h2>
      <p>{{ reussite }}</p>
    </section>
  </div>
</template>
