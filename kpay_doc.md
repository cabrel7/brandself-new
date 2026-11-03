# KPAY-NOW — API integration context

This document covers Payin, Payout, signed callbacks, testing, and prepared
framework examples. Use the live OpenAPI specification for exact schemas.

- Base URL: `https://admin.kpay.site`
- API version: `v1`
- Environment: selected by the `kpay_test_` or `kpay_live_` API key prefix
- Generated: 2026-11-03T09:23:47.935Z
- API request examples: Node.js

## Authentication and environments

Send `X-API-Key` and `X-Secret-Key` on authenticated server requests.
Keep both keys and the application webhook secret off the browser.
The base URL is the same in sandbox and production. Configure a callback
URL before initiating a payment or withdrawal.

## Payin — collect a payment

- Endpoint: `POST /api/v1/payments/init`.
- USSD body: `amount`, `provider`, `phoneNumber`, `externalId`.
- `externalId` is a stable business ID. A duplicate returns HTTP 409.
- Optional fields include `currency`, `description`, `customerEmail`, and `metadata`.
- Gateway mode requires `returnUrl`; the customer selects the operator on the hosted page.
- `paymentMethod: CARD` opens the hosted card page. Without `currency`, the card amount is USD.
- The initiation response includes an ID, reference, and initial status. It does not confirm success.

```javascript
const res = await fetch("https://admin.kpay.site/api/v1/payments/init", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.KPAY_API_KEY,
    "X-Secret-Key": process.env.KPAY_SECRET_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    "amount": 5000,
    "provider": "MTN_MOMO_CMR",
    "phoneNumber": "237653456789",
    "externalId": "ORDER-12345"
  }),
});
const data = await res.json();
```

Confirm only after a signed `payment.completed` webhook. Handle
`payment.failed` and `payment.cancelled` idempotently.

## Payout — send money

- Endpoint: `POST /api/v1/payments/withdraw`.
- USSD body: `amount`, `provider`, `phoneNumber`, and a stable `externalId`.
- For a bank transfer, send a saved `bankAccountId` instead of Mobile Money details.
- Gateway mode requires `returnUrl`; the recipient enters details on the hosted page.
- `sourceCountry` selects the wallet to debit for supported cross-country payouts.
- The full amount must be available in your wallet; insufficient balance returns HTTP 422.
- The initiation response is not the final result.

```javascript
const res = await fetch("https://admin.kpay.site/api/v1/payments/withdraw", {
  method: "POST",
  headers: {
    "X-API-Key": process.env.KPAY_API_KEY,
    "X-Secret-Key": process.env.KPAY_SECRET_KEY,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    "amount": 5000,
    "provider": "MTN_MOMO_CMR",
    "phoneNumber": "237653456789",
    "externalId": "WD-ORDER-98765"
  }),
});
const data = await res.json();
```

Confirm only after a signed `payout.completed` webhook. Handle
`payout.failed` and `payout.cancelled` idempotently.

## Refunds

Use `POST /api/v1/payments/:id/refund` for an eligible completed Payin.
The merchant wallet reserves the refund amount. Handle `refund.completed`,
`refund.failed`, and `refund.cancelled` via signed callbacks.

## Retrieve a transaction

`GET /api/v1/payments/:id` returns the current status and details of a payment,
payout or refund. `:id` accepts the `id` (UUID) or the `reference` (KPAY-…).
Test keys only see sandbox transactions, live keys only live ones; otherwise `404`.
Webhooks stay the authority; poll at most every 5–10 s and stop on a terminal status.

## Webhooks and final status

Configure Payin and Payout callback URLs on the application. KPAY-NOW sends a POST
with `event`, `paymentId`, `reference`, `status`, `amount`, `externalId`,
and `timestamp`. Verify the `X-KPAY-Signature` HMAC-SHA256 hex value
against the raw request body using the application webhook secret.
Compare in constant time. Deduplicate by `paymentId` plus `event`.
Only terminal events should change business state. Respond with HTTP 2xx
after idempotent processing. Redirect URLs are for display only.

```json
{
  "event": "payout.completed",
  "paymentId": "tx_abc123",
  "reference": "KPAY-WD-20261019-ABC123",
  "status": "COMPLETED",
  "amount": 5000,
  "externalId": "WD-ORDER-98765",
  "timestamp": "2026-10-19T12:00:00.000Z"
}
```

## Provider catalogue

Use the exact provider code in USSD requests. Currency and country are
derived from that code. The catalogue below is mirrored from the frontend
provider data; consult the live provider endpoint for current availability.

| Country code | Dial code | Operator | Provider code | Currencies | Decimal policy |
| --- | --- | --- | --- | --- | --- |
| BEN | +229 | MTN | `MTN_MOMO_BEN` | XOF | Whole units |
| BEN | +229 | Moov | `MOOV_BEN` | XOF | Whole units |
| CMR | +237 | MTN | `MTN_MOMO_CMR` | XAF | Whole units |
| CMR | +237 | Orange | `ORANGE_CMR` | XAF | Whole units |
| CIV | +225 | MTN | `MTN_MOMO_CIV` | XOF | Whole units |
| CIV | +225 | Orange | `ORANGE_CIV` | XOF | Whole units |
| COD | +243 | Vodacom M-Pesa | `VODACOM_MPESA_COD` | CDF, USD | Varies |
| COD | +243 | Airtel | `AIRTEL_COD` | CDF, USD | 2 decimals |
| COD | +243 | Orange | `ORANGE_COD` | CDF, USD | 2 decimals |
| GAB | +241 | Airtel | `AIRTEL_GAB` | XAF | 2 decimals |
| KEN | +254 | M-Pesa | `MPESA_KEN` | KES | Varies |
| COG | +242 | Airtel | `AIRTEL_COG` | XAF | Whole units |
| COG | +242 | MTN | `MTN_MOMO_COG` | XAF | Whole units |
| RWA | +250 | Airtel | `AIRTEL_RWA` | RWF | Whole units |
| RWA | +250 | MTN | `MTN_MOMO_RWA` | RWF | Whole units |
| SEN | +221 | Free | `FREE_SEN` | XOF | Whole units |
| SEN | +221 | Orange | `ORANGE_SEN` | XOF | Whole units |
| SLE | +232 | Orange | `ORANGE_SLE` | SLE | 2 decimals |
| UGA | +256 | Airtel | `AIRTEL_OAPI_UGA` | UGX | Whole units |
| UGA | +256 | MTN | `MTN_MOMO_UGA` | UGX | 2 decimals |
| ZMB | +260 | Airtel | `AIRTEL_OAPI_ZMB` | ZMW | 2 decimals |
| ZMB | +260 | MTN | `MTN_MOMO_ZMB` | ZMW | 2 decimals |
| ZMB | +260 | Zamtel | `ZAMTEL_ZMB` | ZMW | 2 decimals |

## Sandbox numbers

Use a `kpay_test_` key. The test number determines COMPLETED, FAILED,
or SUBMITTED. Payin and Payout can have different outcomes.

