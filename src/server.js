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
import { getCachedScan, putCachedScan, saveLead, leadsDurable } from "./db.js";

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
  res.json({ ok: true, psi_key: Boolean(PSI_API_KEY), leads_durable: leadsDurable() });
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
  try {
    const id = await saveLead({
      email,
      storeUrl: normalizeUrl(req.body?.url) ?? null,
      perfScore: Number.isInteger(req.body?.perfScore) ? req.body.perfScore : null,
    });
    res.json({ ok: true, id });
  } catch (err) {
    console.error("saveLead failed:", err.message);
    res.status(500).json({ error: "Could not save right now — try again." });
  }
});

app.listen(PORT, () => {
  console.log(`Theme Medic scan tool on :${PORT}  (PSI key: ${PSI_API_KEY ? "set" : "MISSING"})`);
});
