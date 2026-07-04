// pages.js
//
// Programmatic SEO: one static-ish landing page per app in the signature DB,
// targeting long-tail searches like "does <app> slow down shopify". Each page
// shows real measured impact once enough scans have seen that app in the wild;
// until then it says so honestly instead of inventing a number.

const MIN_SAMPLES_FOR_CONFIDENCE = 3;

const STYLE = `
  :root { --bg:#0f1115; --card:#171a21; --line:#262b36; --text:#e7ebf2; --muted:#9aa3b2; --accent:#4ade80; --warn:#fbbf24; --bad:#f87171; }
  * { box-sizing:border-box; }
  body { margin:0; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); line-height:1.5; }
  .wrap { max-width:760px; margin:0 auto; padding:32px 20px 80px; }
  h1 { font-size:1.9rem; line-height:1.2; margin:.2em 0; }
  h2 { font-size:1.2rem; margin-top:1.6em; }
  .sub { color:var(--muted); font-size:1.05rem; }
  a { color:var(--accent); }
  .pill { display:inline-block; padding:2px 8px; border-radius:999px; font-size:.75rem; background:#0c0e12; border:1px solid var(--line); color:var(--muted); }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:20px; margin-top:20px; }
  .row { display:flex; flex-wrap:wrap; gap:16px; }
  .metric { flex:1; min-width:120px; }
  .metric .big { font-size:1.8rem; font-weight:700; }
  .metric .lbl { color:var(--muted); font-size:.8rem; text-transform:uppercase; letter-spacing:.04em; }
  .scanbox { display:flex; gap:8px; margin:16px 0 8px; }
  input[type=url] { flex:1; padding:14px 16px; border-radius:10px; border:1px solid var(--line); background:#0c0e12; color:var(--text); font-size:1rem; }
  button { padding:14px 20px; border:0; border-radius:10px; background:var(--accent); color:#06210f; font-weight:700; font-size:1rem; cursor:pointer; white-space:nowrap; }
  button:disabled { opacity:.55; cursor:default; }
  .hint { color:var(--muted); font-size:.85rem; }
  .err { color:var(--bad); margin-top:12px; }
  .spinner { display:none; margin:16px 0; color:var(--muted); }
  .spinner.on { display:block; }
  ul.applist { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:1fr 1fr; gap:6px 20px; }
  ul.applist li { padding:8px 0; border-bottom:1px solid var(--line); }
  footer { color:var(--muted); font-size:.85rem; margin-top:40px; border-top:1px solid var(--line); padding-top:20px; }
`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function categoryLabel(cat) {
  const labels = {
    reviews: "product reviews",
    email: "email/SMS marketing",
    popups: "pop-ups",
    upsell: "upsell/cross-sell",
    subscriptions: "subscriptions",
    "all-in-one": "all-in-one marketing",
    loyalty: "loyalty & rewards",
    chat: "live chat/helpdesk",
    "page-builder": "page building",
    analytics: "analytics",
    pixel: "ad tracking pixel",
    translation: "translation",
    wishlist: "wishlist",
    "back-in-stock": "back-in-stock alerts",
    shipping: "shipping/tracking",
    trust: "trust/urgency",
    payments: "buy-now-pay-later",
    search: "search & filter",
  };
  return labels[cat] || cat;
}

