<script setup lang="ts">
definePageMeta({ layout: 'studio', ssr: false })
useSeoMeta({ title: 'Vos liens — Brandself' })

const liste = useTemplateRef<HTMLElement>('liste')
const {
  vitrine,
  enErreur: vitrineEnErreur,
  absente: vitrineAbsente,
  refresh: refreshVitrine,
} = useStudioVitrine()
const username = computed(() => vitrine.value?.username ?? '')
const {
  liens, compteurs, enChargement, enErreur, absente, vide, refresh,
  message, annonce, occupes, basculerVisibilite, deplacer,
} = useStudioLiens(liste)

const qrcodeOuverte = ref(false)
const qrcodeConteneur = useTemplateRef<HTMLElement>('qrcodeConteneur')
const annonceAction = ref('')

const urlPageLiens = computed(() => (username.value ? `${window.location.origin}/@${username.value}` : ''))

async function rafraichirPage(): Promise<void> {
  await Promise.all([refresh(), refreshVitrine()])
}

async function annoncerAction(message: string): Promise<void> {
  annonceAction.value = ''
  await nextTick()
  annonceAction.value = message
}

async function copierUrl(): Promise<boolean> {
  if (!urlPageLiens.value) {
    await annoncerAction('Adresse indisponible.')
    return false
  }
  try {
    await navigator.clipboard.writeText(urlPageLiens.value)
    await annoncerAction('Adresse copiée')
    return true
  }
  catch {
    await annoncerAction('Copie impossible.')
    return false
  }
}

function estAnnulationPartage(erreur: unknown): boolean {
  return typeof erreur === 'object' && erreur !== null && 'name' in erreur && erreur.name === 'AbortError'
}

/** Partage natif si disponible, repli sur la copie de l’adresse. */
async function partager(): Promise<void> {
  if (!urlPageLiens.value) {
    await annoncerAction('Adresse indisponible.')
    return
  }
  annonceAction.value = ''

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Ma page de liens', url: urlPageLiens.value })
      await annoncerAction('Partage terminé.')
      return
    }
    catch (erreur) {
      if (estAnnulationPartage(erreur)) return
      await copierUrl()
      return
    }
  }

  await copierUrl()
}

