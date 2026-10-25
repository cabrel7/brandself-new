<script setup lang="ts">
interface VitrinePublique {
  id: string
  username: string
  titre: string
  prenom: string
  nom: string
  metier: string
  ville: string
  pays: string
  accroche?: string
  bio?: string
  photoMediaId?: string
  emailContact?: string
  telephone?: string
  whatsapp?: string
  palette: string
  publieeLe?: string
  publiee: boolean
  user: {
    id: string
    email?: string | null
    telephone?: string | null
    nom: string
  }
  photoMedia: {
    chemin: string
    mime: string
  } | null
}

const route = useRoute()
const username = route.params.username as string

const { data: vitrine, error, pending } = await useAsyncData<VitrinePublique | null>(
  'vitrine-publique',
  () => $fetch<VitrinePublique | null>(`/api/public/${username}`)
)

if (pending) {
  throw createError({ statusCode: 503, statusMessage: 'Chargement…' })
}

if (error || !vitrine.value) {
  throw createError({ statusCode: 404, statusMessage: 'Vitrine introuvable ou non publiée.' })
}

const v = vitrine.value

useHead({
  title: `${v.user.nom} — ${v.metier} à ${v.ville}`,
  meta: [
    { name: 'description', content: v.accroche || `Découvrez ${v.titre}, ${v.metier} à ${v.ville}.` },
  ],
})
</script>

<template>
  <div class="vitrine-publique">
    <nav class="vitrine-nav">
      <div class="vitrine-nav__gauche">
        <NuxtLink to="/" class="vitrine-nav__logo">Brandself</NuxtLink>
      </div>
      <div class="vitrine-nav__droite">
        <BsButton variant="principal" class="vitrine-nav__reserver">Réserver</BsButton>
      </div>
    </nav>

    <header class="vitrine-header">
      <div class="vitrine-header__contenu">
        <span class="vitrine-badge">Disponible cette semaine</span>
        <h1 class="vitrine-titre">{{ vitrine.prenom }} {{ vitrine.nom }}</h1>
        <p class="vitrine-metier">{{ vitrine.metier }} · {{ vitrine.ville }}</p>
        <p class="vitrine-accroche">{{ vitrine.accroche }}</p>
        <div class="vitrine-boutons">
          <BsButton variant="principal">Réserver</BsButton>
          <BsButton variant="contour">Écrire sur WhatsApp</BsButton>
        </div>
      </div>
      <div class="vitrine-header__photo">
        <div class="vitrine-photo-placeholder">
          <span class="vitrine-initiales">{{ vitrine.prenom[0] }}{{ vitrine.nom[0] }}</span>
        </div>
      </div>
    </header>

    <section class="vitrine-a-propos">
      <h2>Présentation</h2>
      <p>{{ vitrine.bio || "Aucune présentation pour le moment." }}</p>
    </section>

    <section class="vitrine-contact">
      <h2>Contact</h2>
      <p>{{ vitrine.emailContact ?? '—' }}</p>
      <p>{{ vitrine.telephone ?? '—' }}</p>
    </section>

    <footer class="vitrine-pied">
      <p>Créé avec Brandself</p>
    </footer>
  </div>
</template>

<style scoped>
.vitrine-publique {
  min-height: 100vh;
  background-color: var(--fond);
  color: var(--encre);
}
.vitrine-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 4rem;
  padding: 0 1.5rem;
  background-color: var(--surface);
  border-bottom: 1px solid var(--bordure);
  position: sticky;
  top: 0;
  z-index: 10;
}
.vitrine-nav__gauche,
.vitrine-nav__droite {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.vitrine-nav__logo {
  font-family: var(--font-titre);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--encre);
  text-decoration: none;
}
.vitrine-nav__lien {
  font-size: 0.95rem;
  color: var(--texte-secondaire);
  text-decoration: none;
  font-weight: 500;
}
.vitrine-nav__lien:hover {
  color: var(--accent);
}
.vitrine-nav__reserver {
  font-size: 0.9rem;
  padding: 0.5rem 1rem;
  min-height: auto;
}
.vitrine-header {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2rem;
  padding: 2rem 1.5rem;
  background-color: var(--surface);
  border-bottom: 1px solid var(--bordure);
}
.vitrine-header__contenu {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.vitrine-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.25rem 0.75rem;
  background-color: var(--accent-doux);
  color: var(--encre);
  border-radius: 1rem;
  font-size: 0.8rem;
  font-weight: 600;
}
.vitrine-titre {
  font-family: var(--font-titre);
  font-size: 2.5rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0;
}
.vitrine-metier {
  color: var(--texte-secondaire);
  font-size: 1.1rem;
  margin: 0;
}
.vitrine-accroche {
  font-size: 1.1rem;
  line-height: 1.5;
  color: var(--encre);
  margin: 0;
}
.vitrine-boutons {
  display: flex;
  gap: 0.75rem;
}
.vitrine-header__photo {
  display: flex;
  justify-content: center;
}
.vitrine-photo-placeholder {
  width: 10rem;
  height: 10rem;
  border-radius: 50%;
  background-color: var(--accent-doux);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-titre);
  font-size: 3rem;
  font-weight: 600;
  color: var(--encre);
  border: 4px solid var(--accent);
}
.vitrine-initiales {
  text-transform: uppercase;
}
.vitrine-a-propos {
  padding: 2rem 1.5rem;
  max-width: 28rem;
  margin: 0 auto;
}
.vitrine-a-propos h2 {
  font-family: var(--font-titre);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1rem 0;
}
.vitrine-contact {
  padding: 2rem 1.5rem;
  max-width: 28rem;
  margin: 0 auto;
  border-top: 1px solid var(--bordure);
}
.vitrine-contact h2 {
  font-family: var(--font-titre);
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--encre);
  margin: 0 0 1rem 0;
}
.vitrine-pied {
  padding: 1.5rem;
  text-align: center;
  font-size: 0.8rem;
  color: var(--texte-secondaire);
}
</style>
