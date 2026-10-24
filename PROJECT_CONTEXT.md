# PROJECT_CONTEXT.md — Brandself (nouveau projet, Nuxt fullstack)

Document de référence **unique** du produit. Il remplace NOYAU_V1, PLAN_TECHNIQUE_V1 et DESIGN_V1, ainsi que tous les documents de l'ancien projet (qui ne servent plus que d'archive).

- ✅ = tranché (ne se rediscute pas sans décision explicite de Cabrel)
- ⚠️ = proposition par défaut, à confirmer (liste dans PROJECT_STATE.md §3)
- Les règles de code vivent dans **CLAUDE.md**. L'avancement vit dans **PROJECT_STATE.md**. Les sprints vivent dans **SPRINTS.md**.
- Maquettes de référence : https://claude.ai/artifact/K6zesargm7HjPqwuaHd4rc (à exporter dans `docs/maquettes/`, voir PROJECT_STATE.md).

Règle d'or : toute fonctionnalité qui ne sert pas l'une des 3 fonctions du produit va dans « Plus tard » (§13).

tier_domaine: standard      # auth (OTP/Google) + paiement (K-PAY, S10) + données personnelles (téléphone, email, photo). ⚠️ une feature touchant auth/paiement/PII s'auto-élevée en critique le temps de cette feature (protocole v5).
tier_codebase: nouveau      # squelette Nuxt récent, peu de fichiers source — modifs massives encore sûres.
# Corrige si besoin — ces 2 lignes pilotent l'effort / la sévérité / le choix de modèle.

---

## 1. Promesse ✅

**Une vitrine en ligne pour professionnels : on les trouve sur Google, on comprend ce qu'ils font, on peut les contacter et réserver un rendez-vous.**

Trois fonctions, et rien d'autre :
1. **Être trouvé** : SEO sur « [métier] + [ville] ».
2. **Être compris** : présentation, services, réalisations, témoignages.
3. **Être contacté ou réservé** : agenda réservable, formulaire, liens.

Ce n'est pas un site builder générique, pas un réseau social, pas un CV.

## 2. Public cible

Professionnels francophones qui vendent leur expertise : santé (médecins, psychologues, kinésithérapeutes), droit et conseil, coaching et formation, créatifs, indépendants. Marché de départ : Cameroun et Afrique francophone, puis France et diaspora. Usage **mobile d'abord**, connexions parfois limitées.

## 3. Vocabulaire ✅

- Dans l'interface : **« vitrine »**. Jamais « espace », « profil » (sauf l'écran « Votre profil »), « site », « CV ».
- Jamais « bloc », « module », « widget » dans l'interface.
- Contenus : **service**, **réalisation**, **témoignage**, **lien**, **agenda**, **réservation**.
- URL publique : `brandself.io/username`. Link-in-bio : `brandself.io/@username` (repli `/l/username` si le routage pose problème).
- Ton de tous les textes : **vouvoiement, chaleureux**, phrases courtes, aucun jargon (voir §9.4).

## 4. Le contenu : sections fixes, pas de blocs ✅

Une vitrine = **un profil + des listes**. Chaque liste a sa propre table simple. Pas de blocs polymorphiques, pas de placement par page, pas de configuration par type.

| Section | Contenu |
|---|---|
| **Profil** | titre (liste : Dr, Pr, Me, M., Mme, sans titre), prénom, nom, métier, ville, pays (liste), accroche, présentation, photo, contact (email, téléphone, WhatsApp), palette de couleurs, adresse (username) |
| **Services** | titre, description, photo **facultative**, type, tarif, mode de règlement, réservable, en vedette, visible |
| **Réalisations** | titre, description, image principale, galerie facultative, année, lieu ou client, rôle, lien externe, en vedette, visible |
| **Témoignages** | auteur, fonction, texte, en vedette, visible |
| **Liens** | libellé, type, URL, ordre, visible, compteur de clics |
| **Agenda** | disponibilités hebdomadaires, indisponibilités, réservations |

### 4.1 Types de services et paiement ✅