async function telechargerQrcode(): Promise<void> {
  let objectUrl: string | null = null
  let ancre: HTMLAnchorElement | null = null
  try {
    await nextTick()
    const svg = qrcodeConteneur.value?.querySelector<SVGSVGElement>('svg')
    if (!svg) throw new Error('QR code indisponible')

    const source = new XMLSerializer().serializeToString(svg)
    const fichier = new Blob([source], { type: 'image/svg+xml;charset=utf-8' })
    objectUrl = URL.createObjectURL(fichier)
    ancre = document.createElement('a')
    ancre.href = objectUrl
    ancre.download = `qr-code-brandself-${username.value}.svg`
    document.body.appendChild(ancre)
    ancre.click()
    await annoncerAction('QR code téléchargé.')
  }
  catch {
    await annoncerAction('Téléchargement impossible.')
  }
  finally {
    ancre?.remove()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}
</script>

<template>
  <div>
    <UEmpty
      v-if="absente || vitrineAbsente"
      icon="i-ph-storefront"
      title="Créons d’abord votre vitrine"
      description="Vos liens apparaissent ici dès que votre vitrine existe."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Créer ma vitrine', to: '/onboarding', size: 'xl' }]"
    />

    <UEmpty
      v-else-if="enErreur || vitrineEnErreur"
      icon="i-ph-warning-circle"
      title="Vos liens ne s’affichent pas"
      description="Nous n’avons pas pu les charger. Vos liens sont intacts."
      :as="{ title: 'h1' }"
      :actions="[{ label: 'Réessayer', size: 'xl', onClick: rafraichirPage }]"
    />

    <template v-else>
      <header class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h1 class="m-0 text-(length:--fs-32) leading-tight font-bold text-encre">Liens</h1>
          <p class="m-0 mt-1 text-base text-texte-secondaire">
            {{ (compteurs?.total ?? 0) }} {{ (compteurs?.total ?? 0) > 1 ? 'liens' : 'lien' }} · {{ (compteurs?.visibles ?? 0) }} visibles
          </p>
        </div>
        <UButton label="Ajouter" to="/studio/liens/nouveau" icon="i-ph-plus" size="lg" class="shrink-0" />
      </header>

      <section class="mt-6 rounded-(--rayon) border border-bordure bg-surface p-5 md:p-8">
        <h2 class="m-0 text-(length:--fs-14) font-bold tracking-wider text-accent-texte uppercase">Votre page de liens</h2>
        <div class="mt-3 flex items-center gap-2 rounded-(--rayon-interne) border border-bordure bg-champ px-4 py-3">
          <span class="min-w-0 truncate font-semibold text-encre">{{ urlPageLiens }}</span>
          <UButton
            v-if="urlPageLiens"
            icon="i-ph-copy"
            variant="ghost"
            color="neutral"
            size="lg"
            class="ms-auto min-h-(--cible-tactile) size-(--cible-tactile) shrink-0 p-0 justify-center"
            aria-label="Copier l’adresse de votre page de liens"
            @click="copierUrl"
          />
        </div>
        <div class="mt-3 grid grid-cols-2 gap-3">
          <UButton
            label="Partager"
            variant="outline"
            color="primary"
            size="lg"
            :disabled="!urlPageLiens"
            class="min-h-(--cible-tactile) justify-center"
            @click="partager"
          />
          <UButton
            v-if="urlPageLiens"
            label="QR code"
            variant="outline"
            color="primary"
            size="lg"
            class="min-h-(--cible-tactile) justify-center"
            @click="qrcodeOuverte = true"
          />
        </div>
        <p class="m-0 mt-4 text-(length:--fs-14) text-texte-secondaire">
          {{ (compteurs?.clicsSemaine ?? 0) }} clics cette semaine
        </p>
        <p
          v-if="annonceAction"
          role="status"
          aria-live="polite"
          class="m-0 mt-2 text-(length:--fs-14) font-medium text-encre"
        >
          {{ annonceAction }}
        </p>
      </section>

      <header class="mt-8 flex items-start justify-between gap-4">
        <div class="min-w-0">
          <h2 class="m-0 text-(length:--fs-24) leading-tight font-bold text-encre">Vos liens</h2>
        </div>
      </header>

      <p v-if="message" role="alert" class="message-erreur mt-4">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ message }}</span>
      </p>

      <div v-if="enChargement" role="status" class="mt-4 flex flex-col gap-4">
        <span class="sr-only">Chargement de vos liens</span>
        <USkeleton v-for="n in 4" :key="n" class="h-20 w-full" aria-hidden="true" />
      </div>

      <StudioVide
        v-else-if="vide"
        class="mt-4"
        icon="i-ph-link"
        title="Réunissez vos liens en une page"
        description="Ajoutez votre premier lien : site, réseaux sociaux, prise de rendez-vous… tout ce qui vous relie à vos clients."
        action-label="Ajouter un lien"
        action-to="/studio/liens/nouveau"
      />

      <ul v-else ref="liste" class="m-0 mt-4 list-none border-t border-bordure p-0">
        <StudioLienLigne
          v-for="lien in liens"
          :key="lien.id"
          :lien="lien"
          :occupe="occupes.includes(lien.id)"
          :triable="liens.length > 1"
          @basculer="(actif: boolean) => basculerVisibilite(lien.id, actif)"
          @deplacer="(sens: -1 | 1) => deplacer(lien.id, sens)"
        />
      </ul>
      <p v-if="!enChargement && !vide" class="m-0 mt-6 text-(length:--fs-14) text-texte-secondaire">
        Glissez les liens pour changer leur ordre. L’interrupteur masque un lien sans le supprimer.
      </p>
    </template>

    <p class="sr-only" aria-live="polite">{{ annonce }}</p>

    <UModal
      v-model:open="qrcodeOuverte"
      title="QR code de votre page de liens"
      description="Vos visiteurs peuvent le scanner pour ouvrir votre page de liens."
    >
      <template #body>
        <div ref="qrcodeConteneur" class="flex flex-col items-center gap-4 py-2">
          <Qrcode
            v-if="qrcodeOuverte && urlPageLiens"
            :value="urlPageLiens"
            :width="224"
            :height="224"
            aria-label="QR code de votre page de liens"
          />
        </div>
      </template>
      <template #footer="{ close }">
        <div class="grid w-full grid-cols-2 gap-3">
          <UButton
            label="Télécharger"
            icon="i-ph-download-simple"
            size="lg"
            class="justify-center"
            :disabled="!urlPageLiens"
            @click="telechargerQrcode"
          />
          <UButton label="Fermer" variant="outline" color="neutral" size="lg" class="justify-center" @click="close" />
        </div>
      </template>
    </UModal>
  </div>
</template>
