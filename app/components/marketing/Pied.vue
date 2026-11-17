<script setup lang="ts">
import { MARQUE } from '#shared/brand'
import { NAV_LIENS, ROUTE_CONNEXION } from '~/data/landing'

// Pied de page : deux colonnes (Produit, Compte). Aucun lien vers une page qui n'existe pas encore.
const TEXTES = {
  phrase: 'Votre vitrine en ligne, à votre nom.',
  produit: 'Produit',
  compte: 'Compte',
  creer: 'Créer ma vitrine',
  connexion: 'Connexion',
} as const

const { lienNav, lienCreer, lienLogo } = useLiensMarketing()
const compteLiens = computed(() => [
  { libelle: TEXTES.creer, to: lienCreer.value },
  { libelle: TEXTES.connexion, to: ROUTE_CONNEXION },
])

// Année figée côté serveur : le client reprend la même valeur (pas de décalage d'hydratation).
const annee = useState<number>('annee-courante', () => new Date().getFullYear())
const classeLien = 'inline-flex min-h-(--cible-tactile) items-center text-encre no-underline hover:text-accent-texte hover:underline'
const classeTitreColonne = 'm-0 mb-2 text-(length:--fs-14) font-bold tracking-widest text-texte-secondaire uppercase'
</script>

<template>
  <footer class="border-t border-bordure bg-fond px-4 pt-16 pb-9 md:px-6 md:pt-18">
    <div class="mx-auto w-full max-w-290">
      <div class="grid gap-10 max-[960px]:grid-cols-2 min-[961px]:grid-cols-[1.4fr_1fr_1fr]">
        <div class="max-[960px]:col-span-2">
          <NuxtLink :to="lienLogo" :aria-label="`${MARQUE.nom}, accueil`" class="inline-flex min-h-(--cible-tactile) items-center">
            <BsLogo variante="wordmark" class="h-8" />
          </NuxtLink>
          <p class="m-0 mt-3 max-w-xs text-texte-secondaire">
            {{ TEXTES.phrase }}
          </p>
        </div>
        <nav :aria-label="TEXTES.produit">
          <p :class="classeTitreColonne">
            {{ TEXTES.produit }}
          </p>
          <ul class="m-0 list-none p-0">
            <li v-for="lien in NAV_LIENS" :key="lien.ancre">
              <NuxtLink :to="lienNav(lien.ancre)" :class="classeLien">
                {{ lien.libelle }}
              </NuxtLink>
            </li>
          </ul>
        </nav>
        <nav :aria-label="TEXTES.compte">
          <p :class="classeTitreColonne">
            {{ TEXTES.compte }}
          </p>
          <ul class="m-0 list-none p-0">
            <li v-for="lien in compteLiens" :key="lien.libelle">
              <NuxtLink :to="lien.to" :class="classeLien">
                {{ lien.libelle }}
              </NuxtLink>
            </li>
          </ul>
        </nav>
      </div>
      <p class="m-0 mt-12 border-t border-bordure pt-6 text-(length:--fs-14) text-texte-secondaire">
        © {{ annee }} {{ MARQUE.nom }}
      </p>
    </div>
  </footer>
</template>