| Country | Flow | MSISDN | Status | Failure code |
| --- | --- | --- | --- | --- |
| BEN | Payin | `22951345029` | FAILED | PAYER_NOT_FOUND |
| BEN | Payin | `22951345039` | FAILED | PAYMENT_NOT_APPROVED |
| BEN | Payin | `22951345069` | FAILED | UNSPECIFIED_FAILURE |
| BEN | Payin | `22951345129` | SUBMITTED | — |
| BEN | Payin | `22951345789` | COMPLETED | — |
| BEN | Payout | `22951345089` | FAILED | RECIPIENT_NOT_FOUND |
| BEN | Payout | `22951345119` | FAILED | UNSPECIFIED_FAILURE |
| BEN | Payout | `22951345129` | SUBMITTED | — |
| BEN | Payout | `22951345789` | COMPLETED | — |
| CMR | Payin | `237653456019` | FAILED | PAYER_LIMIT_REACHED |
| CMR | Payin | `237653456029` | FAILED | PAYER_NOT_FOUND |
| CMR | Payin | `237653456039` | FAILED | PAYMENT_NOT_APPROVED |
| CMR | Payin | `237653456069` | FAILED | UNSPECIFIED_FAILURE |
| CMR | Payin | `237653456129` | SUBMITTED | — |
| CMR | Payin | `237653456789` | COMPLETED | — |
| CMR | Payout | `237653456089` | FAILED | RECIPIENT_NOT_FOUND |
| CMR | Payout | `237653456119` | FAILED | UNSPECIFIED_FAILURE |
| CMR | Payout | `237653456129` | SUBMITTED | — |
| CMR | Payout | `237653456789` | COMPLETED | — |
| CIV | Payin | `2250503456029` | FAILED | PAYER_NOT_FOUND |
| CIV | Payin | `2250503456039` | FAILED | PAYMENT_NOT_APPROVED |
| CIV | Payin | `2250503456069` | FAILED | UNSPECIFIED_FAILURE |
| CIV | Payin | `2250503456129` | SUBMITTED | — |
| CIV | Payin | `2250503456789` | COMPLETED | — |
| CIV | Payout | `2250503456089` | FAILED | RECIPIENT_NOT_FOUND |
| CIV | Payout | `2250503456119` | FAILED | UNSPECIFIED_FAILURE |
| CIV | Payout | `2250503456129` | SUBMITTED | — |
| CIV | Payout | `2250503456789` | COMPLETED | — |
| COD | Payin | `243813456019` | FAILED | PAYER_LIMIT_REACHED |
| COD | Payin | `243813456029` | FAILED | PAYER_NOT_FOUND |
| COD | Payin | `243813456039` | FAILED | PAYMENT_NOT_APPROVED |
| COD | Payin | `243813456049` | FAILED | INSUFFICIENT_BALANCE |
| COD | Payin | `243813456069` | FAILED | UNSPECIFIED_FAILURE |
| COD | Payin | `243813456129` | SUBMITTED | — |
| COD | Payin | `243813456789` | COMPLETED | — |
| COD | Payout | `243813456089` | FAILED | RECIPIENT_NOT_FOUND |
| COD | Payout | `243813456119` | FAILED | UNSPECIFIED_FAILURE |
| COD | Payout | `243813456129` | SUBMITTED | — |
| COD | Payout | `243813456789` | COMPLETED | — |
| GAB | Payin | `24174345048` | FAILED | INSUFFICIENT_BALANCE |
| GAB | Payin | `24174345068` | FAILED | UNSPECIFIED_FAILURE |
| GAB | Payin | `24174345128` | SUBMITTED | — |
| GAB | Payin | `24174345678` | COMPLETED | — |
| GAB | Payout | `24174345088` | FAILED | RECIPIENT_NOT_FOUND |
| GAB | Payout | `24174345118` | FAILED | UNSPECIFIED_FAILURE |
| GAB | Payout | `24174345128` | SUBMITTED | — |
| GAB | Payout | `24174345678` | COMPLETED | — |
| KEN | Payin | `254703456019` | FAILED | PAYER_LIMIT_REACHED |
| KEN | Payin | `254703456039` | FAILED | PAYMENT_NOT_APPROVED |
| KEN | Payin | `254703456049` | FAILED | INSUFFICIENT_BALANCE |
| KEN | Payin | `254703456059` | FAILED | TRANSACTION_ALREADY_IN_PROCESS |
| KEN | Payin | `254703456069` | FAILED | UNSPECIFIED_FAILURE |
| KEN | Payin | `254703456129` | SUBMITTED | — |
| KEN | Payin | `254703456789` | COMPLETED | — |
| KEN | Payout | `254703456089` | FAILED | RECIPIENT_NOT_FOUND |
| KEN | Payout | `254703456099` | FAILED | WALLET_LIMIT_REACHED |
| KEN | Payout | `254703456109` | FAILED | RECIPIENT_LIMIT_REACHED |
| KEN | Payout | `254703456119` | FAILED | UNSPECIFIED_FAILURE |
| KEN | Payout | `254703456129` | SUBMITTED | — |
| KEN | Payout | `254703456789` | COMPLETED | — |
| COG | Payin | `242053456039` | FAILED | PAYMENT_NOT_APPROVED |
| COG | Payin | `242053456049` | FAILED | INSUFFICIENT_BALANCE |
| COG | Payin | `242053456069` | FAILED | UNSPECIFIED_FAILURE |
| COG | Payin | `242053456129` | SUBMITTED | — |
| COG | Payin | `242053456789` | COMPLETED | — |
| COG | Payout | `242053456089` | FAILED | RECIPIENT_NOT_FOUND |
| COG | Payout | `242053456119` | FAILED | UNSPECIFIED_FAILURE |
| COG | Payout | `242053456129` | SUBMITTED | — |
| COG | Payout | `242053456789` | COMPLETED | — |
| RWA | Payin | `250733456039` | FAILED | PAYMENT_NOT_APPROVED |
| RWA | Payin | `250733456049` | FAILED | INSUFFICIENT_BALANCE |
| RWA | Payin | `250733456069` | FAILED | UNSPECIFIED_FAILURE |
| RWA | Payin | `250733456129` | SUBMITTED | — |
| RWA | Payin | `250733456789` | COMPLETED | — |
| RWA | Payout | `250733456089` | FAILED | RECIPIENT_NOT_FOUND |
| RWA | Payout | `250733456119` | FAILED | UNSPECIFIED_FAILURE |
| RWA | Payout | `250733456129` | SUBMITTED | — |
| RWA | Payout | `250733456789` | COMPLETED | — |
| SEN | Payin | `221763456049` | FAILED | INSUFFICIENT_BALANCE |
| SEN | Payin | `221763456069` | FAILED | UNSPECIFIED_FAILURE |
| SEN | Payin | `221763456129` | SUBMITTED | — |
| SEN | Payin | `221763456789` | COMPLETED | — |
| SEN | Payout | `221763456119` | FAILED | UNSPECIFIED_FAILURE |
| SEN | Payout | `221763456129` | SUBMITTED | — |
| SEN | Payout | `221763456789` | COMPLETED | — |
| SLE | Payin | `23276123456` | COMPLETED | — |
| SLE | Payout | `23276123456` | COMPLETED | — |
| UGA | Payin | `256753456019` | FAILED | PAYER_LIMIT_REACHED |
| UGA | Payin | `256753456039` | FAILED | PAYMENT_NOT_APPROVED |
| UGA | Payin | `256753456049` | FAILED | INSUFFICIENT_BALANCE |
| UGA | Payin | `256753456069` | FAILED | UNSPECIFIED_FAILURE |
| UGA | Payin | `256753456129` | SUBMITTED | — |
| UGA | Payin | `256753456789` | COMPLETED | — |
| UGA | Payout | `256753456089` | FAILED | RECIPIENT_NOT_FOUND |
| UGA | Payout | `256753456099` | FAILED | WALLET_LIMIT_REACHED |
| UGA | Payout | `256753456119` | FAILED | UNSPECIFIED_FAILURE |
| UGA | Payout | `256753456129` | SUBMITTED | — |
| UGA | Payout | `256753456789` | COMPLETED | — |
| ZMB | Payin | `260973456019` | FAILED | PAYER_LIMIT_REACHED |
| ZMB | Payin | `260973456039` | FAILED | PAYMENT_NOT_APPROVED |
| ZMB | Payin | `260973456049` | FAILED | INSUFFICIENT_BALANCE |
| ZMB | Payin | `260973456069` | FAILED | UNSPECIFIED_FAILURE |
| ZMB | Payin | `260973456129` | SUBMITTED | — |
| ZMB | Payin | `260973456789` | COMPLETED | — |
| ZMB | Payout | `260973456089` | FAILED | RECIPIENT_NOT_FOUND |
| ZMB | Payout | `260973456119` | FAILED | UNSPECIFIED_FAILURE |
| ZMB | Payout | `260973456129` | SUBMITTED | — |
| ZMB | Payout | `260973456789` | COMPLETED | — |

