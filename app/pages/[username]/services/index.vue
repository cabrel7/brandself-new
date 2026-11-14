<script setup lang="ts">
const route = useRoute()
const username = String(route.params.username)

const [vitrine, { reponse, erreur }] = await Promise.all([usePublicVitrine(username), usePublicServices(username)])

if (erreur.value) throw erreurPagePublique(erreur.value)
// Une page n'existe que si elle a du contenu : sans service visible, 404.
if (!reponse.value || reponse.value.total === 0) throw erreurPagePublique({ statusCode: 404 })

const services = computed(() => reponse.value?.services ?? [])

useSeoVitrine({ vitrine: vitrine.value, page: 'services', servicesVisibles: services.value })
const fil = computed(() => [{ label: 'Accueil', to: `/${vitrine.value.username}` }, { label: 'Services' }])
</script>

<template>
  <VitrineCadre :vitrine="vitrine">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8 md:py-12">
      <div class="flex flex-col gap-4">
        <UBreadcrumb :items="fil" />
        <h1 class="font-(family-name:--font-titre) text-(length:--fs-32) leading-[1.1] font-bold md:text-(length:--fs-48)">
          Mes services
        </h1>
      </div>
      <ul class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <li v-for="service in services" :key="service.slug">
          <ServiceCarte :service="service" :username="vitrine.username" />
        </li>
      </ul>
    </div>
  </VitrineCadre>
</template>