// Scan widget JS, parameterized to the app name so the results emphasize whether
// THIS app shows up. Reuses the same /api/scan endpoint as the homepage.
function scanWidgetScript(appName) {
  return `
const $ = (id) => document.getElementById(id);
async function scan() {
  const url = $("url").value.trim();
  $("err").textContent = "";
  $("results").innerHTML = "";
  if (!url) { $("err").textContent = "Enter your store URL first."; return; }
  $("scanBtn").disabled = true;
  $("spinner").classList.add("on");
  try {
    const r = await fetch("/api/scan", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ url }) });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Scan failed");
    render(data);
  } catch (e) {
    $("err").textContent = e.message;
  } finally {
    $("scanBtn").disabled = false;
    $("spinner").classList.remove("on");
  }
}
function render(d) {
  const target = ${JSON.stringify(appName)};
  const hit = (d.apps || []).find(a => a.name === target);
  const other = (d.apps || []).filter(a => a.name !== target);
  const hitCard = hit
    ? '<div class="card"><h3 style="margin:.2em 0;color:var(--warn)">Found: ' + hit.name + '</h3><div class="row"><div class="metric"><div class="big">' + hit.weightKb + ' KB</div><div class="lbl">Page weight</div></div><div class="metric"><div class="big">' + hit.requests + '</div><div class="lbl">Requests</div></div><div class="metric"><div class="big">' + (hit.blockingMs || '—') + (hit.blockingMs ? ' ms' : '') + '</div><div class="lbl">Blocking time</div></div></div></div>'
    : '<div class="card"><p class="hint">' + target + ' was not detected on this page (or it\\'s inactive). Full results below.</p></div>';
  const otherRows = other.map(a => '<tr><td>' + a.name + ' <span class="pill">' + a.category + '</span></td><td>' + a.weightKb + ' KB</td><td>' + a.requests + '</td><td>' + (a.blockingMs ? a.blockingMs + ' ms' : '—') + '</td></tr>').join('');
  $("results").innerHTML = hitCard + '<div class="card"><h3 style="margin:.2em 0 0;">Speed score: ' + (d.score ?? '—') + '/100 · ' + (d.pageWeightKb ?? '—') + ' KB · ' + (d.requests ?? '—') + ' requests</h3>' +
    (otherRows ? '<table style="width:100%;border-collapse:collapse;margin-top:12px;"><thead><tr><th style="text-align:left;color:var(--muted);font-size:.8rem;">Other apps found</th><th></th><th></th><th></th></tr></thead><tbody>' + otherRows + '</tbody></table>' : '') +
    '<p class="hint" style="margin-top:12px;"><a href="/">Full scan report &amp; app cleanup guide &rarr;</a></p></div>';
}
$("scanBtn").addEventListener("click", scan);
$("url").addEventListener("keydown", (e) => { if (e.key === "Enter") scan(); });
`;
}

export function renderAppPage(sig, stat) {
  const catLabel = categoryLabel(sig.category);
  const title = `Does ${sig.name} slow down your Shopify store? — Theme Medic`;
  const description = `Real scan data on ${sig.name}'s page weight and load-time cost on Shopify stores. Free instant scan tells you if it's active or left-behind ghost code.`;

  let statBlock;
  if (stat && stat.sampleCount >= MIN_SAMPLES_FOR_CONFIDENCE) {
    statBlock = `
      <div class="card">
        <h2 style="margin-top:0;">Measured impact (n=${stat.sampleCount} real scans)</h2>
        <div class="row">
          <div class="metric"><div class="big">${stat.avgWeightKb} KB</div><div class="lbl">Avg. page weight</div></div>
          <div class="metric"><div class="big">${stat.avgRequests}</div><div class="lbl">Avg. requests</div></div>
          <div class="metric"><div class="big">${stat.avgBlockingMs} ms</div><div class="lbl">Avg. blocking time</div></div>
        </div>
        <p class="hint">Averaged across every Theme Medic scan that detected ${escapeHtml(sig.name)} on a live storefront.</p>
      </div>`;
  } else if (stat && stat.sampleCount > 0) {
    statBlock = `
      <div class="card">
        <h2 style="margin-top:0;">Early data (n=${stat.sampleCount})</h2>
        <p class="hint">We've only seen ${escapeHtml(sig.name)} in ${stat.sampleCount} scan${stat.sampleCount === 1 ? "" : "s"} so far — not enough yet for a reliable average. So far: ~${stat.avgWeightKb} KB, ${stat.avgRequests} requests. Scan your store below to add a data point and see your own number.</p>
      </div>`;
  } else {
    statBlock = `
      <div class="card">
        <h2 style="margin-top:0;">No scan data yet</h2>
        <p class="hint">Nobody's scanned a store running ${escapeHtml(sig.name)} through Theme Medic yet, so we won't invent a number. Run the free scan below and be the first — it'll show your store's real weight and request count for this app.</p>
      </div>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}" />
<meta property="og:title" content="${escapeHtml(title)}" />
<meta property="og:description" content="${escapeHtml(description)}" />
<meta property="og:type" content="website" />
<link rel="canonical" href="https://theme-medic-scan.onrender.com/apps/${sig.id}" />
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Theme Medic", item: "https://theme-medic-scan.onrender.com/" },
    { "@type": "ListItem", position: 2, name: "Apps", item: "https://theme-medic-scan.onrender.com/apps" },
    { "@type": "ListItem", position: 3, name: sig.name, item: `https://theme-medic-scan.onrender.com/apps/${sig.id}` },
  ],
})}
</script>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: `Does ${sig.name} slow down my Shopify store?`,
      acceptedAnswer: {
        "@type": "Answer",
        text: `${sig.name} adds its own scripts and assets to every page load, like any Shopify app. The actual cost varies by store — scan your store free at Theme Medic to see the real page weight, request count, and blocking time it adds on your theme.`,
      },
    },
    {
      "@type": "Question",
      name: `If I uninstall ${sig.name}, does its code get removed automatically?`,
      acceptedAnswer: {
        "@type": "Answer",
        text: `Usually not. Uninstalling a Shopify app removes the app itself, but code it already injected into your theme (in theme files or settings) typically stays behind as "ghost code" until someone removes it manually.`,
      },
    },
  ],
})}
</script>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <p class="hint"><a href="/apps">&larr; All 60 apps</a></p>
  <h1>Does ${escapeHtml(sig.name)} slow down your Shopify store?</h1>
  <p class="sub">${escapeHtml(sig.name)} is a <span class="pill">${escapeHtml(catLabel)}</span> app. Like any app, it adds its own script and asset weight to every page load — and if you ever uninstall it, that code can be left behind as dead weight ("ghost code") unless you clean up the theme manually.</p>

  ${statBlock}

  <div class="card">
    <h2 style="margin-top:0;">Check your own store</h2>
    <p class="hint">Paste your store URL — free, instant, real Google PageSpeed data.</p>
    <div class="scanbox">
      <input id="url" type="url" placeholder="yourstore.com" autocomplete="off" />
      <button id="scanBtn">Scan free</button>
    </div>
    <div id="spinner" class="spinner">⏳ Loading your store like a real visitor and measuring it…</div>
    <div id="err" class="err"></div>
    <div id="results"></div>
  </div>

  <h2>Is ${escapeHtml(sig.name)} still active, or is it ghost code?</h2>
  <p class="sub">If you've since uninstalled ${escapeHtml(sig.name)}, uninstalling the app in Shopify usually does <strong>not</strong> remove the code it injected into your theme. That leftover code keeps loading on every page, forever, unless someone removes it by hand. <a href="/">Theme Medic</a>'s Shopify app tells you which is which — active app vs. dead code — and daily-monitors for new ghost code after every app change.</p>

  <footer>
    Theme Medic — Shopify store performance &amp; app-bloat monitoring.
    <br /><br />
    <a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Service</a>
  </footer>
