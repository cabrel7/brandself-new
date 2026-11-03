<script setup lang="ts">
import { PERIODES_MOIS } from '#shared/plans'

useSeoMeta({
  title: 'Tarifs — Brandself',
  description: 'Un plan gratuit pour commencer, un plan payant quand votre vitrine reçoit des rendez-vous. Paiement par Mobile Money, sans renouvellement automatique.',
})

const {
  tarifs, erreur, refresh, gratuit, payant, paiementDisponible, devises, devise, deviseChoisie, deviseOffre,
  prixPeriodes, periode, prixChoisi, moyensLibelles,
} = await useTarifs()

const LIEN_COMMENCER = '/connexion'
const { loggedIn } = useUserSession()
const exposant = computed(() => deviseOffre.value?.exposant ?? 0)

const itemsDevises = computed(() => devises.value.map((d) => ({ value: d.devise, label: d.devise })))
const itemsPeriodes = computed(() => prixPeriodes.value.map((p) => ({ value: String(p.periodeMois), label: libellePeriode(p.periodeMois) })))
const deviseTexte = computed({
  get: () => devise.value ?? '',
  set: (valeur: string) => {
    deviseChoisie.value = valeur
  },
})
const periodeTexte = computed({
  get: () => String(periode.value ?? ''),
  set: (texte: string) => {
    periode.value = PERIODES_MOIS.find((p) => String(p) === texte) ?? null
  },
})

const prixGratuit = computed(() => (devise.value ? formaterMontant(0, devise.value, exposant.value) : null))
const prixPayant = computed(() => {
  const choisi = prixChoisi.value
  return choisi && devise.value ? formaterMontant(choisi.montantParMois, devise.value, exposant.value) : null
})
const precisionPayant = computed(() => {
  const choisi = prixChoisi.value
  if (!choisi || !devise.value) return undefined
  if (choisi.periodeMois === 1) return 'par mois'
  return `par mois, facturé ${formaterMontant(choisi.montant, devise.value, exposant.value)} pour ${libellePeriode(choisi.periodeMois)}`
})

// Connecté : sa carte Abonnement s'ouvre, la durée choisie ici est présélectionnée. Visiteur : il commence par se connecter
// (aucun retour vers l'abonnement après la connexion n'existe : il le retrouve depuis son compte).
const lienPayant = computed(() => {
  if (!loggedIn.value) return LIEN_COMMENCER
  return periode.value ? `/studio/compte?periode=${periode.value}#abonnement` : '/studio/compte#abonnement'
})
const moyensTexte = computed(() => moyensLibelles.value.join(' ou '))
</script>

<template>
  <div class="min-h-dvh bg-fond text-encre">
    <TarifsEntete />

    <main class="mx-auto w-full max-w-6xl px-6 py-12 md:py-20">
      <UEmpty
        v-if="erreur || !tarifs"
        icon="i-ph-warning-circle"
        title="Les tarifs ne s’affichent pas"
        description="Nous n’avons pas pu les charger. Réessayez dans un instant."
        :as="{ title: 'h1' }"
        :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
      />

      <template v-else>
        <div class="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
          <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold md:text-(length:--fs-48)">
            Un plan gratuit, un plan payant
          </h1>
          <p class="m-0 text-(length:--fs-20) text-texte-secondaire">
            Commencez gratuitement. Passez au payant quand votre vitrine reçoit des rendez-vous.
          </p>
        </div>

        <div v-if="prixPeriodes.length > 0" class="mt-8 flex flex-col items-center gap-4">
          <TarifsSelecteur v-if="devises.length > 1" v-model="deviseTexte" :items="itemsDevises" legende="Devise" />
          <TarifsSelecteur v-model="periodeTexte" :items="itemsPeriodes" legende="Durée de l’abonnement" />
        </div>

        <div class="mt-10 grid items-stretch gap-6 md:grid-cols-2">
          <TarifsPlanCarte
            v-if="gratuit"
            titre="Gratuit"
            :prix="prixGratuit"
            precision="pour toujours"
            :lignes="lignesPlan(gratuit)"
            :action="{ label: 'Commencer gratuitement', to: LIEN_COMMENCER }"
          />
          <TarifsPlanCarte
            v-if="payant"
            titre="Payant"
            :prix="prixPayant"
            :precision="precisionPayant"
            :lignes="lignesPlan(payant)"
            mise-en-avant
            :action="paiementDisponible ? { label: 'Passer au plan payant', to: lienPayant } : undefined"
            note-action="Le paiement en ligne arrive bientôt."
          />
        </div>

        <div class="mx-auto mt-8 flex max-w-2xl flex-col gap-2 text-center text-base text-texte-secondaire">
          <p v-if="moyensTexte" class="m-0">
            Paiement par {{ moyensTexte }}.
          </p>
          <p class="m-0">
            Vous payez une période. Pas de renouvellement automatique : nous vous prévenons avant la fin.
            À l’échéance, {{ tarifs.graceJours }} jours de grâce : rien n’est supprimé.
          </p>
        </div>
      </template>
    </main>

    <footer class="border-t border-bordure">
      <div class="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6 text-(length:--fs-14) text-texte-secondaire">
        <p class="m-0">Brandself</p>
        <p class="m-0">Douala, Cameroun</p>
      </div>
    </footer>
  </div>
</template>