- **Type** : rendez-vous ponctuel · accompagnement (plusieurs séances : nombre, durée, rythme) · atelier ou formation (groupe) · prestation sur devis. Le type adapte le bouton : *Réserver* · *Réserver la 1re séance* · *S'inscrire* · *Demander un devis*.
- **Tarif** : gratuit · payant (prix + devise) · sur devis.
- **Mode de règlement** (si payant) : en ligne à la réservation · sur place · au choix du client.
- **v1** : le professionnel indique son prix et ses instructions de règlement (sur place, Mobile Money, virement). **Le paiement en ligne via Brandself est masqué (drapeau `PAIEMENT_EN_LIGNE=false`)** et arrive en v1.5 (reversement, commission, vérification des professionnels : chantier à part). Le modèle de données et les maquettes le prévoient déjà.
- Rendez-vous ponctuel et accompagnement (première séance) passent par l'agenda. Atelier et prestation sur devis passent par une **demande** (formulaire, sans créneau).

### 4.2 Règles transversales ✅

- **Activer / désactiver** : tout élément (service, réalisation, témoignage, lien) a un interrupteur « Visible sur la vitrine » pour le masquer sans le supprimer.
- **Interrupteurs, jamais de cases à cocher** pour les réglages oui/non.
- **Mise en vedette** : services, réalisations et témoignages ont un réglage « en vedette sur l'accueil » (3 maximum par liste, vérifié côté serveur). L'accueil n'affiche que les éléments en vedette, suivis d'un bouton « Voir tous… (n) ». À la création, les 3 premiers éléments sont en vedette par défaut.
- **Une page n'est visible que si elle a du contenu.** L'utilisateur ne configure rien.
- **Photo des services facultative.** Sans photo, la carte garde un aplat de la couleur d'accent avec l'initiale du titre.

## 5. Pages publiques ✅ (SSR, un seul template au lancement)

| URL | Visible si | Contenu |
|---|---|---|
| `/username` | toujours (si publiée) | **Landing page de l'utilisateur** : présentation (photo large, nom, métier, accroche, boutons Réserver et WhatsApp, pastille « Disponible cette semaine », carte « Prochain créneau »), services à la une (cartes), **agenda visuel**, réalisation et témoignage à la une, contact. **Pas de page « À propos » : la bio vit ici.** |
| `/username/services` | ≥ 1 service visible | grille de toutes les cartes de services |
| `/username/services/[slug]` | service visible | détail : photo, type, durée, tarif, description, ce que comprend le service, créneaux, bouton adapté au type |
| `/username/realisations` | ≥ 1 réalisation visible | liste |
| `/username/realisations/[slug]` | réalisation visible | détail : image, faits (année, lieu, rôle), description, galerie, lien, autres réalisations |
| `/username/reserver` | agenda avec disponibilités | choix du créneau, formulaire du visiteur, choix de règlement, envoi de la demande |
| `/@username` | toujours (si publiée) | **link-in-bio** : photo, nom, accroche, liste de liens, bouton réserver |

**Agenda sur l'accueil** : bloc bien visible (pas une liste d'heures) : choix du service, mini-calendrier de la semaine (jours disponibles marqués, jours passés grisés), créneaux du jour sélectionné, bouton « Confirmer … ». Sur PC : calendrier à gauche, créneaux à droite.

**Cartes de services** : grande image en haut (200 à 220 px) avec le type en pastille, titre (serif), 2 lignes de description, durée, prix à gauche et bouton d'action à droite. Mobile et tablette : défilement horizontal avec la carte suivante qui dépasse. PC : 3 cartes côte à côte.

**Réservation** : c'est une **demande** que le professionnel confirme (statuts : en attente, confirmée, annulée, terminée). Le visiteur choisit son mode de règlement (v1 : sur place seulement).

## 6. Studio (interface de gestion) ✅

**Pas un dashboard** : pas de sidebar, pas de graphiques en accueil.

