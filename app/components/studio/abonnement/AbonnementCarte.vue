<script setup lang="ts">
import { PLAN_LIBELLES } from '#shared/plans'

const props = defineProps<{
  /** Fuseau du compte : toutes les dates s'affichent dans ce fuseau (jamais celui du navigateur). */
  fuseau: string
  /** Devise du compte (`users.devise`). */
  deviseCompte: string
}>()

const route = useRoute()
const { abonnement, enChargement, enErreur, refresh } = useAbonnement()
const {
  periode, moyenId, telephone, paiement, etape, erreurs, devise, deviseOffre, devisesProposees,
  prixChoisi, moyens, moyenChoisi, payer, reessayer, verifierEncore, viderErreur,
} = usePaiementAbonnement(abonnement, refresh)

const etat = computed(() => abonnement.value?.etat ?? 'gratuit')
const offre = computed(() => abonnement.value?.offre ?? null)
const exposant = computed(() => deviseOffre.value?.exposant ?? 0)

const jourFin = computed(() => {
  const a = abonnement.value
  if (!a) return ''
  if (a.dernierJourInclus) return formaterJourLocal(a.dernierJourInclus)
  return a.expireLe ? dernierJourAvant(a.expireLe, props.fuseau) : ''
})
const jourFinGrace = computed(() => {
  const fin = abonnement.value?.graceJusquau
  return fin ? dernierJourAvant(fin, props.fuseau) : ''
})
const jourFinPaiement = computed(() => {
  const echeance = paiement.value?.abonnementExpireLe
  return echeance ? dernierJourAvant(echeance, props.fuseau) : jourFin.value
})

/** Quotas du plan gratuit : seules les ressources limitées sont listées. */
const quotas = computed(() => (abonnement.value?.quotas ?? []).filter((q) => q.limite !== null))

/** Résultat ou attente d'un paiement : prend la place du formulaire. */
const suivi = computed(() => {
  const courant = paiement.value
  const e = etape.value
  return courant && e !== 'saisie' && e !== 'envoi' ? { etape: e, paiement: courant } : null
})
const formulaireVisible = computed(() => suivi.value === null && offre.value?.paiementDisponible === true)
const abonne = computed(() => etat.value !== 'gratuit')
const legende = computed(() => (abonne.value ? 'Renouveler pour' : 'Choisir la durée'))
const action = computed(() => {
  if (abonne.value) return 'Renouveler maintenant'
  return prixChoisi.value && devise.value ? `Payer ${formaterMontant(prixChoisi.value.montant, devise.value, exposant.value)}` : 'Payer'
})
const afficherMention = computed(() => abonne.value || formulaireVisible.value)

// Lien « Voir l'abonnement » ou de rappel (`#abonnement`) : la carte arrive après le chargement de la page.
let ancreTraitee = false
watch(() => abonnement.value !== null, async (charge) => {
  if (!charge || ancreTraitee || route.hash !== '#abonnement') return
  ancreTraitee = true
  await nextTick()
  document.getElementById('abonnement')?.scrollIntoView({ block: 'start' })
}, { immediate: true })
</script>

<template>
  <section id="abonnement" aria-labelledby="titre-abonnement" class="scroll-mt-6">
    <BsCard>
      <div class="flex items-center justify-between gap-3">
        <h2 id="titre-abonnement" class="m-0 text-(length:--fs-20) font-semibold text-encre">
          Abonnement
        </h2>
        <UBadge
          v-if="abonnement"
          :color="abonne ? 'primary' : 'neutral'"
          :variant="abonne ? 'soft' : 'outline'"
          size="lg"
          :class="abonne ? 'bg-accent-doux font-semibold text-accent-texte' : ''"
        >
          {{ PLAN_LIBELLES[abonnement.plan] }}
        </UBadge>
      </div>

      <div v-if="enChargement" class="flex flex-col gap-3" aria-busy="true" aria-label="Chargement de votre abonnement">
        <USkeleton class="h-6 w-2/3" />
        <USkeleton class="h-4 w-1/3" />
        <USkeleton class="h-40 w-full" />
      </div>

      <div v-else-if="enErreur || !abonnement" class="flex flex-col items-start gap-3">
        <p role="alert" class="message-erreur">
          <UIcon name="i-ph-warning-circle" class="size-5 shrink-0" aria-hidden="true" />
          <span>{{ MESSAGE_ABONNEMENT_CHARGEMENT }}</span>
        </p>
        <UButton label="Réessayer" variant="outline" color="neutral" size="lg" class="min-h-(--cible-tactile)" @click="() => refresh()" />
      </div>

      <template v-else>
        <div v-if="etat === 'actif'" class="flex flex-col gap-1">
          <p class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Actif jusqu’au {{ jourFin }}
          </p>
          <p v-if="abonnement.joursRestants !== null" class="m-0 text-base text-texte-secondaire">
            {{ libelleJoursRestants(abonnement.joursRestants) }}
          </p>
        </div>

        <div v-else-if="etat === 'grace'" class="flex flex-col gap-1">
          <p class="m-0 text-(length:--fs-20) font-semibold text-encre">
            Votre abonnement est terminé.
          </p>
          <p class="m-0 text-base text-texte-secondaire">
            Vous gardez tout jusqu’au {{ jourFinGrace }}.
          </p>
        </div>

        <div v-else class="flex flex-col gap-3">
          <p class="m-0 text-base text-encre">
            Vous profitez du plan gratuit.
          </p>
          <dl v-if="quotas.length > 0" class="m-0 flex flex-col">
            <div v-for="quota in quotas" :key="quota.ressource" class="flex items-baseline justify-between gap-3 border-t border-bordure py-2">
              <dt class="text-base text-texte-secondaire">
                {{ LIBELLES_QUOTAS[quota.ressource] }}
              </dt>
              <dd class="m-0 text-base font-semibold text-encre">
                {{ quota.utilise }} sur {{ quota.limite }}
              </dd>
            </div>
          </dl>
        </div>

        <hr v-if="suivi || formulaireVisible || offre?.paiementDisponible === false" class="m-0 border-0 border-t border-bordure">

        <StudioAbonnementSuiviPaiement
          v-if="suivi"
          :etape="suivi.etape"
          :paiement="suivi.paiement"
          :jour-fin="jourFinPaiement"
          @reessayer="reessayer"
          @verifier="verifierEncore"
          @terminer="reessayer"
        />

        <StudioAbonnementFormulairePaiement
          v-else-if="formulaireVisible"
          v-model:periode="periode"
          v-model:moyen="moyenId"
          v-model:telephone="telephone"
          v-model:devise="devise"
          :legende="legende"
          :action="action"
          :devises="devisesProposees"
          :devise-compte="deviseCompte"
          :prix="deviseOffre?.prix ?? []"
          :exposant="exposant"
          :moyens="moyens"
          :moyen-choisi="moyenChoisi"
          :erreurs="erreurs"
          :envoi="etape === 'envoi'"
          @payer="payer"
          @vider-erreur="viderErreur"
        />

        <p v-else-if="offre?.paiementDisponible === false" class="message-info">
          <UIcon name="i-ph-clock" class="size-5 shrink-0" aria-hidden="true" />
          <span>Le paiement en ligne arrive bientôt.</span>
        </p>

        <p v-if="afficherMention" class="m-0 text-base text-texte-secondaire">
          Votre abonnement ne se renouvelle pas automatiquement. {{ phraseRappels() }}
        </p>
      </template>
    </BsCard>
  </section>
</template>
