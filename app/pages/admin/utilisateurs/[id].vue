<script setup lang="ts">
import { ADMIN_PREFIXE_API } from '#shared/admin'
import { ABONNEMENT_FUSEAU_REPLI } from '#shared/plans'
import type { UtilisateurFicheDto } from '#shared/schemas/admin-a2'
import { etiquettesUtilisateur, messageDepuisErreurApi, valeurOuTiret } from '~/utils/admin-a2'
import type { IdActionA2 } from '~/utils/admin-a2'
import { LIBELLES_ORIGINE, libellesDatesAbonnement, formaterDate, formaterDateHeureAdmin, formaterNombre } from '~/utils/admin-paiements'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Utilisateur · Administration' })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data, status, error, refresh } = useFetch<UtilisateurFicheDto>(() => `${ADMIN_PREFIXE_API}/utilisateurs/${encodeURIComponent(id.value)}`, {
  key: computed(() => `admin-utilisateur-${id.value}`),
  server: false,
  lazy: true,
})
surveillerSessionAdmin(error)

const enChargement = computed(() => !data.value && !error.value && (status.value === 'pending' || status.value === 'idle'))
const introuvable = computed(() => !!error.value && lireErreurApi(error.value).statut === 404)
const messageErreur = computed(() => (error.value ? messageDepuisErreurApi(error.value) : ''))
const etiquettes = computed(() => (data.value ? etiquettesUtilisateur(data.value) : []))

const compteurs = computed(() => data.value
  ? [
      { libelle: 'Services', valeur: data.value.compteurs.services },
      { libelle: 'Réalisations', valeur: data.value.compteurs.realisations },
      { libelle: 'Témoignages', valeur: data.value.compteurs.temoignages },
      { libelle: 'Liens', valeur: data.value.compteurs.liens },
    ]
  : [])
const activite = computed(() => data.value
  ? [
      { libelle: 'Visites', valeur: data.value.activite30j.vues },
      { libelle: 'Réservations', valeur: data.value.activite30j.reservations },
      { libelle: 'Demandes', valeur: data.value.activite30j.demandes },
      { libelle: 'Messages', valeur: data.value.activite30j.messages },
    ]
  : [])