## Fees, limits, and utilities

Current platform rates: Payin 5.00 %; Payout 5.00 %. Withdrawal range: 100–500000 XAF.
Useful API routes include `POST /api/v1/payments/predict-provider`,
`GET /api/v1/payments/availability`, `GET /api/v1/payments/currencies`,
and `GET /api/v1/payments/balance` (authenticated).

## Common errors

- HTTP 400: invalid amount, phone number, provider, or Gateway fields.
- HTTP 401: missing or invalid API credentials.
- HTTP 409: duplicate `externalId`.
- HTTP 422: insufficient merchant wallet balance for a Payout.
- HTTP 429: rate limit exceeded. Retry transient errors with backoff.

## TopOf K-Remittances

Collect in every K-PAY country without a plan: each country feeds its own wallet. The TopOf plan unlocks withdrawals from your foreign wallets, which K-PAY repatriates to your home country.

### Key points

Collection: open in every K-PAY country, in sandbox and Live, without a plan. Just select the countries in your application.

Wallets: each application has one wallet per country and currency. Each country's balance is shown on its card, in its currency.

Home country: its wallet is withdrawn directly, as usual, without a plan.

Foreign country: its wallet is withdrawn through a TopOf request, with an active Live plan. K-PAY repatriates the converted net amount to your home country wallet.

Recommended countries: those in your region, repatriated on proven routes. Other countries stay open; repatriation of their funds is reviewed case by case and may take longer.

### Prepare your account

Set your home country in Profile. It is the destination of your TopOf requests and the basis for recommended countries. Your application and the TopOf page link to this setting. New requests then go to the new country; requests already submitted keep their destination.

An account without a home country cannot add new countries to its applications until this setting is completed. Countries already configured are kept.

Enter your legal business name and select your activity in every application. These details are required to collect, withdraw and send a TopOf request, including on existing applications.

The TopOf plan is purchased in Live, from the TopOf K-Remittances page, with a verified account. Its price and duration are shown before payment; it covers every project and application on your account.

### Collect in several countries

In an application's settings, the countries section lists your home country first, then “Your region” (countries marked “Recommended”), then “All other countries”. All can be selected; the “Add my region” button selects every recommended country at once.

Selecting a country enables all its Mobile Money operators. A selected country collects as soon as the application is saved (in Live, once the application is production-ready), provided an operator is available there; an operator marked “!” is flagged as temporarily unstable and its payments may fail.

As soon as you select two or more countries, a TopOf K-Remittances message sums up how it works: collection open, one wallet per country, foreign withdrawals through TopOf. It also shows whether your plan is active.

Your payment links, checkout page and cheques offer the countries selected in the related application. Your customers pay from these countries with no further action on your side.

### Read the country map

The map on the TopOf K-Remittances page shows every K-PAY country. Blue: your home country. Green: your recommended region. Purple: other countries open for collection. Grey: countries not covered by K-PAY.

Lines link each country to your home country: a solid line for a recommended route, a dotted line for an out-of-region repatriation. Tap a country, on the map or in the list, to show its route and the currency funds will arrive in.

You can explore another home country to compare: it does not change your profile. The map is indicative; the summary of each TopOf request prevails.

### One wallet per country

On an application page, the wallets section shows one card per country and currency. Your home country is labelled “Home country · direct withdrawal”; a foreign country shows “Withdraw via TopOf”, or “TopOf plan required to withdraw” when you have no active plan.

A country may have several currencies, for example DR Congo in CDF and USD: each currency then has its own wallet.

Funds stay in the wallet of the country where they were collected. They only move between countries through a confirmed TopOf request. If you remove a country from your application, its wallet stays visible while it holds a balance.

### Withdraw your funds

Home country: click Withdraw on its card and follow the usual withdrawal, without a plan.

Foreign country, in Live: click Withdraw on its card. A window explains how funds travel to your home country. Without an active plan it invites you to subscribe; your funds stay safe in the wallet meanwhile. With an active plan, “Make my TopOf request” opens the TopOf page with this wallet already selected.

In Live, a direct withdrawal from a foreign wallet is not possible, even with a plan: these funds only leave through a TopOf request. A payout to a beneficiary in another country, even from your home country wallet, first requires an active plan, then goes through a TopOf request handled by K-PAY: TopOf K-Remittances page › Pay a recipient abroad (debited wallet, country, operator, recipient number and name, CONFIRMER then email code). Funds are reserved; K-PAY pays the recipient then confirms.

Once funds are credited to your home country wallet, you withdraw them directly, according to your usual pricing.

### Test before switching to Live

In sandbox, every country is open and test withdrawals work from any wallet, without a plan. Use the test numbers and payment methods shown in your dashboard.

The plan, TopOf requests and cheques are Live-only. To repatriate real funds, switch to Live and subscribe to the plan shown on the TopOf K-Remittances page.

### When can you request a transfer?

With an active plan, you can send a TopOf request every day of the plan, from any foreign wallet that holds a balance.

Repatriation is not instant: each request is checked and then processed by the K-PAY team. Countries in your region follow proven routes; an out-of-region country may take longer.

A submitted request stays pending until processed, even if the plan expires meanwhile. Check its status in your TopOf history.

### Submit your request

1. Open TopOf in Live, from a foreign wallet's Withdraw button or from the menu. Check the destination, which is your home country, then choose a source wallet by country and currency; each wallet shows “Recommended region” or “Outside region”.

2. Enter the amount you want to repatriate. It cannot exceed the wallet's available balance. Funds reserved for other operations are unavailable.

3. Review the source amount, conversion rate, fee percentage, fee amount and net amount to receive in the destination currency.

