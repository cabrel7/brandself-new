<script setup lang="ts">
// Deux cartes (`MarketingPlanCarte`), données par `useTarifsAffichage()` : aucun prix ni aucune limite écrits ici (règle 4.11).
// Même logique de prix et de paiement que la page /tarifs. Si l'API échoue, la page reste entière : une carte de repli renvoie vers /tarifs.
const TEXTES = {
  surtitre: 'Tarifs',
  titre: 'Commencez gratuitement.',
  detail: 'Voir tous les détails',
  repliTitre: 'Les tarifs ne s’affichent pas ici',
  repliTexte: 'Retrouvez le plan gratuit et le plan payant sur la page des tarifs.',
} as const

const ROUTE_TARIFS = '/tarifs'

const source = await useTarifs()
const { mentionEssai } = source
const { cartes, indisponible } = useTarifsAffichage(source, { accrochePayant: true })
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
          <MarketingPlanCarte v-for="carte in cartes" :key="carte.id" :carte="carte" />
        </div>
        <p v-if="mentionEssai" class="m-0 mt-8 text-center text-base font-semibold text-encre">
          {{ mentionEssai }}
        </p>
        <p class="m-0 text-center" :class="mentionEssai ? 'mt-2' : 'mt-8'">
          <NuxtLink :to="ROUTE_TARIFS" class="inline-flex min-h-(--cible-tactile) items-center font-semibold text-accent-texte underline underline-offset-4">
            {{ TEXTES.detail }}
          </NuxtLink>
        </p>
      </template>
    </div>
  </section>
</template>
