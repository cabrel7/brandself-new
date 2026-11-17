<script setup lang="ts">
// « Être contacté » : agenda utilisable DE DÉMONSTRATION. Aucun appel réseau, aucune écriture :
// le choix reste dans la page et la confirmation est un simple message. La logique de dates est dans useAgendaDemo.
const TEXTES = {
  surtitre: 'Être contacté',
  titre: 'Un rendez-vous en quelques secondes.',
  service: 'Service',
  fuseau: 'heure de Douala',
  groupeJours: 'Jours disponibles',
  groupeCreneaux: 'Créneaux du jour',
  pris: 'déjà pris',
  note: 'Agenda de démonstration : les jours et les heures sont donnés à titre d’exemple.',
  confirmation: 'C’est noté (exemple).',
  rienEnvoye: 'Rien n’est envoyé depuis cette démonstration.',
  autreCreneau: 'Autre créneau',
} as const

const {
  services,
  indexService,
  serviceChoisi,
  jours,
  libelleMois,
  indexJour,
  jourChoisi,
  creneaux,
  indexCreneau,
  libelleConfirmer,
  confirme,
  choisirJour,
  choisirCreneau,
  confirmer,
  recommencer,
} = useAgendaDemo()

const idService = useId()
const champService = useTemplateRef<HTMLSelectElement>('champService')
const message = useTemplateRef<HTMLElement>('message')

// Le bouton qui avait le focus disparaît au changement d'état : le focus suit le nouveau contenu.
async function validerCreneau() {
  confirmer()
  await nextTick()
  message.value?.focus()
}

async function autreCreneau() {
  recommencer()
  await nextTick()
  champService.value?.focus()
}
</script>

<template>
  <section id="contact" class="contact" aria-labelledby="contact-titre">
    <div class="conteneur">
      <MarketingTitreRubrique :surtitre="TEXTES.surtitre" :titre="TEXTES.titre" titre-id="contact-titre" sombre />

      <div class="agenda">
        <div class="colonne">
          <label class="rubrique" :for="idService">{{ TEXTES.service }}</label>
          <select :id="idService" ref="champService" v-model.number="indexService" class="select">
            <option v-for="service in services" :key="service.index" :value="service.index">
              {{ service.titre }}
            </option>
          </select>
          <p class="meta">
            {{ serviceChoisi?.duree }} · {{ TEXTES.fuseau }}
          </p>
        </div>

        <div class="colonne">
          <h3 class="rubrique">
            {{ libelleMois }}
          </h3>
          <div class="jours" role="group" :aria-label="TEXTES.groupeJours">
            <button
              v-for="jour in jours"
              :key="jour.instant"
              type="button"
              class="jour"
              :aria-pressed="indexJour === jour.index"
              :aria-label="jour.long"
              @click="choisirJour(jour.index)"
            >
              <span>{{ jour.court }}</span>
              <strong>{{ jour.numero }}</strong>
            </button>
          </div>
        </div>

        <div class="colonne">
          <h3 class="rubrique">
            {{ jourChoisi?.long }}
          </h3>
          <div class="creneaux" role="group" :aria-label="TEXTES.groupeCreneaux">
            <button
              v-for="creneau in creneaux"
              :key="creneau.index"
              type="button"
              class="creneau"
              :aria-pressed="indexCreneau === creneau.index"
              :aria-label="creneau.pris ? `${creneau.libelle}, ${TEXTES.pris}` : undefined"
              :disabled="creneau.pris"
              @click="choisirCreneau(creneau.index)"
            >
              {{ creneau.libelle }}
            </button>
          </div>
        </div>

        <div v-if="!confirme" class="action">
          <BsButton class="confirmer" @click="validerCreneau">
            {{ libelleConfirmer }}
          </BsButton>
        </div>
        <div v-else ref="message" class="termine" role="status" tabindex="-1">
          <p class="termine-titre">
            {{ TEXTES.confirmation }}
          </p>
          <p class="termine-texte">
            {{ TEXTES.rienEnvoye }}
          </p>
          <BsButton variant="neutre" class="autre" @click="autreCreneau">
            {{ TEXTES.autreCreneau }}
          </BsButton>
        </div>
      </div>

      <p class="note">
        {{ TEXTES.note }}
      </p>
    </div>
  </section>
