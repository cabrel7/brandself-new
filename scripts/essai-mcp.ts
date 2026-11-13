// S16 : essai de bout en bout du serveur MCP en dev, SANS IA. Ce script joue le rôle de Claude/ChatGPT :
// enregistrement dynamique du client (RFC 7591), connexion par code e-mail (boîte de dev), autorisation PKCE,
// consentement, jeton d'accès, puis client MCP officiel (initialize, tools/list, tools/call).
//
// Prérequis : `MCP_ACTIF=true pnpm dev` (app + worker, le worker dépose le code dans la boîte de dev).
// Usage :
//   pnpm exec tsx scripts/essai-mcp.ts                                  # compte payant de démo, lecture seule
//   pnpm exec tsx scripts/essai-mcp.ts --email=cabrel@brandself.test   # compte gratuit : consentement refusé (403)
//   pnpm exec tsx scripts/essai-mcp.ts --ecriture                       # ajoute creer_service (contenu masqué)
// Vérifie aussi : jeton de renouvellement, nom public du client, HEAD sur la découverte, `actif` refusé.
//   pnpm exec tsx scripts/essai-mcp.ts --url=http://localhost:3000
// Lecture seule par défaut : jamais de contenu écrit sans --ecriture.
import { createHash, randomBytes } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const EMAIL_PAYANT_DEFAUT = 'cabrel-payant@brandself.test'
const REDIRECT_URI = 'http://localhost:8976/callback'
const PORTEES = 'vitrine:lecture contenu:ecriture reservations:lecture messages:lecture offline_access'
const ATTENTE_CODE_MAX = 30
const ATTENTE_CODE_MS = 1000
const DELAI_HEAD_MS = 10_000

function option(nom: string): string | undefined {
  return process.argv.find((arg) => arg.startsWith(`--${nom}=`))?.slice(nom.length + 3)
}

const base = option('url') ?? 'http://localhost:3000'
const email = option('email') ?? EMAIL_PAYANT_DEFAUT
const avecEcriture = process.argv.includes('--ecriture')
const ressource = `${base}/mcp`

const cookies = new Map<string, string>()
function memoriserCookies(reponse: Response): void {
  for (const ligne of reponse.headers.getSetCookie()) {
    const [paire] = ligne.split(';')
    const [nom, ...valeur] = (paire ?? '').split('=')
    if (nom) cookies.set(nom.trim(), valeur.join('='))
  }
}
const entetesCookie = (): Record<string, string> => ({
  origin: base,
  cookie: [...cookies].map(([nom, valeur]) => `${nom}=${valeur}`).join('; '),
})

