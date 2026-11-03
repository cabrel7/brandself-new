<script setup lang="ts">
definePageMeta({ ssr: false })
useSeoMeta({ title: 'Se désabonner', robots: 'noindex, nofollow' })
// Le jeton est dans l'adresse : aucune page liée ne doit le recevoir en référent.
useHead({ meta: [{ name: 'referrer', content: 'no-referrer' }] })

const { etat, libelle, envoi, message, apercu, confirmer } = useDesabonnement()

onMounted(apercu)

// Le focus suit le titre à chaque changement d'état (lecteurs d'écran et clavier).
const titre = useTemplateRef<HTMLHeadingElement>('titre')
watch(etat, async () => {
  await nextTick()
  titre.value?.focus()
})

const { ready: squeletteVisible } = useTimeout(200, { controls: true })
</script>

<template>
  <main class="mx-auto flex w-full max-w-120 flex-col gap-4 px-6 pt-8 pb-12">
    <p class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) font-bold">Brandself</p>

    <div v-if="etat === 'chargement'" role="status" aria-busy="true" aria-label="Vérification de votre lien">
      <div v-if="squeletteVisible" class="flex flex-col gap-4 pt-8" aria-hidden="true">
        <USkeleton class="h-10 w-3/4" />
        <USkeleton class="h-6 w-full" />
        <USkeleton class="h-14 w-full" />
      </div>
    </div>

    <template v-else-if="etat === 'valide'">
      <h1 ref="titre" tabindex="-1" class="m-0 pt-8 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold outline-none">
        Ne plus recevoir {{ libelle }} ?
      </h1>
      <p class="m-0 text-base text-texte-secondaire">
        Vous pourrez le réactiver à tout moment dans votre compte.
      </p>
      <p v-if="message" role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ message }}</span>
      </p>
      <UButton
        :label="message ? 'Réessayer' : 'Me désabonner'"
        size="xl"
        block
        class="min-h-(--cible-tactile)"
        :loading="envoi"
        @click="confirmer"
      />
    </template>

    <template v-else-if="etat === 'succes'">
      <UIcon name="i-ph-check-circle" class="mt-8 size-10 text-accent" aria-hidden="true" />
      <h1 ref="titre" tabindex="-1" class="m-0 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold outline-none">
        C’est fait.
      </h1>
      <p class="m-0 text-base text-texte-secondaire">
        Vous ne recevrez plus {{ libelle }}.
      </p>
      <UButton label="Gérer mes e-mails" to="/studio/compte" variant="outline" size="xl" block class="min-h-(--cible-tactile)" />
    </template>

    <template v-else-if="etat === 'expire'">
      <h1 ref="titre" tabindex="-1" class="m-0 pt-8 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold outline-none">
        Ce lien a expiré.
      </h1>
      <p class="m-0 text-base text-texte-secondaire">
        Vous pouvez gérer vos e-mails depuis votre compte.
      </p>
      <UButton label="Me connecter" to="/connexion" size="xl" block class="min-h-(--cible-tactile)" />
    </template>

    <template v-else-if="etat === 'invalide'">
      <h1 ref="titre" tabindex="-1" class="m-0 pt-8 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold outline-none">
        Ce lien n’est pas valide.
      </h1>
      <p class="m-0 text-base text-texte-secondaire">
        Vous pouvez gérer vos e-mails depuis votre compte.
      </p>
      <UButton label="Me connecter" to="/connexion" size="xl" block class="min-h-(--cible-tactile)" />
    </template>

    <template v-else>
      <h1 ref="titre" tabindex="-1" class="m-0 pt-8 font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.15] font-bold outline-none">
        Une erreur est survenue.
      </h1>
      <p role="alert" class="message-erreur">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ message }}</span>
      </p>
      <UButton label="Réessayer" size="xl" block class="min-h-(--cible-tactile)" @click="apercu" />
    </template>
  </main>
</template>
