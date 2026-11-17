# Sprints d'administration A1 à A5 — à coller dans SPRINTS.md

**1.** Dans « Mode d'emploi », ligne « Ordre et jalons » : `… → A1 → A2 → A3 → A4 → A5 (administration)`.

**2.** Coller ce qui suit **avant** la section « Annexe — Idées gardées pour après la v1 ».

**3.** PROJECT_STATE.md : cinq lignes dans le tableau d'avancement (A1 à A5, « à faire ») et, dans « Décisions tranchées » : « Administration sur `admin.jesuis.pro`, accès réservé au superadmin (Cabrel) ; un seul mécanisme de configuration (registre) et non une page par réglage ».

**4.** Préparer avant A1 (hors code) : enregistrement DNS `admin.jesuis.pro`, certificat SSL du sous-domaine, bloc Nginx dédié **avec liste d'adresses IP autorisées (obligatoire)**.

---

# COMPLÉMENT ADMIN (à coller après le BLOC COMMUN, pour A1 à A5)

```
CONTEXTE ADMIN : l'administration de jesuis.pro est un outil interne réservé au superadmin (Cabrel). Elle vit sur admin.jesuis.pro. Elle réutilise le système de design du studio (palette Terracotta, Fraunces, Figtree, Phosphor, interrupteurs, étiquettes, cartes) et les composants de @nuxt/ui (tableau, tiroir, modale, barre latérale) : AUCUN composant maison si @nuxt/ui le fournit (vérifier dans la version installée). Il n'y a pas de maquette : suis le motif existant, ne devine pas un nouveau design ; si un doute de design bloque, arrête-toi et pose la question.
TIER : critique pour tout le sprint (authentification, paiement, données personnelles). Revue de sécurité par le reviewer en mode opus, TDD côté serveur, e2e. Interdit de mocker la couche qu'un critère doit prouver (journal, persistance, droits).

RÈGLES ADMIN NON NÉGOCIABLES :
- CONFIDENTIALITÉ : l'admin voit les comptes, les vitrines, les abonnements et des COMPTEURS. Il ne voit JAMAIS le contenu confidentiel des visiteurs d'un professionnel (noms, e-mails, téléphones, motifs et messages des réservations, demandes et messages de contact), ni dans le détail, ni dans un export, ni dans un journal. Les réponses admin sont construites en LISTE BLANCHE (schéma Zod strict, sans spread de ligne). Un test énumère automatiquement toutes les routes de server/api/admin/** et échoue si l'une n'est pas couverte par le test de contrat (une route nouvelle ne peut pas passer sous le radar).
- ACCÈS : seul le rôle superadmin passe ; les autres reçoivent 404. Les pages et routes admin ne répondent QUE sur ADMIN_HOST (admin.jesuis.pro) ; sur jesuis.pro elles renvoient 404, et le studio et les vitrines ne répondent pas sur le domaine admin. Double barrière : contrôle du nom d'hôte dans le code ET Nginx qui bloque /api/admin et les pages admin sur jesuis.pro (et inversement). Aucun cookie sur le domaine parent `.jesuis.pro` : la session admin est propre au sous-domaine.
- AUDIT : toute écriture admin est enregistrée dans journal_admin DANS LA MÊME TRANSACTION que l'action (si le journal échoue, l'action est annulée). Les effets externes (e-mails, jobs) partent APRÈS le commit. Champs : admin, action, type et identifiant de la cible, avant, après, motif, adresse IP, date. Les champs avant/après ne contiennent JAMAIS de donnée personnelle (identifiants et champs neutres seulement). Le journal est append-only, garanti par le service ET par un déclencheur de base (UPDATE, DELETE, TRUNCATE interdits).
- ACTIONS DESTRUCTRICES : motif obligatoire ET réauthentification à USAGE UNIQUE (nouveau code par action : suppression de compte, changement de plan, marquage manuel d'un paiement, validation des prix, activation d'un prompt). Les autres écritures : motif obligatoire.
- IDEMPOTENCE : toute action admin qui change un montant, une durée ou un état (offrir des jours, marquer payé, suspendre…) porte une clé d'idempotence ; la rejouer ne l'applique pas deux fois.
- SURFACES : les pages admin sont ssr:false, noindex, Cache-Control: no-store, absentes du sitemap et de robots ; ni InstallPrompt, ni collecte de vues, ni service worker sur le domaine admin.
- CONFIGURATION : tout réglage modifiable passe par le REGISTRE DES RÉGLAGES (voir A4). Jamais une page par réglage. Les SECRETS (clés d'API, secrets K-PAY et de webhook, secret d'authentification) restent dans l'environnement et ne sont jamais lus ni écrits par l'admin (affichage « configuré : oui/non » seulement).
- Un réglage lu en base utilise un cache mémoire court (5 s) ; en cas d'erreur de lecture, la valeur de repli est la configuration du code, jamais « tout ouvert ».
- Jamais d'addition entre devises. Jamais de montant à virgule (entiers : XAF sans décimale, EUR et USD en centimes).
- Les actions d'admin passent par les MÊMES services que le studio (suppression de compte, publication, plans) : pas de logique dupliquée, aucune écriture directe en base depuis une route.
- Vocabulaire : l'exigence « vitrine, service, réalisation… » vaut pour l'interface ; l'admin est interne, mais emploie « vitrine » et le vouvoiement ; les noms de composants et de code restent en anglais.
- Bibliothèque d'abord (tableaux, tiroirs, supervision des files). Rappel : pas d'opération en masse, un fichier à la fois, après lecture intégrale.
```

