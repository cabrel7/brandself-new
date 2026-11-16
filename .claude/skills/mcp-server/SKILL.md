---
managed-by: claude-system-v5
name: mcp-server
description: Utiliser pour construire un serveur MCP (Model Context Protocol) — outils/ressources exposés via @modelcontextprotocol/sdk, schémas d'entrée validés, fiabilité (timeouts, relances, disjoncteur), auth des clients, sécurité (pas d'action destructive non confirmée). Lire avant tout code MCP.
---

# Serveur MCP (Model Context Protocol)

## Base
- SDK officiel `@modelcontextprotocol/sdk`. Un serveur expose des **tools** (actions) et **resources** (lectures).
- Chaque tool : nom clair, description précise (c'est elle qui pilote l'usage par le LLM), **schéma d'entrée zod/JSON-Schema validé**.

## Structure d'un tool
```ts
server.tool('create_invoice', 'Crée une facture', createInvoiceSchema, async (args) => {
  const data = createInvoiceSchema.parse(args)          // valider TOUJOURS
  // ... logique via service, pas d'accès brut
  return { content: [{ type: 'text', text: JSON.stringify(result) }] }
})
```

## Fiabilité (obligatoire)
- **Timeout** par appel d'outil, **relances** avec backoff sur erreur transitoire, **disjoncteur** (circuit breaker) si un dépendant tombe.
- Erreurs renvoyées proprement au client (jamais de stack brute).
- Pas d'action destructive (DELETE, paiement) sans confirmation/garde explicite.

## Sécurité
- Auth des clients MCP (jeton/OAuth selon le contexte). Scope minimal par client.
- Un connecteur base de données n'expose JAMAIS du SQL libre — des opérations cadrées et paramétrées.
- Jamais de secret dans la description d'un tool ou dans une réponse.

## Anti-patterns interdits
Tool sans validation d'entrée · SQL libre exposé · action destructive sans garde · secret dans une réponse · pas de timeout/relance.
