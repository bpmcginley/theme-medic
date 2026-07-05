// server.js
//
// M2: the free public scan tool. Anyone pastes their Shopify store URL and gets an
// instant performance + app-bloat report. This is the acquisition hook and the market
// test — no OAuth, no Partner account. Leads captured here become the funnel into the
// paid monitoring app.

import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { collectMetrics } from "./metrics.js";
import { attributeResources } from "./attribute.js";
import {
  getCachedScan,
  putCachedScan,
  saveLead,
  leadsDurable,
  recordAppStat,
  getAppStat,
  recordFunnelEvent,
  getFunnelStats,
} from "./db.js";
import { sendReportEmail } from "./email.js";
import { signatures } from "./signatures.js";
import { renderAppPage, renderAppIndexPage, renderSitemap, renderGuidePage, GUIDES } from "./pages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3200;
const PSI_API_KEY = process.env.PSI_API_KEY;

app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Normalize + validate a user-supplied store URL. Returns a clean https URL or null.
function normalizeUrl(input) {
  if (!input || typeof input !== "string") return null;
  let s = input.trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

// Shape the heavy internal snapshot into the lean payload the UI renders.
function toReport(snapshot, attribution) {
  return {
    url: snapshot.finalUrl,
    score: snapshot.score,
    pageWeightKb: snapshot.totalBytes ? Math.round(snapshot.totalBytes / 1024) : null,
    requests: snapshot.requestCount,
    vitals: {
      lcpMs: snapshot.lab.lcp ? Math.round(snapshot.lab.lcp) : null,
      cls: snapshot.lab.cls != null ? Number(snapshot.lab.cls.toFixed(3)) : null,
      tbtMs: snapshot.lab.tbt ? Math.round(snapshot.lab.tbt) : null,
    },
    field: snapshot.field
      ? {
          overall: snapshot.field.overall,
          lcpMs: snapshot.field.lcp,
          inpMs: snapshot.field.inp,
        }
      : null,
    apps: attribution.apps.map((a) => ({
      appId: a.appId,
      name: a.app,
      category: a.category,
      weightKb: Math.round(a.bytes / 1024),
      requests: a.requests,
      blockingMs: a.blockingMs ?? 0,
    })),
    otherThirdPartyKb: attribution.unattributed.bytes
      ? Math.round(attribution.unattributed.bytes / 1024)
      : 0,
    scannedAt: snapshot.fetchedAt,
  };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    psi_key: Boolean(PSI_API_KEY),
    leads_durable: leadsDurable(),
    email_configured: Boolean(process.env.RESEND_API_KEY && process.env.LEAD_FROM_EMAIL),
  });
});

app.post("/api/scan", async (req, res) => {
  const url = normalizeUrl(req.body?.url);
  if (!url) return res.status(400).json({ error: "Enter a valid store URL." });

  try {
    const cached = getCachedScan(url);
    if (cached) return res.json({ ...cached, cached: true });

    const snapshot = await collectMetrics(url, { strategy: "mobile", apiKey: PSI_API_KEY });
    const attribution = attributeResources(snapshot);
    const report = toReport(snapshot, attribution);

    putCachedScan(url, report);
    for (const a of report.apps) {
      if (!a.appId) continue;
      recordAppStat({ appId: a.appId, weightKb: a.weightKb, requests: a.requests, blockingMs: a.blockingMs }).catch(
        (e) => console.error("recordAppStat failed:", e.message),
      );
    }
    recordFunnelEvent("scan").catch((e) => console.error("recordFunnelEvent(scan) failed:", e.message));
    res.json({ ...report, cached: false });
  } catch (err) {
    const quota = /\b429\b/.test(err.message);
    res.status(quota ? 503 : 502).json({
      error: quota
        ? "Scan service is briefly over its quota — try again in a minute."
        : "Could not scan that URL. Check it's a public, live store.",
      detail: err.message.slice(0, 200),
    });
  }
});

app.post("/api/lead", async (req, res) => {
  const email = (req.body?.email || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email." });
  }
  const storeUrl = normalizeUrl(req.body?.url) ?? null;
  const perfScore = Number.isInteger(req.body?.perfScore) ? req.body.perfScore : null;
  try {
    const id = await saveLead({ email, storeUrl, perfScore });
    recordFunnelEvent("lead").catch((e) => console.error("recordFunnelEvent(lead) failed:", e.message));

    // Fire-and-forget: send the report immediately using this scan's cached data
    // (same TTL as the UI's own re-render), so the "email me my report" promise is
    // actually delivered rather than just stored. No-ops silently until an email
    // provider key is configured (see src/email.js).
    if (storeUrl) {
      const cached = getCachedScan(storeUrl);
      sendReportEmail(email, { url: storeUrl, score: perfScore ?? cached?.score ?? null, apps: cached?.apps ?? [] }).catch(
        (e) => console.error("sendReportEmail failed:", e.message),
      );
    }

    res.json({ ok: true, id });
  } catch (err) {
    console.error("saveLead failed:", err.message);
    res.status(500).json({ error: "Could not save right now — try again." });
  }
});

// Aggregate funnel counts for the founder to check conversion — no PII, optionally
// gated by INTERNAL_STATS_KEY if set (so it's not left wide open once traffic exists).
app.get("/internal/funnel-stats", async (req, res) => {
  const requiredKey = process.env.INTERNAL_STATS_KEY;
  if (requiredKey && req.query.key !== requiredKey) {
    return res.status(404).end();
  }
  try {
    res.json(await getFunnelStats());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Programmatic SEO: one page per app in the signature DB (SHIP_PLAN.md 4.3).
app.get("/apps", (_req, res) => {
  res.type("html").send(renderAppIndexPage(signatures));
});

app.get("/apps/:id", async (req, res) => {
  const sig = signatures.find((s) => s.id === req.params.id);
  if (!sig) return res.status(404).type("html").send("<p>App not found. <a href=\"/apps\">Browse all apps</a>.</p>");
  const stat = await getAppStat(sig.id).catch(() => null);
  res.type("html").send(renderAppPage(sig, stat));
});

app.get("/guides/:slug", (req, res) => {
  const guide = GUIDES.find((g) => g.slug === req.params.slug);
  if (!guide) return res.status(404).type("html").send("<p>Guide not found. <a href=\"/\">Back home</a>.</p>");
  res.type("html").send(renderGuidePage(guide));
});

app.get("/sitemap.xml", (req, res) => {
  const baseUrl = `${req.protocol}://${req.get("host")}`;
  res.type("application/xml").send(renderSitemap(baseUrl, signatures));
});

app.listen(PORT, () => {
  console.log(`Theme Medic scan tool on :${PORT}  (PSI key: ${PSI_API_KEY ? "set" : "MISSING"})`);
});
