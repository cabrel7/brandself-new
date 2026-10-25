<script setup lang="ts">
import { useRouter } from '#app'

const router = useRouter()

const titre = ref<string>('')
const description = ref<string>('')
const type = ref<'rdv' | 'accompagnement' | 'atelier' | 'devis'>('rdv')
const dureeMin = ref<number>(30)
const tarif = ref<'gratuit' | 'payant' | 'devis'>('gratuit')
const prixMontant = ref<string>('')
const prixDevise = ref<string>('')
const reservable = ref<boolean>(true)
const enVedette = ref<boolean>(false)

const chargement = ref(false)
const erreur = ref('')

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

async function creerService() {
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
    if (body.tarif === 'payant' && prixMontant.value) {
      body.prixMontant = Number(prixMontant.value)
      body.prixDevise = prixDevise.value || 'XAF'
    }
    if (body.tarif === 'devis') {
      body.paiementMode = 'sur_place'
    }

    const reponse = await $fetch<{ service: { slug: string } }>('/api/studio/services', {
      method: 'POST',
      body,
    })

    await router.push(`/studio/services/${reponse.service?.slug}`)
  } catch (err: unknown) {
    erreur.value = err instanceof Error ? err.message : 'Une erreur est survenue.'
  } finally {
    chargement.value = false
  }
}
</script>

<template>
  <div class="studio">
    <BsTopNav actif="services" />

    <main class="studio__contenu">
      <section class="studio__en-tete">
        <h1>Nouveau service</h1>
        <p class="studio__sous-titre">Créez un service pour votre vitrine.</p>
      </section>

      <section class="studio__carte">
        <h2>Détails du service</h2>

        <BsField label="Titre" required>
          <input v-model="titre" type="text" placeholder="Consultation de cardiologie" required>
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
          <input v-model.number="dureeMin" type="number" min="5" placeholder="30" required>
        </BsField>

        <BsField label="Tarif">
          <select v-model="tarif">
            <option v-for="t in tarifs" :key="t.valeur" :value="t.valeur">{{ t.label }}</option>
          </select>
        </BsField>

        <div v-if="tarif === 'payant'" class="studio__champ">
          <BsField label="Prix (montant)">
            <input v-model="prixMontant" type="number" min="0" placeholder="5000">
          </BsField>
          <BsField label="Devise">
            <input v-model="prixDevise" type="text" placeholder="XAF" maxlength="3">
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
          <BsButton variant="principal" :disabled="chargement" @click="creerService">
            {{ chargement ? 'Création en cours…' : 'Créer le service' }}
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
