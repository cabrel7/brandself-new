<script setup lang="ts">
import { formaterDateHeureAdmin, formaterNombre } from '~/utils/admin-paiements'
import {
  ANCRES_SUPERVISION,
  ETIQUETTES_SANTE,
  ETIQUETTES_SAUVEGARDE,
  LIBELLES_MOTIF_REPLI,
  LIBELLES_PWA_APPAREIL,
  LIBELLES_PWA_ORIGINE,
  LIBELLES_PWA_TYPE,
  LIBELLES_STATUT_IA,
  LIBELLES_TYPE_IA,
  LIBELLE_SANS_FOURNISSEUR,
  PERIODES_AGREGATS,
  PERIODES_ENVOIS,
  formaterAgeSupervision,
  formaterDureeSupervision,
  formaterOctetsSupervision,
  formaterTauxSupervision,
  listerPointsSupervision,
  optionsPeriodes,
  tronquerIdentifiant,
} from '~/utils/admin-supervision'
import { UI_CHAMP_TACTILE } from '~/utils/admin-ui'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useSeoMeta({ title: 'Systèmes · Administration' })

const {
  sante, files, envois, ia, pwa, assistants,
  joursEnvois, joursAgregats, actualiserTout, actualisationEnCours,
  dialogue, dialogueOuvert, enCours, erreur, ouvrirRelance, ouvrirPurge, confirmer,
} = useAdminSupervision()

const optionsEnvois = optionsPeriodes(PERIODES_ENVOIS)
const optionsAgregats = optionsPeriodes(PERIODES_AGREGATS)

const points = computed(() => listerPointsSupervision(sante.data.value ?? undefined, files.data.value ?? undefined))

const disque = computed(() => {
  const d = sante.data.value?.disque
  if (!d || d.libreOctets === null || d.totalOctets === null) return 'Taille inconnue'
  const pct = d.libresPct === null ? '' : ` (${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(d.libresPct)} % libre)`
  return `${formaterOctetsSupervision(d.libreOctets)} libres sur ${formaterOctetsSupervision(d.totalOctets)}${pct}`
})

const sauvegardeDetail = computed(() => {
  const s = sante.data.value?.sauvegarde
  if (!s || s.derniereReussiteLe === null) return 'Aucune sauvegarde enregistrée.'
  return `Le ${formaterDateHeureAdmin(s.derniereReussiteLe)} (il y a ${formaterAgeSupervision(s.ageHeures)})`
})

function latence(valeur: number | null): string | undefined {
  return valeur === null ? undefined : `Réponse en ${valeur} ms`
}

const statutsIa = computed(() => (ia.data.value?.parStatut ?? []).map((l) => ({ id: l.statut, libelle: LIBELLES_STATUT_IA[l.statut], nombre: l.nombre })))
const motifsIa = computed(() => (ia.data.value?.parMotifRepli ?? []).map((l) => ({ id: l.motif, libelle: LIBELLES_MOTIF_REPLI[l.motif], nombre: l.nombre })))
const typesIa = computed(() => (ia.data.value?.parType ?? []).map((l) => ({ id: l.type, libelle: LIBELLES_TYPE_IA[l.type], nombre: l.nombre })))
const fournisseursIa = computed(() => (ia.data.value?.parFournisseur ?? []).map((l) => ({ id: l.fournisseur ?? 'aucun', libelle: l.fournisseur ?? LIBELLE_SANS_FOURNISSEUR, nombre: l.nombre })))
const outils = computed(() => (assistants.data.value?.parOutil ?? []).map((l) => ({ id: l.outil, libelle: l.outil, nombre: l.nombre })))
const parAssistant = computed(() => (assistants.data.value?.parAssistant ?? []).map((l) => ({ id: l.assistantId, libelle: tronquerIdentifiant(l.assistantId), nombre: l.nombre })))
const erreursEnvoi = computed(() => (envois.data.value?.erreurs ?? []).map((l) => ({ id: l.codeErreur, libelle: l.codeErreur, nombre: l.nombre })))

const pwaParType = computed(() => {
  const totaux = { proposee: 0, installee: 0, refusee: 0 }
  for (const ligne of pwa.data.value?.lignes ?? []) totaux[ligne.type] += ligne.nombre
  return (Object.keys(totaux) as Array<keyof typeof totaux>).map((type) => ({ id: type, libelle: LIBELLES_PWA_TYPE[type], nombre: totaux[type] }))
})
const pwaDetail = computed(() => (pwa.data.value?.lignes ?? []).map((l) => ({
  id: `${l.type}-${l.origine}-${l.deviceType}`,
  libelle: `${LIBELLES_PWA_TYPE[l.type]} · ${LIBELLES_PWA_ORIGINE[l.origine]} · ${LIBELLES_PWA_APPAREIL[l.deviceType]}`,
  nombre: l.nombre,
})))

