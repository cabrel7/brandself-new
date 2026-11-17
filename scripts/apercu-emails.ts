// Décision #26, lot 1 : aperçu local des e-mails HTML (code de connexion + 4 e-mails de réservation au visiteur),
// pour les 5 palettes quand l'identité est celle du professionnel. Utilise les builders RÉELS : aucun gabarit dupliqué.
//
// Usage :
//   pnpm emails:apercu                 # écrit tmp/apercu-emails/ (.html, .txt, index.html) ; n'envoie rien
//   pnpm emails:apercu -- --mailpit    # envoie aussi chaque e-mail à Mailpit (http://localhost:8025) s'il est joignable
//   pnpm emails:apercu -- --mailpit --mailpit-url=http://localhost:8025
// Ouvrir ensuite tmp/apercu-emails/index.html dans un navigateur (mobile 390 px et PC 1280 px côte à côte).
// Données de démonstration FICTIVES uniquement ; destinataires en @exemple.test ; refuse de tourner en production.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PALETTES } from '../shared/palettes'
import type { Palette } from '../shared/palettes'
import { buildTransactionalEmail } from '../server/services/emails/contenus'
import type { TransactionalEmailContent } from '../server/services/emails/contenus'
import { buildOtpEmail } from '../server/services/emails/otp-contenu'
import type { EmailMessage } from '../server/services/emails/transport'

const DOSSIER = join(process.cwd(), 'tmp', 'apercu-emails')
const MAILPIT_URL_DEFAUT = 'http://localhost:8025'
const MAILPIT_DELAI_MS = 5000
const EXPEDITEUR = { Email: 'apercu@exemple.test', Name: 'Aperçu e-mails (dev)' }
const DOMAINE_FICTIF = '@exemple.test'
const SITE_URL = 'http://localhost:3000'
const LARGEUR_MOBILE = 390
const LARGEUR_PC = 1280
const HAUTEUR_CADRE = 900
const OTP_DEMO = { code: '123456', dureeMinutes: 10 } as const
const TYPES_VISITEUR = [
  'reservation_visiteur_recue',
  'reservation_visiteur_confirmee',
  'reservation_visiteur_annulee',
  'reservation_visiteur_refusee',
] as const
type TypeVisiteur = (typeof TYPES_VISITEUR)[number]

interface Apercu {
  /** Nom de fichier sans extension. */
  fichier: string
  titre: string
  message: EmailMessage
}

function option(nom: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${nom}=`))?.slice(nom.length + 3)
}

function contenuVisiteur(type: TypeVisiteur, palette: Palette): TransactionalEmailContent {
  const debut = new Date('2027-03-16T09:00:00Z')
  return {
    type,
    outboxId: `apercu-${type}-${palette}`,
    generatedAt: new Date('2027-03-01T08:00:00Z'),
    professionnelEmail: `pro${DOMAINE_FICTIF}`,
    siteUrl: SITE_URL,
    vitrine: {
      username: 'camille-demo',
      palette,
      emailContact: `contact${DOMAINE_FICTIF}`,
      titre: null,
      prenom: 'Camille',
      nom: 'Exemple',
      metier: 'Coach en organisation',
      ville: 'Douala',
      fuseau: 'Africa/Douala',
    },
    visiteur: { nom: 'Alex Démo', email: `alex.demo${DOMAINE_FICTIF}`, telephone: null, motif: null },
    service: {
      titre: 'Premier entretien',
      dureeMin: 45,
      tarif: 'paiement',
      prixMontant: 15000,
      prixDevise: 'XAF',
      paiementInstructions: 'Règlement par Mobile Money à la fin du rendez-vous.',
    },
    reservation: { id: `00000000-0000-4000-8000-${String(PALETTES.indexOf(palette)).padStart(12, '0')}`, debut, fin: new Date(debut.getTime() + 45 * 60_000), paiementChoisi: 'sur_place' },
  }
}

function construireApercus(): Apercu[] {
  const apercus: Apercu[] = [{
    fichier: 'connexion-code',
    titre: 'Code de connexion (identité de la plateforme)',
    message: buildOtpEmail({ destinataire: `alex.demo${DOMAINE_FICTIF}`, ...OTP_DEMO, siteUrl: SITE_URL }),
  }]
  for (const type of TYPES_VISITEUR) {
    for (const palette of PALETTES) {
      apercus.push({
        fichier: `${type}-${palette}`,
        titre: `${type} — palette ${palette}`,
        message: buildTransactionalEmail(contenuVisiteur(type, palette)),
      })
    }
  }
  return apercus
}

const echapper = (texte: string): string => texte.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Page de contrôle locale (outil de dev, pas un e-mail) : couleurs neutres par variables CSS locales. */
function pageIndex(apercus: Apercu[]): string {
  const liens = apercus.map((a) => `<li><a href="#${a.fichier}">${echapper(a.titre)}</a> · <a href="${a.fichier}.html">html</a> · <a href="${a.fichier}.txt">texte</a></li>`).join('\n')
  const cartes = apercus.map((a) => `<section id="${a.fichier}">
  <h2>${echapper(a.titre)}</h2>
  <p>Objet : ${echapper(a.message.subject)}</p>
  <div class="cadres">
    <figure><figcaption>Mobile ${LARGEUR_MOBILE} px</figcaption><iframe src="${a.fichier}.html" width="${LARGEUR_MOBILE}" height="${HAUTEUR_CADRE}" title="${echapper(a.titre)} (mobile)"></iframe></figure>
    <figure><figcaption>PC ${LARGEUR_PC} px</figcaption><iframe src="${a.fichier}.html" width="${LARGEUR_PC}" height="${HAUTEUR_CADRE}" title="${echapper(a.titre)} (PC)"></iframe></figure>
  </div>
</section>`).join('\n')
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><title>Aperçu des e-mails (dev)</title>
<style>
:root { --fond: #f4f4f5; --carte: #ffffff; --texte: #18181b; --bord: #d4d4d8; }
body { margin: 0; padding: 24px; background: var(--fond); color: var(--texte); font: 15px/1.5 system-ui, sans-serif; }
section { margin: 32px 0; }
.cadres { display: flex; gap: 24px; align-items: flex-start; overflow-x: auto; }
figure { margin: 0; flex: none; }
figcaption { font-weight: 600; margin-bottom: 6px; }
iframe { background: var(--carte); border: 1px solid var(--bord); }
</style></head><body>
<h1>Aperçu des e-mails (outil de développement local)</h1>
<ul>
${liens}
</ul>
${cartes}
</body></html>
`
}