4. Read the warning and type CONFIRMER exactly. Request the email verification code and enter its six digits. It is valid for 10 minutes and applies to this request. Request a new code if you change the amount, wallet or destination country.

Once submitted, the request cannot be edited. Its source amount is reserved during processing and the K-PAY team is notified. Follow the request in your TopOf history.

### Understand amounts and fees

The source amount is converted at the displayed rate. The percentage fee is then deducted from the converted amount. The summary shows the net amount to receive, with amounts rounded to two decimal places.

Illustrative example: 300,000 XAF at a rate of 1 to XOF with a 2% fee gives 300,000 XOF before fees, a 6,000 XOF fee and 294,000 XOF net. Always refer to your own request summary.

The rate and fees are saved when you submit. The saved net amount remains fixed for that request. If a valid rate is unavailable, wait and retry before confirming. These fees are separate from the plan price.

### Track your request and funds

Pending (REQUESTED): your request has been received. The source amount remains reserved during processing and cannot be used elsewhere.

Confirmed (CONFIRMED): the source amount has been debited and the net amount credited to your home country wallet. The corresponding entries appear in your transactions.

Rejected (REJECTED): the reservation is released and the funds become available in your source wallet. Review your request and contact support if you need help.

Share your request reference with K-PAY support when asking about a pending request.

### Plan expiry and renewal

When the plan expires, collection continues in all your countries and balances stay in their wallets. Only foreign wallet withdrawals and payouts to another country are suspended.

TopOf requests already submitted keep being processed. As soon as you renew, you can send requests again. An early renewal starts at the end of the period already paid for.

### Resolve a blocked operation

Missing home country: complete Profile. Missing activity: enter the activity and legal business name in your application settings. Missing or expired plan: subscribe or renew to withdraw your foreign wallets.

Withdrawal refused from a foreign wallet: use that wallet's Withdraw button to send a TopOf request. Through the API, this refusal carries the TOPOF_REQUIRED code, as does a payout to another country made with an active plan; without a plan, a payout to another country first carries REMITTANCE_SUBSCRIPTION_REQUIRED; a service not yet open in Live carries REMITTANCE_NOT_AVAILABLE_LIVE.

Payment impossible from a country: check that the country is selected in the application and that an operator is available there. Insufficient balance: reduce the amount or wait for other operations to finish.

Missing email code: check your inbox and spam folder, then wait 30 seconds before requesting another code. After five incorrect attempts, request a new code. If the service is temporarily unavailable, try again later or contact support.

If your balance or request has changed, refresh the history before retrying to check whether the request was already recorded.
## Live sandbox tester

The documentation page at `/documentation/tester` can send a real sandbox request
using your `kpay_test_` API key and secret. Its searchable explorer covers
Payin, Payout, refunds, and merchant utilities, with editable
requests and a custom /api/v1 path. Credentials stay in page memory.
An initiation response is not the final result; signed callbacks carry final status.

## Prepared integration examples — 15 technologies

These are static examples. Keep API credentials on your server, store a stable externalId, and confirm the final result only through a signed callback.

### Express · JavaScript

**Payin request**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payment', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid payment data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/init', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Payout request**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payout', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid withdrawal data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Signed webhook receiver**

```javascript
import express from 'express';
import crypto from 'node:crypto';
const app = express();
// Install express; run this file on your server only.
const raw = express.raw({ type: 'application/json' });
app.post('/webhooks/kpay', raw, (req, res) => {
  const signature = req.get('X-KPAY-Signature') || '';
  const expected = crypto.createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET).update(req.body).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString());
  // Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);
```

### Next.js · TypeScript

**Payin request**

```typescript
// app/api/kpay/route.ts — server route, never a client component.
export async function POST(request: Request) {
  const { amount, phoneNumber, externalId } = await request.json();
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return Response.json({ message: 'Invalid input' }, { status: 400 });
  }
  try {
    const response = await fetch('https://admin.kpay.site/api/v1/payments/init', {
      method: 'POST', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.KPAY_API_KEY!,
        'X-Secret-Key': process.env.KPAY_SECRET_KEY!,
      },
      body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ message: 'KPAY-NOW is unavailable' }, { status: 502 });
  }
}
```

**Payout request**

```typescript
// app/api/kpay/payout/route.ts — server route, never a client component.
export async function POST(request: Request) {
  const { amount, phoneNumber, externalId } = await request.json();
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return Response.json({ message: 'Invalid input' }, { status: 400 });
  }
  try {
    const response = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
      method: 'POST', cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.KPAY_API_KEY!,
        'X-Secret-Key': process.env.KPAY_SECRET_KEY!,
      },
      body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ message: 'KPAY-NOW is unavailable' }, { status: 502 });
  }
}
```

**Signed webhook receiver**

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
export async function POST(request: Request) {
  const raw = await request.text();
  const signature = request.headers.get('X-KPAY-Signature') ?? '';
  const expected = createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return new Response('Invalid signature', { status: 401 });
  const event = JSON.parse(raw);
  // Deduplicate by event.paymentId + event.event, then handle payment.completed / payout.completed.
  return new Response('OK');
}
```

### NestJS · TypeScript

**Payin request**

```typescript
import { Body, Controller, HttpException, Post } from '@nestjs/common';

interface PaymentInput { amount: number; phoneNumber: string; externalId: string }

@Controller('api')
export class KpayController {
  @Post('create-payment')
  async pay(@Body() body: PaymentInput) {
    if (!Number.isFinite(body.amount) || body.amount < 100 || !body.phoneNumber || !body.externalId) {
      throw new HttpException('Invalid input', 400);
    }
    let response: Response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/init', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY!,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY!,
        },
        body: JSON.stringify({ ...body, provider: 'MTN_MOMO_CMR' }),
      });
    } catch { throw new HttpException('KPAY-NOW is unavailable', 502); }
    const result = await response.json();
    if (!response.ok) throw new HttpException(result, response.status);
    return result;
  }
}
```

**Payout request**

```typescript
import { Body, Controller, HttpException, Post } from '@nestjs/common';

interface PayoutInput { amount: number; phoneNumber: string; externalId: string }

