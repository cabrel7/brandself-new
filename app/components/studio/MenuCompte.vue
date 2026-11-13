<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

// Menu de l'avatar (barre du haut, mobile et PC) : accès au profil, aux messages, au compte,
// aux assistants, publication / dépublication de la vitrine et déconnexion.
const { vitrine, publicationEnCours, changerPublication } = useStudioVitrine()
const { nonLus } = useStudioMessages()
const deconnexion = useDeconnexion()

const idNonLus = useId()
const menuOuvert = ref(false)
const depublicationOuverte = ref(false)
const erreurDepublication = ref('')
const messagePublication = ref('')
const profilIncomplet = ref(false)

const initiales = computed(() => {
  if (!vitrine.value) return ''
  return `${vitrine.value.prenom.charAt(0)}${vitrine.value.nom.charAt(0)}`.toUpperCase()
})

const messageErreur = computed(() => messagePublication.value || deconnexion.erreur.value)

watch(menuOuvert, (ouvert) => {
  if (ouvert) return
  messagePublication.value = ''
  profilIncomplet.value = false
  deconnexion.erreur.value = ''
})

async function publier(): Promise<void> {
  messagePublication.value = ''
  profilIncomplet.value = false
  const resultat = await changerPublication('publier')
  if (resultat.ok) {
    menuOuvert.value = false
    return
  }
  messagePublication.value = resultat.message
  profilIncomplet.value = resultat.manquants.length > 0
}

async function depublier(): Promise<void> {
  erreurDepublication.value = ''
  const resultat = await changerPublication('depublier')
  if (resultat.ok) depublicationOuverte.value = false
  else erreurDepublication.value = resultat.message
}

async function seDeconnecter(): Promise<void> {
  await deconnexion.deconnecter()
  if (!deconnexion.erreur.value) menuOuvert.value = false
}

function ouvrirDepublication(): void {
  erreurDepublication.value = ''
  depublicationOuverte.value = true
}

const groupes = computed<DropdownMenuItem[][]>(() => {
  const navigation: DropdownMenuItem[] = [
    { label: 'Profil', icon: 'i-ph-user', to: '/studio/profil' },
    { label: 'Messages', icon: 'i-ph-chat-circle-text', to: '/studio/messages', slot: 'messages' },
    { label: 'Compte', icon: 'i-ph-gear', to: '/studio/compte' },
    { label: 'Assistants', icon: 'i-ph-robot', to: '/studio/assistants' },
  ]

  const publication: DropdownMenuItem[] = []
  if (vitrine.value?.publiee) {
    publication.push({
      label: 'Dépublier ma vitrine',
      icon: 'i-ph-eye-slash',
      onSelect: ouvrirDepublication,
    })
  } else if (vitrine.value) {
    publication.push({
      label: 'Publier ma vitrine',
      icon: 'i-ph-rocket-launch',
      loading: publicationEnCours.value,
      disabled: publicationEnCours.value,
      // Le menu reste ouvert : l'éventuel message d'échec s'affiche dedans.
      onSelect: (evenement) => {
        evenement.preventDefault()
        void publier()
      },
    })
  }

  const session: DropdownMenuItem[] = [{
    label: 'Se déconnecter',
    icon: 'i-ph-sign-out',
    loading: deconnexion.enCours.value,
    disabled: deconnexion.enCours.value,
    onSelect: (evenement) => {
      evenement.preventDefault()
      void seDeconnecter()
    },
  }]

  return [navigation, publication, session].filter((groupe) => groupe.length > 0)
})
</script>

<template>
  <div>
    <UDropdownMenu
      v-model:open="menuOuvert"
      :items="groupes"
      :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
      :ui="{ content: 'min-w-60', item: 'min-h-(--cible-tactile) text-base' }"
    >
      <button
        type="button"
        aria-label="Votre menu"
        :aria-describedby="nonLus > 0 ? idNonLus : undefined"
        class="relative inline-flex size-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 transition-shadow hover:ring-2 hover:ring-bordure"
        :class="{ 'ring-2 ring-accent': menuOuvert }"
      >
        <UAvatar :text="initiales || undefined" icon="i-ph-user" size="lg" aria-hidden="true" />
        <template v-if="nonLus > 0">
          <span
            class="absolute top-0.5 right-0.5 size-3 rounded-full border-2 border-fond bg-accent"
            aria-hidden="true"
          />
          <span :id="idNonLus" class="sr-only">{{ nonLus }} {{ nonLus > 1 ? 'messages non lus' : 'message non lu' }}</span>
        </template>
      </button>

      <template #messages-trailing>
        <span
          v-if="nonLus > 0"
          class="inline-flex min-w-6 items-center justify-center rounded-full bg-accent px-2 text-(length:--fs-14) leading-6 font-semibold text-sur-accent"
        >
          <span aria-hidden="true">{{ nonLus }}</span>
          <span class="sr-only">{{ nonLus > 1 ? 'non lus' : 'non lu' }}</span>
        </span>
      </template>

      <template #content-bottom>
        <div v-if="messageErreur" class="flex flex-col items-start gap-1 border-t border-bordure p-3">
          <p role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ messageErreur }}</span>
          </p>
          <UButton
            v-if="profilIncomplet"
            label="Compléter mon profil"
            to="/studio/profil"
            variant="link"
            size="lg"
            class="min-h-(--cible-tactile)"
            @click="menuOuvert = false"
          />
        </div>
      </template>
    </UDropdownMenu>

    <UModal
      v-model:open="depublicationOuverte"
      title="Dépublier votre vitrine ?"
      description="Elle ne sera plus visible tant que vous ne l’aurez pas publiée de nouveau."
      :dismissible="!publicationEnCours"
    >
      <template #footer="{ close }">
        <div class="flex w-full flex-col gap-3">
          <p v-if="erreurDepublication" role="alert" class="message-erreur">
            <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
            <span>{{ erreurDepublication }}</span>
          </p>
          <div class="flex flex-col gap-2 sm:flex-row-reverse">
            <UButton
              label="Dépublier"
              color="error"
              class="min-h-(--cible-tactile) justify-center"
              :loading="publicationEnCours"
              :disabled="publicationEnCours"
              @click="depublier"
            />
            <UButton
              label="Annuler"
              variant="outline"
              color="neutral"
              class="min-h-(--cible-tactile) justify-center"
              :disabled="publicationEnCours"
              @click="close"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
