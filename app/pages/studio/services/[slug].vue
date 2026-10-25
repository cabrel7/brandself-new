<script setup lang="ts">
import { useRouter } from '#app'

const router = useRouter()

const route = useRoute()
const slug = route.params.slug as string

interface Service {
  id: string
  vitrineId: string
  slug: string
  titre: string
  description?: string
  type: string
  nbSeances?: number
  rythme?: string
  dureeMin: number
  tarif: string
  prixMontant?: number
  prixDevise?: string
  paiementMode?: string
  paiementInstructions?: string
  reservable: boolean
  enVedette: boolean
  ordre: number
  actif: boolean
}

const service = ref<Service | null>(null)
const chargement = ref(true)
const erreur = ref('')

const titre = ref('')
const description = ref('')
const type = ref<'rdv' | 'accompagnement' | 'atelier' | 'devis'>('rdv')
const dureeMin = ref(30)
const tarif = ref<'gratuit' | 'payant' | 'devis'>('gratuit')
const prixMontant = ref<string>('')
const prixDevise = ref<string>('')
const reservable = ref<boolean>(true)
const enVedette = ref<boolean>(false)

const types = [
  { valeur: 'rdv', label: 'Rendez-vous ponctuel' },
  { valeur: 'accompagnement', label: 'Accompagnement' },
  { valeur: 'atelier', label: 'Atelier / formation' },
  { valeur: 'devis', label: 'Prestation sur devis' },
]

const tarifs = [
  { valeur: 'gratuit', label: 'Gratuit' },
  { valeur: 'payant', label: 'Payant' },
  { valeur: 'devis', label: 'Sur devis' },
]

async function chargerService() {
  chargement.value = true
  try {
    const reponse = await $fetch<{ service: Service }>(`/api/studio/services/${slug}`)
    service.value = reponse.service
    titre.value = reponse.service.titre
    description.value = reponse.service.description || ''
    type.value = (reponse.service.type as 'rdv' | 'accompagnement' | 'atelier' | 'devis')
    dureeMin.value = reponse.service.dureeMin
    tarif.value = (reponse.service.tarif as 'gratuit' | 'payant' | 'devis')
    prixMontant.value = reponse.service.prixMontant?.toString() || ''
    prixDevise.value = reponse.service.prixDevise || ''
    reservable.value = reponse.service.reservable
    enVedette.value = reponse.service.enVedette
  } catch {
    erreur.value = 'Impossible de charger le service.'
  } finally {
    chargement.value = false
  }
}

async function modifierService() {
  erreur.value = ''
  chargement.value = true
  try {
    const body: Record<string, unknown> = {
      titre,
      description,
      type: type.value,
      dureeMin: dureeMin.value,
      tarif: tarif.value,
      reservable: reservable.value,
      enVedette: enVedette.value,
    }
    if (tarif.value === 'payant' && prixMontant.value) {
      body.prixMontant = Number(prixMontant.value)
      body.prixDevise = prixDevise.value || 'XAF'
    }
    if (tarif.value === 'devis') {
      body.paiementMode = 'sur_place'
    }

    const reponse = await fetch(`/api/studio/services/${slug}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!reponse.ok) throw new Error('Modification refusée')

    await router.push('/studio/services')
  } catch (err: unknown) {
    erreur.value = err instanceof Error ? err.message : 'Une erreur est survenue.'
  } finally {
    chargement.value = false
  }
}

onMounted(() => {
  chargerService()
})
</script>

<template>
  <div class="studio">
    <BsTopNav actif="services" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <h1>Modifier le service</h1>
        <p class="studio__sous-titre">Modifiez les informations de votre service.</p>
      </section>

      <section class="studio__carte">
        <h2>Détails du service</h2>

        <BsField label="Titre" required>
          <input v-model="titre" type="text" required>
        </BsField>

        <BsField label="Description">
          <textarea v-model="description" placeholder="Décrivez votre service…" rows="3" />
        </BsField>

        <BsField label="Type de service">
          <select v-model="type">
            <option v-for="t in types" :key="t.valeur" :value="t.valeur">{{ t.label }}</option>
          </select>
        </BsField>

        <BsField label="Durée (minutes)">
          <input v-model.number="dureeMin" type="number" min="5" required>
        </BsField>

        <BsField label="Tarif">
          <select v-model="tarif">
            <option v-for="t in tarifs" :key="t.valeur" :value="t.valeur">{{ t.label }}</option>
          </select>
        </BsField>

        <div v-if="tarif === 'payant'" class="studio__champ">
          <BsField label="Prix (montant)">
            <input v-model="prixMontant" type="number" min="0">
          </BsField>
          <BsField label="Devise">
            <input v-model="prixDevise" type="text" maxlength="3">
          </BsField>
        </div>

        <div class="studio__interrupteurs">
          <label class="interrupteur-label">
            <BsSwitch v-model="reservable" label="Réservable en ligne" />
          </label>
          <label class="interrupteur-label">
            <BsSwitch v-model="enVedette" label="En vedette sur l'accueil" />
          </label>
        </div>

        <p v-if="erreur" class="erreur" role="alert">{{ erreur }}</p>

        <div class="studio__actions">
          <BsButton variant="contour" to="/studio/services">Annuler</BsButton>
          <BsButton variant="principal" :disabled="chargement" @click="modifierService">
            {{ chargement ? 'Enregistrement…' : 'Enregistrer les modifications' }}
          </BsButton>
        </div>
      </section>
    </main>

    <BsBottomNav actif="services" />
  </div>
</template>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--fond);
}
.studio__contenu {
  flex: 1;
  padding: 1.5rem;
  max-width: 28rem;
  margin: 0 auto;
}
.studio__en-tete {
  margin-bottom: 2rem;
}
.studio__en-tete h1 {
  font-family: var(--font-titre);
  font-size: 2rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 0.5rem 0;
}
.studio__sous-titre {
  color: var(--texte-secondaire);
  font-size: 0.95rem;
  margin: 0;
}
.studio__carte {
  background-color: var(--surface);
  border: 1px solid var(--bordure);
  border-radius: 1rem;
  padding: 1.25rem;
}
.studio__carte h2 {
  font-family: var(--font-titre);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1rem 0;
}
.studio__actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1rem;
}
.erreur {
  color: var(--erreur);
  font-size: 0.9rem;
  margin-bottom: 1rem;
}
.studio__interrupteurs {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--bordure);
}
.interrupteur-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.85rem;
  color: var(--encre);
  cursor: pointer;
}
textarea {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid var(--bordure);
  border-radius: 0.75rem;
  background-color: var(--surface);
  font-family: var(--font-texte);
  font-size: 1rem;
  resize: vertical;
}
</style>