- **Navigation : 5 entrées** (barre du bas sur mobile, barre du haut sur ordinateur) : **Vitrine · Services · Réalisations · Liens · Agenda**. Le **compte** est accessible par l'avatar en haut à droite. Les témoignages et le profil sont dans l'écran **Vitrine**.
- **Vitrine** : statut (Publiée), une ligne de statistiques (visites, clics, réservations des 7 derniers jours), **une seule « prochaine étape »**, liste des sections avec compteurs (Profil, Services, Réalisations, Témoignages, Agenda, Liens).
- **Profil** : photo (avec « Changer la photo »), titre + prénom + nom (aperçu « Affiché sur la vitrine : Dr … »), métier, ville, pays (liste), accroche (compteur de caractères), présentation + bouton « Améliorer avec l'IA » (l'IA reformule, l'utilisateur valide), contact, palette (5 pastilles), adresse.
- **Listes** (Services, Réalisations, Liens) : lignes avec miniature, titre, métadonnées, étiquette « En vedette », **interrupteur de visibilité**, bouton Ajouter. Les éléments masqués sont grisés.
- **Formulaires** : un par type de contenu. Le formulaire d'ajout est le même que celui de modification, vide. Enregistrement explicite par un bouton « Enregistrer ».
- **Liens** : adresse de la page link-in-bio avec copie, Partager, QR code, statistiques de clics, liste réordonnable (glisser), formulaire avec aperçu du bouton.
- **Agenda** : réservations à venir et passées (confirmer, annuler), disponibilités par jour de la semaine, indisponibilités.
- **Compte** : abonnement (état, échéance, renouvellement 1/3/12 mois), email, téléphone, langue, devise, fuseau horaire, appareils connectés, déconnexion, suppression du compte.

## 7. Parcours utilisateur ✅

### 7.1 Connexion et inscription : un seul parcours, sans mot de passe

- **Trois façons** : Google · email · numéro de téléphone.
- **Code OTP à 6 chiffres** (email ou téléphone) : valable 10 minutes, **3 essais** par code, renvoi possible après 60 secondes ⚠️. Écran « Code incorrect » : « Ce code n'est pas correct. Il vous reste 2 essais. »
- Téléphone : indicatif (liste) + numéro ; canal **SMS** (⚠️ WhatsApp à confirmer, voir PROJECT_STATE.md).
- Si le compte n'existe pas, il est créé, puis le visiteur entre dans l'inscription guidée ; sinon il ouvre le studio.
- Aucune gestion de mot de passe nulle part. Page Compte : « Vous vous connectez avec un code : aucun mot de passe à gérer. »

### 7.2 Inscription guidée en 4 étapes + écran final ✅

1. **Qui êtes-vous ?** titre, prénom, nom, métier (avec suggestions), ville, pays.
2. **Votre photo** : photo obligatoire ⚠️, conseils (de face, lumière naturelle, fond simple).
3. **Notre proposition (IA)** : 3 accroches au choix, présentation modifiable, 3 services proposés avec un interrupteur chacun. « Rien n'est publié sans votre accord. »
4. **Votre adresse** : `brandself.io/` + username (disponibilité en direct), choix de la palette. Bouton « Publier ma vitrine ».
5. **C'est en ligne** : adresse à copier, Voir ma vitrine, Partager sur WhatsApp, prochaine étape (ouvrir les disponibilités).

## 8. Fonctionnement des plans, abonnements, rétention ✅

### 8.1 Plans (limites validées « pour le moment »)

| | Gratuit | Payant |
|---|---|---|
| Services / réalisations / témoignages | 3 chacun | illimité |
| Réservations | 10 par mois | illimité |
| Génération IA | 3 par mois | illimitée |
| Link-in-bio | oui | oui |
| Badge « Créé avec Brandself » | oui | retiré |
| Statistiques | basiques (7 jours) ⚠️ | complètes (90 jours, pages et sources) ⚠️ |

Prix du plan payant : **non décidé**, par devise (XAF, EUR, USD), en configuration, jamais en dur.

### 8.2 Abonnement prépayé, renouvellement manuel ✅

K-PAY ne renouvelle pas automatiquement (ni mobile ni carte). Donc :
- L'utilisateur paie une **période** : 1, 3 ou 12 mois (remise croissante). Le plan payant est actif jusqu'à `expire_le`.
- **Rappels** par email à J-7, J-3 et le jour J, avec un lien « Renouveler en un clic » (BullMQ).
- **Délai de grâce de 7 jours** ⚠️ après l'expiration, puis retour au plan gratuit.
- **Rien n'est supprimé** : au-delà des limites du gratuit, les éléments en trop (les plus récents) sont **masqués** sur la vitrine publique et réapparaissent au renouvellement ⚠️.
- L'abonnement annuel est mis en avant.
- Option future : second fournisseur avec renouvellement automatique par carte (clients internationaux).