</template>

<style scoped>
.contact {
  padding-block: 5rem;
  background: var(--encre);
  color: var(--fond);
}

.conteneur {
  width: 100%;
  max-width: 72.5rem;
  margin-inline: auto;
  padding-inline: max(1rem, env(safe-area-inset-left, 0px)) max(1rem, env(safe-area-inset-right, 0px));
}

.agenda {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 2rem;
  padding: 1.375rem;
  border-radius: var(--rayon-carte);
  background: var(--champ);
  color: var(--encre);
}

.rubrique {
  display: block;
  margin: 0 0 0.875rem;
  font-family: var(--font-titre);
  font-size: var(--fs-20);
  font-weight: 500;
  line-height: 1.2;
}

.select {
  width: 100%;
  min-height: 3rem;
  padding: 0 0.875rem;
  border: 1.5px solid var(--bordure);
  border-radius: var(--rayon-interne);
  background: var(--fond);
  color: var(--encre);
  font: 500 var(--fs-16) var(--font-texte);
  cursor: pointer;
}

.select:hover {
  border-color: var(--accent);
}

.meta {
  margin: 0.75rem 0 0;
  font-size: var(--fs-14);
  color: var(--texte-secondaire);
}

.jours {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 0.5rem;
}

.jour {
  display: grid;
  gap: 0.125rem;
  place-items: center;
  align-content: center;
  min-height: 4.25rem;
  border: 1.5px solid var(--bordure);
  border-radius: var(--rayon-interne);
  background: var(--fond);
  color: var(--texte-secondaire);
  font: 500 var(--fs-14) var(--font-texte);
  cursor: pointer;
  transition:
    background-color var(--transition),
    border-color var(--transition);
}

.jour strong {
  font-family: var(--font-titre);
  font-size: var(--fs-20);
  font-weight: 500;
  color: var(--encre);
}

.jour:hover {
  border-color: var(--accent);
}

.jour[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--sur-accent);
}

.jour[aria-pressed='true'] strong {
  color: var(--sur-accent);
}

.creneaux {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.5rem;
}

.creneau {
  min-height: 3rem;
  border: 1.5px solid var(--bordure);
  border-radius: var(--rayon-interne);
  background: var(--fond);
  color: var(--encre);
  font: 600 var(--fs-16) var(--font-texte);
  cursor: pointer;
  transition:
    background-color var(--transition),
    border-color var(--transition);
}

.creneau:hover:not(:disabled) {
  border-color: var(--accent);
}

.creneau[aria-pressed='true'] {
  border-color: var(--accent);
  background: var(--accent-doux);
}

.creneau:disabled {
  opacity: 0.4;
  text-decoration: line-through;
  cursor: not-allowed;
}

.action {
  grid-column: 1 / -1;
  display: flex;
  justify-content: stretch;
  padding-top: 1.5rem;
  border-top: 1px solid var(--bordure);
}

.confirmer {
  width: 100%;
}

.termine {
  grid-column: 1 / -1;
  display: grid;
  gap: 0.75rem;
  padding: 1.625rem;
  border-radius: var(--rayon);
  background: var(--accent-doux);
}

.termine:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.termine-titre {
  margin: 0;
  font-family: var(--font-titre);
  font-size: var(--fs-24);
  font-weight: 500;
}

.termine-texte {
  margin: 0;
}

.autre {
  width: fit-content;
}

.note {
  margin: 1.25rem 0 0;
  font-size: var(--fs-14);
  text-align: center;
  /* Texte clair atténué sur fond sombre : opacité plutôt que `color-mix` (résolu en `color(srgb …)`, illisible par l'audit
     d'accessibilité de Lighthouse). */
  color: var(--fond);
  opacity: 0.78;
}

@media (min-width: 60.0625rem) {
  .contact {
    padding-block: 7.5rem;
  }

  .agenda {
    grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.1fr) minmax(0, 1fr);
    padding: 2rem;
  }

  .action {
    justify-content: flex-end;
  }

  .confirmer {
    width: auto;
  }
}
</style>