---

# A1 — Socle de l'administration

**Objectif** : une zone d'administration sécurisée sur `admin.jesuis.pro` : accès par rôle, domaine et IP, mise en page à barre latérale, journal d'audit, réauthentification.
**Pré-requis** : S14 ; DNS, SSL et Nginx prêts (voir « Préparer avant A1 »). Le rôle de base de données séparé (S13) n'est pas bloquant. **Maquettes** : aucune.

**Périmètre**
- **Routage par nom d'hôte** : `ADMIN_HOST` en configuration validée au démarrage ; contrôle côté serveur (middleware Nitro) et côté pages (middleware de route) ; en développement `admin.localhost` (Chromium le résout). Mots réservés : `admin`, `mcp` présents dans `shared/reserved.ts` (vérifier).
- **Rôle et suspension** : adopter le **plugin `admin` de Better Auth** (rôle, bannissement, révocation de sessions). **Impersonation désactivée** (aucune route exposée). Seul `superadmin` donne accès. **Le premier superadmin se crée par commande** (`pnpm admin:creer <email>`), jamais par l'interface ; commande de récupération `pnpm admin:reinitialiser <email>` documentée ; recommandation : un **second superadmin de secours** ⚠️. Lire la documentation du plugin et vérifier que le bannissement bloque aussi la connexion par code.
- **Connexion admin** : page `/connexion` propre au domaine ; **code envoyé par e-mail uniquement** (ni Google, ni téléphone) ; session de 8 heures ; cookie sécurisé propre au sous-domaine. Vérifier dans Better Auth 1.7.18 la configuration de `baseURL`/`trustedOrigins` pour un second hôte. **Suivi immédiat** (hors A1) : passkey (plugin Better Auth).
- **Accès par IP** : liste d'adresses autorisées appliquée par Nginx (versionnée dans `deploy/nginx/`), obligatoire en production.
- **Réauthentification** : service unique `reauth`, code à usage unique par action destructrice, envoyé à l'e-mail vérifié du superadmin (jamais fourni par la requête), limité en débit.
- **Journal d'audit** : table `journal_admin` ; service unique `Audit.enregistrer(...)` appelé dans la transaction de l'action ; déclencheur de base interdisant UPDATE, DELETE et TRUNCATE ; chaîne de hachage (chaque ligne porte l'empreinte de la précédente) pour détecter une altération.
- **Mise en page** : barre latérale (Vue d'ensemble, Utilisateurs, Vitrines, Abonnements, Systèmes, Réglages, Journal), barre du haut (nom de l'admin, déconnexion), **bandeau permanent « Administration »** avec une variable de thème dédiée (jamais de couleur en dur). Sur mobile, la barre latérale devient un menu repliable. Composants : ceux de @nuxt/ui ; n'ajouter qu'une couche mince (`StatCard`, `FilterBar`, `ConfirmDialog` avec motif et réauthentification) si rien n'existe.
- **Pages provisoires** pour chaque entrée (« Bientôt disponible »), sauf la connexion et la vue d'ensemble.
- **Test de confidentialité structurel** (voir règles).

**Hors périmètre** : rôles support ou lecture seule, impersonation, recherche globale (livrée avec A2, elle n'a de sens qu'avec les fiches), contenus des fiches.

**Critères de réception**
- Utilisateur non connecté, ordinaire et superadmin testés sur chaque route : seul le superadmin passe, les autres reçoivent 404.
- Les pages admin répondent sur `admin.jesuis.pro` et pas sur `jesuis.pro` ; le studio ne répond pas sur le domaine admin ; Nginx bloque `/api/admin` sur le domaine public (preuve : en-têtes et réponses collés).
- Aucun cookie posé pour `.jesuis.pro` (en-têtes collés).
- Le journal refuse UPDATE, DELETE et TRUNCATE (tentative échouée au niveau de la base) ; une action dont l'écriture du journal échoue est annulée ; la chaîne de hachage détecte une ligne altérée.
- Une action destructrice sans code est refusée ; avec un code valide elle passe ; le même code rejoué est refusé.
- Les pages admin répondent `noindex` et `no-store`, sans InstallPrompt ni collecte de vues.
- Le test de confidentialité est vert et échoue si on ajoute une route non couverte ou un champ interdit.

**Tests** : accès par rôle, par domaine et par IP, expiration de session, réauthentification à usage unique, journal (append-only, atomicité, chaîne), confidentialité.

---

# A2 — Utilisateurs, vitrines et assistants

**Objectif** : retrouver un utilisateur, comprendre sa situation, agir (suspendre, offrir, changer de plan, supprimer, dépublier, couper un assistant) avec traçabilité.
**Pré-requis** : A1. **Maquettes** : aucune.

**Périmètre**
- **Base** : suspension via le bannissement du plugin admin ; `blocage_admin` (booléen) et `blocage_motif` sur les vitrines.
- **Prédicat central de visibilité** (un seul, dans le même esprit que `plan-visibilite`) : une vitrine suspendue, bloquée ou non publiée est invisible partout : page et API publiques, sitemap, SEO, **écritures des visiteurs** (créneaux, réservation, contact, démarrage d'un paiement), jetons MCP du compte, connexions. Les rappels déjà planifiés à des visiteurs pour des rendez-vous confirmés sont envoyés ; aucune nouvelle réservation n'est acceptée ⚠️ (à confirmer). Le cache public ne dure que 10 s : une dépublication est effective en 10 s au plus (à écrire dans les critères).
- **Recherche globale** : `GET /api/admin/recherche?q=` (e-mail, téléphone, username, nom), résultats groupés, 10 par groupe, vers les fiches.
- **Liste des utilisateurs** : pagination, tri, recherche, filtres (plan, pays, statut, inscription, vitrine publiée ou non).
- **Fiche utilisateur** (tiroir) : identité (nom, e-mail, téléphone), pays, devise, fuseau, plan et abonnement, dates (inscription, dernière connexion), vitrine (username, publiée, compteurs de services, réalisations, témoignages, liens), activité (vues et réservations des 30 jours en compteurs, usage IA du mois), sessions actives, **assistants connectés** (clients et jetons OAuth, dernier usage). **Aucun contenu de visiteur.**
- **Actions** (motif obligatoire ; réauthentification pour celles marquées *) : suspendre * / réactiver (révoque les sessions, refuse la connexion avec un message clair, masque la vitrine) ; **offrir des jours** (base de calcul `max(maintenant, expire_le)` ; sur un compte gratuit, crée un abonnement de type `offert` ; clé d'idempotence) ; changer le plan * ; révoquer toutes les sessions ; **retirer l'accès d'un assistant** ou de tous ; supprimer le compte * (confirmation en saisissant l'e-mail ; même service que la suppression du studio ; `paiements` reste, anonymisé, conformément à `ON DELETE SET NULL` ; le journal ne garde aucune donnée personnelle).
- **Liste et fiche des vitrines** : filtres (publiée, plan, pays, avec réservations) ; actions : **dépublier** * (motif, e-mail automatique au professionnel avec le motif), republier, ouvrir la vitrine publique. Tant que `blocage_admin` est vrai, **le studio ne permet pas de republier** et affiche le motif et un moyen de nous contacter.
- **E-mails** (jobs) : suspension, réactivation, dépublication, jours offerts. Vouvoiement, courts, sans jargon.
- **Interface** : tableau et tiroir de @nuxt/ui, étiquettes de statut, boîte de confirmation avec motif.

**Hors périmètre** : contenu des réservations et messages, impersonation, modération de signalements (la réception passe par une adresse « abus » à publier avec la page Confidentialité).

**Critères de réception**
- Suspendre un compte de test : sessions révoquées, connexion refusée avec message, vitrine masquée, **réservation et contact visiteur refusés, jeton MCP refusé** ; réactiver : tout revient.
- Dépublier avec motif : e-mail envoyé, republication impossible depuis le studio tant que le blocage existe.
- Offrir 30 jours prolonge de 30 jours exactement, une seule fois même si l'action est rejouée (clé d'idempotence).
- Supprimer un compte efface données et images ; les paiements restent, sans lien avec une personne ; le journal ne contient aucune donnée personnelle.
- La recherche trouve un compte par e-mail, téléphone et username.
- Chaque action est dans le journal avec avant, après, motif et adresse IP ; confidentialité verte.

**Tests** : filtres et pagination, chaque action avec et sans motif et réauthentification, effets de la suspension sur chaque surface publique, idempotence, suppression, journal, confidentialité.

---

# A3 — Abonnements, paiements et revenus

**Objectif** : suivre l'argent, ne rater aucun renouvellement, corriger un paiement bloqué.
**Pré-requis** : A2, S10. **Décision préalable** : trancher la décision ouverte #13 (le montant du webhook K-PAY est-il brut ou net ?) sinon les revenus affichent une mention d'incertitude. **Maquettes** : aucune.

**Périmètre**
- **Migration** : `paiements.source` (`kpay`, `manuel`) ; pour un paiement manuel, référence `manuel-<uuid>` et contraintes ajustées (la règle d'unicité de `reference_kpay` reste intacte pour K-PAY) ; compteur des **webhooks refusés** (signature invalide) : date, motif, **sans le contenu**.
- **Abonnements** : liste (plan, devise, `expire_le`, état : actif, en grâce, expiré, gratuit) avec trois onglets **« À renouveler dans 7 jours »**, **« En grâce »**, **« Expirés récemment (30 jours) »**. Action : **envoyer un rappel maintenant** (même e-mail que J-7, un par 24 h par utilisateur).
- **Paiements** : liste (référence, utilisateur avec lien, montant, devise, période, statut, source, date), filtres, détail.
- **Actions** : **revérifier auprès de K-PAY** (même traitement idempotent que le webhook, jamais de double prolongation) ; **marquer comme payé à la main** * (motif, source `manuel`, visible comme tel partout, clé d'idempotence).
- **Traitement unique** : un seul service applique un paiement confirmé ; il est utilisé par le webhook, la revérification et le marquage manuel.
- **Revenus par devise** : encaissé du mois en cours et du mois précédent, abonnés payants actifs, répartition 1, 3 et 12 mois. Les paiements `manuel` et les jours offerts sont **étiquetés à part**, jamais comptés comme encaissement K-PAY. Aucune addition entre devises. Le taux de renouvellement est reporté après A4.
- **Alertes en haut de la vue d'ensemble** : paiements en attente depuis plus d'une heure, webhooks refusés, **incohérences** (paiement confirmé sans abonnement prolongé, abonnement actif sans paiement correspondant).
- **Export CSV** d'une période (date, référence, e-mail, montant, devise, période, statut, source) ; neutralisation de l'injection de formules (cellules commençant par `=`, `+`, `-`, `@`) ; l'e-mail d'un compte supprimé est vide.
- **Vue d'ensemble** : inscrits, vitrines publiées, abonnés payants, revenus par devise, jobs en échec (branchés en A4), indicateur de réussite (vitrines publiées avec au moins une visite ou une réservation sur 30 jours).

**Hors périmètre** : remboursements, factures PDF, relances WhatsApp, comptabilité détaillée, durée légale de conservation des paiements ⚠️ (à trancher avec un conseil juridique).

**Critères de réception**
- Revérifier un paiement de test confirmé prolonge l'abonnement **une seule fois**, même relancé plusieurs fois (preuve collée).
- Le marquage manuel crée un paiement `manuel`, prolonge l'abonnement, apparaît dans le journal.
- Les onglets correspondent aux vraies dates (horloge simulée).
- Les revenus de deux devises restent séparés ; aucune ligne ne les additionne ; `manuel` et offerts ne sont pas dans « encaissé K-PAY ».
- Une incohérence fabriquée est détectée ; un webhook à signature invalide incrémente le compteur sans stocker son contenu.
- L'export CSV ne contient aucun champ interdit, reflète les filtres et neutralise les formules.

**Tests** : idempotence, revenus multi-devises, incohérences, onglets, export (injection), journal, confidentialité.

---

# A4 — Supervision et registre des réglages

**Objectif** : voir si la plateforme est en bonne santé, relancer ce qui échoue, régler la plateforme sans redéployer, sans créer une page par réglage.
**Pré-requis** : A3. Le **job de sauvegarde** doit exister (S13 ou devops) ; sinon le critère « dernière sauvegarde » est retiré de ce sprint. **Maquettes** : aucune.

**Périmètre**
- **Jobs** : interface de supervision des files d'une bibliothèque existante (ex. Bull Board) sous Systèmes > Jobs, derrière le middleware admin ; relance d'un job en échec, purge limitée et journalisée. **Vérifier d'abord qu'un adaptateur maintenu fonctionne avec Nitro ; sinon petit process séparé derrière Nginx.** Alerte e-mail à l'admin quand les échecs dépassent un seuil sur 15 minutes ⚠️ ; le compteur alimente la vue d'ensemble.
- **Envois de codes** : migration d'une table d'envois (date, canal, **pays**, statut ; **aucun identifiant**) et instrumentation de l'envoi des codes (touche S1 et S9 : `regression-checker` obligatoire) ; tableau : codes par jour et par canal, taux d'échec, **volume par pays** (coût des SMS), identifiants les plus bloqués par la limite de débit (comptés, non nommés si cela expose un contenu), e-mails transactionnels envoyés et échoués.
- **IA** : générations par jour, jetons, durée moyenne, taux de repli, utilisateurs les plus consommateurs, quotas atteints (depuis `generations_ia`).
- **Installation PWA** : carte de la vue d'ensemble (depuis `pwa_install_events`) : proposée, installée, refusée, taux d'installation, par appareil et par origine (studio ou marketing), 30 jours. Aucune page dédiée.
- **Santé** : base, Redis, files, espace disque des images, dernière sauvegarde réussie (alerte au-delà de 26 h), version déployée.
- **Assistants (MCP)** : vue globale (clients et jetons actifs, journal des assistants, volumes) ; coupure globale via `MCP_ACTIF`.
- **Registre des réglages** (mécanisme 1, **une seule page « Réglages »**, filtrable par catégorie) : fichier de registre dans le code ; chaque entrée = clé, type, valeur par défaut, bornes min et max, catégorie, réauthentification requise ou non, modifiable ou lecture seule, validation croisée éventuelle (ex. limite par utilisateur ≤ limite globale). La table `reglages` ne stocke que les valeurs modifiées (clé, valeur, modifié par, date). Service unique `Reglages.lire(clé)` : valeur en base si présente, sinon configuration du code ; cache 5 s (le worker, process séparé, a le même cache) ; erreur de lecture → configuration du code.
  - Familles dans le registre : **limites de débit et plafonds IA** (`shared/limites.ts`, IA 10/h, 2000/jour, SEO 5/24 h, quota gratuit) ; **rétentions et délais** (textes IA 30 j, inscriptions abandonnées 90 j, indisponibilités 90 j, grâce 7 j, jetons OAuth orphelins 7 j, valeurs par défaut de l'agenda) ; **drapeaux** (`PAIEMENT_EN_LIGNE`, `MCP_ACTIF`, `SEO_IA_REGENERATION_ACTIVE`, arrêt de l'IA, `INSCRIPTIONS_OUVERTES`, `MAINTENANCE` et son **message** : page d'attente sur le studio, vitrines publiques en ligne, **l'admin reste accessible**) ; **comptes pilotes du MCP** = capacité accordée par compte, lue par `PlanService` (pas de second contrôle d'accès).
  - Les fonctionnalités existantes qui lisent ces valeurs passent par `Reglages.lire` (modification fichier par fichier, après lecture, avec `regression-checker`).
- **Journal d'audit** (page) : filtrable (admin, action, cible, période), détail avant et après.

**Hors périmètre** : plans, prix, pays, devises, fuseaux, prompts (A5) ; taux de renouvellement, analyse de parcours.

**Critères de réception**
- Un job volontairement en échec apparaît, se relance depuis l'interface, l'alerte part au seuil.
- Basculer `MAINTENANCE` affiche la page d'attente sur le studio sans toucher aux vitrines ni à l'admin ; la désactiver rétablit tout.
- Une valeur hors bornes est refusée ; une valeur modifiée prend effet en moins de 10 s sans redémarrage, dans l'application ET le worker ; une base illisible retombe sur la configuration du code.
- Ajouter un réglage au registre le fait apparaître sur la page sans écrire d'écran.
- Les compteurs d'envois, d'IA et d'installation PWA correspondent aux données de test ; la table d'envois ne contient aucun identifiant.
- Chaque changement figure dans le journal (avant, après, motif) ; les secrets n'apparaissent nulle part.

**Tests** : lecture des réglages (priorité, cache, erreur), bornes et validations croisées, effets de chaque drapeau, relance de job, alertes, instrumentation des envois (non-régression S1/S9), confidentialité.

---

# A5 — Configuration commerciale : catalogues et versions

**Objectif** : piloter pays, devises, fuseaux, plans, prix, frais et prompts IA depuis l'administration, **avec deux mécanismes génériques et non une page par cas**.
**Pré-requis** : A4. **Maquettes** : aucune. Touche le cœur (`PlanService`, onboarding, envoi de codes par pays) : `regression-checker` obligatoire.

**Périmètre**
- **Mécanisme 2 — Catalogues** (une page « Catalogues », un composant tableau + tiroir, champs décrits par un schéma ; quatre instances) :
  - **Pays** : table `pays` (code, libellé, actif, devise par défaut, fuseaux proposés, **canaux de code actifs : SMS, WhatsApp, e-mail**, paiement disponible). **Un pays utilisé n'est jamais supprimé** : on le désactive pour les nouvelles sélections.
  - **Devises** : activer ou désactiver parmi celles que le code sait gérer (`XAF`, `EUR`, `USD`, décimales et affichage restent dans le code). Une nouvelle devise reste un changement de code.
  - **Fuseaux** : catalogue par pays, validé par la liste IANA (`Intl`).
  - **Noms d'utilisateur bloqués** : liste en base (abus, marques) en complément des mots réservés du code.
- **Mécanisme 3 — Versions** (une page « Versions », un historique commun : créer une nouvelle version, date d'effet, activer, retour arrière, motif ; réauthentification pour activer) :
  - **Plans** : les **clés** (capacités) restent dans le code, les **valeurs** (limites, badge, statistiques, MCP…) sont en base, versionnées (`plan_versions`). `PlanService` lit la version active (cache court). **Aperçu d'impact obligatoire** avant d'enregistrer une baisse de limite : « N comptes verraient M éléments masqués » ; rien n'est supprimé. Pas de création de plan dans l'interface.
  - **Prix** : par devise et par période (`PRIX_PLANS`), versionnés ; **ne s'appliquent qu'aux paiements futurs** ; à l'initiation, le client envoie le montant qu'il a vu et **le serveur refuse en 409 s'il a changé** ; `PRIX_STATUT` devient un état « validé » activé avec réauthentification.
  - **Moyens de paiement et frais** : taux, supporteur, opérateurs actifs, versionnés ; l'instantané sur chaque paiement reste en place.
  - **Prompts IA** : éditer = **créer une nouvelle version** (jamais de modification d'une version utilisée) ; éditables : `systeme`, `gabarit`, `parametres` (avec bornes) ; **`schema_sortie` en lecture seule** (le code le valide) ; les variables du gabarit doivent appartenir à celles que le code fournit ; **essai à blanc** avec des entrées **synthétiques** (jamais de données d'utilisateurs), limité en nombre ; comparaison par version (taux de repli, rejets des garde-fous, jetons) ; retour arrière = réactiver la version précédente ; la vérification en code (accents, faits inventés, formulations interdites) ne dépend pas du prompt.
- Les écrans réutilisent le tableau, le tiroir et la boîte de confirmation d'A1 ; seuls l'aperçu d'impact (plans) et l'éditeur de texte (prompts) sont spécifiques, branchés dans le mécanisme commun.
- La validation de Zod côté serveur (devise, pays, fuseau) lit les catalogues (cache court) au lieu de listes en dur ; le type `Devise` du code ne change pas.

**Hors périmètre** : création de nouveaux plans, nouvelle devise sans changement de code, codes promotionnels, essais gratuits, édition des clés de capacités.

**Critères de réception**
- Désactiver un pays : il disparaît des nouvelles sélections, les profils existants restent valides ; le supprimer est refusé s'il est utilisé.
- Retirer le code par SMS d'un pays change le choix de canal de connexion sans redéploiement.
- Baisser une limite de plan : l'aperçu donne les bons chiffres ; après activation, les contenus en trop sont masqués publiquement, jamais supprimés ; le retour arrière les rétablit.
- Un prix modifié ne change pas un paiement déjà initié ; un client avec un ancien montant reçoit 409.
- Un prompt édité crée une version ; le retour arrière réactive la précédente ; un gabarit avec une variable inconnue est refusé ; l'essai à blanc n'accepte pas de donnée utilisateur.
- Chaque version, activation et retour arrière figure dans le journal.

**Tests** : catalogues (désactivation, refus de suppression), versions (activation, date d'effet, retour arrière), impact, 409 de prix, prompts (variables, schéma en lecture seule, essai à blanc), non-régression `PlanService`, onboarding et envoi de codes, confidentialité.

---

## Décisions à reporter dans PROJECT_STATE.md

**Tranchées** : administration sur `admin.jesuis.pro` ; plugin `admin` de Better Auth (sans impersonation) ; liste d'IP Nginx obligatoire ; pilotes MCP via `PlanService` ; configuration par registre (pas de page par réglage) ; plans et prix modifiables en base et versionnés ; devises : activation parmi celles du code ; `schema_sortie` des prompts en lecture seule.

**Ouvertes** : rappels aux visiteurs pour une vitrine suspendue (proposition : envoyés pour les rendez-vous déjà confirmés) ; montant du webhook K-PAY brut ou net (#13) ; durée légale de conservation des paiements ; second superadmin de secours ; passkey ; job de sauvegarde (S13) ; adaptateur de supervision des files compatible Nitro.

## Idées gardées pour la suite de l'administration

Analyse de parcours (inscription, publication, première réservation, paiement) · cohortes · taux de renouvellement · modération de signalements · « voir comme l'utilisateur » en lecture seule · rôle support en lecture seule · passkey · notifications d'alerte (WhatsApp ou téléphone) · création de plans et codes promotionnels · essais gratuits.
