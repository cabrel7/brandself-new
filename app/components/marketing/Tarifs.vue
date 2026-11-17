<script setup lang="ts">
import { ROUTE_CONNEXION } from '~/data/landing'

// Deux cartes, données par `useTarifs()` : aucun prix ni aucune limite écrits ici (règle 4.11). Même logique de prix
// et de paiement que la page /tarifs. Si l'API échoue, la page reste entière : une carte de repli renvoie vers /tarifs.
const TEXTES = {
  surtitre: 'Tarifs',
  titre: 'Commencez gratuitement.',
  gratuit: { titre: 'Gratuit', accroche: 'Pour présenter votre vitrine', action: 'Commencer gratuitement' },
  payant: { titre: 'Payant', accroche: 'À partir de', action: 'Passer au plan payant', note: 'Le paiement en ligne arrive bientôt.' },
  detail: 'Voir tous les détails',
  repliTitre: 'Les tarifs ne s’affichent pas ici',
  repliTexte: 'Retrouvez le plan gratuit et le plan payant sur la page des tarifs.',
} as const

const ROUTE_TARIFS = '/tarifs'

interface Carte {
  id: string
  titre: string
  accroche: string
  prix: string | null
  precision?: string
  lignes: string[]
  sombre: boolean
  action?: { label: string, to: string }
  note?: string
}

const { tarifs, erreur, gratuit, payant, paiementDisponible, devise, deviseOffre, periode, prixChoisi } = await useTarifs()
const { loggedIn } = useUserSession()

const exposant = computed(() => deviseOffre.value?.exposant ?? 0)
const lienPayant = computed(() => {
  if (!loggedIn.value) return ROUTE_CONNEXION
  return periode.value ? `/studio/compte?periode=${periode.value}#abonnement` : '/studio/compte#abonnement'
})

const prixGratuit = computed(() => (devise.value ? formaterMontant(0, devise.value, exposant.value) : null))
const prixPayant = computed(() => {
  const choisi = prixChoisi.value
  return choisi && devise.value ? formaterMontant(montantParMoisPaye(choisi), devise.value, exposant.value) : null
})
const precisionPayant = computed(() => {
  const choisi = prixChoisi.value
  if (!choisi || !devise.value) return undefined
  if (choisi.periodeMois === 1) return 'par mois'
  return `par mois, facturé ${formaterMontant(montantPaye(choisi), devise.value, exposant.value)} pour ${libellePeriode(choisi.periodeMois)}`
})

const cartes = computed<Carte[]>(() => {
  const liste: Carte[] = []
  if (gratuit.value) {
    liste.push({
      id: 'gratuit',
      titre: TEXTES.gratuit.titre,
      accroche: TEXTES.gratuit.accroche,
      prix: prixGratuit.value,
      lignes: lignesPlan(gratuit.value),
      sombre: false,
      action: { label: TEXTES.gratuit.action, to: ROUTE_CONNEXION },
    })
  }
  if (payant.value) {
    liste.push({
      id: 'payant',
      titre: TEXTES.payant.titre,
      accroche: prixPayant.value ? TEXTES.payant.accroche : '',
      prix: prixPayant.value,
      precision: precisionPayant.value,
      lignes: lignesPlan(payant.value),
      sombre: true,
      action: paiementDisponible.value ? { label: TEXTES.payant.action, to: lienPayant.value } : undefined,
      note: TEXTES.payant.note,
    })
  }
  return liste
})

const indisponible = computed(() => Boolean(erreur.value) || !tarifs.value || cartes.value.length === 0)
</script>

<template>
  <section id="tarifs" class="bg-surface px-4 py-20 md:px-6 md:py-30" aria-labelledby="titre-tarifs">
    <div class="mx-auto w-full max-w-290">
      <div class="mx-auto mb-12 flex max-w-200 flex-col items-center gap-3 text-center md:mb-16">
        <p class="m-0 text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">
          {{ TEXTES.surtitre }}
        </p>
        <h2 id="titre-tarifs" class="m-0 text-balance font-(family-name:--font-titre) text-[clamp(2.125rem,4.8vw,3.625rem)] leading-[1.06] font-medium text-encre">
          {{ TEXTES.titre }}
        </h2>
      </div>

      <div v-if="indisponible" class="mx-auto flex max-w-xl flex-col items-center gap-4 rounded-(--rayon-carte) border border-bordure bg-fond p-8 text-center">
        <h3 class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) font-medium text-encre">
          {{ TEXTES.repliTitre }}
        </h3>
        <p class="m-0 text-texte-secondaire">
          {{ TEXTES.repliTexte }}
        </p>
        <BsButton :to="ROUTE_TARIFS" variant="contour">
          {{ TEXTES.detail }}
        </BsButton>
      </div>

      <template v-else>
        <div class="mx-auto grid max-w-240 items-stretch gap-6 md:grid-cols-2 md:gap-7">
          <article
            v-for="carte in cartes"
            :key="carte.id"
            :aria-labelledby="`carte-${carte.id}`"
            class="flex flex-col gap-6 rounded-(--rayon-carte) border p-7 md:p-10"
            :class="carte.sombre ? 'border-encre bg-encre text-fond' : 'border-bordure bg-fond text-encre'"
          >
            <h3 :id="`carte-${carte.id}`" class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-tight font-medium">
              {{ carte.titre }}
            </h3>
            <div class="flex flex-col gap-1">
              <p class="m-0 min-h-6 text-(length:--fs-14)" :class="carte.sombre ? 'text-fond/80' : 'text-texte-secondaire'">
                {{ carte.accroche }}
              </p>
              <p v-if="carte.prix" class="m-0 font-(family-name:--font-titre) text-(length:--fs-48) leading-tight font-medium">
                {{ carte.prix }}
              </p>
              <p v-if="carte.precision" class="m-0 text-(length:--fs-14)" :class="carte.sombre ? 'text-fond/80' : 'text-texte-secondaire'">
                {{ carte.precision }}
              </p>
            </div>
            <ul class="m-0 flex flex-1 list-none flex-col gap-3 p-0">
              <li v-for="ligne in carte.lignes" :key="ligne" class="flex items-start gap-2.5">
                <UIcon name="i-ph-check" class="mt-1 size-5 shrink-0" :class="carte.sombre ? 'text-accent-doux' : 'text-accent-texte'" aria-hidden="true" />
                <span>{{ ligne }}</span>
              </li>
            </ul>
            <BsButton v-if="carte.action" :to="carte.action.to" :variant="carte.sombre ? 'principal' : 'contour'" block>
              {{ carte.action.label }}
            </BsButton>
            <p v-else-if="carte.note" class="m-0 flex items-start gap-2 text-fond/80">
              <UIcon name="i-ph-clock" class="mt-0.5 size-5 shrink-0" aria-hidden="true" />
              <span>{{ carte.note }}</span>
            </p>
          </article>
        </div>
        <p class="m-0 mt-8 text-center">
          <NuxtLink :to="ROUTE_TARIFS" class="inline-flex min-h-(--cible-tactile) items-center font-semibold text-accent-texte underline underline-offset-4">
            {{ TEXTES.detail }}
          </NuxtLink>
        </p>
      </template>
    </div>
  </section>
</template>
