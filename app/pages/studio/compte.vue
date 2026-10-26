<script setup lang="ts">
import { ACCOUNT_DELETION_PHRASE } from '#shared/compte'
import type { Devise, Locale } from '#shared/compte'

definePageMeta({ layout: 'studio' })
useSeoMeta({ title: 'Mon compte — Brandself' })

const { moi, enChargement, enErreur, refresh, enregistrement, erreur, confirmation, mettreAJour } = useMoi()
const appareils = useAppareils()
const deconnexion = useDeconnexion()
const suppression = useSuppressionCompte()

// Préférences : valeur locale (affichage immédiat), remise à l'état serveur si l'enregistrement échoue.
const locale = ref<Locale>('fr')
const devise = ref<Devise>('XAF')
const fuseau = ref('Africa/Douala')

watch(moi, (courant) => {
  if (!courant) return
  locale.value = courant.locale
  devise.value = courant.devise
  fuseau.value = courant.fuseau
}, { immediate: true })

const fuseauxItems = computed(() => itemsFuseaux(moi.value?.fuseau ?? fuseau.value))

async function enregistrerLocale(valeur: Locale): Promise<void> {
  if (!(await mettreAJour({ locale: valeur })) && moi.value) locale.value = moi.value.locale
}
async function enregistrerDevise(valeur: Devise): Promise<void> {
  if (!(await mettreAJour({ devise: valeur })) && moi.value) devise.value = moi.value.devise
}
async function enregistrerFuseau(valeur: string): Promise<void> {
  if (!(await mettreAJour({ fuseau: valeur })) && moi.value) fuseau.value = moi.value.fuseau
}

// Appareils connectés
const appareilsOuverts = ref(false)
const idListeAppareils = useId()

// Suppression du compte : confirmation sur place, sans fenêtre.
const suppressionOuverte = ref(false)
const saisie = ref('')
const phraseValide = computed(() => saisie.value.trim() === ACCOUNT_DELETION_PHRASE)

function annulerSuppression(): void {
  suppressionOuverte.value = false
  saisie.value = ''
  suppression.erreur.value = ''
}
</script>

