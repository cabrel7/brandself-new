<script setup lang="ts">
import type { RevenuDeviseDto } from '#shared/schemas/admin-paiements'
import { formaterDate, formaterMontantAdmin, formaterNombre, libellePeriodeAdmin } from '~/utils/admin-paiements'

// Une carte par devise : jamais d'addition entre devises. Montants bruts présumés (la mention est affichée par la page).
defineProps<{ revenu: RevenuDeviseDto }>()
</script>

<template>
  <UCard :ui="{ body: 'flex flex-col gap-4' }">
    <template #header>
      <h3 class="font-(family-name:--font-titre) text-(length:--fs-20) font-bold">{{ revenu.devise }}</h3>
    </template>

    <dl class="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2">
      <dt class="text-muted">Encaissé K-PAY ce mois-ci</dt>
      <dd class="text-right font-medium">{{ formaterMontantAdmin(revenu.mois.courant.kpay.brut, revenu.devise) }}</dd>
      <dt class="text-muted">Paiements K-PAY</dt>
      <dd class="text-right">{{ formaterNombre(revenu.mois.courant.kpay.nombre) }}</dd>
      <dt class="text-muted">Frais réels connus</dt>
      <dd class="text-right">{{ formaterMontantAdmin(revenu.mois.courant.kpay.fraisReels, revenu.devise) }}</dd>
      <dt v-if="revenu.mois.courant.kpay.nombreSansFrais > 0" class="text-muted">Paiements sans frais connus</dt>
      <dd v-if="revenu.mois.courant.kpay.nombreSansFrais > 0" class="text-right">
        {{ formaterNombre(revenu.mois.courant.kpay.nombreSansFrais) }}
      </dd>
      <dt class="text-muted">Marqués manuellement</dt>
      <dd class="text-right">
        {{ formaterMontantAdmin(revenu.mois.courant.manuel.brut, revenu.devise) }}
        ({{ formaterNombre(revenu.mois.courant.manuel.nombre) }})
      </dd>
      <dt class="text-muted">Mois précédent, K-PAY</dt>
      <dd class="text-right">{{ formaterMontantAdmin(revenu.mois.precedent.kpay.brut, revenu.devise) }}</dd>
      <dt class="text-muted">Abonnés actifs</dt>
      <dd class="text-right">{{ formaterNombre(revenu.abonnesActifs) }}</dd>
    </dl>

    <section :aria-label="`Répartition par durée en ${revenu.devise}`">
      <h4 class="mb-2 font-medium">Répartition sur 12 mois</h4>
      <ul class="divide-y divide-(--bordure)">
        <li v-for="ligne in revenu.repartition" :key="ligne.periodeMois" class="flex justify-between gap-4 py-2">
          <span>{{ libellePeriodeAdmin(ligne.periodeMois) }} ({{ formaterNombre(ligne.nombre) }})</span>
          <span>{{ formaterMontantAdmin(ligne.brut, revenu.devise) }}</span>
        </li>
      </ul>
    </section>

    <p class="text-muted">
      Période du {{ formaterDate(revenu.mois.courant.debut) }} au {{ formaterDate(revenu.mois.courant.fin) }}.
    </p>
  </UCard>
</template>
