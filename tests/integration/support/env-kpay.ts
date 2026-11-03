import { demarrerFauxKpay, KPAY_TEST_CLE_API, KPAY_TEST_CLE_SECRETE, KPAY_TEST_SECRET_WEBHOOK } from '../../support/faux-kpay'

// À importer EN PREMIER par tests/integration/setup.ts : `shared/env.ts` lit `process.env` une seule fois, à son
// premier import (qui a lieu dès que `server/utils/db` est chargé). Les variables K-PAY doivent donc exister avant.
//
// Tous les tests d'intégration partagent ainsi la même configuration de paiement : clés de TEST factices et
// `KPAY_BASE_URL` pointant sur un faux serveur K-PAY local (node:http, 127.0.0.1, port éphémère, un par fichier de
// test). Aucune requête ne part jamais vers le vrai K-PAY. Les tests qui exigent « K-PAY non configuré »
// (spec CA31, CA50) retirent temporairement les clés de l'objet `env` (voir `sansConfigurationKpay`).
//
// Les valeurs de l'environnement du développeur (clés réelles de son .env) sont ÉCRASÉES : un test d'intégration ne
// doit jamais pouvoir appeler le bac à sable réel ni dépendre d'un secret local.

export const fauxKpay = await demarrerFauxKpay()

process.env.KPAY_API_KEY = KPAY_TEST_CLE_API
process.env.KPAY_SECRET_KEY = KPAY_TEST_CLE_SECRETE
process.env.KPAY_WEBHOOK_SECRET = KPAY_TEST_SECRET_WEBHOOK
process.env.KPAY_BASE_URL = fauxKpay.url
process.env.KPAY_MODE_TEST_AUTORISE = 'false'