<template>
  <div>
    <StudioRetour to="/studio" label="Vitrine" />

    <div v-if="enChargement" class="mt-4 flex flex-col gap-6" aria-busy="true" aria-label="Chargement de votre compte">
      <USkeleton class="h-10 w-48" />
      <USkeleton class="h-32 w-full" />
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-14 w-full" />
    </div>

    <UEmpty
      v-else-if="enErreur || !moi"
      icon="i-ph-warning-circle"
      title="Votre compte ne s’affiche pas"
      description="Nous n’avons pas pu le charger. Vos informations sont intactes."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: () => refresh() }]"
    />

    <div v-else class="mt-2 flex flex-col gap-8">
      <h1 class="m-0 text-(length:--fs-32) leading-tight font-semibold text-encre">
        Mon compte
      </h1>

      <section aria-labelledby="titre-abonnement">
        <BsCard>
          <div class="flex items-center justify-between gap-3">
            <h2 id="titre-abonnement" class="m-0 text-(length:--fs-20) font-semibold text-encre">
              Abonnement
            </h2>
            <UBadge color="neutral" variant="outline" size="lg">
              Plan gratuit
            </UBadge>
          </div>
          <p class="m-0 text-base text-texte-secondaire">
            Vous profitez du plan gratuit. Les formules payantes seront proposées ici.
          </p>
        </BsCard>
      </section>

      <section aria-labelledby="titre-informations" class="flex flex-col gap-4">
        <h2 id="titre-informations" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Vos informations
        </h2>

        <dl class="m-0 flex flex-col gap-4">
          <div>
            <dt class="text-base font-semibold text-encre">
              Email
            </dt>
            <dd class="m-0 text-base text-encre">
              {{ moi.email ?? 'Non renseignée' }}
            </dd>
            <dd v-if="moi.email" class="m-0 text-(length:--fs-14) text-texte-secondaire">
              Adresse vérifiée
            </dd>
          </div>
          <div>
            <dt class="text-base font-semibold text-encre">
              Téléphone
            </dt>
            <dd class="m-0 text-base text-encre">
              {{ moi.telephone ?? 'Non renseigné' }}
            </dd>
          </div>
        </dl>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <UFormField label="Langue" name="locale">
            <USelect v-model="locale" :items="ITEMS_LOCALES" :disabled="enregistrement" @update:model-value="enregistrerLocale" />
          </UFormField>
          <UFormField label="Devise" name="devise">
            <USelect v-model="devise" :items="ITEMS_DEVISES" :disabled="enregistrement" @update:model-value="enregistrerDevise" />
          </UFormField>
        </div>
        <UFormField label="Fuseau horaire" name="fuseau">
          <USelect v-model="fuseau" :items="fuseauxItems" :disabled="enregistrement" @update:model-value="enregistrerFuseau" />
        </UFormField>

        <p v-if="erreur" role="alert" class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ erreur }}</span>
        </p>
        <p v-else class="m-0 min-h-6 text-(length:--fs-14) text-texte-secondaire" role="status">
          {{ confirmation }}
        </p>
      </section>

      <section aria-labelledby="titre-securite" class="flex flex-col gap-3">
        <h2 id="titre-securite" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Connexion et sécurité
        </h2>
        <p class="m-0 text-base text-texte-secondaire">
          Aucun mot de passe à gérer.
        </p>

        <div class="border-y border-bordure">
          <button
            type="button"
            class="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 bg-transparent px-1 text-left text-base text-encre transition-colors hover:bg-surface"
            :aria-expanded="appareilsOuverts"
            :aria-controls="idListeAppareils"
            @click="appareilsOuverts = !appareilsOuverts"
          >
            <span>
              Appareils connectés<template v-if="!appareils.enChargement.value && !appareils.messageChargement.value"> ({{ appareils.appareils.value.length }})</template>
            </span>
            <UIcon
              name="i-ph-caret-right"
              class="size-5 text-texte-secondaire transition-transform"
              :class="{ 'rotate-90': appareilsOuverts }"
              aria-hidden="true"
            />
          </button>

          <div v-if="appareilsOuverts" :id="idListeAppareils" class="border-t border-bordure py-2">
            <USkeleton v-if="appareils.enChargement.value" class="h-16 w-full" aria-label="Chargement des appareils" />
            <div v-else-if="appareils.messageChargement.value" class="flex flex-col items-start gap-2 py-2">
              <p role="alert" class="message-erreur">
                <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
                <span>{{ appareils.messageChargement.value }}</span>
              </p>
              <UButton label="Réessayer" variant="outline" size="lg" @click="appareils.refresh()" />
            </div>
            <p v-else-if="appareils.appareils.value.length === 0" class="m-0 py-2 text-base text-texte-secondaire">
              Aucun appareil connecté.
            </p>
            <ul v-else class="m-0 list-none p-0">
              <li
                v-for="appareil in appareils.appareils.value"
                :key="appareil.id"
                class="flex items-center justify-between gap-3 border-b border-bordure py-3 last:border-b-0"
              >
                <div class="min-w-0">
                  <p class="m-0 flex flex-wrap items-center gap-2 text-base font-medium text-encre">
                    {{ libelleAppareil(appareil.userAgent) }}
                    <UBadge v-if="appareil.actuel" color="primary" variant="solid" size="md">
                      Cet appareil
                    </UBadge>
                  </p>
                  <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
                    Dernière activité : {{ formaterDateHeure(appareil.derniereActivite, moi.fuseau) }}
                  </p>
                </div>
                <UButton
                  v-if="!appareil.actuel"
                  label="Déconnecter"
                  variant="outline"
                  color="neutral"
                  size="lg"
                  :loading="appareils.revocationEnCours.value === appareil.id"
                  :disabled="appareils.revocationEnCours.value !== null"
                  :aria-label="`Déconnecter ${libelleAppareil(appareil.userAgent)}`"
                  @click="appareils.revoquer(appareil.id)"
                />
              </li>
            </ul>
            <p v-if="appareils.erreurRevocation.value" role="alert" class="message-erreur mt-2">
              <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
              <span>{{ appareils.erreurRevocation.value }}</span>
            </p>
          </div>
        </div>

        <UButton
          label="Se déconnecter"
          variant="outline"
          block
          :loading="deconnexion.enCours.value"
          @click="deconnexion.deconnecter"
        />
        <p v-if="deconnexion.erreur.value" role="alert" class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ deconnexion.erreur.value }}</span>
        </p>
      </section>

      <section class="flex flex-col items-center gap-3 pb-4">
        <UButton
          v-if="!suppressionOuverte"
          label="Supprimer mon compte"
          color="error"
          variant="link"
          size="lg"
          @click="suppressionOuverte = true"
        />
        <form v-else class="flex w-full flex-col gap-3" novalidate @submit.prevent="suppression.supprimer(saisie.trim())">
          <h2 class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Supprimer mon compte
          </h2>
          <p class="m-0 text-base text-texte-secondaire">
            Votre vitrine et tout son contenu seront supprimés définitivement. Cette action est irréversible.
          </p>
          <UFormField :label="`Pour confirmer, saisissez ${ACCOUNT_DELETION_PHRASE}`" name="confirmation" :error="suppression.erreur.value || undefined">
            <UInput v-model="saisie" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          </UFormField>
          <div class="flex flex-col gap-2 sm:flex-row">
            <UButton
              type="submit"
              label="Supprimer définitivement"
              color="error"
              :loading="suppression.enCours.value"
              :disabled="!phraseValide"
            />
            <UButton label="Annuler" variant="outline" color="neutral" :disabled="suppression.enCours.value" @click="annulerSuppression" />
          </div>
        </form>
      </section>
    </div>
  </div>
</template>