@Controller('api')
export class KpayController {
  @Post('create-payout')
  async payout(@Body() body: PayoutInput) {
    if (!Number.isFinite(body.amount) || body.amount < 100 || !body.phoneNumber || !body.externalId) {
      throw new HttpException('Invalid input', 400);
    }
    let response: Response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY!,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY!,
        },
        body: JSON.stringify({ ...body, provider: 'MTN_MOMO_CMR' }),
      });
    } catch { throw new HttpException('KPAY-NOW is unavailable', 502); }
    const result = await response.json();
    if (!response.ok) throw new HttpException(result, response.status);
    return result;
  }
}
```

**Signed webhook receiver**

```typescript
import { Controller, Headers, HttpException, Post, Req } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Activer rawBody: true dans NestFactory.create(AppModule, { rawBody: true }).
@Controller('kpay')
export class KpayWebhookController {
  @Post('webhook')
  webhook(
    @Req() req: { rawBody: Buffer; body: { event: string; paymentId: string; externalId: string } },
    @Headers('x-kpay-signature') signature = '',
  ) {
    if (!req.rawBody) throw new HttpException('Raw body requis', 400);
    const expected = createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET!)
      .update(req.rawBody).digest('hex');
    if (signature.length !== expected.length ||
        !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new HttpException('Signature invalide', 401);
    }
    const event = req.body;
    // In your SQL transaction: UNIQUE(paymentId, event), then update business state.
    // payment.completed / payout.completed => success; *.failed => failure.
    return { received: true, paymentId: event.paymentId };
  }
}
```

### Laravel · PHP

**Payin request**

```php
<?php
// routes/api.php — keep keys in server configuration.
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::post('/create-payment', function (Request $request) {
    $data = $request->validate([
        'amount' => ['required', 'numeric', 'min:100'],
        'phoneNumber' => ['required', 'string'],
        'externalId' => ['required', 'string', 'max:100'],
    ]);
    try {
        $result = Http::timeout(15)->withHeaders([
            'X-API-Key' => env('KPAY_API_KEY'),
            'X-Secret-Key' => env('KPAY_SECRET_KEY'),
        ])->post('https://admin.kpay.site/api/v1/payments/init', [
            ...$data, 'provider' => 'MTN_MOMO_CMR',
        ]);
        return response()->json($result->json(), $result->status());
    } catch (\Illuminate\Http\Client\ConnectionException $e) {
        return response()->json(['message' => 'KPAY-NOW is unavailable'], 502);
    }
});
```

**Payout request**

```php
<?php
// routes/api.php — keep keys in server configuration.
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Route;

Route::post('/create-payout', function (Request $request) {
    $data = $request->validate([
        'amount' => ['required', 'numeric', 'min:100'],
        'phoneNumber' => ['required', 'string'],
        'externalId' => ['required', 'string', 'max:100'],
    ]);
    try {
        $result = Http::timeout(15)->withHeaders([
            'X-API-Key' => env('KPAY_API_KEY'),
            'X-Secret-Key' => env('KPAY_SECRET_KEY'),
        ])->post('https://admin.kpay.site/api/v1/payments/withdraw', [
            ...$data, 'provider' => 'MTN_MOMO_CMR',
        ]);
        return response()->json($result->json(), $result->status());
    } catch (\Illuminate\Http\Client\ConnectionException $e) {
        return response()->json(['message' => 'KPAY-NOW is unavailable'], 502);
    }
});
```

**Signed webhook receiver**

```php
<?php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::post('/kpay/webhook', function (Request $request) {
    $expected = hash_hmac('sha256', $request->getContent(), env('KPAY_WEBHOOK_SECRET'));
    abort_unless(hash_equals($expected, $request->header('X-KPAY-Signature', '')), 401);
    $event = $request->json()->all();
    // Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
    return response()->json(['received' => true]);
});
```

### Django · Python

**Payin request**

```python
import json
import os
import requests
from django.http import JsonResponse
from django.views.decorators.http import require_POST

@require_POST
def create_payment(request):
    try:
        data = json.loads(request.body)
        amount = data['amount']
        if not isinstance(amount, (int, float)) or amount < 100:
            raise ValueError('Invalid amount')
        payload = {
            'amount': amount,
            'provider': 'MTN_MOMO_CMR',
            'phoneNumber': data['phoneNumber'],
            'externalId': data['externalId'],
        }
    except (ValueError, KeyError, TypeError):
        return JsonResponse({'message': 'Invalid input'}, status=400)
    try:
        result = requests.post(
            'https://admin.kpay.site/api/v1/payments/init',
            headers={
                'X-API-Key': os.environ['KPAY_API_KEY'],
                'X-Secret-Key': os.environ['KPAY_SECRET_KEY'],
            }, json=payload, timeout=15,
        )
        return JsonResponse(result.json(), status=result.status_code, safe=False)
    except requests.RequestException:
        return JsonResponse({'message': 'KPAY-NOW is unavailable'}, status=502)
```

**Payout request**

```python
import json
import os
import requests
from django.http import JsonResponse
from django.views.decorators.http import require_POST

@require_POST
def create_payout(request):
    try:
        data = json.loads(request.body)
        amount = data['amount']
        if not isinstance(amount, (int, float)) or amount < 100:
            raise ValueError('Invalid amount')
        payload = {
            'amount': amount,
            'provider': 'MTN_MOMO_CMR',
            'phoneNumber': data['phoneNumber'],
            'externalId': data['externalId'],
        }
    except (ValueError, KeyError, TypeError):
        return JsonResponse({'message': 'Invalid input'}, status=400)
    try:
        result = requests.post(
            'https://admin.kpay.site/api/v1/payments/withdraw',
            headers={
                'X-API-Key': os.environ['KPAY_API_KEY'],
                'X-Secret-Key': os.environ['KPAY_SECRET_KEY'],
            }, json=payload, timeout=15,
        )
        return JsonResponse(result.json(), status=result.status_code, safe=False)
    except requests.RequestException:
        return JsonResponse({'message': 'KPAY-NOW is unavailable'}, status=502)
```

**Signed webhook receiver**

```python
import os
import json
import hmac
import hashlib
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

@csrf_exempt
@require_POST
def kpay_webhook(request):
    expected = hmac.new(os.environ['KPAY_WEBHOOK_SECRET'].encode(), request.body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get('X-KPAY-Signature', '')): return HttpResponse(status=401)
    event = json.loads(request.body)
    # Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
    return HttpResponse(status=200)
```

### FastAPI · Python

**Payin request**

```python
import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()

class PaymentInput(BaseModel):
    amount: float = Field(ge=100, le=10_000_000)
    phoneNumber: str = Field(min_length=9)
    externalId: str = Field(min_length=1, max_length=100)

@app.post('/api/create-payment')
async def create_payment(body: PaymentInput):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            result = await client.post(
                'https://admin.kpay.site/api/v1/payments/init',
                headers={
                    'X-API-Key': os.environ['KPAY_API_KEY'],
                    'X-Secret-Key': os.environ['KPAY_SECRET_KEY'],
                },
                json={**body.model_dump(), 'provider': 'MTN_MOMO_CMR'},
            )
    except httpx.RequestError:
        raise HTTPException(502, 'KPAY-NOW is unavailable')
    if result.is_error:
        raise HTTPException(result.status_code, result.text)
    return result.json()
```

**Payout request**

```python
import os
import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

app = FastAPI()

class PayoutInput(BaseModel):
    amount: float = Field(ge=100, le=10_000_000)
    phoneNumber: str = Field(min_length=9)
    externalId: str = Field(min_length=1, max_length=100)

@app.post('/api/create-payout')
async def create_payout(body: PayoutInput):
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            result = await client.post(
                'https://admin.kpay.site/api/v1/payments/withdraw',
                headers={
                    'X-API-Key': os.environ['KPAY_API_KEY'],
                    'X-Secret-Key': os.environ['KPAY_SECRET_KEY'],
                },
                json={**body.model_dump(), 'provider': 'MTN_MOMO_CMR'},
            )
    except httpx.RequestError:
        raise HTTPException(502, 'KPAY-NOW is unavailable')
    if result.is_error:
        raise HTTPException(result.status_code, result.text)
    return result.json()
```

**Signed webhook receiver**

```python
import os
import hmac
import hashlib
from fastapi import FastAPI, Request, HTTPException

app = FastAPI()