### 8.3 Rétention : cinq mécanismes, pas plus ✅

1. **Notification immédiate** à chaque réservation ou message (email d'abord, WhatsApp plus tard).
2. **Résumé hebdomadaire** par email (visites, clics, réservations ; sinon une suggestion concrète).
3. **Prochaine étape unique** dans le studio tant que la vitrine n'est pas complète (photo, 1 service, disponibilités, 1 réalisation, partage).
4. **Aide au partage** après publication : lien, QR code, message prêt à envoyer.
5. **Passage au payant au moment de la limite** : un message explique ce qui se débloque. Aucune fenêtre promotionnelle en dehors.

Règles : un seul message à l'écran à la fois ; pas plus d'un email non transactionnel par semaine ; un message ignoré ne revient pas. **Indicateur de réussite** : pourcentage d'utilisateurs avec une vitrine publiée et au moins une visite ou une réservation dans les 30 jours.

## 9. Design ✅

### 9.1 Direction : « éditorial chaleureux »

Fond crème, texte brun foncé, un accent chaud, beaucoup d'air, la photo du professionnel en grand. Qualité d'un beau portfolio, chaleur d'une personne. On quitte le bleu froid, les gris ardoise et l'allure « logiciel pour développeurs ».

**Deux identités** : la vitrine publique met en valeur le professionnel (sa photo, sa palette) ; le studio et le site Brandself portent l'identité Brandself (palette Terracotta par défaut).

### 9.2 Palettes ✅ (principe) ⚠️ (valeurs)

L'utilisateur choisit **une palette complète**, jamais des couleurs une à une. Ce sont des variables CSS, jamais des couleurs en dur dans les composants.

| Palette | Fond | Surface | Encre | Texte secondaire | Accent | Accent doux | Bordure |
|---|---|---|---|---|---|---|---|
| **Terracotta** (défaut) | #FBF7F0 | #F3EBDD | #231F1C | #6B5F55 | #B4532F | #F2DDD2 | #E6DCCB |
| **Sauge** | #F8F7F1 | #ECEFE3 | #1F2420 | #5C6358 | #3F6B4F | #DDE8DC | #DCE0D0 |
| **Indigo** | #F7F5F1 | #E9E7EF | #1E1B2E | #5A5670 | #3B3F8C | #DDDFF2 | #DEDBE6 |
| **Ocre** | #FCF8EE | #F6EBCB | #26200F | #6A5E3F | #9A6A0F | #F6E3B0 | #EADFBE |
| **Bordeaux** | #FAF5F3 | #F1E4E1 | #2A1C1E | #6B5558 | #8A2F45 | #F0D8DD | #E8D5D3 |

Texte sur l'accent : blanc. Contraste minimum 4,5:1 (à vérifier pour toute nouvelle palette). Erreur : #B3261E. Pas de mode sombre pour les vitrines en v1.

### 9.3 Typographie, formes, mouvement

- **Titres : Fraunces** (serif). **Texte et interface : Figtree**. Chargées via `@nuxt/fonts`.
- **Les mots ne changent jamais de couleur ni ne passent en italique dans un titre.** Tout le titre s'écrit pareil. (Seules les citations de témoignages sont en italique.)
- Coins arrondis 12 à 16 px (cartes jusqu'à 24 px), bordures fines, ombres très douces.
- **Photo de profil en grand**, en arche (coins du haut très arrondis), `object-position: center top`. Sur mobile, la photo prend toute la largeur en haut de la page.
- Mouvement discret, désactivé si l'utilisateur demande moins d'animations.
- Pas de dégradés violets/roses, pas de verre dépoli, pas de décor chargé.
- **Icônes : Phosphor** via `@nuxt/icon`, une seule famille et un seul style de trait. **Jamais Lucide.**
- Zones tactiles ≥ 44 px, texte courant 16 à 18 px.

### 9.4 Ton des textes

Vouvoiement, chaleureux, phrases courtes, verbes d'action. Exemples : « Bienvenue. Construisons votre vitrine ensemble. » · « C'est en ligne. Voici votre adresse, prête à être partagée. » · « Nous n'avons pas pu enregistrer. Vos modifications sont gardées, réessayez dans un instant. » · « Votre abonnement se termine dans 3 jours. » Une erreur ne culpabilise jamais et dit toujours quoi faire ensuite.

### 9.5 Principes d'expérience

1. Mobile d'abord (pages légères, images optimisées). 2. Un écran, une action principale. 3. Un seul message à la fois (jamais deux bandeaux ni une fenêtre par-dessus une autre). 4. États vides qui donnent envie (une phrase chaleureuse et un seul bouton). 5. Chaque composant a ses états : normal, survol, focus visible, désactivé, erreur, chargement. 6. Accessibilité : contraste, clavier, textes alternatifs.

## 10. SEO ✅ (conçu dès le départ)

Rendu serveur sur toutes les pages publiques, cache par page. Titre `Nom — Métier à Ville`. Description générée par l'IA, modifiable. Données structurées (Person, Service). Sitemap automatique. Image de partage (OG) générée. Une page par service pour cibler des requêtes précises. Mots réservés pour `username` (voir CLAUDE.md).

## 11. Modèle de données (≈ 19 tables)

```
(auth)           user, session, account, verification : gérées par Better Auth
users            id, email?, telephone?, nom, locale, devise, fuseau, email_hebdo, created_at
vitrines         id, user_id (unique), username (unique), titre, prenom, nom, metier, ville, pays,
                 accroche, bio, photo_media_id, email_contact, telephone, whatsapp, palette,
                 seo_titre, seo_description, sections_masquees text[], fuseau, pas_creneau_min,
                 preavis_heures, horizon_jours, publiee_le, created_at
services         id, vitrine_id, slug, titre, description, image_media_id?, type (rdv|accompagnement|atelier|devis),
                 nb_seances?, rythme?, duree_min?, tarif (gratuit|payant|devis), prix_montant?, prix_devise?,
                 paiement_mode (en_ligne|sur_place|au_choix), paiement_instructions?,
                 reservable, en_vedette, ordre, actif
realisations     id, vitrine_id, slug, titre, description, image_media_id, annee?, lieu?, role?, lien?,
                 en_vedette, ordre, actif
realisation_images  id, realisation_id, media_id, ordre
temoignages      id, vitrine_id, auteur, fonction?, texte, en_vedette, ordre, actif
liens            id, vitrine_id, libelle, url, type (libre|whatsapp|reseau|email|telephone|vitrine), ordre, clics, actif
disponibilites   id, vitrine_id, jour_semaine, debut, fin
indisponibilites id, vitrine_id, date, raison?
reservations     id, vitrine_id, service_id, nom, email, telephone, note?, debut, fin, statut
                 (en_attente|confirmee|annulee|terminee), paiement_choisi (en_ligne|sur_place),
                 paiement_statut (non_requis|en_attente|paye), created_at
demandes         id, vitrine_id, service_id, nom, email, telephone, message?, statut, created_at
messages         id, vitrine_id, nom, email, message, lu, created_at
medias           id, user_id, disk, chemin, mime, taille, largeur, hauteur
abonnements      id, user_id, plan, devise, expire_le
paiements        id, user_id, reference_kpay (unique), montant, devise, periode_mois, statut, created_at
generations_ia   id, user_id, type, statut, tokens, duree_ms, entree, sortie, created_at
prompts_ia       id, type, version, texte, actif
vues             id, vitrine_id, page, ip_hash, pays, appareil, source, date
```

Règles : une donnée interrogeable = une colonne typée, jamais du JSON. Une image = une ligne `medias`, jamais un chemin dans une autre table. **Pas de double réservation, garanti par la base** : contrainte d'exclusion PostgreSQL (`btree_gist`) sur la plage `[debut, fin)` d'une vitrine pour les statuts actifs (en attente, confirmée). **Webhooks K-PAY idempotents** : `reference_kpay` unique. Heures stockées en `timestamptz`, affichées dans le fuseau de la vitrine (défaut `Africa/Douala`). Prix des plans en configuration, par devise.

## 12. Technique ✅

| Domaine | Choix |
|---|---|
| Framework | **Nuxt** (dernière version stable à l'initialisation), TypeScript strict, Tailwind, **un seul projet fullstack (Nitro), sans Laravel** |
| Base de données | **PostgreSQL** ; ORM **Drizzle** (+ drizzle-zod) |
| Jobs et cache | **BullMQ + Redis** ; process `worker` séparé |
| Auth | **Better Auth** : Google, OTP email, OTP téléphone (plugins à vérifier dans la documentation de la version installée) |
| Validation | Zod, partagé client/serveur |
| Images | disque local derrière une couche de stockage (unstorage) pour passer à S3/R2 plus tard ; `sharp` (redimensionnement, WebP, retrait EXIF) |
| Emails | Resend |
| SMS / WhatsApp (OTP) | fournisseur à choisir, derrière une interface `OtpSender` |
| Paiement | **K-PAY** (API REST + webhooks signés, client TypeScript maison) ; multi-devise ; pas de renouvellement automatique |
| IA | un seul service, fournisseur interchangeable, prompts versionnés en base |
| UI | Tailwind + composants maison (Switch, Segmented, RadioCard, Chip…) ; `@nuxt/ui` possible comme base ⚠️ ; icônes Phosphor |
| SEO | `@nuxtjs/seo` (sitemap, robots, image de partage, données structurées) ; `@nuxt/image` ; `@nuxt/fonts` |
| Divers | VueUse, dayjs ou date-fns, `qrcode` |
| Tests | Vitest (unitaires), Playwright (bout en bout) |
| Déploiement | VPS Ubuntu, Nginx, PM2 (un process Nuxt + un process worker) |

**Principe : bibliothèque d'abord.** On ne recode pas ce qu'une bibliothèque maintenue (récente, TypeScript, compatible Nuxt, peu de dépendances) fait déjà. Le code métier reste à nous : règles de réservation, limites des plans, abonnement prépayé, rétention.

**Chemin d'une requête** : route → validation Zod → service → base. Les pages publiques n'appellent que des routes en lecture et ne contiennent aucune logique métier.

## 13. Plus tard (pas dans la v1)

Paiement en ligne des réservations par Brandself (v1.5) · boutique · blog (et blog central) · newsletter · affiliation et parrainage · badge vérifié · snapshots et révisions · domaine personnalisé · version bilingue · templates supplémentaires · assistant IA conversationnel · import LinkedIn/CV · analytics avancés · FAQ · chiffres clés · OTP par WhatsApp (selon décision) · autres types de contenu (bénévolat, langues, outils, awards, partenariats, presse, publications, mentorat) · invitation de témoignage par lien · WhatsApp pour les notifications · site marketing complet (maquette à produire).

## 14. Abandonné

Système de blocs polymorphique, table de placement par page, configuration des types de blocs, 25 types de contenu, 6 templates en parallèle, modération d'un blog central, mot de passe, Laravel/Passport, Lucide, vocabulaire « Espace », double parrainage/affiliation, retention à 16 mécanismes, dashboard à sidebar et graphiques.

## 15. Données de démonstration ✅

Toutes les démos, maquettes et tests utilisent ce profil (jamais de lorem ipsum, jamais une autre persona) :
**Dr Cabrel Nguesso, cardiologue interventionnel, Douala (Cameroun)**, devise XAF, username `dr-cabrel`, palette Terracotta. Services : Consultation de cardiologie (rdv, 45 min), Bilan cardiovasculaire complet (rdv, 60 min), Suivi après infarctus (accompagnement, 6 séances de 30 min), Échographie cardiaque, Téléconsultation (gratuit), Second avis (sur devis). Réalisations : Unité de cathétérisme (CHU de Douala, 2025), Campagne de dépistage de l'hypertension (2024), Programme de réadaptation cardiaque (2022). Témoignages et téléphone : espaces réservés tant que Cabrel ne les fournit pas. Aucun chiffre inventé.

## 16. Glossaire

- **Vitrine** : le site multi-pages d'un professionnel sur Brandself.
- **Studio** : l'interface de gestion de la vitrine.
- **En vedette** : élément affiché en premier sur l'accueil (3 maximum par liste).
- **Demande** : formulaire sans créneau (atelier, prestation sur devis).
- **Période** : durée prépayée de l'abonnement (1, 3 ou 12 mois).
- **Palette** : ensemble cohérent de couleurs choisi par l'utilisateur.