// Compte supprimé : la fiche n'existe plus, retour à la liste. Toute autre action recharge la fiche.
async function apresAction(action: IdActionA2): Promise<void> {
  if (action === 'supprimer') await navigateTo('/admin/utilisateurs')
  else await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <UButton to="/admin/utilisateurs" color="neutral" variant="link" size="lg" icon="i-ph-arrow-left" class="-ml-3 min-h-(--cible-tactile) self-start font-normal">
      Retour aux utilisateurs
    </UButton>

    <AdminRechercheEtats
      :chargement="enChargement"
      :erreur="!!error && !introuvable"
      :vide="introuvable"
      :message-erreur="messageErreur"
      icone="i-ph-user"
      titre-vide="Utilisateur introuvable"
      :description-vide="messageErreur"
      @reessayer="() => refresh()"
    >
      <template v-if="data">
        <header class="flex flex-col gap-2">
          <h2 class="m-0 font-(family-name:--font-titre) text-(length:--fs-24) leading-tight font-bold text-encre">
            {{ data.nom }}
          </h2>
          <p class="m-0 break-all text-base text-texte-secondaire">
            {{ data.email }}
          </p>
          <AdminUtilisateurEtiquettes :etiquettes="etiquettes" />
        </header>

        <UAlert
          v-if="data.suspendu"
          color="error"
          variant="soft"
          icon="i-ph-prohibit"
          title="Ce compte est suspendu."
          :description="data.motifSuspension ? `Motif communiqué au professionnel : ${data.motifSuspension}` : undefined"
        />

        <section aria-labelledby="titre-actions" class="flex flex-col gap-3">
          <h3 id="titre-actions" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Actions
          </h3>
          <AdminUtilisateurActions :utilisateur="data" @fait="apresAction" />
        </section>

        <section aria-labelledby="titre-identite" class="flex flex-col gap-3">
          <h3 id="titre-identite" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Compte
          </h3>
          <dl class="m-0 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Téléphone</dt>
              <dd class="m-0 text-encre">{{ valeurOuTiret(data.telephone) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Pays</dt>
              <dd class="m-0 text-encre">{{ valeurOuTiret(data.pays) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Devise</dt>
              <dd class="m-0 text-encre">{{ data.devise }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Fuseau</dt>
              <dd class="m-0 text-encre">{{ data.fuseau }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Inscrit le</dt>
              <dd class="m-0 text-encre">{{ formaterDate(data.inscritLe) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Dernière connexion</dt>
              <dd class="m-0 text-encre">{{ data.derniereConnexion ? formaterDateHeureAdmin(data.derniereConnexion) : 'Jamais' }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Vitrine</dt>
              <dd class="m-0">
                <UButton
                  v-if="data.username"
                  :to="{ path: '/admin/vitrines', query: { q: data.username } }"
                  color="neutral"
                  variant="link"
                  size="lg"
                  class="-ml-2.5 min-h-(--cible-tactile) font-medium"
                >
                  /{{ data.username }}
                </UButton>
                <span v-else class="text-encre">—</span>
              </dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="titre-abonnement" class="flex flex-col gap-3">
          <h3 id="titre-abonnement" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Abonnement
          </h3>
          <p v-if="!data.abonnement" class="m-0 text-base text-texte-secondaire">
            Aucun abonnement : plan gratuit.
          </p>
          <dl v-else class="m-0 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-3">
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Origine</dt>
              <dd class="m-0 text-encre">{{ LIBELLES_ORIGINE[data.abonnement.origine] }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">{{ libellesDatesAbonnement(data.abonnement.origine).fin }}</dt>
              <dd class="m-0 text-encre">{{ formaterDateHeureAdmin(data.abonnement.expireLe) }} ({{ ABONNEMENT_FUSEAU_REPLI }})</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">{{ libellesDatesAbonnement(data.abonnement.origine).debut }}</dt>
              <dd class="m-0 text-encre">{{ formaterDate(data.abonnement.premiereActivationLe) }}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="titre-contenu" class="flex flex-col gap-3">
          <h3 id="titre-contenu" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Vitrine et activité
          </h3>
          <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="compteur in compteurs" :key="compteur.libelle" class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">{{ compteur.libelle }}</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(compteur.valeur) }}</dd>
            </div>
          </dl>
          <p class="m-0 text-(length:--fs-14) text-texte-secondaire">30 derniers jours</p>
          <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="element in activite" :key="element.libelle" class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">{{ element.libelle }}</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(element.valeur) }}</dd>
            </div>
          </dl>
          <p class="m-0 text-base text-texte-secondaire">
            Utilisations de l’assistant d’écriture ce mois-ci : {{ formaterNombre(data.iaMois) }}
          </p>
        </section>

        <section aria-labelledby="titre-sessions" class="flex flex-col gap-3">
          <h3 id="titre-sessions" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Appareils connectés
          </h3>
          <p v-if="data.sessionsActives.length === 0" class="m-0 text-base text-texte-secondaire">
            Aucun appareil connecté.
          </p>
          <ul v-else class="m-0 flex list-none flex-col divide-y divide-bordure p-0">
            <li v-for="session in data.sessionsActives" :key="session.id" class="flex flex-col py-3">
              <span class="text-encre">Ouverte le {{ formaterDateHeureAdmin(session.creeLe) }}</span>
              <span class="text-(length:--fs-14) text-texte-secondaire">Expire le {{ formaterDateHeureAdmin(session.expireLe) }}</span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="titre-capacite" class="flex flex-col gap-3">
          <h3 id="titre-capacite" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Capacité des assistants
          </h3>
          <AdminCapaciteMcp :utilisateur-id="data.id" :capacites="data.capacites" @modifie="() => refresh()" />
        </section>

        <section aria-labelledby="titre-assistants" class="flex flex-col gap-3">
          <h3 id="titre-assistants" class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Assistants connectés
          </h3>
          <AdminAssistantListe :assistants="data.assistants" @retire="() => refresh()" />
        </section>
      </template>
    </AdminRechercheEtats>
  </div>
</template>
