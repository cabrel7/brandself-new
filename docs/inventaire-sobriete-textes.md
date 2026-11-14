# Inventaire de sobriété des textes (côté code, lecture seule)

Date : 2026-11-13. Aucun fichier de l'application modifié. Chemins relatifs à `app/`.
Critère : une phrase est retirée si son absence ne fait ni se poser une question ni se tromper. Les phrases « en quelques instants / prête en quelques minutes » sont **conservées** (décision de l'utilisateur).

Types : **A** réassurance non demandée · **B** précision technique inutile · **C** justification d'un geste évident · **D** slogan à la place d'une information, ou jargon.
Verdicts : **S** supprimer · **R** raccourcir · **D→** déplacer au moment utile · **G** garder.

Total relevé : A 27 · B 17 · C 64 · D 17 (lignes groupées comprises). Peu de tests dépendent de ces textes (`valable 10 minutes` 4 fichiers, `sans le supprimer` 1, `Rien n'est supprimé` 1, `heure de` 3).

## 0. Motifs répétés (à traiter d'un coup)

| Motif | Occurrences | Verdict |
|---|---|---|
| « Vos données / services sont intacts. », « Aucun message n'est perdu. » en fin de message d'échec de chargement | 21 écrans studio | R → « Nous n'avons pas pu charger X. » |
| « Vos X apparaissent ici dès que votre vitrine existe » | 15 écrans studio | S (le titre « Créons d'abord votre vitrine » suffit) |
| « Désactivez pour masquer ce/cette X sans le supprimer » | 4 formulaires | S |
| « Il a peut-être été supprimé depuis un autre appareil / identifiant invalide » | 6 écrans | S (garder « n'existe plus ») |
| « En envoyant, vous acceptez que vos informations soient transmises à {pro}… » | 3 formulaires visiteur | R, **à valider** (voir §6) |
| « … disponibles · heure de {ville} » sous chaque jour | agenda public (2) | R → « N créneaux » (fuseau dit une fois, voir §6) |

## 1. Connexion, landing, tarifs, onboarding

| Fichier:ligne | Texte | Type | Verdict |
|---|---|---|---|
| connexion/index.vue:69 | « Aucun mot de passe à retenir » (panneau PC) | A | S |
| connexion/index.vue:186 | « …Aucun mot de passe à retenir. » sous Bienvenue | A | S (garder « en quelques instants ») |
| connexion/index.vue:176 | « Créé avec soin à Douala » | D | S |
| connexion/index.vue:67-68 | « Une adresse simple à partager », « Des rendez-vous réservables en ligne » | D | R |
| connexion/index.vue:74,77 | « Nous vous envoyons un code à 6 chiffres… valable 10 minutes. » | B | S |
| connexion/index.vue:276 | « WhatsApp arrive bientôt. » | C | S |
| connexion/index.vue:227 | « Connexion Google bientôt disponible. Utilisez votre email… » | C | R → « Google bientôt disponible. » |
| connexion/index.vue:303 | « En continuant, vous acceptez les conditions… » | légal | G (en lien) |
| connexion/code.vue:248 | « Nous avons envoyé un code à 6 chiffres à… » | B | R → « Code envoyé à … » |
| connexion/code.vue:277 | « Le code expire dans 10 minutes. » | B | S (l'erreur d'expiration existe) |
| connexion/code.vue:297 | « Rien reçu ? Vérifiez vos courriels/messages indésirables. » | C | D→ quand « Renvoyer le code » devient actif |
| connexion/code.vue:285,130 | Décompte de renvoi, erreur d'essais | OK | G |
| connexion/code.vue:299-303 | « Code de test… worker… pnpm dev » | D | G (masqué en production : `import.meta.dev`) |
| index.vue + marketing/Promesse.vue:12 | « Être trouvé sur Google, être compris, être contacté ou réservé. » | D | S (répété par Fonctions) |
| marketing/Fonctions.vue:7 | « Votre vitrine fait trois choses » | D | S |
| marketing/Fonctions.vue:16,25,34 | Explications de bénéfice | OK | G |
| marketing/TarifsResume.vue:13 | « Un plan gratuit pour commencer, un plan payant quand… » | C | S |
| marketing/TarifsResume.vue:18 ; tarifs.vue:105 | « Pour toujours » | A | S |
| tarifs.vue:91 | « Commencez gratuitement. Passez au payant quand… » | C | S |
| tarifs.vue:126 | « Vous payez une période. Pas de renouvellement automatique : nous vous prévenons… » | A | R → « Sans renouvellement automatique. » |
| tarifs.vue:127 | « À l'échéance, N jours de grâce : rien n'est supprimé. » | A | **à décider** (voir §6) |
| tarifs.vue:136 | « Douala, Cameroun » | D | S |
| tarifs.vue:117 | « Le paiement en ligne arrive bientôt. » | OK | G |
| onboarding.vue:92 | « Vos informations sont gardées. » | A | S |
| utils/onboarding.ts:24 | « Bienvenue. Construisons votre vitrine ensemble. » | D | S |
| utils/onboarding.ts:25 | « C'est la première chose que vos visiteurs regardent. » | C | S |
| utils/onboarding.ts:26 + SOUS_TITRE_REPLI | « …Choisissez, corrigez, c'est vous qui décidez. » | A | R → « Choisissez et corrigez. » |
| utils/onboarding.ts:27 | « C'est le lien que vous partagerez à vos patients et clients. » | C | S |
| onboarding/EtapeProposition.vue:92 | « Modifiable à tout moment. Rien n'est publié sans votre accord. » | A | S |
| onboarding/EtapeProposition.vue:42 | « …Cela prend quelques secondes. » / « Encore un instant, nous relisons chaque phrase. » | C | R → « Nous rédigeons votre proposition… » |
| onboarding/EtapePhoto.vue:15-17 | Trois conseils de photo | C/D | S (ou 1 ligne) |
| onboarding.vue:53-60 | Aides `sr-only` « en cours de vérification / de rédaction » | C | S |
| desabonnement.vue:38 | « Vous pourrez le réactiver à tout moment… » | A | S |
| InstallPrompt.vue:83,130 | « …sans retenir l'adresse » | A/D | R → « Ouvrez votre studio comme une application. » |

## 2. Studio : assistants, compte, profil, accueil

| Fichier:ligne | Texte | Type | Verdict |
|---|---|---|---|
| assistants/index.vue:116 | « Le serveur MCP n'est pas encore activé… » | D | R → « Pas encore disponible pour votre compte. » |
| assistants/index.vue:21 | « …autorisez les portées demandées » | B | R (retirer « portées ») |
| assistants/index.vue:155-156 | « …possibilité de retirer son accès à tout moment » | A | S |
| assistants/index.vue:235 | Réglage « détail » désactivé, « Bientôt disponible » | D | S tant qu'inactif (**écart décision #21**) |
| assistants/index.vue:243-245 | Avertissement secret professionnel | légal | R, afficher à l'activation |
| assistants/index.vue:249-250 | « Par défaut, votre assistant ne voit que la date… » | A | S (déjà dit à l'autorisation) |
| assistants/index.vue:279-280 | « Le journal garde les 50 dernières actions… » | B | R → « Aucune action pour l'instant. » |
| assistants/autorisation.vue:116 | « Toujours accordé. » | C | S |
| assistants/autorisation.vue:141-142 | « …ne peut rien supprimer ni publier… » | G | R |
| assistants/autorisation.vue:152 | « Ce nom est déclaré par l'assistant… » | sécurité | R, garder |
| assistants/autorisation.vue:190 | « Vous pourrez retirer cet accès à tout moment… » | A | S |
| compte.vue:109 | « Adresse vérifiée » | A | S |
| compte.vue:163-165 | « Les e-mails liés à vos réservations… toujours envoyés » | C | S |
| compte.vue:198-200 | « L'application est déjà installée… » | C | S |
| compte.vue:216 | « Aucun mot de passe à gérer. » | A | S |
| compte.vue:314 | « …supprimés définitivement. Cette action est irréversible. » | G | R (un seul des deux mots) |
| profil.vue:149-160 | « N sur 80 caractères » | B | D→ près de la limite |
| profil.vue:198 | « Format international, par exemple +237… » | C | S (placeholder) |
| profil.vue:267 | « Le lien actuel cessera de fonctionner… » | G | G |
| studio/profil/SeoGoogle.vue:77 | « Titre et description affichés… nous les écrivons pour vous… » | B | R → « Laissez vide pour un texte automatique. » |
| studio/profil/SeoGoogle.vue:32 | « …Si vous écrivez le vôtre : 30 à 60 caractères. » | B | R |
| studio/AmeliorationIa.vue:43 | « L'IA reformule votre texte, vous validez… » | A | S |
| index.vue:144 | « Votre vitrine n'est visible que par vous. Publiez-la… » | C | R → « Pas encore publiée. » |
| studio/ProchaineEtape.vue (shared/prochaine-etape.ts:19-43) | « Un visage rassure vos visiteurs… » etc. | D | S ou bénéfice factuel |
| studio/AbonnementBandeau.vue:24 | « …Rien n'est supprimé. » | A | R |
| messages.vue:110,181-183 | « Ils arrivent surtout après la mise en ligne… », « Les messages arrivent aussi par email… » | C | R / S |

## 3. Studio : agenda

| Fichier:ligne | Texte | Type | Verdict |
|---|---|---|---|
| agenda/disponibilites.vue:126-127 | « Les visiteurs ne peuvent réserver que dans ces plages. » | C | S |
| StudioAgendaDisponibilites.vue:153,169 | « Délai minimal avant une réservation. », « Période ouverte… » | C | R (renommer les libellés) |
| StudioAgendaIndisponibilites.vue:94 | « Les dates où vous êtes absent… » | C | S |
| StudioAgendaIndisponibilites.vue:212 | « Indiquez ci-dessus vos congés… » | C | R → « Aucune date fermée. » |
| StudioAgendaIndisponibilites.vue:227 | « Les créneaux habituels seront de nouveau proposés… » | C | S |
| agenda/FeuilleJour.vue:78 | « Heures d'ouverture de ce jour. » | C | S |
| agenda/FeuilleJour.vue:170 | « Ce jour est fermé : personne ne peut réserver. » | C | R → « Ce jour est fermé. » |
| agenda/FeuilleJour.vue:33-34,166 | « Les heures de ces jours seront remplacées », limite de plages | G | G |
| StudioAgendaActivite.vue:69 | « Rien de passé — tout est traité » | D | R → « Aucun rendez-vous passé » |
| StudioAgendaActivite.vue:72-74 | « …apparaîtront ici. » (3 états vides) | C | S |

## 4. Studio : formulaires et listes

| Fichier:ligne | Texte | Type | Verdict |
|---|---|---|---|
| StudioServiceForm.vue:82 | « Le type adapte le bouton et le parcours… » | C | S |
| StudioServiceForm.vue:42 | « Exemple : 12,50 (deux décimales au plus). » / « Montant entier… » | B | R (exemple seul) |
| StudioServiceForm.vue:135 | « Une prestation sur devis n'a pas de tarif fixe… » | G | R |
| StudioServiceForm.vue:195 | « Une ligne par élément, N au maximum (M caractères…) » | B | R → « Une ligne par élément. » |
| StudioServiceForm.vue:208 ; StudioTemoignageForm.vue:296 ; StudioRealisationForm.vue:31 ; studio/LienForm.vue:280 | « Désactivez pour masquer… sans le supprimer » | C | S |
| StudioServiceForm.vue:216 | « Le visiteur peut réserver ou faire sa demande… » | C | S |
| StudioServicePhoto.vue:97 | « Elle s'affiche sur la fiche du service. » | C | S |
| StudioRealisationForm.vue:95-96 | « Racontez le contexte, votre rôle et le résultat. » | C | S |
| StudioRealisationForm.vue:31 | « Disponible dès que l'image principale est ajoutée. » | G | G |
| StudioTemoignageForm.vue:27,284 | « …mis en avant sur votre accueil », « Affiché tel quel… » | C | S |
| StudioTemoignageForm.vue:85,87 | Témoignage masqué / vedette | G | G |
| studio/LienForm.vue:211 | « Le texte du bouton. » | C | S |
| studio/PartageVitrine.vue:30 | « Un message prêt à envoyer, et un QR code… » | C | S |
| studio/MenuCompte.vue:161 | « Elle ne sera plus visible tant que… » | G | R |
| services/index.vue:57 ; realisations/index.vue:43 ; temoignages/index.vue:45 ; liens/index.vue:210 | Slogans d'état vide | D | R → action seule |
| services/index.vue:118 | « L'interrupteur masque un service… » | C | S |
| realisations/index.vue:103 | « La première réalisation en vedette… » | B | S |
| temoignages/index.vue:105 ; liens/index.vue:227 | « Glissez… pour changer leur ordre… » | C | S |
| liens/index.vue:236 | « Vos visiteurs peuvent le scanner… » | C | S |
| studio/abonnement/AbonnementCarte.vue:136 | « Vous profitez du plan gratuit. » | D | S |
| studio/abonnement/AbonnementCarte.vue:194 | « …Nous vous envoyons un rappel 7 jours et 3 jours avant… » | B | R (1re phrase) |
| studio/abonnement/SuiviPaiement.vue:53 | « Merci. Un récapitulatif vous est envoyé par e-mail. » | A | R → « Merci. » |
| studio/StatistiquesDetail.vue:44 | « Les périodes de 30 et 90 jours sont incluses… » | B | D→ au clic sur 30/90 j |
| shared/plans.ts:61+ (LimitePlanMessage) | « …et le badge jesuis.pro disparaît » | G | R (retirer la 2e proposition) |

## 5. Pages visiteur : réservation, agenda, contact, vitrine

| Fichier:ligne | Texte | Type | Verdict |
|---|---|---|---|
| reservation/ReservationForm.vue:72 | « Votre confirmation sera envoyée ici. » | C | S |
| reservation/ReservationForm.vue:88 | « Quelques mots pour préparer votre venue. » | C | S |
| reservation/ReservationForm.vue:114-119 | « Comment souhaitez-vous régler ? » + « Vous réglerez directement… » | C | R → « Règlement sur place. » |
| reservation/ReservationForm.vue:161 ; DemandeForm.vue:199 ; contact/ContactMessageForm.vue:129 | « En envoyant, vous acceptez que vos informations… » | A | R, **à valider** |
| composables/useReservation.ts:19 | « 24 heures avant le rendez-vous. » | B | G |
| reservation/DemandeForm.vue:134 | « {pro} vous répondra personnellement. » | A | S |
| reservation/DemandeForm.vue:30-31 | « Précisez vos attentes… », « Décrivez brièvement… » | C | S |
| reservation/DemandeForm.vue:127 | « {pro} vous répondra prochainement au sujet de… » | C | R → « {pro} vous répondra. » |
| contact/ContactMessageForm.vue:104 | « Quelques lignes suffisent. » | C | S |
| contact/ContactMessageForm.vue:46 | « …{pro} vous répond dès que possible. » | C | R |
| pages/[username]/contact.vue:2 | « …Écrivez-moi, je vous réponds dès que possible. » | C | R → « Une question avant de réserver ? » |
| contact/ContactInfos.vue:39 | « Choisissez directement un créneau dans l'agenda. » | C | S |
| agenda/AgendaReservation.vue:351 | « Vous confirmez vos informations à l'étape suivante. » | C | S |
| agenda/AgendaPublic.vue:283 | « Votre demande sera confirmée par le professionnel. » | A | D→ à l'envoi (déjà sur la confirmation) |
| agenda/AgendaPublic.vue:159 ; pages/[username]/agenda.vue:57 | « Choisissez un service, un jour, puis une heure. » | C | S |
| agenda/AgendaPublic.vue:117 ; AgendaReservation.vue:136 | « …disponibles · heure de {ville} » | B | R → « N créneaux » (fuseau une fois, §6) |
| agenda/AgendaReservation.vue:326 ; AgendaPublic.vue:278 | « …Choisissez un jour marqué d'un point. » | C | R → « Aucun créneau ce jour. » |
| agenda/AgendaReservation.vue:280 | « …revenez plus tard ou regardez le mois suivant. » | C | R |
| agenda/AgendaReservation.vue:271 | Légende du point | G | G |
| pages/[username]/agenda.vue:69 | « Écrivez-le depuis la page Contact pour convenir… » | C | R |
| pages/[username]/reserver.vue:110,137 | « Revenez à l'agenda pour choisir le service… » / « Consultez les horaires encore libres. » | C | R |
| reserver/confirmation.vue:116 | « …Aucune information personnelle n'est affichée sur cette page. » | A | R |
| reserver/confirmation.vue:98,107 | « …ce récapitulatif temporaire… », « Revenez à la vitrine pour consulter… » | B/C | R |
| utils/confirmation-reservation.ts:27 | « {pro} vous confirmera ce rendez-vous par email. » | G | G |
| utils/confirmation-reservation.ts:34,41,48 | « …un email de confirmation vous a été envoyé », « Vous pouvez choisir un nouveau créneau », « Vous pouvez en choisir un autre » | C | R |
| utils/confirmation-reservation.ts:55 | « Cette réservation est terminée. » | C | S |
| pages/[username]/services/index.vue:26 | « Choisissez la prestation qui correspond… » | C | S |
| pages/[username]/realisations/index.vue:27 | « Quelques projets qui montrent ma façon de travailler. » | D | S |
| vitrine/EnLigne.vue:31 | « Votre vitrine est publiée. Voici votre adresse… » | C | R → « Votre adresse : » |

## 6. Points à décider (je ne devine pas)

1. **Vocabulaire médical codé en dur** (défaut réel, pas de la sobriété) : `contact/ContactInfos.vue:28` « Cabinet » et `reservation/ReservationForm.vue:89` « Motif de la consultation (facultatif) » s'affichent pour tout métier. À rendre neutres (« Lieu », « Motif »).
2. **Consentement** (« En envoyant, vous acceptez que vos informations soient transmises à {pro} ») : le raccourcir affaiblit une mention de consentement. Proposition : « Vos informations sont transmises à {pro} pour ce rendez-vous. » (garde la finalité). À valider.
3. **Fuseau horaire** : le retirer de chaque jour est bon, mais il en faut **une** mention sur l'agenda (un visiteur à l'étranger se tromperait d'heure). Détection côté client écartée : casse l'hydratation des pages rendues par le serveur.
4. **tarifs.vue:127** (« N jours de grâce : rien n'est supprimé ») : c'est un fait produit (décisions #4 et #5), pas seulement une réassurance. Proposition : le retirer de la page tarifs et le dire dans le bandeau d'expiration, au moment où il compte.
5. **Réglage « détail » des assistants** (décision #21, inactif) : le supprimer de l'écran tant qu'il n'est pas actif. Écart par rapport à la maquette.
6. **E-mails et SMS** exclus de cet inventaire (leur texte est figé par des tests ; « valable 10 minutes » reste dans le code reçu).
