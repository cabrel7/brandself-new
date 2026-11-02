<script setup lang="ts">
import type { SujetMessage } from '#shared/message'
import { SUJET_LIBELLES } from '#shared/message'

definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Messages — Brandself' })

const {
  messages,
  nonLus,
  idDeplie,
  basculer,
  erreurMarquageLu,
  enChargement,
  enErreur,
  absente,
  rafraichir,
} = useStudioMessages()

function plurielNonLus(nombre: number): string {
  return nombre > 1 ? 'non lus' : 'non lu'
}

function libelleSujet(sujet: string): string {
  return Object.hasOwn(SUJET_LIBELLES, sujet) ? SUJET_LIBELLES[sujet as SujetMessage] : sujet
}

// L'email du visiteur est encodé : un « ? » ou un « & » valide dans une adresse ne doit pas
// ajouter de paramètres (cc, bcc, body) au lien mailto.
function lienMail(email: string): string {
  return `mailto:${encodeURIComponent(email)}`
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <StudioRetour to="/studio" label="Vitrine" />

    <div v-if="enChargement" role="status" aria-label="Chargement de vos messages">
      <div class="flex flex-col gap-3" aria-hidden="true">
        <USkeleton class="h-10 w-48" />
        <USkeleton class="h-5 w-24" />
      </div>
      <div class="mt-6 flex flex-col gap-4" aria-hidden="true">
        <USkeleton v-for="n in 3" :key="n" class="h-24 w-full" />
      </div>
    </div>

    <UEmpty
      v-else-if="absente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos messages apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur"
      icon="i-ph-warning-circle"
      title="Vos messages ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Aucun message n’est perdu."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: rafraichir }]"
    />

    <template v-else>
      <header>
        <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">
          Messages
        </h1>
        <p class="m-0 mt-1 text-base text-texte-secondaire" aria-live="polite">
          {{ nonLus > 0 ? `${nonLus} ${plurielNonLus(nonLus)}` : 'Tout est lu' }}
        </p>
      </header>

      <UAlert
        v-if="erreurMarquageLu"
        role="alert"
        aria-live="assertive"
        color="error"
        variant="soft"
        icon="i-ph-warning-circle"
        :description="erreurMarquageLu.texte"
      />

      <UEmpty
        v-if="messages.length === 0"
        icon="i-ph-chat-circle-dots"
        title="Aucun message pour l’instant"
        description="Ils arrivent surtout après la mise en ligne de votre vitrine."
        class="rounded-(--rayon) border border-bordure bg-surface"
      />

      <ul v-else class="m-0 list-none border-t border-bordure p-0">
        <li v-for="message in messages" :key="message.id" class="border-b border-bordure">
          <button
            type="button"
            class="flex w-full items-start gap-4 py-4 text-left transition-colors hover:bg-surface"
            :aria-expanded="idDeplie === message.id"
            :aria-controls="`message-detail-${message.id}`"
            @click="basculer(message.id)"
          >
            <span
              class="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-doux font-(family-name:--font-titre) text-lg font-semibold text-accent-texte"
              aria-hidden="true"
            >
              {{ message.initiale }}
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-3">
                <span class="truncate font-bold text-encre">{{ message.nom }}</span>
                <span class="flex shrink-0 items-center gap-2 text-(length:--fs-14) text-texte-secondaire">
                  {{ message.dateRelative }}
                  <span
                    v-if="message.luLe === null"
                    class="size-2 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                </span>
              </span>
              <span class="mt-1 line-clamp-2 block text-base text-texte-secondaire">{{ message.message }}</span>
            </span>
          </button>

          <div
            v-if="idDeplie === message.id"
            :id="`message-detail-${message.id}`"
            class="pb-5 pl-16"
          >
            <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
              Sujet : <span class="font-semibold text-encre">{{ libelleSujet(message.sujet) }}</span>
            </p>
            <p class="m-0 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-(length:--fs-14)">
              <a
                :href="lienMail(message.email)"
                class="break-all text-texte-secondaire underline-offset-4 hover:underline"
              >{{ message.email }}</a>
              <a
                v-if="message.telephone"
                :href="`tel:${message.telephone}`"
                class="text-texte-secondaire underline-offset-4 hover:underline"
              >{{ message.telephone }}</a>
            </p>
            <p class="m-0 mt-3 text-base whitespace-pre-line text-encre">{{ message.message }}</p>
          </div>
        </li>
      </ul>

      <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
        Les messages arrivent aussi par email. Répondez directement depuis votre messagerie.
      </p>
    </template>
  </div>
</template>