@app.post('/webhooks/kpay')
async def webhook(request: Request):
    raw = await request.body()
    expected = hmac.new(os.environ['KPAY_WEBHOOK_SECRET'].encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get('X-KPAY-Signature', '')): raise HTTPException(401, 'Invalid signature')
    event = await request.json()
    # Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
    return {'received': True}
```

### Flask · Python

**Payin request**

```python
import os
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.post('/api/create-payment')
def create_payment():
    data = request.get_json(silent=True) or {}
    amount = data.get('amount')
    if not isinstance(amount, (int, float)) or amount < 100 or not data.get('externalId') or not data.get('phoneNumber'):
        return jsonify(message='Invalid input'), 400
    try:
        result = requests.post(
            'https://admin.kpay.site/api/v1/payments/init',
            headers={
                'X-API-Key': os.environ['KPAY_API_KEY'],
                'X-Secret-Key': os.environ['KPAY_SECRET_KEY'],
            },
            json={
                'amount': amount, 'provider': 'MTN_MOMO_CMR',
                'phoneNumber': data['phoneNumber'], 'externalId': data['externalId'],
            }, timeout=15,
        )
    except requests.RequestException:
        return jsonify(message='KPAY-NOW is unavailable'), 502
    return jsonify(result.json()), result.status_code
```

**Payout request**

```python
import os
import requests
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.post('/api/create-payout')
def create_payout():
    data = request.get_json(silent=True) or {}
    amount = data.get('amount')
    if not isinstance(amount, (int, float)) or amount < 100 or not data.get('externalId') or not data.get('phoneNumber'):
        return jsonify(message='Invalid input'), 400
    try:
        result = requests.post(
            'https://admin.kpay.site/api/v1/payments/withdraw',
            headers={
                'X-API-Key': os.environ['KPAY_API_KEY'],
                'X-Secret-Key': os.environ['KPAY_SECRET_KEY'],
            },
            json={
                'amount': amount, 'provider': 'MTN_MOMO_CMR',
                'phoneNumber': data['phoneNumber'], 'externalId': data['externalId'],
            }, timeout=15,
        )
    except requests.RequestException:
        return jsonify(message='KPAY-NOW is unavailable'), 502
    return jsonify(result.json()), result.status_code
```

**Signed webhook receiver**

```python
import os
import hmac
import hashlib
from flask import Flask, request, abort

app = Flask(__name__)

@app.post('/webhooks/kpay')
def webhook():
    raw = request.get_data()
    expected = hmac.new(os.environ['KPAY_WEBHOOK_SECRET'].encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, request.headers.get('X-KPAY-Signature', '')): abort(401)
    event = request.get_json()
    # Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
    return '', 200
```

### Spring Boot · Java

**Payin request**

```java
import java.util.Map;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@RestController
class KpayController {
  private final RestClient client = RestClient.create();
  // Configure an HTTP timeout in your production RestClient bean.

  @PostMapping("/api/create-payment")
  ResponseEntity<String> pay(@RequestBody Map<String, Object> body) {
    if (!(body.get("amount") instanceof Number) || body.get("phoneNumber") == null || body.get("externalId") == null)
      return ResponseEntity.badRequest().body("Invalid input");
    var payload = Map.of(
      "amount", body.get("amount"), "provider", "MTN_MOMO_CMR",
      "phoneNumber", body.get("phoneNumber"), "externalId", body.get("externalId")
    );
    try {
      String json = client.post()
        .uri("https://admin.kpay.site/api/v1/payments/init")
        .header("X-API-Key", System.getenv("KPAY_API_KEY"))
        .header("X-Secret-Key", System.getenv("KPAY_SECRET_KEY"))
        .contentType(MediaType.APPLICATION_JSON).body(payload)
        .retrieve().body(String.class);
      return ResponseEntity.status(201).contentType(MediaType.APPLICATION_JSON).body(json);
    } catch (RestClientResponseException error) {
      return ResponseEntity.status(error.getStatusCode()).body(error.getResponseBodyAsString());
    }
  }
}
```

**Payout request**

```java
import java.util.Map;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientResponseException;

@RestController
class KpayController {
  private final RestClient client = RestClient.create();
  // Configure an HTTP timeout in your production RestClient bean.

  @PostMapping("/api/create-payout")
  ResponseEntity<String> payout(@RequestBody Map<String, Object> body) {
    if (!(body.get("amount") instanceof Number) || body.get("phoneNumber") == null || body.get("externalId") == null)
      return ResponseEntity.badRequest().body("Invalid input");
    var payload = Map.of(
      "amount", body.get("amount"), "provider", "MTN_MOMO_CMR",
      "phoneNumber", body.get("phoneNumber"), "externalId", body.get("externalId")
    );
    try {
      String json = client.post()
        .uri("https://admin.kpay.site/api/v1/payments/withdraw")
        .header("X-API-Key", System.getenv("KPAY_API_KEY"))
        .header("X-Secret-Key", System.getenv("KPAY_SECRET_KEY"))
        .contentType(MediaType.APPLICATION_JSON).body(payload)
        .retrieve().body(String.class);
      return ResponseEntity.status(201).contentType(MediaType.APPLICATION_JSON).body(json);
    } catch (RestClientResponseException error) {
      return ResponseEntity.status(error.getStatusCode()).body(error.getResponseBodyAsString());
    }
  }
}
```

**Signed webhook receiver**

```java
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
class KpayWebhookController {
  @PostMapping("/webhooks/kpay")
  ResponseEntity<String> webhook(
      @RequestBody byte[] raw,
      @RequestHeader(value = "X-KPAY-Signature", required = false) String signature
  ) throws Exception {
    Mac mac = Mac.getInstance("HmacSHA256");
    mac.init(new SecretKeySpec(
      System.getenv("KPAY_WEBHOOK_SECRET").getBytes(StandardCharsets.UTF_8), "HmacSHA256"
    ));
    String expected = HexFormat.of().formatHex(mac.doFinal(raw));
    if (signature == null || !MessageDigest.isEqual(
        expected.getBytes(StandardCharsets.US_ASCII),
        signature.getBytes(StandardCharsets.US_ASCII))) {
      return ResponseEntity.status(401).build();
    }
    // Deduplicate (paymentId, event) in the database, then confirm Payin or Payout.
    return ResponseEntity.ok("OK");
  }
}
```

### ASP.NET Core · C#

**Payin request**

```csharp
using System.Net.Http.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient("kpay", client => {
    client.BaseAddress = new Uri("https://admin.kpay.site");
    client.Timeout = TimeSpan.FromSeconds(15);
});
var app = builder.Build();

app.MapPost("/api/create-payment", async (PaymentInput body, IHttpClientFactory factory) => {
    if (body.Amount < 100 || string.IsNullOrWhiteSpace(body.PhoneNumber) || string.IsNullOrWhiteSpace(body.ExternalId))
        return Results.BadRequest(new { message = "Invalid input" });
    var client = factory.CreateClient("kpay");
    client.DefaultRequestHeaders.Add("X-API-Key", Environment.GetEnvironmentVariable("KPAY_API_KEY"));
    client.DefaultRequestHeaders.Add("X-Secret-Key", Environment.GetEnvironmentVariable("KPAY_SECRET_KEY"));
    try {
        var result = await client.PostAsJsonAsync("/api/v1/payments/init", new {
            amount = body.Amount, provider = "MTN_MOMO_CMR",
            phoneNumber = body.PhoneNumber, externalId = body.ExternalId
        });
        return Results.Content(await result.Content.ReadAsStringAsync(), "application/json", statusCode: (int)result.StatusCode);
    } catch (HttpRequestException) {
        return Results.Problem("KPAY-NOW is unavailable", statusCode: 502);
    }
});

