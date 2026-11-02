<script setup lang="ts">
import type { DemandeCreatedDTO } from '#shared/dto'
import type { DemandeCreateInput } from '#shared/schemas/agenda'
import type { ServiceType } from '#shared/services'
import { CONTACT_EMAIL_MAX, CONTACT_NOM_MAX, MOTIF_MAX } from '#shared/agenda'
import { schemaDemandeCreate } from '#shared/schemas/agenda'

const props = defineProps<{
  username: string
  serviceSlug: string
  serviceTitre: string
  serviceType: ServiceType
  professionnel: string
}>()

type ChampDemande = 'nom' | 'email' | 'telephone' | 'message'
type ErreursDemande = Partial<Record<ChampDemande, string>>

const CHAMPS_DEMANDE: readonly ChampDemande[] = ['nom', 'email', 'telephone', 'message']
const TELEPHONE_MAX = 24
const form = reactive({ nom: '', email: '', telephone: '', message: '', siteWeb: '' })
const erreurs = ref<ErreursDemande>({})
const erreurGenerale = ref('')
const envoi = ref(false)
const envoyee = ref(false)
const honeypotId = `${useId()}-site-web`

const titre = computed(() => props.serviceType === 'atelier' ? 'Demandez votre inscription' : 'Parlez de votre besoin')
const aideMessage = computed(() => props.serviceType === 'atelier'
  ? 'Précisez vos attentes ou toute information utile.'
  : 'Décrivez brièvement votre projet ou votre besoin.')

function normaliserTelephone(value: string): string {
  return value.trim().replace(/[\s().-]/g, '')
}

function estChampDemande(value: string): value is ChampDemande {
  return CHAMPS_DEMANDE.some(champ => champ === value)
}

function viderErreur(champ: ChampDemande): void {
  if (erreurs.value[champ]) erreurs.value = { ...erreurs.value, [champ]: undefined }
}

function construireCorps(): Record<string, unknown> {
  const message = form.message.trim()
  return {
    service: props.serviceSlug,
    nom: form.nom.trim(),
    email: form.email.trim(),
    telephone: normaliserTelephone(form.telephone),
    siteWeb: form.siteWeb,
    ...(message === '' ? {} : { message }),
  }
}

function valider(): DemandeCreateInput | null {
  const resultat = schemaDemandeCreate.safeParse(construireCorps())
  if (resultat.success) return resultat.data
  const parChamp: ErreursDemande = {}
  for (const issue of resultat.error.issues) {
    const champ = String(issue.path[0] ?? '')
    if (estChampDemande(champ) && !parChamp[champ]) parChamp[champ] = issue.message
  }
  erreurs.value = parChamp
  if (Object.keys(parChamp).length === 0) erreurGenerale.value = 'Vérifiez les informations saisies.'
  return null
}

function rangerErreur(error: unknown): void {
  const api = lireErreurApi(error)
  if (api.code === 'VALIDATION') {
    const parChamp: ErreursDemande = {}
    for (const [champ, messages] of Object.entries(api.champs)) {
      if (estChampDemande(champ) && messages?.[0]) parChamp[champ] = messages[0]
    }
    erreurs.value = parChamp
    erreurGenerale.value = Object.keys(parChamp).length === 0 ? 'Vérifiez les informations saisies.' : ''
  }
  else if (api.code === 'TROP_DE_REQUETES') {
    erreurGenerale.value = 'Trop de demandes ont été envoyées. Attendez quelques instants avant de réessayer.'
  }
  else if (api.code === 'LIMITEUR_INDISPONIBLE') {
    erreurGenerale.value = 'Le formulaire est momentanément indisponible. Réessayez dans quelques instants.'
  }
  else {
    erreurGenerale.value = 'Nous n’avons pas pu envoyer votre demande. Vos informations sont gardées, réessayez.'
  }
}