</div>
<script>${scanWidgetScript(sig.name)}</script>
</body>
</html>`;
}

export function renderAppIndexPage(signatures) {
  const byCategory = new Map();
  for (const sig of signatures) {
    const list = byCategory.get(sig.category) ?? [];
    list.push(sig);
    byCategory.set(sig.category, list);
  }
  const sections = [...byCategory.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([cat, apps]) => {
      const items = apps
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((a) => `<li><a href="/apps/${a.id}">${escapeHtml(a.name)}</a></li>`)
        .join("");
      return `<h2>${escapeHtml(categoryLabel(cat))}</h2><ul class="applist">${items}</ul>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>60 Shopify apps that can slow your store — Theme Medic</title>
<meta name="description" content="Browse real page-weight and load-time data for 60 common Shopify apps (reviews, email, upsell, chat, and more). See which ones are quietly costing you speed." />
<link rel="canonical" href="https://theme-medic-scan.onrender.com/apps" />
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "ItemList",
  itemListElement: signatures.map((s, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: s.name,
    url: `https://theme-medic-scan.onrender.com/apps/${s.id}`,
  })),
})}
</script>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
  <p class="hint"><a href="/">&larr; Free scan tool</a></p>
  <h1>Shopify apps we track</h1>
  <p class="sub">Theme Medic matches every scan against 60 common Shopify apps to see exactly which ones are adding weight to a store — and whether leftover code from an uninstalled app is still loading. Pick an app to see real measured impact.</p>
  ${sections}
  <footer>
    Theme Medic — Shopify store performance &amp; app-bloat monitoring.
    <br /><br />
    <a href="/privacy.html">Privacy Policy</a> · <a href="/terms.html">Terms of Service</a>
  </footer>
</div>
</body>
</html>`;
}

export function renderSitemap(baseUrl, signatures) {
  const urls = [
    `${baseUrl}/`,
    `${baseUrl}/apps`,
    ...signatures.map((s) => `${baseUrl}/apps/${s.id}`),
  ];
  const body = urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}
