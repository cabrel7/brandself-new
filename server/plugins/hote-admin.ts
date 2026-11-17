// A1 : Nitro sert `public/` (sw.js, manifest.json, offline.html, favicon, brand) AVANT les middlewares : en
// production, le handler statique est inséré en tête de la liste (`handlers.unshift`, nitropack rollup/index.mjs) ;
// le hook `request` s'exécute dans `onRequest` de h3, avant TOUT handler (h3 `createAppEventHandler`).
//
// Une erreur levée dans ce hook est AVALÉE par Nitro (`callHook("request").catch(captureError)`,
// nitropack runtime/internal/app.mjs) : on ne peut donc pas y lever le 404. On neutralise la méthode (le handler
// statique ignore tout ce qui n'est pas GET/HEAD, `runtime/internal/static.mjs`) ; la requête atteint ensuite
// `00-hote.ts`, qui lève le 404 uniforme (même décision, même corps). Une requête refusée ne sert donc jamais un fichier.
// Limite du mode dev : le serveur de développement sert `public/` dans le processus parent (nitropack core
// `serveStatic`), avant le worker Nitro : ce hook n'y est pas appelé. En dev, `/sw.js` reste lisible sur l'hôte admin.
import { evaluerHote, poserEntetesAdmin } from '../utils/hote'

/** Méthode sans effet : ni GET ni HEAD (pas de fichier statique), sans comportement propre dans Nitro. */
const METHODE_REFUSEE = 'OPTIONS'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    const { hoteAdmin, refuser } = evaluerHote(event)
    if (hoteAdmin) poserEntetesAdmin(event)
    if (refuser) event.node.req.method = METHODE_REFUSEE
  })
})
