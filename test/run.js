// test/run.js
//
// Self-contained engine demo. `assets` mimics exactly what the Shopify Asset API
// returns for a theme (array of { key, value }). We simulate a store that has churned
// through several apps: most are uninstalled but left code behind (ghost code), while
// Privy is still installed (should be reported as "active — leave it").
//
// Run with:  npm run demo   (or: node test/run.js)

import { scanTheme } from "../src/scanner.js";
import { formatReport } from "../src/report.js";

const assets = [
  // --- A clean, untouched layout would look like this... but this one is dirty ---
  {
    key: "layout/theme.liquid",
    value: `<!doctype html>
<html>
<head>
  {{ content_for_header }}
  <!-- leftover from when we used Klaviyo -->
  <script async src="https://static.klaviyo.com/onsite/js/klaviyo.js?company_id=ABC123"></script>
  <!-- Hotjar Tracking Code (app removed months ago) -->
  <script>
    (function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};
    h._hjSettings={hjid:1234567,hjsv:6};})(window,document);
  </script>
</head>
<body>
  {{ content_for_layout }}
  {% render 'privy-embed' %}
</body>
</html>`,
  },

  // --- Orphaned standalone files left by uninstalled apps ---
  {
    key: "snippets/loox.liquid",
    value: `{%- comment -%} Loox reviews widget {%- endcomment -%}
<div id="looxReviews" data-product-id="{{ product.id }}"></div>
<script src="https://cdn.loox.io/widget/loox.js"></script>`,
  },
  {
    key: "assets/judgeme.js",
    value: `// Judge.me review stars loader\nwindow.jdgm = window.jdgm || {};\n/* ... ~14KB of widget code ... */\n${"x".repeat(14000)}`,
  },
  {
    key: "snippets/bold-upsell-common.liquid",
    value: `{%- comment -%} Bold Upsell {%- endcomment -%}
<script src="https://cdn.boldapps.net/upsell/loader.js"></script>`,
  },

  // --- An app that is STILL installed (Privy). Its snippet should be reported as
  //     "active — leave it", NOT as removable ghost code. ---
  {
    key: "snippets/privy-embed.liquid",
    value: `<div class="privy-container" data-privy-id="987"></div>
<script async src="https://widget.privy.com/assets/widget.js"></script>`,
  },

  // --- Genuinely clean files: must produce ZERO findings (false-positive check) ---
  {
    key: "sections/header.liquid",
    value: `<header class="site-header">{{ shop.name }}</header>`,
  },
  {
    key: "assets/base.css",
    value: `:root{--accent:#111} body{margin:0;font-family:system-ui}`,
  },
  { key: "assets/logo.png", value: "" }, // binary — skipped for content scan

  // --- Real-world false positives caught on a stock Horizon theme (regression) ---
  {
    // `resize(` used to match Zendesk's old `zE(` marker.
    key: "assets/utilities.js",
    value: `export function onResize(cb){window.addEventListener("resize",()=>cb());}
const normalized = items.map((i) => normalize(i));`,
  },
  {
    // Polish locale text used to match tawk.to's old `tawk` marker. Locales are
    // excluded from content scanning entirely.
    key: "locales/pl.schema.json",
    value: `{"sections":{"opis":"Zostawkę ustawkę tawkowski przykład tekstu"}}`,
  },
];

// The store currently has ONLY Privy installed. Everything else that matches is ghost.
const installedAppHandles = ["privy"];

const result = scanTheme(assets, { installedAppHandles });
console.log(formatReport(result));

// --- Lightweight assertions so the demo doubles as a correctness check ---
const errors = [];
const get = (id) => result.apps.find((a) => a.appId === id);

if (get("privy")?.status !== "active") errors.push("Privy should be 'active' (still installed)");
if (get("loox")?.status !== "ghost") errors.push("Loox should be 'ghost' (uninstalled)");
if (get("klaviyo")?.status !== "ghost") errors.push("Klaviyo should be flagged as ghost");
if (get("hotjar")?.status !== "ghost") errors.push("Hotjar should be flagged as ghost");
if (get("judgeme")?.status !== "ghost") errors.push("Judge.me should be flagged as ghost");
if (get("bold-upsell")?.status !== "ghost") errors.push("Bold Upsell should be flagged as ghost");
// Privy must NOT be counted in recoverable totals:
if (result.apps.filter((a) => a.status === "ghost").length !== result.totals.apps) {
  errors.push("totals.apps must equal number of ghost apps");
}
// Clean files must not create phantom apps:
const knownIds = new Set(["privy", "loox", "klaviyo", "hotjar", "judgeme", "bold-upsell"]);
for (const a of result.apps) {
  if (!knownIds.has(a.appId)) errors.push(`Unexpected detection: ${a.appId} (possible false positive)`);
}

// --- Activity-signal classification (no install list available) --------------
const sigScan = scanTheme(assets, { activeAppIds: ["privy"] });
const sGet = (id) => sigScan.apps.find((a) => a.appId === id);
if (sGet("privy")?.status !== "active") errors.push("signals: privy should be active");
if (sGet("loox")?.status !== "stale") errors.push("signals: loox should be stale (no sign of life)");
if (sGet("klaviyo")?.status !== "stale") errors.push("signals: klaviyo should be stale");
if (sigScan.totals.apps !== sigScan.apps.filter((a) => a.status !== "active").length) {
  errors.push("signals: totals must count non-active apps");
}

console.log("");
if (errors.length) {
  console.log("❌ ASSERTIONS FAILED:");
  for (const e of errors) console.log("   - " + e);
  process.exit(1);
} else {
  console.log("✅ All assertions passed — detection + install cross-reference correct.");
}