app.Run();
record PaymentInput(decimal Amount, string PhoneNumber, string ExternalId);
```

**Payout request**

```csharp
using System.Net.Http.Json;

var builder = WebApplication.CreateBuilder(args);
builder.Services.AddHttpClient("kpay", client => {
    client.BaseAddress = new Uri("https://admin.kpay.site");
    client.Timeout = TimeSpan.FromSeconds(15);
});
var app = builder.Build();

app.MapPost("/api/create-payout", async (PayoutInput body, IHttpClientFactory factory) => {
    if (body.Amount < 100 || string.IsNullOrWhiteSpace(body.PhoneNumber) || string.IsNullOrWhiteSpace(body.ExternalId))
        return Results.BadRequest(new { message = "Invalid input" });
    var client = factory.CreateClient("kpay");
    client.DefaultRequestHeaders.Add("X-API-Key", Environment.GetEnvironmentVariable("KPAY_API_KEY"));
    client.DefaultRequestHeaders.Add("X-Secret-Key", Environment.GetEnvironmentVariable("KPAY_SECRET_KEY"));
    try {
        var result = await client.PostAsJsonAsync("/api/v1/payments/withdraw", new {
            amount = body.Amount, provider = "MTN_MOMO_CMR",
            phoneNumber = body.PhoneNumber, externalId = body.ExternalId
        });
        return Results.Content(await result.Content.ReadAsStringAsync(), "application/json", statusCode: (int)result.StatusCode);
    } catch (HttpRequestException) {
        return Results.Problem("KPAY-NOW is unavailable", statusCode: 502);
    }
});

app.Run();
record PayoutInput(decimal Amount, string PhoneNumber, string ExternalId);
```

**Signed webhook receiver**

```csharp
using System.Security.Cryptography;
using System.Text;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();
app.MapPost("/webhooks/kpay", async (HttpRequest request) => {
  using var stream = new MemoryStream(); await request.Body.CopyToAsync(stream); var raw = stream.ToArray();
  var expected = Convert.ToHexString(HMACSHA256.HashData(Encoding.UTF8.GetBytes(Environment.GetEnvironmentVariable("KPAY_WEBHOOK_SECRET")!), raw));
  var signature = request.Headers["X-KPAY-Signature"].ToString();
  if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected.ToLowerInvariant()), Encoding.ASCII.GetBytes(signature))) return Results.Unauthorized();
  // Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
  return Results.Ok();
});
app.Run();
```

### Ruby on Rails · Ruby

**Payin request**

```ruby
require 'faraday'

class KpayController < ActionController::API
  def pay
    amount = params.require(:amount).to_f
    phone = params.require(:phoneNumber)
    external_id = params.require(:externalId)
    return render json: { message: 'Invalid amount' }, status: :bad_request if amount < 100

    payload = {
      amount: amount, provider: 'MTN_MOMO_CMR',
      phoneNumber: phone, externalId: external_id
    }
    response = Faraday.post(
      'https://admin.kpay.site/api/v1/payments/init', payload.to_json,
      'Content-Type' => 'application/json',
      'X-API-Key' => ENV.fetch('KPAY_API_KEY'),
      'X-Secret-Key' => ENV.fetch('KPAY_SECRET_KEY')
    )
    render json: JSON.parse(response.body), status: response.status
  rescue Faraday::Error
    render json: { message: 'KPAY-NOW is unavailable' }, status: :bad_gateway
  end
end
```

**Payout request**

```ruby
require 'faraday'

class KpayController < ActionController::API
  def payout
    amount = params.require(:amount).to_f
    phone = params.require(:phoneNumber)
    external_id = params.require(:externalId)
    return render json: { message: 'Invalid amount' }, status: :bad_request if amount < 100

    payload = {
      amount: amount, provider: 'MTN_MOMO_CMR',
      phoneNumber: phone, externalId: external_id
    }
    response = Faraday.post(
      'https://admin.kpay.site/api/v1/payments/withdraw', payload.to_json,
      'Content-Type' => 'application/json',
      'X-API-Key' => ENV.fetch('KPAY_API_KEY'),
      'X-Secret-Key' => ENV.fetch('KPAY_SECRET_KEY')
    )
    render json: JSON.parse(response.body), status: response.status
  rescue Faraday::Error
    render json: { message: 'KPAY-NOW is unavailable' }, status: :bad_gateway
  end
end
```

**Signed webhook receiver**

```ruby
require 'openssl'

class KpayController < ActionController::API
  def webhook
    raw = request.raw_post
    expected = OpenSSL::HMAC.hexdigest('SHA256', ENV.fetch('KPAY_WEBHOOK_SECRET'), raw)
    return head :unauthorized unless ActiveSupport::SecurityUtils.secure_compare(expected, request.headers['X-KPAY-Signature'].to_s)
    event = JSON.parse(raw)
    # Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
    head :ok
  end
end
```

### Nuxt · TypeScript

**Payin request**

```typescript
// server/api/kpay.post.ts — variables without NUXT_PUBLIC_ stay private.
export default defineEventHandler(async (event) => {
  const { amount, phoneNumber, externalId } = await readBody(event);
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' });
  }
  try {
    return await $fetch('https://admin.kpay.site/api/v1/payments/init', {
      method: 'POST', timeout: 15000,
      headers: {
        'X-API-Key': process.env.KPAY_API_KEY!,
        'X-Secret-Key': process.env.KPAY_SECRET_KEY!,
      },
      body: { amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId },
    });
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: 'KPAY-NOW is unavailable', cause: error });
  }
});
```

**Payout request**

```typescript
// server/api/kpay-payout.post.ts — variables without NUXT_PUBLIC_ stay private.
export default defineEventHandler(async (event) => {
  const { amount, phoneNumber, externalId } = await readBody(event);
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid input' });
  }
  try {
    return await $fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
      method: 'POST', timeout: 15000,
      headers: {
        'X-API-Key': process.env.KPAY_API_KEY!,
        'X-Secret-Key': process.env.KPAY_SECRET_KEY!,
      },
      body: { amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId },
    });
  } catch (error) {
    throw createError({ statusCode: 502, statusMessage: 'KPAY-NOW is unavailable', cause: error });
  }
});
```

**Signed webhook receiver**

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';
export default defineEventHandler(async (event) => {
  const raw = await readRawBody(event) ?? '';
  const signature = getHeader(event, 'X-KPAY-Signature') ?? '';
  const expected = createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET!).update(raw).digest('hex');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw createError({ statusCode: 401 });
  const payload = JSON.parse(raw);
  // Deduplicate by payload.paymentId + payload.event, then handle payment.completed / payout.completed.
  return { received: true };
});
```

### SvelteKit · TypeScript

**Payin request**

