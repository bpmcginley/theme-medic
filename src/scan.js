// scan.js
//
// Orchestration layer. Turns raw PSI output + app attribution into a compact, storable
// "scan record" — the unit we persist over time and diff for drift detection. Also
// scans multiple page types (home / product / collection) so the report reflects the
// whole store, not just the homepage.

import { collectMetrics } from "./metrics.js";
import { attributeResources } from "./attribute.js";

// Extract unique third-party hostnames from a snapshot (anything not on the store's
// own domain). Used by drift detection to spot newly-appeared external scripts.
function thirdPartyHosts(snapshot) {
  let storeHost = null;
  try {
    storeHost = new URL(snapshot.finalUrl).hostname.replace(/^www\./, "");
  } catch {
    /* ignore */
  }
  const hosts = new Set();
  for (const r of snapshot.resources ?? []) {
    try {
      const h = new URL(r.url).hostname;
      const bare = h.replace(/^www\./, "");
      if (storeHost && (bare === storeHost || bare.endsWith("." + storeHost))) continue;
      // Skip Shopify's own first-party CDN/infra — not a third-party app.
      if (/(^|\.)(shopify|shopifycdn|myshopify)\.com$/.test(h) || h.endsWith("cdn.shopify.com")) continue;
      hosts.add(h);
    } catch {
      /* ignore */
    }
  }
  return [...hosts].sort();
}

/**
 * Build a compact, comparable scan record from a metrics snapshot + attribution.
 * Pure (no network) — safe to unit test.
 */
export function buildScanRecord(snapshot, attribution) {
  return {
    url: snapshot.finalUrl,
    fetchedAt: snapshot.fetchedAt,
    score: snapshot.score,
    totalBytes: snapshot.totalBytes ?? 0,
    requestCount: snapshot.requestCount ?? 0,
    lab: {
      lcp: snapshot.lab?.lcp ?? null,
      cls: snapshot.lab?.cls ?? null,
      tbt: snapshot.lab?.tbt ?? null,
      fcp: snapshot.lab?.fcp ?? null,
    },
    field: snapshot.field ?? null,
    apps: (attribution.apps ?? []).map((a) => ({
      appId: a.appId,
      name: a.app,
      category: a.category,
      bytes: a.bytes,
      requests: a.requests,
      blockingMs: a.blockingMs ?? 0,
    })),
    hosts: thirdPartyHosts(snapshot),
  };
}

/** Scan a single URL → scan record (makes a live PSI call). */
export async function scanUrl(url, opts = {}) {
  const snapshot = await collectMetrics(url, opts);
  const attribution = attributeResources(snapshot);
  return buildScanRecord(snapshot, attribution);
}

/**
 * Scan several representative page types for a store. Accepts a base origin and an
 * optional set of paths; returns one scan record per page that scanned successfully.
 */
export async function scanStore(origin, { paths = ["/"], ...opts } = {}) {
  const base = origin.replace(/\/+$/, "");
  const records = [];
  for (const p of paths) {
    const url = p.startsWith("http") ? p : base + (p.startsWith("/") ? p : "/" + p);
    try {
      records.push(await scanUrl(url, opts));
    } catch (err) {
      records.push({ url, error: err.message });
    }
  }
  return records;
}
