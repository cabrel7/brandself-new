<script setup lang="ts">
import { ADMIN_PREFIXE_API } from '#shared/admin'
import type { VitrineFicheDto } from '#shared/schemas/admin-a2'
import { etiquettesVitrine, messageDepuisErreurApi, valeurOuTiret } from '~/utils/admin-a2'
import { formaterDate, formaterNombre, libellePlan } from '~/utils/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Vitrine · Administration' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, status, error, refresh } = useFetch<VitrineFicheDto>(() => `${ADMIN_PREFIXE_API}/vitrines/${encodeURIComponent(id.value)}`, {
  key: computed(() => `admin-vitrine-${id.value}`),
  server: false,
  lazy: true,
})
surveillerSessionAdmin(error)

const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
const introuvable = computed(() => !!error.value && lireErreurApi(error.value).statut === 404)
const messageErreur = computed(() => (error.value ? messageDepuisErreurApi(error.value) : ''))
const etiquettes = computed(() => (data.value ? etiquettesVitrine(data.value) : []))

const compteurs = computed(() => data.value
  ? [
      { libelle: 'Services', valeur: data.value.compteurs.services },
      { libelle: 'Réalisations', valeur: data.value.compteurs.realisations },
      { libelle: 'Témoignages', valeur: data.value.compteurs.temoignages },
      { libelle: 'Liens', valeur: data.value.compteurs.liens },
    ]
  : [])
</script>

<template>
  <div class="flex flex-col gap-6">
    <UButton to="/admin/vitrines" color="neutral" variant="link" size="lg" icon="i-ph-arrow-left" class="-ml-3 min-h-(--cible-tactile) self-start font-normal">
      Retour aux vitrines
    </UButton>

    <AdminRechercheEtats
      :chargement="enChargement"
      :erreur="!!error && !introuvable"
      :vide="introuvable"
      :message-erreur="messageErreur"
      icone="i-ph-storefront"
      titre-vide="Vitrine introuvable"
      :description-vide="messageErreur"
      @reessayer="() => refresh()"
    >
      <template v-if="data">
        <header class="flex flex-col gap-2">
          <h2 class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold text-encre">
            {{ data.nom }}
          </h2>
          <p class="m-0 text-base text-texte-secondaire">
            /{{ data.username }} · {{ valeurOuTiret(data.metier) }}
          </p>
          <AdminUtilisateurEtiquettes :etiquettes="etiquettes" />
        </header>

        <UAlert
          v-if="data.bloquee"
          color="error"
          variant="soft"
          icon="i-ph-lock-key"
          title="Cette vitrine est bloquée par l’administration."
          :description="data.blocageMotif ? `Motif communiqué au professionnel : ${data.blocageMotif}` : undefined"
        />

        <dl class="m-0 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <div class="flex flex-col">
            <dt class="text-(length:--fs-14) text-texte-secondaire">Plan</dt>
            <dd class="m-0 text-encre">{{ libellePlan(data.plan) }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="text-(length:--fs-14) text-texte-secondaire">Créée le</dt>
            <dd class="m-0 text-encre">{{ formaterDate(data.creeLe) }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="text-(length:--fs-14) text-texte-secondaire">Publiée le</dt>
            <dd class="m-0 text-encre">{{ data.publieeLe ? formaterDate(data.publieeLe) : '—' }}</dd>
          </div>
          <div class="flex flex-col">
            <dt class="text-(length:--fs-14) text-texte-secondaire">Professionnel</dt>
            <dd class="m-0">
              <UButton :to="`/admin/utilisateurs/${encodeURIComponent(data.utilisateurId)}`" color="neutral" variant="link" size="lg" class="-ml-2.5 min-h-(--cible-tactile) font-medium">
                Ouvrir le compte
              </UButton>
            </dd>
          </div>
        </dl>

        <div class="flex flex-col gap-2">
          <h3 class="m-0 text-base font-semibold text-texte-secondaire">Contenu</h3>
          <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="compteur in compteurs" :key="compteur.libelle" class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">{{ compteur.libelle }}</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(compteur.valeur) }}</dd>
            </div>
          </dl>
        </div>

        <div class="flex flex-col gap-2">
          <h3 class="m-0 text-base font-semibold text-texte-secondaire">Action</h3>
          <AdminVitrineActions :vitrine="data" @fait="() => refresh()" />
        </div>
      </template>
    </AdminRechercheEtats>
  </div>
</template>