const quotaGratuit = computed(() => {
  const quota = ia.data.value?.quotaGratuitMois
  if (quota === undefined) return ''
  return quota === null ? 'Plan gratuit : propositions illimitées.' : `Plan gratuit : ${formaterNombre(quota)} propositions par mois.`
})
</script>

<template>
  <div class="flex flex-col gap-10">
    <div class="flex justify-end">
      <UButton
        color="neutral"
        variant="outline"
        size="lg"
        icon="i-ph-arrow-clockwise"
        class="min-h-(--cible-tactile)"
        :loading="actualisationEnCours"
        @click="actualiserTout"
      >
        Actualiser
      </UButton>
    </div>

    <AdminSupervisionAlerte :points="points" />

    <AdminSupervisionPartie
      :id="ANCRES_SUPERVISION.sante"
      titre="Santé"
      :chargement="sante.chargement.value"
      :erreur="sante.erreur.value"
      :message-erreur="sante.message.value"
      @reessayer="sante.refresh"
    >
      <template v-if="sante.data.value">
        <div class="flex flex-col divide-y divide-bordure border-y border-bordure">
          <AdminSanteLigne libelle="Base de données" :etiquette="ETIQUETTES_SANTE[sante.data.value.base.etat]" :detail="latence(sante.data.value.base.latenceMs)" />
          <AdminSanteLigne libelle="Redis" :etiquette="ETIQUETTES_SANTE[sante.data.value.redis.etat]" :detail="latence(sante.data.value.redis.latenceMs)" />
          <AdminSanteLigne libelle="Stockage des images" :etiquette="ETIQUETTES_SANTE[sante.data.value.disque.etat]" :detail="disque" />
          <AdminSanteLigne libelle="Dernière sauvegarde" :etiquette="ETIQUETTES_SAUVEGARDE[sante.data.value.sauvegarde.etat]" :detail="sauvegardeDetail" />
        </div>
        <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
          Version {{ sante.data.value.version }} · relevé du {{ formaterDateHeureAdmin(sante.data.value.genereLe) }}
        </p>
      </template>
    </AdminSupervisionPartie>

    <AdminSupervisionPartie
      :id="ANCRES_SUPERVISION.files"
      titre="Files de tâches"
      :chargement="files.chargement.value"
      :erreur="files.erreur.value"
      :message-erreur="files.message.value"
      @reessayer="files.refresh"
    >
      <template v-if="files.data.value">
        <div class="flex flex-col divide-y divide-bordure border-y border-bordure">
          <AdminFileLigne
            v-for="file in files.data.value.files"
            :key="file.file"
            :file="file"
            :seuil="files.data.value.seuilEchecs15Min"
            @relancer="(job) => ouvrirRelance(file.file, job)"
            @purger="ouvrirPurge(file.file)"
          />
        </div>
        <p class="m-0 text-(length:--fs-14) text-texte-secondaire">
          Alerte à partir de {{ files.data.value.seuilEchecs15Min }} échecs définitifs en 15 minutes dans une même file.
        </p>
      </template>
    </AdminSupervisionPartie>

    <AdminSupervisionPartie
      id="envois"
      titre="Envois de codes de connexion"
      :chargement="envois.chargement.value"
      :erreur="envois.erreur.value"
      :message-erreur="envois.message.value"
      @reessayer="envois.refresh"
    >
      <template #actions>
        <UFormField label="Période" name="periode-envois">
          <USelect v-model="joursEnvois" :items="optionsEnvois" :ui="UI_CHAMP_TACTILE" class="w-48 max-w-full" />
        </UFormField>
      </template>
      <template v-if="envois.data.value">
        <p class="m-0 text-base text-encre">
          {{ formaterNombre(envois.data.value.total.envoyes) }} envoyés, {{ formaterNombre(envois.data.value.total.echecs) }} en échec
          ({{ formaterTauxSupervision(envois.data.value.total.echecs, envois.data.value.total.envoyes + envois.data.value.total.echecs) }}).
        </p>
        <p v-if="envois.data.value.lignes.length === 0" class="m-0 text-base text-texte-secondaire">
          Aucun envoi sur la période.
        </p>
        <div v-else class="flex flex-col divide-y divide-bordure border-y border-bordure">
          <AdminEnvoiLigne v-for="ligne in envois.data.value.lignes" :key="`${ligne.canal}-${ligne.pays ?? 'aucun'}`" :ligne="ligne" />
        </div>
        <AdminSupervisionCompteurs v-if="erreursEnvoi.length > 0" titre="Codes d’erreur les plus fréquents" :elements="erreursEnvoi" />
      </template>
    </AdminSupervisionPartie>

    <div class="flex flex-col gap-10">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <p class="m-0 max-w-prose text-base text-texte-secondaire">
          Les trois parties suivantes portent sur la même période.
        </p>
        <UFormField label="Période" name="periode-agregats">
          <USelect v-model="joursAgregats" :items="optionsAgregats" :ui="UI_CHAMP_TACTILE" class="w-48 max-w-full" />
        </UFormField>
      </div>

      <AdminSupervisionPartie
        id="ia"
        titre="Propositions d’IA"
        :chargement="ia.chargement.value"
        :erreur="ia.erreur.value"
        :message-erreur="ia.message.value"
        @reessayer="ia.refresh"
      >
        <template v-if="ia.data.value">
          <dl class="m-0 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Demandes</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(ia.data.value.total) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Durée moyenne</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterDureeSupervision(ia.data.value.dureeMoyenneMs) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Jetons envoyés</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(ia.data.value.tokensEntree) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Jetons reçus</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(ia.data.value.tokensSortie) }}</dd>
            </div>
          </dl>
          <p class="m-0 text-base text-encre">
            Injections suspectées : {{ formaterNombre(ia.data.value.injectionsSuspectees) }}
          </p>
          <p class="m-0 text-base text-texte-secondaire">
            {{ quotaGratuit }}
            <NuxtLink to="/admin/versions" class="font-medium underline underline-offset-4">page Versions</NuxtLink>
          </p>
          <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <AdminSupervisionCompteurs titre="Par statut" :elements="statutsIa" />
            <AdminSupervisionCompteurs titre="Motifs de repli" :elements="motifsIa" vide="Aucun repli sur la période." />
            <AdminSupervisionCompteurs titre="Par usage" :elements="typesIa" />
            <AdminSupervisionCompteurs titre="Par fournisseur" :elements="fournisseursIa" />
          </div>
          <div class="flex flex-col gap-1">
            <h3 class="m-0 text-base font-semibold text-texte-secondaire">
              Comptes les plus actifs
            </h3>
            <p v-if="ia.data.value.consommateurs.length === 0" class="m-0 text-base text-texte-secondaire">
              Aucune demande sur la période.
            </p>
            <ul v-else class="m-0 flex list-none flex-col divide-y divide-bordure border-y border-bordure p-0">
              <li v-for="compte in ia.data.value.consommateurs" :key="compte.utilisateurId" class="flex min-h-(--cible-tactile) items-center justify-between gap-4 py-1">
                <NuxtLink
                  :to="`/admin/utilisateurs/${encodeURIComponent(compte.utilisateurId)}`"
                  class="flex min-h-(--cible-tactile) items-center font-medium underline underline-offset-4"
                  :title="compte.utilisateurId"
                >
                  {{ tronquerIdentifiant(compte.utilisateurId) }}
                </NuxtLink>
                <span class="font-semibold text-encre">{{ formaterNombre(compte.nombre) }}</span>
              </li>
            </ul>
          </div>
        </template>
      </AdminSupervisionPartie>

      <AdminSupervisionPartie
        id="pwa"
        titre="Installation du studio"
        :chargement="pwa.chargement.value"
        :erreur="pwa.erreur.value"
        :message-erreur="pwa.message.value"
        @reessayer="pwa.refresh"
      >
        <template v-if="pwa.data.value">
          <p v-if="pwa.data.value.total === 0" class="m-0 text-base text-texte-secondaire">
            Aucun événement d’installation sur la période.
          </p>
          <div v-else class="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <AdminSupervisionCompteurs titre="Total" :elements="pwaParType" />
            <AdminSupervisionCompteurs titre="Détail" :elements="pwaDetail" />
          </div>
        </template>
      </AdminSupervisionPartie>

      <AdminSupervisionPartie
        id="assistants"
        titre="Assistants connectés"
        :chargement="assistants.chargement.value"
        :erreur="assistants.erreur.value"
        :message-erreur="assistants.message.value"
        @reessayer="assistants.refresh"
      >
        <template v-if="assistants.data.value">
          <dl class="m-0 grid grid-cols-3 gap-3">
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Appels</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(assistants.data.value.total) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Comptes actifs</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(assistants.data.value.comptesActifs) }}</dd>
            </div>
            <div class="flex flex-col">
              <dt class="text-(length:--fs-14) text-texte-secondaire">Capacités accordées</dt>
              <dd class="m-0 text-(length:--fs-20) font-semibold text-encre">{{ formaterNombre(assistants.data.value.capacitesActives) }}</dd>
            </div>
          </dl>
          <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <AdminSupervisionCompteurs titre="Par outil" :elements="outils" />
            <AdminSupervisionCompteurs titre="Par assistant" :elements="parAssistant" />
          </div>
        </template>
      </AdminSupervisionPartie>
    </div>

    <AdminSupervisionConfirmation
      v-if="dialogue"
      v-model:open="dialogueOuvert"
      :titre="dialogue.titre"
      :description="dialogue.description"
      :libelle-action="dialogue.libelleAction"
      :reauth="dialogue.reauth"
      :action="dialogue.action"
      :cible-type="dialogue.cibleType"
      :cible-id="dialogue.cibleId"
      :destructive="dialogue.destructive"
      :en-cours="enCours"
      :erreur="erreur"
      @confirmer="confirmer"
    />
  </div>
</template>