async function ecrire(apercus: Apercu[]): Promise<string[]> {
  await rm(DOSSIER, { recursive: true, force: true })
  await mkdir(DOSSIER, { recursive: true })
  const produits: string[] = []
  const ecrireFichier = async (nom: string, contenu: string): Promise<void> => {
    await writeFile(join(DOSSIER, nom), contenu, 'utf8')
    produits.push(nom)
  }
  for (const a of apercus) {
    if (!a.message.html) throw new Error(`Version HTML absente pour « ${a.fichier} ».`)
    await ecrireFichier(`${a.fichier}.html`, a.message.html)
    await ecrireFichier(`${a.fichier}.txt`, a.message.text)
  }
  await ecrireFichier('index.html', pageIndex(apercus))
  return produits
}

/** Envoi par l'API HTTP de Mailpit (aucune bibliothèque SMTP dans le dépôt). Destinataires fictifs uniquement. */
async function envoyerMailpit(apercus: Apercu[], base: string): Promise<void> {
  try {
    const sonde = await fetch(`${base}/api/v1/info`, { signal: AbortSignal.timeout(MAILPIT_DELAI_MS) })
    if (!sonde.ok) throw new Error(`HTTP ${sonde.status}`)
  } catch {
    console.warn(`Mailpit n’est pas joignable à l’adresse ${base} : aucun e-mail envoyé. Lancez « docker compose up mailpit » puis réessayez.`)
    return
  }
  let envoyes = 0
  for (const { message, fichier } of apercus) {
    if (!message.to.endsWith(DOMAINE_FICTIF)) throw new Error(`Destinataire non fictif refusé pour « ${fichier} ».`)
    const corps = {
      From: EXPEDITEUR,
      To: [{ Email: message.to }],
      Subject: message.subject,
      Text: message.text,
      HTML: message.html ?? '',
      ...(message.replyTo ? { ReplyTo: [{ Email: message.replyTo }] } : {}),
      Attachments: message.attachments.map((p) => ({
        Filename: p.filename,
        Content: Buffer.from(p.content).toString('base64'),
        ContentType: p.contentType,
      })),
    }
    try {
      const reponse = await fetch(`${base}/api/v1/send`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(corps),
        signal: AbortSignal.timeout(MAILPIT_DELAI_MS),
      })
      if (!reponse.ok) throw new Error(`HTTP ${reponse.status}`)
      envoyes++
    } catch (erreur) {
      console.error(`Échec d’envoi de « ${fichier} » : ${erreur instanceof Error ? erreur.message : String(erreur)}`)
    }
  }
  console.info(`${envoyes} e-mail(s) sur ${apercus.length} envoyé(s) à Mailpit. Boîte de réception : ${base}`)
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Ce script de développement refuse de tourner avec NODE_ENV=production.')
  }
  const apercus = construireApercus()
  const produits = await ecrire(apercus)
  console.info(`${produits.length} fichier(s) écrit(s) dans ${DOSSIER} :`)
  for (const nom of produits) console.info(`  ${nom}`)
  console.info(`Ouvrez ${join(DOSSIER, 'index.html')} dans votre navigateur.`)
  if (process.argv.includes('--mailpit')) await envoyerMailpit(apercus, option('mailpit-url') ?? MAILPIT_URL_DEFAUT)
  else console.info('Aucun e-mail envoyé (ajoutez --mailpit pour les envoyer à Mailpit).')
}

main().catch((erreur: unknown) => {
  console.error('Génération des aperçus en échec :', erreur instanceof Error ? erreur.message : erreur)
  process.exit(1)
})
