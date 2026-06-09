# Theme Medic

Shopify store **performance & drift monitor**. Free scan shows a store's speed, page
weight, and — the differentiator — **exactly which apps are slowing it down**, including
ghost code left behind by uninstalled apps. The paid app re-scans daily, tracks drift
over time, and alerts the merchant when an app update quietly makes things worse.

## Why this exists

- Uptime monitors answer *"is the store up?"* Speed apps do a *one-time* boost.
  **Nobody continuously tracks performance and attributes regressions to a specific app.**
- Uninstalling a Shopify app does **not** remove the code it injected into the theme.
  Stores accumulate years of dead scripts that load on every page.
- Apps auto-update silently; a store's speed drifts every week. That regenerating pain
  is what makes monitoring a *recurring* product.

## Architecture

| Piece | File(s) | Status |
|---|---|---|
| Signature DB (60 apps: CDN hosts, file patterns, markers) | `src/signatures.js` | ✅ |
| Theme scanner (ghost-code detection, ghost-vs-active) | `src/scanner.js`, `src/report.js` | ✅ tested |
| Metrics collector (Google PageSpeed Insights: CWV, weight, resources) | `src/metrics.js` | ✅ live-tested |
| App attribution (PSI resources → named apps + KB/blocking cost) | `src/attribute.js` | ✅ live-tested |
| Scan records + multi-page orchestration | `src/scan.js` | ✅ |
| **Drift detection** (regression diffing + per-app blame) | `src/drift.js` | ✅ tested |
| Free public scan tool (landing page + lead capture) | `src/server.js`, `public/` | ✅ smoke-tested |
| Shopify embedded app (OAuth, `read_themes` deep scan, Billing) | — | next (needs Partner account) |

## Run it

```bash
npm install
cp .env.example .env       # add PSI_API_KEY (free Google key)

npm run demo               # offline engine demo + assertions
node test/drift.test.js    # drift detection tests
npm run scan -- https://www.somestore.com   # live scan a real store
npm run dev                # free scan tool on http://localhost:3200
```

## Environment

- `PSI_API_KEY` — free Google PageSpeed Insights key (console.cloud.google.com).
- `DATABASE_URL` — optional free Neon Postgres for durable lead capture; falls back to
  in-memory if unset.

## Deploy (free)

`render.yaml` targets Render's **free plan** — no disk, $0. Leads persist via Neon
(free). Free-tier sleep is harmless: scans already take 20–60s.

## Roadmap

M1 metrics ✅ → M2 free scan tool ✅ → M3 Shopify app (OAuth + deep theme scan) →
M4 scheduled scans + drift alerts → M5 Shopify Billing ($19–29/mo) → M6 agency tier.