async function envoyer(): Promise<void> {
  if (envoi.value) return
  erreurs.value = {}
  erreurGenerale.value = ''
  const corps = valider()
  if (!corps) return

  envoi.value = true
  try {
    await $fetch<DemandeCreatedDTO>(
      `/api/public/${encodeURIComponent(props.username)}/demandes`,
      { method: 'POST', body: corps },
    )
    form.nom = ''
    form.email = ''
    form.telephone = ''
    form.message = ''
    form.siteWeb = ''
    envoyee.value = true
  }
  catch (error) {
    rangerErreur(error)
  }
  finally {
    envoi.value = false
  }
}
</script>

<template>
  <section id="demande" class="scroll-mt-24 rounded-(--rayon-carte) border border-bordure bg-surface p-6 md:p-8" aria-labelledby="demande-titre">
    <div v-if="envoyee" class="flex flex-col items-start gap-4" role="status" aria-live="polite">
      <span class="flex size-14 items-center justify-center rounded-full bg-accent-doux text-accent">
        <UIcon name="i-ph-check" class="size-7" aria-hidden="true" />
      </span>
      <h2 id="demande-titre" class="text-(length:--fs-32) leading-tight font-bold">Votre demande est envoyée</h2>
      <p class="text-texte-secondaire">{{ professionnel }} vous répondra prochainement au sujet de « {{ serviceTitre }} ».</p>
    </div>

    <form v-else class="flex flex-col gap-6" novalidate @submit.prevent="envoyer">
      <div class="flex flex-col gap-2">
        <p class="text-(length:--fs-14) font-semibold tracking-widest text-accent-texte uppercase">{{ serviceTitre }}</p>
        <h2 id="demande-titre" class="text-(length:--fs-32) leading-tight font-bold">{{ titre }}</h2>
        <p class="text-texte-secondaire">{{ professionnel }} vous répondra personnellement.</p>
      </div>

      <div class="grid gap-5 md:grid-cols-2">
        <UFormField label="Nom complet" name="nom" required :error="erreurs.nom">
          <UInput
            v-model="form.nom"
            required
            autocomplete="name"
            :maxlength="CONTACT_NOM_MAX"
            :disabled="envoi"
            placeholder="Marie Ndzi"
            @update:model-value="viderErreur('nom')"
          />
        </UFormField>
        <UFormField label="Téléphone ou WhatsApp" name="telephone" required :error="erreurs.telephone">
          <UInput
            v-model="form.telephone"
            required
            type="tel"
            inputmode="tel"
            autocomplete="tel"
            :maxlength="TELEPHONE_MAX"
            :disabled="envoi"
            placeholder="+237 6 99 00 00 01"
            @update:model-value="viderErreur('telephone')"
          />
        </UFormField>
        <UFormField class="md:col-span-2" label="Email" name="email" required :error="erreurs.email">
          <UInput
            v-model="form.email"
            required
            type="email"
            inputmode="email"
            autocomplete="email"
            :maxlength="CONTACT_EMAIL_MAX"
            :disabled="envoi"
            placeholder="adresse@exemple.com"
            @update:model-value="viderErreur('email')"
          />
        </UFormField>
        <UFormField class="md:col-span-2" name="message" :error="erreurs.message" :help="aideMessage">
          <template #label>Votre message <span class="font-normal text-texte-secondaire">(facultatif)</span></template>
          <UTextarea
            v-model="form.message"
            :rows="5"
            :maxlength="MOTIF_MAX"
            :disabled="envoi"
            class="w-full"
            @update:model-value="viderErreur('message')"
          />
        </UFormField>
      </div>

      <div class="sr-only" aria-hidden="true">
        <label :for="honeypotId">Site web</label>
        <input :id="honeypotId" v-model="form.siteWeb" name="siteWeb" type="text" autocomplete="off" tabindex="-1">
      </div>

      <p v-if="erreurGenerale" class="message-erreur" role="alert" aria-live="assertive">
        <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
        <span>{{ erreurGenerale }}</span>
      </p>
      <UButton type="submit" label="Envoyer ma demande" :loading="envoi" block />
      <p class="text-(length:--fs-14) text-texte-secondaire">
        En envoyant, vous acceptez que vos informations soient transmises à {{ professionnel }} pour cette demande.
      </p>
    </form>
  </section>
</template>