```typescript
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const { amount, phoneNumber, externalId } = await request.json();
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return Response.json({ message: 'Invalid input' }, { status: 400 });
  }
  try {
    const result = await fetch('https://admin.kpay.site/api/v1/payments/init', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.KPAY_API_KEY,
        'X-Secret-Key': env.KPAY_SECRET_KEY,
      },
      body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
    });
    return new Response(await result.text(), {
      status: result.status, headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ message: 'KPAY-NOW is unavailable' }, { status: 502 });
  }
};
```

**Payout request**

```typescript
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch }) => {
  const { amount, phoneNumber, externalId } = await request.json();
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return Response.json({ message: 'Invalid input' }, { status: 400 });
  }
  try {
    const result = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': env.KPAY_API_KEY,
        'X-Secret-Key': env.KPAY_SECRET_KEY,
      },
      body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
    });
    return new Response(await result.text(), {
      status: result.status, headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ message: 'KPAY-NOW is unavailable' }, { status: 502 });
  }
};
```

**Signed webhook receiver**

```typescript
import { env } from '$env/dynamic/private';
import { createHmac, timingSafeEqual } from 'node:crypto';
export async function POST({ request }: { request: Request }) {
  const raw = await request.text();
  const signature = request.headers.get('X-KPAY-Signature') ?? '';
  const expected = createHmac('sha256', env.KPAY_WEBHOOK_SECRET).update(raw).digest('hex');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return new Response('Invalid signature', { status: 401 });
  const event = JSON.parse(raw);
  // Deduplicate by event.paymentId + event.event, then handle payment.completed / payout.completed.
  return new Response('OK');
}
```

### React + Express · TypeScript

**Payin request**

```typescript
import { useState } from 'react';

type Props = { orderId: string; amount: number };

export function Checkout({ orderId, amount }: Props) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function pay(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch('/api/create-payment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, phoneNumber, externalId: orderId }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Payment declined');
      setMessage('Request sent. Awaiting the signed callback.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Network error');
    } finally { setBusy(false); }
  }

  return <form onSubmit={pay}>
    <label>Mobile Money number
      <input required value={phoneNumber} onChange={e => setPhoneNumber(e.target.value)} />
    </label>
    <button disabled={busy}>{busy ? 'Sending…' : 'Pay'}</button>
    <p role="status">{message}</p>
  </form>;
}
// The Express server validates the order amount and calls KPAY-NOW.
```

**Server-side Payin route (Express)**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payment', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid payment data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/init', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Payout request**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payout', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid withdrawal data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Signed webhook receiver**

```javascript
import express from 'express';
import crypto from 'node:crypto';
const app = express();
// Install express; run this file on your server only.
const raw = express.raw({ type: 'application/json' });
app.post('/webhooks/kpay', raw, (req, res) => {
  const signature = req.get('X-KPAY-Signature') || '';
  const expected = crypto.createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET).update(req.body).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString());
  // Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);
```

### Vue + Express · TypeScript

**Payin request**

```vue
<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{ orderId: string; amount: number }>();
const phoneNumber = ref('');
const busy = ref(false);
const message = ref('');

async function pay() {
  busy.value = true;
  try {
    const response = await fetch('/api/create-payment', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: props.amount, phoneNumber: phoneNumber.value, externalId: props.orderId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Payment declined');
    message.value = 'Request sent. Awaiting the signed callback.';
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Network error';
  } finally { busy.value = false; }
}
</script>

<template>
  <form @submit.prevent="pay">
    <label>Mobile Money number <input v-model="phoneNumber" required /></label>
    <button :disabled="busy">{{ busy ? 'Sending…' : 'Pay' }}</button>
    <p role="status">{{ message }}</p>
  </form>
</template>
<!-- The Express server validates the order amount and calls KPAY-NOW. -->
```

**Server-side Payin route (Express)**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payment', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid payment data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/init', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Payout request**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payout', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid withdrawal data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Signed webhook receiver**

```javascript
import express from 'express';
import crypto from 'node:crypto';
const app = express();
// Install express; run this file on your server only.
const raw = express.raw({ type: 'application/json' });
app.post('/webhooks/kpay', raw, (req, res) => {
  const signature = req.get('X-KPAY-Signature') || '';
  const expected = crypto.createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET).update(req.body).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString());
  // Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);
```

### Angular + Express · TypeScript

**Payin request**

```typescript
import { Component, Input, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-checkout', standalone: true, imports: [FormsModule],
  template: `<form (ngSubmit)="pay()">
    <label>Mobile Money number <input [(ngModel)]="phoneNumber" name="phone" required></label>
    <button [disabled]="busy">{{ busy ? 'Sending…' : 'Pay' }}</button>
    <p role="status">{{ message }}</p>
  </form>`,
})
export class CheckoutComponent {
  @Input({ required: true }) orderId!: string;
  @Input({ required: true }) amount!: number;
  private http = inject(HttpClient);
  phoneNumber = ''; busy = false; message = '';

  pay() {
    this.busy = true;
    this.http.post('/api/create-payment', {
      amount: this.amount, phoneNumber: this.phoneNumber, externalId: this.orderId,
    }).pipe(finalize(() => this.busy = false)).subscribe({
      next: () => this.message = 'Request sent. Awaiting the signed callback.',
      error: error => this.message = error.error?.message || 'Payment declined',
    });
  }
}
// The Express server validates the order amount and calls KPAY-NOW.
```

**Server-side Payin route (Express)**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payment', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid payment data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/init', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Payout request**

```javascript
import express from 'express';

const app = express();
app.use(express.json());

// amount, phoneNumber and externalId come from a transaction validated in your database.
app.post('/api/create-payout', async (req, res) => {
  const { amount, phoneNumber, externalId } = req.body;
  if (!Number.isFinite(amount) || amount < 100 || !phoneNumber || !externalId) {
    return res.status(400).json({ message: 'Invalid withdrawal data' });
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch('https://admin.kpay.site/api/v1/payments/withdraw', {
        method: 'POST', signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': process.env.KPAY_API_KEY,
          'X-Secret-Key': process.env.KPAY_SECRET_KEY,
        },
        body: JSON.stringify({ amount, provider: 'MTN_MOMO_CMR', phoneNumber, externalId }),
      });
    } finally { clearTimeout(timeout); }
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (error) {
    return res.status(502).json({ message: 'KPAY-NOW is temporarily unavailable' });
  }
});

app.listen(process.env.PORT || 3000);
```

**Signed webhook receiver**

```javascript
import express from 'express';
import crypto from 'node:crypto';
const app = express();
// Install express; run this file on your server only.
const raw = express.raw({ type: 'application/json' });
app.post('/webhooks/kpay', raw, (req, res) => {
  const signature = req.get('X-KPAY-Signature') || '';
  const expected = crypto.createHmac('sha256', process.env.KPAY_WEBHOOK_SECRET).update(req.body).digest('hex');
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return res.sendStatus(401);
  const event = JSON.parse(req.body.toString());
  // Deduplicate by paymentId + event, then handle payment.completed / payout.completed.
  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);
```

## Live OpenAPI specification

```javascript
const res = await fetch("https://admin.kpay.site/api/docs/public-json", {
  method: "GET",
});
const data = await res.json();
```

Use the live specification for exact request and response schemas.