async function postJson(chemin: string, corps: unknown): Promise<Response> {
  const reponse = await fetch(`${base}${chemin}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...entetesCookie() },
    body: JSON.stringify(corps),
    redirect: 'manual',
  })
  memoriserCookies(reponse)
  return reponse
}

function etape(titre: string, valeur?: unknown): void {
  console.info(`\n== ${titre}`)
  if (valeur !== undefined) console.info(typeof valeur === 'string' ? valeur : JSON.stringify(valeur, null, 2))
}

async function main(): Promise<void> {
  const enregistrement = await postJson('/api/auth/oauth2/register', {
    client_name: 'Essai MCP (dev)',
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: PORTEES,
  })
  const client = (await enregistrement.json()) as { client_id?: string }
  etape(`DCR -> HTTP ${enregistrement.status}`, client)
  if (!client.client_id) throw new Error('Enregistrement refusé.')

  const lireBoite = async (): Promise<string | null> => {
    const boite = await fetch(`${base}/api/dev/boite-otp?identifiant=${encodeURIComponent(email)}`)
    return ((await boite.json()) as { code: string | null }).code
  }
  // La boîte garde le dernier code : on attend un code DIFFÉRENT de celui déjà présent.
  const ancienCode = await lireBoite()
  await postJson('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
  let code: string | null = null
  for (let essai = 0; essai < ATTENTE_CODE_MAX && (!code || code === ancienCode); essai++) {
    await new Promise((resolve) => setTimeout(resolve, ATTENTE_CODE_MS))
    code = await lireBoite()
  }
  if (!code || code === ancienCode) throw new Error('Aucun code reçu dans la boîte de dev (le worker tourne-t-il ?).')
  const connexion = await postJson('/api/auth/sign-in/email-otp', { email, otp: code })
  etape(`Connexion ${email} -> HTTP ${connexion.status}`)

  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const autorisation = new URL(`${base}/api/auth/oauth2/authorize`)
  for (const [cle, valeur] of Object.entries({
    client_id: client.client_id,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: PORTEES,
    state: 'etat-essai',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    resource: ressource,
  })) autorisation.searchParams.set(cle, valeur)
  const redirection = await fetch(autorisation, { headers: entetesCookie(), redirect: 'manual' })
  // Better Auth répond soit par une redirection, soit par `{ redirect: true, url }` (appel fetch).
  const corpsAutorisation = redirection.status === 200 ? ((await redirection.json()) as { url?: string }) : {}
  const lieu = redirection.headers.get('location') ?? corpsAutorisation.url ?? ''
  etape(`authorize -> HTTP ${redirection.status}`, `Location : ${lieu.split('?')[0]}`)
  const requeteOauth = lieu.includes('?') ? lieu.slice(lieu.indexOf('?') + 1) : ''

  // Nom public du client (écran de consentement).
  const publicClient = await fetch(`${base}/api/auth/oauth2/public-client?client_id=${encodeURIComponent(client.client_id)}`, { headers: entetesCookie() })
  etape(`public-client -> HTTP ${publicClient.status}`, await publicClient.json())

  // HEAD sur la découverte : doit répondre, pas pendre.
  try {
    const head = await fetch(`${base}/.well-known/oauth-authorization-server`, { method: 'HEAD', signal: AbortSignal.timeout(DELAI_HEAD_MS) })
    etape(`HEAD /.well-known/oauth-authorization-server -> HTTP ${head.status}`, head.headers.get('content-type') ?? '(sans content-type)')
  } catch (erreur) {
    etape('HEAD /.well-known/oauth-authorization-server -> ÉCHEC', erreur instanceof Error ? erreur.message : String(erreur))
  }

  const consentement = await postJson('/api/auth/oauth2/consent', { accept: true, oauth_query: requeteOauth })
  const retour = (await consentement.json()) as { url?: string }
  etape(`consent (accept: true) -> HTTP ${consentement.status}`, consentement.ok ? `url : ${retour.url?.split('?')[0]}` : retour)
  if (!consentement.ok) {
    // Compte gratuit : l'acceptation est refusée, le refus reste permis.
    const refus = await postJson('/api/auth/oauth2/consent', { accept: false, oauth_query: requeteOauth })
    etape(`consent (accept: false) -> HTTP ${refus.status}`, `url : ${((await refus.json()) as { url?: string }).url?.split('?')[0]}`)
    return
  }
  const codeAutorisation = retour.url ? new URL(retour.url).searchParams.get('code') : null
  if (!codeAutorisation) throw new Error('Pas de code d’autorisation.')

  const jetonReponse = await fetch(`${base}/api/auth/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: codeAutorisation,
      code_verifier: verifier,
      client_id: client.client_id,
      redirect_uri: REDIRECT_URI,
      resource: ressource,
    }),
  })
  const jeton = (await jetonReponse.json()) as { access_token?: string, scope?: string, expires_in?: number, refresh_token?: string }
  etape(`token -> HTTP ${jetonReponse.status}`, {
    scope: jeton.scope,
    expires_in: jeton.expires_in,
    jwt: jeton.access_token?.split('.').length === 3,
    refresh_token: Boolean(jeton.refresh_token),
  })
  if (!jeton.access_token) throw new Error('Pas de jeton d’accès.')

  const mcp = new Client({ name: 'essai-mcp', version: '1.0.0' })
  await mcp.connect(new StreamableHTTPClientTransport(new URL(ressource), {
    requestInit: { headers: { authorization: `Bearer ${jeton.access_token}` } },
  }))
  etape('initialize', { serveur: mcp.getServerVersion(), capacites: mcp.getServerCapabilities() })

  const { tools } = await mcp.listTools()
  etape(`tools/list : ${tools.length} outils`, tools.map((outil) => `${outil.name} (${outil.inputSchema.type}, lecture seule : ${outil.annotations?.readOnlyHint})`).join('\n'))

  etape('tools/call obtenir_vitrine', await mcp.callTool({ name: 'obtenir_vitrine', arguments: {} }))
  const services = await mcp.callTool({ name: 'lister_services', arguments: {} })
  etape('tools/call lister_services', services)

  // `actif` n'est pas un argument de modifier_service : un assistant ne publie jamais. Refus attendu.
  const premier = JSON.parse(String((services.content as Array<{ text?: string }>)[0]?.text ?? '[]')) as Array<{ id?: string }>
  const idService = premier[0]?.id
  if (idService) {
    try {
      etape('tools/call modifier_service { actif: true } (refus attendu)', await mcp.callTool({ name: 'modifier_service', arguments: { id: idService, actif: true } }))
    } catch (erreur) {
      etape('tools/call modifier_service { actif: true } -> rejeté', erreur instanceof Error ? erreur.message : String(erreur))
    }
  } else {
    etape('modifier_service { actif: true } non essayé : aucun service dans la vitrine')
  }
  if (avecEcriture) {
    const arguments_ = { titre: 'Essai MCP', type: 'rdv', dureeMin: 30, tarif: 'gratuit', cle_idempotence: `essai-${Date.now()}` }
    etape('tools/call creer_service (1re fois)', await mcp.callTool({ name: 'creer_service', arguments: arguments_ }))
    etape('tools/call creer_service (rejeu, même clé)', await mcp.callTool({ name: 'creer_service', arguments: arguments_ }))
  }
  await mcp.close()

  // Jeton de renouvellement : un nouveau jeton d'accès, utilisable sur /mcp.
  if (jeton.refresh_token) {
    const renouvellement = await fetch(`${base}/api/auth/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: jeton.refresh_token, client_id: client.client_id, resource: ressource }),
    })
    const nouveau = (await renouvellement.json()) as { access_token?: string, expires_in?: number, refresh_token?: string, error?: string }
    etape(`refresh_token -> HTTP ${renouvellement.status}`, {
      nouveau_jeton: Boolean(nouveau.access_token),
      different_de_l_ancien: nouveau.access_token !== jeton.access_token,
      expires_in: nouveau.expires_in,
      nouveau_refresh_token: Boolean(nouveau.refresh_token),
      error: nouveau.error,
    })
    if (nouveau.access_token) {
      const mcp2 = new Client({ name: 'essai-mcp-refresh', version: '1.0.0' })
      await mcp2.connect(new StreamableHTTPClientTransport(new URL(ressource), {
        requestInit: { headers: { authorization: `Bearer ${nouveau.access_token}` } },
      }))
      etape('tools/call obtenir_vitrine (jeton renouvelé)', await mcp2.callTool({ name: 'obtenir_vitrine', arguments: {} }))
      await mcp2.close()
    }
  }
}

main().catch((erreur: unknown) => {
  console.error('Essai en échec :', erreur instanceof Error ? erreur.message : erreur)
  process.exit(1)
})
